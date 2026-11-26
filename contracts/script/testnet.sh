#!/usr/bin/env bash
# KeyEscrow: BSC testnet (chainId 97), opBNB testnet (5611) and BSC mainnet (56, the capped pilot) deploy helper.
# See docs/DEPLOY.md. DEPLOY_CHAIN_ID picks the network: 97 (default, pnpm deploy:testnet*), 5611 (pnpm deploy:opbnb*)
# or 56 (pnpm deploy:mainnet*). Same rules on all three; 56 additionally needs MAINNET_I_UNDERSTAND=yes to broadcast,
# uses the real BSC-USD (never MockUSDT), deploys no Fleet Vault and caps the factory (MAX_* below).
#
#   contracts/script/testnet.sh check      preflight; NEVER sends a transaction       (pnpm deploy:testnet:check)
#   contracts/script/testnet.sh deploy     the one broadcast; needs ALLOW_NON_LOCAL_BROADCAST=true and a typed
#                                          confirmation (--yes skips the prompt)       (pnpm deploy:testnet)
#   contracts/script/testnet.sh verify     verify via Etherscan API V2 (BscScan testnet / opBNB testnet BscScan)
#                                                                                       (pnpm deploy:testnet:verify)
#   contracts/script/testnet.sh rehearse   whole path against a throwaway LOCAL anvil started with --chain-id 97
#                                          or 5611 (and one with the matching mainnet id, 56 / 204, for the refusal check)
#                                                                                       (pnpm deploy:testnet:rehearse)
#
# Env (repo-root .env is loaded for names that are not already set; KEYESCROW_NO_DOTENV=1 skips it):
#   DEPLOY_CHAIN_ID            97 (default), 5611 or 56. Taken from the command line only, never from .env.
#   BSC_TESTNET_RPC_URL        required for 97. Must answer chainId 97.
#   BSC_MAINNET_RPC_URL        required for 56. Must answer chainId 56.
#   MAINNET_I_UNDERSTAND       must be `yes` for `deploy` on 56 (on top of ALLOW_NON_LOCAL_BROADCAST and the prompt)
#   MAX_DEPOSIT, MAX_RENT_PER_PERIOD, MAX_ACTIVE_VALUE   pilot caps in WHOLE tokens; default 5 / 2 / 25 on 56,
#                              unlimited on the testnets (the factory owner can change them later with setCaps)
#   OPBNB_TESTNET_RPC_URL      required for 5611. Must answer chainId 5611 (e.g. https://opbnb-testnet-rpc.bnbchain.org).
#   DEPLOYER_ADDRESS           required. Public address of the deployer; cross-checked against the wallet.
#   one deployer wallet:
#     DEPLOYER_ACCOUNT         preferred: name of a `cast wallet import` keystore (~/.foundry/keystores/<name>)
#     DEPLOYER_KEYSTORE        or: path to a keystore file
#     PRIVATE_KEY              or: raw key (discouraged)
#   DEPLOYER_PASSWORD_FILE     optional keystore password file (otherwise forge prompts)
#   FACTORY_OWNER, FEE_RECIPIENT, DEFAULT_ARBITER   required; no defaults off anvil, anvil accounts refused
#   FEE_BPS                    optional, 0-1000 (default 1000 = 10% of one month's rent, once per lease)
#   BSCSCAN_API_KEY            needed for verify (an Etherscan API V2 key, valid for 97 and 5611; forge sends it as
#                              ETHERSCAN_API_KEY)
#   VERIFIER_URL               optional verifier API override (default: forge's Etherscan V2 endpoint for the chain)
#   ALLOW_NON_LOCAL_BROADCAST  must be `true` for `deploy`
#   FLEET_OPERATOR             optional: Fleet Vault operator (maintenance fee); defaults to FEE_RECIPIENT
#   FLEET_OPERATOR_FEE_BPS     optional: operator fee in bps of vault income (default 1000, max 3000)
#   FORCE_REDEPLOY             `true` to overwrite an existing deployments/<chainId>.json
#   DEPLOYMENTS_DIR            relative to contracts/ (default `deployments`)
set -euo pipefail

