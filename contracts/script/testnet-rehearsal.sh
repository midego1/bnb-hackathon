#!/usr/bin/env bash
# LOCAL ONLY. Rehearses the testnet deploy path (contracts/script/testnet.sh) end to end against throwaway anvil
# nodes on 127.0.0.1: one started with --chain-id 97 (pretends to be BSC testnet) and one with --chain-id 56 (pretends
# to be BSC mainnet, to prove the refusal without the mainnet opt-in). With DEPLOY_CHAIN_ID=5611 the pair is 5611
# (opBNB testnet) and 204 (opBNB mainnet). With DEPLOY_CHAIN_ID=56 (the BSC mainnet pilot) the pair is 56 and 1
# (Ethereum, always refused); the 56 node gets an 18-decimal mock of BSC-USD at the real BSC-USD address
# (anvil_setCode with test/mocks/MockBscUsd.sol), so the exact mainnet path runs: no MockUSDT, no Fleet Vault, default
# pilot caps, MAINNET_I_UNDERSTAND=yes required. Ports come from 28550-28559 (override: REHEARSAL_PORTS="a b").
# Both nodes are killed and every temp file is removed on exit. Nothing here touches a real network.
#
#   pnpm deploy:testnet:rehearse      (chainId 97)
#   pnpm deploy:opbnb:rehearse        (chainId 5611)
#   pnpm deploy:mainnet:rehearse      (chainId 56, local anvil only: nothing reaches BSC mainnet)
#
# The last step runs one one-period rental (weekly on 56) on the rehearsed deployment and prints the gas of every call,
# so the cost per rental can be priced at each network's real gas price (docs/ARCHITECTURE.md).
#
# The deployer is a fresh keystore created in a temp dir (password file, also temp) and funded with anvil_setBalance,
# so the rehearsal goes through the exact keystore + --sender path used on the real testnet. Role addresses are fresh
# random addresses. Anvil's default dev key 0 is used only to prove the anvil-account refusal.
set -uo pipefail

CONTRACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONTRACTS" || exit 1
TESTNET_SH="$CONTRACTS/script/testnet.sh"
CID="${DEPLOY_CHAIN_ID:-97}"
case "$CID" in
  97) MAIN=56 RPC_VAR=BSC_TESTNET_RPC_URL ;;
  5611) MAIN=204 RPC_VAR=OPBNB_TESTNET_RPC_URL ;;
  56) MAIN=1 RPC_VAR=BSC_MAINNET_RPC_URL ;;
  *) echo "DEPLOY_CHAIN_ID must be 97, 5611 or 56"; exit 64 ;;
esac
# Mainnet runs need the second opt-in on every broadcast-capable call; CUR is the gas token name testnet.sh prints.
MI=() CUR=tBNB
[[ "$CID" == 56 ]] && MI=(MAINNET_I_UNDERSTAND=yes) CUR=BNB
BSC_USD=0x55d398326f99059fF775485246999027B3197955
export DEPLOY_CHAIN_ID="$CID"

if [[ -t 1 ]]; then G=$'\e[32m' R=$'\e[31m' B=$'\e[1m' D=$'\e[2m' N=$'\e[0m'; else G='' R='' B='' D='' N=''; fi
PASS=0 FAIL=0
pass() { printf '%sPASS%s %s\n' "$G" "$N" "$*"; PASS=$((PASS + 1)); }
fail() { printf '%sFAIL%s %s\n' "$R" "$N" "$*"; FAIL=$((FAIL + 1)); }
step() { printf '\n%s== %s%s\n' "$B" "$*" "$N"; }
indent() { sed "s/^/   ${D}|${N} /"; }

repo_state() { git -C "$CONTRACTS" status --porcelain --untracked-files=all -- broadcast deployments cache; }
BEFORE="$(repo_state)"
TMP="$(mktemp -d)"
REL_DIR="deployments/.rehearsal/$$" # Deploy.s.sol may only write under ./deployments (foundry.toml fs_permissions)
PIDS=()
cleanup() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; wait "$p" 2>/dev/null; done
  rm -rf "${TMP:?}" "${CONTRACTS:?}/${REL_DIR:?}"
  rmdir "$CONTRACTS/deployments/.rehearsal" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