CHAIN_ID="${DEPLOY_CHAIN_ID:-97}"
case "$CHAIN_ID" in
  97) NET="BSC testnet" RPC_VAR=BSC_TESTNET_RPC_URL PNPM=deploy:testnet ;;
  5611) NET="opBNB testnet" RPC_VAR=OPBNB_TESTNET_RPC_URL PNPM=deploy:opbnb ;;
  56) NET="BSC mainnet" RPC_VAR=BSC_MAINNET_RPC_URL PNPM=deploy:mainnet ;;
  *) echo "DEPLOY_CHAIN_ID must be 97 (BSC testnet), 5611 (opBNB testnet) or 56 (BSC mainnet), got '$CHAIN_ID'" >&2; exit 64 ;;
esac
MAINNET=0 CUR=tBNB SYMBOL=mUSDT
[[ "$CHAIN_ID" == 56 ]] && MAINNET=1 CUR=BNB SYMBOL=USDT
BSC_USD=0x55d398326f99059fF775485246999027B3197955
CONTRACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$CONTRACTS/.." && pwd)"
cd "$CONTRACTS"

if [[ -t 1 ]]; then G=$'\e[32m' R=$'\e[31m' Y=$'\e[33m' B=$'\e[1m' N=$'\e[0m'; else G='' R='' Y='' B='' N=''; fi
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
bad() { printf '  %s✗%s %s\n' "$R" "$N" "$*"; FAILS=$((FAILS + 1)); }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die() { printf '%s%s%s\n' "$R" "$1" "$N" >&2; exit "${2:-1}"; }
FAILS=0

load_dotenv() {
  [[ "${KEYESCROW_NO_DOTENV:-}" == 1 || ! -f "$ROOT/.env" ]] && return 0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}" val="${BASH_REMATCH[3]}"
    val="${val%$'\r'}"
    [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]] && val="${BASH_REMATCH[1]}"
    [[ -z "${!key:-}" && -n "$val" ]] && export "$key=$val"
  done <"$ROOT/.env"
  return 0
}

is_address() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }
deployments_dir() { echo "${DEPLOYMENTS_DIR:-deployments}"; }
deployment_file() { echo "$(deployments_dir)/$CHAIN_ID.json"; }
# Big-int compare / format without floating point (balances can exceed 2^63 wei).
wei_gte() { node -e 'process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)' "$1" "$2"; }
fmt_bnb() { cast from-wei "$1" ether; }

# Sets WALLET_MODE and WALLET_ARGS (forge flags for the signer; empty for PRIVATE_KEY, which Deploy.s.sol reads).
resolve_wallet() {
  local n=0
  [[ -n "${DEPLOYER_ACCOUNT:-}" ]] && n=$((n + 1))
  [[ -n "${DEPLOYER_KEYSTORE:-}" ]] && n=$((n + 1))
  [[ -n "${PRIVATE_KEY:-}" ]] && n=$((n + 1))
  WALLET_ARGS=()
  if ((n == 0)); then
    WALLET_MODE=none
    bad "no deployer wallet: set DEPLOYER_ACCOUNT (cast wallet keystore name, preferred), DEPLOYER_KEYSTORE or PRIVATE_KEY"
    return
  fi
  if ((n > 1)); then
    WALLET_MODE=none
    bad "set exactly one of DEPLOYER_ACCOUNT / DEPLOYER_KEYSTORE / PRIVATE_KEY"
    return
  fi
  if [[ -n "${DEPLOYER_ACCOUNT:-}" ]]; then
    WALLET_MODE="keystore account '$DEPLOYER_ACCOUNT'"
    WALLET_ARGS=(--account "$DEPLOYER_ACCOUNT")
    if [[ -f "${FOUNDRY_KEYSTORES_DIR:-$HOME/.foundry/keystores}/$DEPLOYER_ACCOUNT" ]]; then
      ok "deployer wallet: $WALLET_MODE"
    else
      bad "keystore '$DEPLOYER_ACCOUNT' not found in ~/.foundry/keystores (cast wallet import $DEPLOYER_ACCOUNT --interactive)"
    fi
  elif [[ -n "${DEPLOYER_KEYSTORE:-}" ]]; then
    WALLET_MODE="keystore file"
    WALLET_ARGS=(--keystore "$DEPLOYER_KEYSTORE")
    if [[ -f "$DEPLOYER_KEYSTORE" ]]; then ok "deployer wallet: $WALLET_MODE"; else bad "DEPLOYER_KEYSTORE file not found"; fi
  else
    WALLET_MODE="PRIVATE_KEY env"
    warn "deployer wallet: PRIVATE_KEY env (works, but a cast wallet keystore via DEPLOYER_ACCOUNT is preferred)"
  fi
  if [[ -n "${DEPLOYER_PASSWORD_FILE:-}" && "$WALLET_MODE" == keystore* ]]; then
    WALLET_ARGS+=(--password-file "$DEPLOYER_PASSWORD_FILE")
  fi
}

# Preflight. Never sends a transaction: the only forge invocation below has no --broadcast.
preflight() {
  FAILS=0
  echo "${B}KeyEscrow preflight: $NET (chainId $CHAIN_ID). No transaction is sent.${N}"
  local t
  for t in forge cast node; do command -v "$t" >/dev/null || die "missing tool: $t" 2; done

  if [[ -z "$RPC" ]]; then
    die "$RPC_VAR is not set. Put a $NET RPC URL in .env (see docs/DEPLOY.md, step 3)." 2
  fi
  local rpc_chain
  if ! rpc_chain="$(timeout 20 cast chain-id --rpc-url "$RPC" 2>/dev/null)"; then
    die "RPC at $RPC_VAR did not answer eth_chainId (unreachable, wrong URL, or rate limited)." 2
  fi
  if [[ "$rpc_chain" != "$CHAIN_ID" ]]; then
    die "RPC at $RPC_VAR reports chainId $rpc_chain, expected $CHAIN_ID ($NET). Refusing." 3
  fi
  ok "RPC reachable, chainId $rpc_chain"

  resolve_wallet
  if [[ -z "${DEPLOYER_ADDRESS:-}" ]]; then
    bad "DEPLOYER_ADDRESS is not set (public address of the deployer wallet)"
  elif ! is_address "$DEPLOYER_ADDRESS"; then
    bad "DEPLOYER_ADDRESS is not an address"
  else
    ok "DEPLOYER_ADDRESS $DEPLOYER_ADDRESS"
  fi

  local v
  for v in FACTORY_OWNER FEE_RECIPIENT DEFAULT_ARBITER; do
    if [[ -z "${!v:-}" ]]; then bad "$v is not set (no default off anvil)"
    elif ! is_address "${!v}"; then bad "$v is not an address"
    else ok "$v ${!v}"; fi
  done
  if [[ -n "${FEE_BPS:-}" ]]; then
    if [[ "$FEE_BPS" =~ ^[0-9]+$ ]] && ((FEE_BPS <= 1000)); then ok "FEE_BPS $FEE_BPS"; else bad "FEE_BPS must be 0-1000"; fi
  else
    ok "FEE_BPS default 1000 (10% of one month's rent, once per lease)"
  fi
  if ((MAINNET)); then
    if [[ -n "${TOKEN_ADDRESS:-}" && "$(tr 'A-F' 'a-f' <<<"$TOKEN_ADDRESS")" != "$(tr 'A-F' 'a-f' <<<"$BSC_USD")" ]]; then
      bad "TOKEN_ADDRESS must be BSC-USD ($BSC_USD) on mainnet, or unset"
    else
      ok "token: BSC-USD $BSC_USD (18 decimals; no MockUSDT, no Fleet Vault on mainnet)"
    fi
    ok "pilot caps (whole USDT): max deposit ${MAX_DEPOSIT:-5}, max rent per period ${MAX_RENT_PER_PERIOD:-2}, max held in all escrows ${MAX_ACTIVE_VALUE:-25}"
    if [[ "${MAINNET_I_UNDERSTAND:-}" == yes ]]; then ok "MAINNET_I_UNDERSTAND=yes"; else warn "MAINNET_I_UNDERSTAND is not 'yes': fine for this check, deploy will refuse"; fi
  else
    [[ -n "${TOKEN_ADDRESS:-}" ]] && bad "TOKEN_ADDRESS is set: on testnet the deploy creates its own MockUSDT, unset it"
  fi
  if [[ -n "${BSCSCAN_API_KEY:-}" ]]; then ok "BSCSCAN_API_KEY set (verification)"; else warn "BSCSCAN_API_KEY not set: deploy works, verification will be skipped"; fi
  if [[ "${ALLOW_NON_LOCAL_BROADCAST:-}" == true ]]; then ok "ALLOW_NON_LOCAL_BROADCAST=true"; else warn "ALLOW_NON_LOCAL_BROADCAST is not 'true': fine for this check, deploy will refuse"; fi
  if [[ -f "$(deployment_file)" ]]; then
    warn "$(deployment_file) already exists: deploy refuses unless FORCE_REDEPLOY=true"
  fi

  if ((FAILS > 0)) || ! is_address "${DEPLOYER_ADDRESS:-}"; then
    echo "${R}Preflight failed ($FAILS problem(s)); simulation skipped.${N}"
    return 1
  fi

  # Simulation: fork the RPC state locally and run Deploy.s.sol WITHOUT --broadcast. The opt-in flag is set only for
  # this process so the script's chain guard lets the dry run through; output goes to <chainId>.dry-run.json.
  echo "  … simulating Deploy.s.sol against the RPC (forge script, no --broadcast)"
  local out
  if ! out="$(ALLOW_NON_LOCAL_BROADCAST=true MAINNET_I_UNDERSTAND=yes forge script script/Deploy.s.sol --rpc-url "$RPC" \
    --sender "$DEPLOYER_ADDRESS" 2>&1)"; then
    bad "simulation failed:"
    grep -E "Error|revert|error" <<<"$out" | head -8 | sed 's/^/      /'
    return 1
  fi
  local gas est_bnb price
  gas="$(sed -nE 's/^Estimated total gas used for script: ([0-9]+).*/\1/p' <<<"$out" | tail -1)"
  est_bnb="$(sed -nE 's/^Estimated amount required: ([0-9.]+) .*/\1/p' <<<"$out" | tail -1)"
  price="$(sed -nE 's/^Estimated (max fee per gas|gas price): ([0-9.]+ gwei).*/\2/p' <<<"$out" | tail -1)"
  if [[ -z "$gas" || -z "$est_bnb" ]]; then
    bad "could not read the gas estimate from forge output"
    return 1
  fi
  ESTIMATE_WEI="$(cast to-wei "$est_bnb" ether)"
  if ((MAINNET)); then ok "simulation OK: EscrowFactory (+ RentalEscrow implementation) on BSC-USD"
  else ok "simulation OK: MockUSDT + EscrowFactory (+ RentalEscrow implementation) + FleetVault"; fi
  ok "estimate: ${B}$est_bnb $CUR${N} ($gas gas at ${price:-?}; includes forge's 130% gas margin)"
  if [[ "$CHAIN_ID" == 5611 ]]; then
    # forge prices L2 execution gas only; opBNB adds an L1 data fee (about 0.000002 tBNB for this deploy, Nov 2026).
    ESTIMATE_WEI="$(node -e 'console.log(String(BigInt(process.argv[1]) + 10n ** 14n))' "$ESTIMATE_WEI")"
    est_bnb="$(fmt_bnb "$ESTIMATE_WEI")"
    ok "plus 0.0001 tBNB headroom for opBNB's L1 data fee (not in forge's estimate): $est_bnb tBNB"
  fi

  local bal
  bal="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC")"
  if wei_gte "$bal" "$ESTIMATE_WEI"; then
    ok "deployer balance $(fmt_bnb "$bal") $CUR >= estimate"
  else
    bad "deployer balance $(fmt_bnb "$bal") $CUR < estimate $est_bnb $CUR: fund it (docs/DEPLOY.md, step 1; opBNB: bridge)"
  fi

  if ((FAILS > 0)); then echo "${R}Preflight failed ($FAILS problem(s)).${N}"; return 1; fi
  echo "${G}Preflight passed.${N} Nothing was sent. The broadcast is: pnpm $PNPM (only after OK)."
}