pick_ports() {
  local p
  for p in ${REHEARSAL_PORTS:-$(seq 28550 28559)}; do port_free "$p" && FREE+=("$p"); done
  ((${#FREE[@]} >= 3)) || { echo "need 3 free ports in 28550-28559"; exit 1; }
}
start_anvil() { # chainId port
  anvil --host 127.0.0.1 --port "$2" --chain-id "$1" --silent &
  PIDS+=("$!")
  local _
  for _ in $(seq 1 50); do
    [[ "$(cast chain-id --rpc-url "http://127.0.0.1:$2" 2>/dev/null)" == "$1" ]] && return 0
    sleep 0.2
  done
  echo "anvil --chain-id $1 on :$2 did not start"; exit 1
}

# Clean slate: nothing from the caller's shell or .env may leak in (no real RPC, no real keys).
for v in BSC_TESTNET_RPC_URL OPBNB_TESTNET_RPC_URL DEPLOYER_ADDRESS DEPLOYER_ACCOUNT DEPLOYER_KEYSTORE DEPLOYER_PASSWORD_FILE PRIVATE_KEY \
  FACTORY_OWNER FEE_RECIPIENT DEFAULT_ARBITER FEE_BPS TOKEN_ADDRESS BSCSCAN_API_KEY ETHERSCAN_API_KEY VERIFIER_URL \
  ALLOW_NON_LOCAL_BROADCAST FORCE_REDEPLOY RPC_URL ETH_RPC_URL ETH_FROM BSC_MAINNET_RPC_URL MAINNET_I_UNDERSTAND \
  MAX_DEPOSIT MAX_RENT_PER_PERIOD MAX_ACTIVE_VALUE; do unset "$v"; done
export KEYESCROW_NO_DOTENV=1 DEPLOYMENTS_DIR="$REL_DIR"
# Keep forge's broadcast/cache records of this rehearsal out of the repo.
export FOUNDRY_BROADCAST="$TMP/broadcast" FOUNDRY_CACHE_PATH="$TMP/cache"

FREE=()
pick_ports
PNET="${FREE[0]}" PMAIN="${FREE[1]}" PDEAD="${FREE[2]}"
RPCNET="http://127.0.0.1:$PNET" RPCMAIN="http://127.0.0.1:$PMAIN"
echo "${B}KeyEscrow testnet deploy rehearsal for chainId $CID (LOCAL anvil only)${N}"
echo "anvil --chain-id $CID on :$PNET, anvil --chain-id $MAIN on :$PMAIN, nothing listening on :$PDEAD"
start_anvil "$CID" "$PNET"
start_anvil "$MAIN" "$PMAIN"
if [[ "$CID" == 56 ]]; then
  forge build -q
  cast rpc anvil_setCode "$BSC_USD" "$(forge inspect test/mocks/MockBscUsd.sol:MockBscUsd deployedBytecode)" --rpc-url "$RPCNET" >/dev/null
  echo "BSC-USD mock (18 decimals) at $BSC_USD on the chainId-56 node: $(cast call "$BSC_USD" 'symbol()(string)' --rpc-url "$RPCNET")"
fi

# expect <exit-code|nonzero> <grep pattern> <label> -- command...
expect() {
  local want="$1" pat="$2" label="$3"
  shift 4
  local out code
  out="$("$@" 2>&1)"
  code=$?
  echo "$out" | tail -n "${SHOW_LINES:-6}" | indent
  if [[ "$want" == nonzero && $code -eq 0 ]] || [[ "$want" != nonzero && $code -ne $want ]]; then
    fail "$label (exit $code, wanted $want)"
  elif ! grep -qE "$pat" <<<"$out"; then
    fail "$label (output lacks /$pat/)"
  else
    pass "$label (exit $code)"
  fi
}

new_addr() { cast wallet new --json | jq -r '.data[0].address'; }
mkdir -p "$TMP/keystores"
printf 'rehearsal-only\n' >"$TMP/password"
KS_JSON="$(cast wallet new "$TMP/keystores" --password-file "$TMP/password" --json 2>/dev/null ||
  cast wallet new "$TMP/keystores" --unsafe-password rehearsal-only --json)"
DEPLOYER="$(jq -r '.data[0].address' <<<"$KS_JSON")"
KEYSTORE="$(jq -r '.data[0].path' <<<"$KS_JSON")"
OWNER="$(new_addr)" TREASURY="$(new_addr)" DESK="$(new_addr)"
echo "deployer (fresh temp keystore) $DEPLOYER"
echo "owner $OWNER  treasury $TREASURY  dispute desk $DESK"

# Shared env for the "configured" runs.
cfg=(env "$RPC_VAR=$RPCNET" DEPLOYER_ADDRESS="$DEPLOYER" DEPLOYER_KEYSTORE="$KEYSTORE"
  DEPLOYER_PASSWORD_FILE="$TMP/password" FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" DEFAULT_ARBITER="$DESK" "${MI[@]}")
# Direct forge calls (bypassing the wrapper) to prove the Solidity guard on its own.
ANVIL0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil default dev key 0 (public)
FRESH_KEY="$(cast wallet new --json | jq -r '.data[0].private_key')"         # throwaway, never leaves this process
FRESH_ADDR="$(cast wallet address --private-key "$FRESH_KEY")"
cast rpc anvil_setBalance "$FRESH_ADDR" 0xde0b6b3a7640000 --rpc-url "$RPCNET" >/dev/null # 1 (t)BNB, local only
cast rpc anvil_setBalance "$FRESH_ADDR" 0xde0b6b3a7640000 --rpc-url "$RPCMAIN" >/dev/null
roles=(FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" DEFAULT_ARBITER="$DESK")

step "1. Preflight fails cleanly when the RPC is not configured / unreachable / the wrong chain"
expect 2 "$RPC_VAR is not set" "check without $RPC_VAR" -- bash "$TESTNET_SH" check
expect 2 "did not answer eth_chainId" "check with an unreachable RPC" -- \
  env "$RPC_VAR=http://127.0.0.1:$PDEAD" bash "$TESTNET_SH" check
expect 3 "reports chainId $MAIN, expected $CID" "check against a chainId-$MAIN RPC" -- \
  env "$RPC_VAR=$RPCMAIN" bash "$TESTNET_SH" check
expect 1 "DEFAULT_ARBITER is not set" "check with a missing role address" -- \
  env "$RPC_VAR=$RPCNET" DEPLOYER_ADDRESS="$DEPLOYER" DEPLOYER_KEYSTORE="$KEYSTORE" \
  FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" bash "$TESTNET_SH" check

step "2. Solidity chain guard (forge script --broadcast straight at the local nodes, no wrapper)"
expect nonzero "RefusingNonLocalChain\($CID\)" "chainId $CID WITHOUT ALLOW_NON_LOCAL_BROADCAST, --broadcast refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" "${roles[@]}" forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
expect nonzero "(RefusingMainnet\($MAIN\)|MainnetNotConfirmed)" "chainId $MAIN WITH ALLOW_NON_LOCAL_BROADCAST=true, --broadcast still refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${MI[@]}" \
  forge script script/Deploy.s.sol --rpc-url "$RPCMAIN" --broadcast
expect nonzero "RefusingAnvilAccount" "chainId $CID with an anvil default account as deployer refused" -- \
  env PRIVATE_KEY="$ANVIL0_KEY" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${MI[@]}" \
  forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
expect nonzero "RefusingAnvilAccount" "chainId $CID with an anvil default account as dispute desk refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" \
  DEFAULT_ARBITER=0x90F79bf6EB2c4f870365E785982E1f101E93b906 ALLOW_NON_LOCAL_BROADCAST=true "${MI[@]}" \
  forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
expect nonzero "MissingRoleAddress" "chainId $CID without FEE_RECIPIENT refused (no default off anvil)" -- \
  env PRIVATE_KEY="$FRESH_KEY" FACTORY_OWNER="$OWNER" DEFAULT_ARBITER="$DESK" ALLOW_NON_LOCAL_BROADCAST=true "${MI[@]}" \
  forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
expect nonzero "DeployerMismatch" "chainId $CID with DEPLOYER_ADDRESS not matching the key refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" DEPLOYER_ADDRESS="$OWNER" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${MI[@]}" \
  forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
if [[ "$CID" == 56 ]]; then
  expect nonzero "MainnetNotConfirmed" "chainId 56 WITH ALLOW_NON_LOCAL_BROADCAST but WITHOUT MAINNET_I_UNDERSTAND=yes refused" -- \
    env PRIVATE_KEY="$FRESH_KEY" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true \
    forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
  expect nonzero "WrongMainnetToken" "chainId 56 with a TOKEN_ADDRESS other than BSC-USD refused" -- \
    env PRIVATE_KEY="$FRESH_KEY" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${MI[@]}" TOKEN_ADDRESS="$OWNER" \
    forge script script/Deploy.s.sol --rpc-url "$RPCNET" --broadcast
fi
nonce="$(cast nonce "$FRESH_ADDR" --rpc-url "$RPCNET")"
[[ "$nonce" == 0 ]] && pass "no transaction reached the chainId-$CID node (nonce $nonce)" || fail "nonce is $nonce"
nonce="$(cast nonce "$FRESH_ADDR" --rpc-url "$RPCMAIN")"
[[ "$nonce" == 0 ]] && pass "no transaction reached the chainId-$MAIN node (nonce $nonce)" || fail "nonce is $nonce"

step "3. Preflight with an unfunded deployer: simulation + estimate printed, balance check fails"
SHOW_LINES=20 expect 1 "deployer balance 0.000000000000000000 $CUR < estimate" "check, unfunded" -- \
  "${cfg[@]}" bash "$TESTNET_SH" check

step "4. Fund the deployer on the LOCAL chainId-$CID node (anvil_setBalance 0.5), preflight passes"
cast rpc anvil_setBalance "$DEPLOYER" 0x6f05b59d3b20000 --rpc-url "$RPCNET" >/dev/null
SHOW_LINES=20 expect 0 "Preflight passed" "check, funded" -- "${cfg[@]}" bash "$TESTNET_SH" check
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPCNET")" == 0 ]] && pass "preflight sent nothing (deployer nonce 0)" ||
  fail "preflight changed the deployer nonce"
[[ ! -e "$REL_DIR/$CID.json" && -f "$REL_DIR/$CID.dry-run.json" ]] &&
  pass "simulation wrote only $CID.dry-run.json, no $CID.json" || fail "simulation wrote $CID.json"

step "5. Deploy wrapper refuses without the opt-in flag / without confirmation"
expect 4 "set ALLOW_NON_LOCAL_BROADCAST=true" "deploy without ALLOW_NON_LOCAL_BROADCAST" -- \
  "${cfg[@]}" bash "$TESTNET_SH" deploy --yes
if [[ "$CID" == 56 ]]; then
  expect 4 "also set MAINNET_I_UNDERSTAND=yes" "deploy to 56 without MAINNET_I_UNDERSTAND=yes" -- \
    "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true MAINNET_I_UNDERSTAND= bash "$TESTNET_SH" deploy --yes
fi
SHOW_LINES=3 expect 4 "No TTY for the confirmation prompt" "deploy with the flag but no confirmation (no TTY)" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true bash "$TESTNET_SH" deploy </dev/null
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPCNET")" == 0 ]] && pass "still nothing sent (deployer nonce 0)" ||
  fail "deployer nonce changed"

step "6. The broadcast, against the LOCAL chainId-$CID anvil: keystore + --sender, then post-deploy checks"
SHOW_LINES=16 expect 0 "NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=0x" "deploy --yes (keystore wallet)" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true bash "$TESTNET_SH" deploy --yes
F="$REL_DIR/$CID.json"
if [[ -f "$F" ]]; then
  echo "$F:" && jq . "$F" | indent
  # Mainnet has no Fleet Vault, so no fleet* keys.
  drop='[]'
  [[ "$CID" == 56 ]] && drop='["fleetOperator","fleetOperatorFeeBps","fleetVault"]'
  want="$(jq -c "keys - $drop" deployments/31337.example.json)" got="$(jq -c 'keys' "$F")"
  [[ "$want" == "$got" ]] && pass "$CID.json has the same keys as 31337.example.json (minus fleet* on 56)" || fail "keys differ: $got"
  if [[ "$CID" == 56 ]]; then
    [[ "$(jq -r .token "$F")" == "$BSC_USD" && "$(jq -r .tokenDecimals "$F")" == 18 && "$(jq -r .tokenSymbol "$F")" == USDT ]] &&
      pass "token = BSC-USD, 18 decimals, read from the token" || fail "unexpected token in $CID.json"
    [[ "$(jq -r .maxDeposit "$F")" == 5000000000000000000 && "$(jq -r .maxRentPerPeriod "$F")" == 2000000000000000000 &&
      "$(jq -r .maxActiveValue "$F")" == 25000000000000000000 ]] && pass "default pilot caps 5 / 2 / 25 USDT" || fail "unexpected caps in $CID.json"
  fi
  [[ "$(jq -r .chainId "$F")" == "$CID" && "$(jq -r .deployer "$F")" == "$DEPLOYER" && "$(jq -r .defaultArbiter "$F")" == "$DESK" ]] &&
    pass "chainId $CID, deployer = keystore wallet, roles from env" || fail "unexpected values in $CID.json"
else
  fail "no $F"
fi
# A real deployments/<chainId>.json may be committed; it must not mention the rehearsal deployer.
! grep -qi "$DEPLOYER" "deployments/$CID.json" 2>/dev/null && pass "contracts/deployments/$CID.json untouched" ||
  fail "the rehearsal wrote to deployments/$CID.json"
expect 4 "Refusing to overwrite" "second deploy refuses to overwrite $CID.json" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true bash "$TESTNET_SH" deploy --yes

step "7. Verification commands (dry run: no API contacted; standard-JSON input built locally)"
SHOW_LINES=8 expect 0 "EscrowFactory: standard-JSON input builds" "verify, dry run" -- \
  env VERIFY_DRY_RUN=1 bash "$TESTNET_SH" verify
expect 2 "BSCSCAN_API_KEY is not set" "verify without BSCSCAN_API_KEY refuses" -- bash "$TESTNET_SH" verify

step "8. Gas: the deploy above, then one one-period rental (no damage; weekly on 56) on the rehearsed deployment"
# Gas units are identical on 97 and 5611 (same EVM, same bytecode); price them per network, see docs/ARCHITECTURE.md.
DEPLOY_GAS=0
for g in $(jq -r '.receipts[].gasUsed' "$FOUNDRY_BROADCAST/Deploy.s.sol/$CID/run-latest.json" 2>/dev/null); do
  DEPLOY_GAS=$((DEPLOY_GAS + $(cast to-dec "$g")))
done
((DEPLOY_GAS > 0)) && pass "deploy used $DEPLOY_GAS gas ($([[ "$CID" == 56 ]] && echo "2 contracts: factory + implementation" || echo "4 contracts"))" || fail "no deploy receipts"
TENANT_KEY="$(cast wallet new --json | jq -r '.data[0].private_key')"
TENANT="$(cast wallet address --private-key "$TENANT_KEY")"
cast rpc anvil_setBalance "$TENANT" 0xde0b6b3a7640000 --rpc-url "$RPCNET" >/dev/null
FACTORY="$(jq -r .escrowFactory "$F" 2>/dev/null)" TOKEN="$(jq -r .token "$F" 2>/dev/null)"
RENTAL_GAS=0
tx() { # label key to sig args...
  local label="$1" key="$2" r g
  shift 2
  r="$(cast send --json --private-key "$key" --rpc-url "$RPCNET" "$@" 2>&1)" &&
    [[ "$(jq -r .status <<<"$r")" == 0x1 ]] || { fail "$label: $r"; return 1; }
  g="$(cast to-dec "$(jq -r .gasUsed <<<"$r")")"
  RENTAL_GAS=$((RENTAL_GAS + g))
  printf '   %s|%s %-34s %8s gas\n' "$D" "$N" "$label" "$g"
}
H=0x$(printf 'ab%.0s' {1..32})
# Amounts in the token's own decimals (read from the token): 2 rent + 5 deposit fit the mainnet pilot caps.
DEC="$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPCNET")"
U() { cast parse-units "$1" "$DEC"; }
PERIOD=0 # factory default: 30 days
[[ "$CID" == 56 ]] && PERIOD=604800 # weekly rent on the pilot
SIG='createLease((address,address,uint256,uint256,uint32,uint32,uint32,uint32,bytes32))'
tx "faucet 300 (test setup only)" "$TENANT_KEY" "$TOKEN" 'faucet(address,uint256)' "$TENANT" "$(U 300)" && RENTAL_GAS=0
if [[ "$CID" == 56 ]]; then
  expect nonzero "DepositAboveCap" "createLease with a 6 USDT deposit refused by the 5 USDT pilot cap" -- \
    cast send --private-key "$FRESH_KEY" --rpc-url "$RPCNET" "$FACTORY" "$SIG" "($TENANT,0x0000000000000000000000000000000000000000,$(U 2),$(U 6),1,$PERIOD,0,0,$H)"
fi
tx "createLease (owner)" "$FRESH_KEY" "$FACTORY" "$SIG" "($TENANT,0x0000000000000000000000000000000000000000,$(U 2),$(U 5),1,$PERIOD,0,0,$H)"
LEASE="$(cast call "$FACTORY" 'leasesByTenant(address)(address[])' "$TENANT" --rpc-url "$RPCNET" | tr -d '[]')"
tx "approve (renter)" "$TENANT_KEY" "$TOKEN" 'approve(address,uint256)' "$LEASE" "$(U 7)"
tx "fund rent + deposit (renter)" "$TENANT_KEY" "$LEASE" 'fund()'
[[ "$(cast call "$FACTORY" 'activeValue()(uint256)' --rpc-url "$RPCNET" | cut -d' ' -f1)" == "$(U 7)" ]] &&
  pass "factory activeValue = 7 tokens held" || fail "activeValue after fund"
tx "addEvidence pickup photos (renter)" "$TENANT_KEY" "$LEASE" 'addEvidence(uint8,bytes32)' 0 "$H"
tx "addEvidence return photos (renter)" "$TENANT_KEY" "$LEASE" 'addEvidence(uint8,bytes32)' 1 "$H"
tx "propose split + report hash (owner)" "$FRESH_KEY" "$LEASE" 'propose(uint256,bytes32)' "$(U 5)" "$H"
tx "accept, settles (renter)" "$TENANT_KEY" "$LEASE" 'accept(uint32)' 1
[[ "$(cast call "$LEASE" 'status()(uint8)' --rpc-url "$RPCNET")" == 4 ]] &&
  pass "one rental, created to settled: $RENTAL_GAS gas in 7 transactions" || fail "rental did not settle"
[[ "$(cast call "$FACTORY" 'activeValue()(uint256)' --rpc-url "$RPCNET")" == 0 ]] && pass "factory activeValue back to 0" ||
  fail "activeValue after settlement"

step "9. Repo left clean"
dirty="$(diff <(printf "%s\n" "$BEFORE") <(printf "%s\n" "$(repo_state)") || true)"
[[ -z "$dirty" ]] && pass "no new files under contracts/broadcast, deployments or cache (git status unchanged)" ||
  { fail "repo changes:"; echo "$dirty" | indent; }

echo
if ((FAIL == 0)); then echo "${G}${B}Rehearsal passed: $PASS checks.${N}"; else echo "${R}${B}Rehearsal FAILED: $FAIL of $((PASS + FAIL)) checks.${N}"; fi
((FAIL == 0))