cmd_check() { preflight; }

cmd_deploy() {
  local yes=0
  [[ "${1:-}" == "--yes" ]] && yes=1
  local allow="${ALLOW_NON_LOCAL_BROADCAST:-}"
  if [[ "$allow" != true ]]; then
    die "Refusing to broadcast: set ALLOW_NON_LOCAL_BROADCAST=true for this one command (docs/DEPLOY.md, step 6)." 4
  fi
  if ((MAINNET)) && [[ "${MAINNET_I_UNDERSTAND:-}" != yes ]]; then
    die "Refusing to broadcast to BSC MAINNET (real money): also set MAINNET_I_UNDERSTAND=yes (docs/DEPLOY.md, mainnet pilot)." 4
  fi
  if [[ -f "$(deployment_file)" && "${FORCE_REDEPLOY:-}" != true ]]; then
    die "$(deployment_file) exists. Refusing to overwrite a live deployment (FORCE_REDEPLOY=true to replace it)." 4
  fi
  preflight || die "Preflight failed; nothing was sent." 1

  if ((yes == 0)); then
    [[ -t 0 ]] || die "No TTY for the confirmation prompt; nothing was sent (pass --yes only if you really mean it)." 4
    local answer
    local want="deploy $CHAIN_ID"
    ((MAINNET)) && want="deploy 56 with real money"
    read -r -p "Broadcast to chainId $CHAIN_ID ($NET) from $DEPLOYER_ADDRESS? Type '$want' to continue: " answer
    [[ "$answer" == "$want" ]] || die "Not confirmed; nothing was sent." 4
  fi

  echo "${B}Broadcasting Deploy.s.sol to chainId $CHAIN_ID …${N}"
  forge script script/Deploy.s.sol --rpc-url "$RPC" --sender "$DEPLOYER_ADDRESS" \
    "${WALLET_ARGS[@]}" --broadcast --slow

  post_check
  print_web_env
  if [[ -n "${BSCSCAN_API_KEY:-}" ]]; then
    cmd_verify || warn "verification failed; the deploy itself is fine. Retry: pnpm $PNPM:verify"
  else
    warn "BSCSCAN_API_KEY not set: skipped verification (pnpm $PNPM:verify later)"
  fi
}

# After a broadcast: the deployments file must describe contracts that exist on-chain with the expected config.
post_check() {
  FAILS=0
  local f
  f="$(deployment_file)"
  [[ -f "$f" ]] || die "deploy finished but $f is missing" 1
  echo "${B}Post-deploy check of $f${N}"
  local k a
  [[ "$(jq -r .chainId "$f")" == "$CHAIN_ID" ]] && ok "chainId $CHAIN_ID" || bad "chainId in $f is not $CHAIN_ID"
  for k in token escrowFactory rentalEscrowImplementation $( ((MAINNET)) || echo fleetVault); do
    a="$(jq -r ".$k" "$f")"
    if [[ "$(cast code "$a" --rpc-url "$RPC")" != 0x ]]; then ok "$k $a has code"; else bad "$k $a has no code"; fi
  done
  local factory
  factory="$(jq -r .escrowFactory "$f")"
  check_eq() { # label, call result, expected
    if [[ "$(tr 'A-F' 'a-f' <<<"$2")" == "$(tr 'A-F' 'a-f' <<<"$3")" ]]; then ok "$1 $2"; else bad "$1 is $2, expected $3"; fi
  }
  check_eq "factory.owner()" "$(cast call "$factory" 'owner()(address)' --rpc-url "$RPC")" "$(jq -r .factoryOwner "$f")"
  check_eq "factory.feeRecipient()" "$(cast call "$factory" 'feeRecipient()(address)' --rpc-url "$RPC")" "$(jq -r .feeRecipient "$f")"
  check_eq "factory.defaultArbiter()" "$(cast call "$factory" 'defaultArbiter()(address)' --rpc-url "$RPC")" "$(jq -r .defaultArbiter "$f")"
  check_eq "factory.token()" "$(cast call "$factory" 'token()(address)' --rpc-url "$RPC")" "$(jq -r .token "$f")"
  local cap
  for cap in maxDeposit maxRentPerPeriod maxActiveValue; do
    check_eq "factory.$cap()" "$(cast call "$factory" "$cap()(uint256)" --rpc-url "$RPC" | cut -d' ' -f1)" "$(jq -r ".$cap" "$f")"
  done
  ((MAINNET)) || check_eq "fleetVault.asset()" "$(cast call "$(jq -r .fleetVault "$f")" 'asset()(address)' --rpc-url "$RPC")" "$(jq -r .token "$f")"
  ((MAINNET)) && check_eq "token (BSC-USD)" "$(jq -r .token "$f")" "$BSC_USD"
  check_eq "token.symbol()" "$(cast call "$(jq -r .token "$f")" 'symbol()(string)' --rpc-url "$RPC" | tr -d '"')" "$SYMBOL"
  check_eq "token.decimals() = tokenDecimals" "$(cast call "$(jq -r .token "$f")" 'decimals()(uint8)' --rpc-url "$RPC")" "$(jq -r .tokenDecimals "$f")"
  ((FAILS == 0)) || die "post-deploy check failed ($FAILS problem(s))" 1
}

print_web_env() {
  local f
  f="$(deployment_file)"
  cat <<EOF
${B}For web/.env.local (public identifiers only):${N}
NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID
NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=$(jq -r .escrowFactory "$f")
NEXT_PUBLIC_MOCK_USDT_ADDRESS=$(jq -r .token "$f")
EOF
  ((MAINNET)) || echo "NEXT_PUBLIC_FLEET_VAULT_ADDRESS=$(jq -r .fleetVault "$f")"
}

# Verify (MockUSDT,) EscrowFactory, the RentalEscrow implementation (and FleetVault) from deployments/<chainId>.json,
# on BscScan / opBNBScan through the Etherscan V2 API (one key for 97, 5611 and 56).
# VERIFY_DRY_RUN=1 prints the commands and builds each standard-JSON input locally without contacting any API.
cmd_verify() {
  local f
  f="$(deployment_file)"
  [[ -f "$f" ]] || die "$f not found: deploy first (or set DEPLOYMENTS_DIR)" 1
  [[ "$(jq -r .chainId "$f")" == "$CHAIN_ID" ]] || die "$f is not a chainId $CHAIN_ID deployment" 1
  local dry="${VERIFY_DRY_RUN:-0}"
  if [[ "$dry" != 1 && -z "${BSCSCAN_API_KEY:-}" ]]; then die "BSCSCAN_API_KEY is not set" 2; fi

  local ctor
  ctor="$(cast abi-encode 'constructor(address,address,uint16,address,address,uint256,uint256,uint256)' \
    "$(jq -r .token "$f")" "$(jq -r .factoryOwner "$f")" "$(jq -r .feeBps "$f")" \
    "$(jq -r .feeRecipient "$f")" "$(jq -r .defaultArbiter "$f")" \
    "$(jq -r .maxDeposit "$f")" "$(jq -r .maxRentPerPeriod "$f")" "$(jq -r .maxActiveValue "$f")")"
  local -a targets=(
    "$(jq -r .escrowFactory "$f")|src/EscrowFactory.sol:EscrowFactory|$ctor"
    "$(jq -r .rentalEscrowImplementation "$f")|src/RentalEscrow.sol:RentalEscrow|"
  )
  # Mainnet: BSC-USD is Tether's own (verified) contract and there is no Fleet Vault.
  if ((!MAINNET)); then
    local vctor
    vctor="$(cast abi-encode 'constructor(address,string,string,address,uint16)' \
      "$(jq -r .token "$f")" "${FLEET_NAME:-KeyEscrow Bangkok Fleet 1}" "${FLEET_SYMBOL:-BKK-FLEET-1}" \
      "$(jq -r .fleetOperator "$f")" "$(jq -r .fleetOperatorFeeBps "$f")")"
    targets=("$(jq -r .token "$f")|src/mocks/MockUSDT.sol:MockUSDT|" "${targets[@]}"
      "$(jq -r .fleetVault "$f")|src/FleetVault.sol:FleetVault|$vctor")
  fi
  local extra=()
  [[ -n "${VERIFIER_URL:-}" ]] && extra=(--verifier-url "$VERIFIER_URL")
  echo "${B}Verifying on $NET (chainId $CHAIN_ID, Etherscan API V2)${N}$([[ "$dry" == 1 ]] && echo ' [dry run: nothing is submitted]')"
  local t addr id args fails=0
  for t in "${targets[@]}"; do
    IFS='|' read -r addr id args <<<"$t"
    local cmd=(forge verify-contract "$addr" "$id" --chain "$CHAIN_ID" --verifier etherscan --watch "${extra[@]}")
    [[ -n "$args" ]] && cmd+=(--constructor-args "$args")
    echo "  \$ ETHERSCAN_API_KEY=\$BSCSCAN_API_KEY ${cmd[*]}"
    if [[ "$dry" == 1 ]]; then
      if forge verify-contract "$addr" "$id" --chain "$CHAIN_ID" --show-standard-json-input >/dev/null 2>&1; then
        ok "$id: standard-JSON input builds"
      else
        bad "$id: could not build the verification input"; fails=$((fails + 1))
      fi
    else
      # The key goes via env, not argv, so it never shows up in the process list.
      ETHERSCAN_API_KEY="$BSCSCAN_API_KEY" "${cmd[@]}" || fails=$((fails + 1))
    fi
  done
  ((fails == 0)) || return 1
}

cmd_rehearse() { exec bash "$CONTRACTS/script/testnet-rehearsal.sh" "$@"; }

main() {
  local sub="${1:-}"
  shift || true
  [[ "$sub" == rehearse ]] && cmd_rehearse "$@"
  load_dotenv
  RPC="${!RPC_VAR:-}"
  case "$sub" in
    check) cmd_check ;;
    deploy) cmd_deploy "$@" ;;
    verify) cmd_verify ;;
    *) die "usage: $0 check | deploy [--yes] | verify | rehearse" 64 ;;
  esac
}
main "$@"
