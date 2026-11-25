#!/usr/bin/env bash
# LOCAL ONLY. Rehearses the BSC testnet deploy path (contracts/script/testnet.sh) end to end against throwaway anvil
# nodes on 127.0.0.1: one started with --chain-id 97 (pretends to be BSC testnet) and one with --chain-id 56 (pretends
# to be BSC mainnet, to prove the refusal). Ports come from 28550-28559 (override: REHEARSAL_PORTS="a b").
# Both nodes are killed and every temp file is removed on exit. Nothing here touches a real network.
#
#   pnpm deploy:testnet:rehearse
#
# The deployer is a fresh keystore created in a temp dir (password file, also temp) and funded with anvil_setBalance,
# so the rehearsal goes through the exact keystore + --sender path used on the real testnet. Role addresses are fresh
# random addresses. Anvil's default dev key 0 is used only to prove the anvil-account refusal.
set -uo pipefail

CONTRACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONTRACTS" || exit 1
TESTNET_SH="$CONTRACTS/script/testnet.sh"

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
for v in BSC_TESTNET_RPC_URL DEPLOYER_ADDRESS DEPLOYER_ACCOUNT DEPLOYER_KEYSTORE DEPLOYER_PASSWORD_FILE PRIVATE_KEY \
  FACTORY_OWNER FEE_RECIPIENT DEFAULT_ARBITER FEE_BPS TOKEN_ADDRESS BSCSCAN_API_KEY ETHERSCAN_API_KEY VERIFIER_URL \
  ALLOW_NON_LOCAL_BROADCAST FORCE_REDEPLOY RPC_URL ETH_RPC_URL ETH_FROM; do unset "$v"; done
export KEYESCROW_NO_DOTENV=1 DEPLOYMENTS_DIR="$REL_DIR"
# Keep forge's broadcast/cache records of this rehearsal out of the repo.
export FOUNDRY_BROADCAST="$TMP/broadcast" FOUNDRY_CACHE_PATH="$TMP/cache"

FREE=()
pick_ports
P97="${FREE[0]}" P56="${FREE[1]}" PDEAD="${FREE[2]}"
RPC97="http://127.0.0.1:$P97" RPC56="http://127.0.0.1:$P56"
echo "${B}KeyEscrow testnet deploy rehearsal (LOCAL anvil only)${N}"
echo "anvil --chain-id 97 on :$P97, anvil --chain-id 56 on :$P56, nothing listening on :$PDEAD"
start_anvil 97 "$P97"
start_anvil 56 "$P56"

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
cfg=(env BSC_TESTNET_RPC_URL="$RPC97" DEPLOYER_ADDRESS="$DEPLOYER" DEPLOYER_KEYSTORE="$KEYSTORE"
  DEPLOYER_PASSWORD_FILE="$TMP/password" FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" DEFAULT_ARBITER="$DESK")
# Direct forge calls (bypassing the wrapper) to prove the Solidity guard on its own.
ANVIL0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil default dev key 0 (public)
FRESH_KEY="$(cast wallet new --json | jq -r '.data[0].private_key')"         # throwaway, never leaves this process
FRESH_ADDR="$(cast wallet address --private-key "$FRESH_KEY")"
cast rpc anvil_setBalance "$FRESH_ADDR" 0xde0b6b3a7640000 --rpc-url "$RPC97" >/dev/null # 1 (t)BNB, local only
cast rpc anvil_setBalance "$FRESH_ADDR" 0xde0b6b3a7640000 --rpc-url "$RPC56" >/dev/null
roles=(FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" DEFAULT_ARBITER="$DESK")

step "1. Preflight fails cleanly when the RPC is not configured / unreachable / the wrong chain"
expect 2 "BSC_TESTNET_RPC_URL is not set" "check without BSC_TESTNET_RPC_URL" -- bash "$TESTNET_SH" check
expect 2 "did not answer eth_chainId" "check with an unreachable RPC" -- \
  env BSC_TESTNET_RPC_URL="http://127.0.0.1:$PDEAD" bash "$TESTNET_SH" check
expect 3 "reports chainId 56, expected 97" "check against a chainId-56 RPC" -- \
  env BSC_TESTNET_RPC_URL="$RPC56" bash "$TESTNET_SH" check
expect 1 "DEFAULT_ARBITER is not set" "check with a missing role address" -- \
  env BSC_TESTNET_RPC_URL="$RPC97" DEPLOYER_ADDRESS="$DEPLOYER" DEPLOYER_KEYSTORE="$KEYSTORE" \
  FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" bash "$TESTNET_SH" check

step "2. Solidity chain guard (forge script --broadcast straight at the local nodes, no wrapper)"
expect nonzero "RefusingNonLocalChain\(97\)" "chainId 97 WITHOUT ALLOW_NON_LOCAL_BROADCAST, --broadcast refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" "${roles[@]}" forge script script/Deploy.s.sol --rpc-url "$RPC97" --broadcast
expect nonzero "RefusingMainnet\(56\)" "chainId 56 WITH ALLOW_NON_LOCAL_BROADCAST=true, --broadcast still refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true \
  forge script script/Deploy.s.sol --rpc-url "$RPC56" --broadcast
expect nonzero "RefusingAnvilAccount" "chainId 97 with an anvil default account as deployer refused" -- \
  env PRIVATE_KEY="$ANVIL0_KEY" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true \
  forge script script/Deploy.s.sol --rpc-url "$RPC97" --broadcast
expect nonzero "RefusingAnvilAccount" "chainId 97 with an anvil default account as dispute desk refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" FACTORY_OWNER="$OWNER" FEE_RECIPIENT="$TREASURY" \
  DEFAULT_ARBITER=0x90F79bf6EB2c4f870365E785982E1f101E93b906 ALLOW_NON_LOCAL_BROADCAST=true \
  forge script script/Deploy.s.sol --rpc-url "$RPC97" --broadcast
expect nonzero "MissingRoleAddress" "chainId 97 without FEE_RECIPIENT refused (no default off anvil)" -- \
  env PRIVATE_KEY="$FRESH_KEY" FACTORY_OWNER="$OWNER" DEFAULT_ARBITER="$DESK" ALLOW_NON_LOCAL_BROADCAST=true \
  forge script script/Deploy.s.sol --rpc-url "$RPC97" --broadcast
expect nonzero "DeployerMismatch" "chainId 97 with DEPLOYER_ADDRESS not matching the key refused" -- \
  env PRIVATE_KEY="$FRESH_KEY" DEPLOYER_ADDRESS="$OWNER" "${roles[@]}" ALLOW_NON_LOCAL_BROADCAST=true \
  forge script script/Deploy.s.sol --rpc-url "$RPC97" --broadcast
nonce="$(cast nonce "$FRESH_ADDR" --rpc-url "$RPC97")"
[[ "$nonce" == 0 ]] && pass "no transaction reached the chainId-97 node (nonce $nonce)" || fail "nonce is $nonce"
nonce="$(cast nonce "$FRESH_ADDR" --rpc-url "$RPC56")"
[[ "$nonce" == 0 ]] && pass "no transaction reached the chainId-56 node (nonce $nonce)" || fail "nonce is $nonce"

step "3. Preflight with an unfunded deployer: simulation + estimate printed, balance check fails"
SHOW_LINES=20 expect 1 "deployer balance 0.000000000000000000 tBNB < estimate" "check, unfunded" -- \
  "${cfg[@]}" bash "$TESTNET_SH" check

step "4. Fund the deployer on the LOCAL chainId-97 node (anvil_setBalance 0.5), preflight passes"
cast rpc anvil_setBalance "$DEPLOYER" 0x6f05b59d3b20000 --rpc-url "$RPC97" >/dev/null
SHOW_LINES=20 expect 0 "Preflight passed" "check, funded" -- "${cfg[@]}" bash "$TESTNET_SH" check
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPC97")" == 0 ]] && pass "preflight sent nothing (deployer nonce 0)" ||
  fail "preflight changed the deployer nonce"
[[ ! -e "$REL_DIR/97.json" && -f "$REL_DIR/97.dry-run.json" ]] &&
  pass "simulation wrote only 97.dry-run.json, no 97.json" || fail "simulation wrote 97.json"

step "5. Deploy wrapper refuses without the opt-in flag / without confirmation"
expect 4 "set ALLOW_NON_LOCAL_BROADCAST=true" "deploy without ALLOW_NON_LOCAL_BROADCAST" -- \
  "${cfg[@]}" bash "$TESTNET_SH" deploy --yes
SHOW_LINES=3 expect 4 "No TTY for the confirmation prompt" "deploy with the flag but no confirmation (no TTY)" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true bash "$TESTNET_SH" deploy </dev/null
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPC97")" == 0 ]] && pass "still nothing sent (deployer nonce 0)" ||
  fail "deployer nonce changed"

step "6. The broadcast, against the LOCAL chainId-97 anvil: keystore + --sender, then post-deploy checks"
SHOW_LINES=16 expect 0 "NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=0x" "deploy --yes (keystore wallet)" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true bash "$TESTNET_SH" deploy --yes
F="$REL_DIR/97.json"
if [[ -f "$F" ]]; then
  echo "$F:" && jq . "$F" | indent
  want="$(jq -c 'keys' deployments/31337.example.json)" got="$(jq -c 'keys' "$F")"
  [[ "$want" == "$got" ]] && pass "97.json has the same keys as 31337.example.json" || fail "keys differ: $got"
  [[ "$(jq -r .chainId "$F")" == 97 && "$(jq -r .deployer "$F")" == "$DEPLOYER" && "$(jq -r .defaultArbiter "$F")" == "$DESK" ]] &&
    pass "chainId 97, deployer = keystore wallet, roles from env" || fail "unexpected values in 97.json"
else
  fail "no $F"
fi
[[ ! -e deployments/97.json ]] && pass "nothing written to contracts/deployments/97.json" || fail "deployments/97.json exists"
expect 4 "Refusing to overwrite" "second deploy refuses to overwrite 97.json" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true bash "$TESTNET_SH" deploy --yes

step "7. Verification commands (dry run: no API contacted; standard-JSON input built locally)"
SHOW_LINES=8 expect 0 "EscrowFactory: standard-JSON input builds" "verify, dry run" -- \
  env VERIFY_DRY_RUN=1 bash "$TESTNET_SH" verify
expect 2 "BSCSCAN_API_KEY is not set" "verify without BSCSCAN_API_KEY refuses" -- bash "$TESTNET_SH" verify

step "8. Repo left clean"
dirty="$(diff <(echo "$BEFORE") <(repo_state) || true)"
[[ -z "$dirty" ]] && pass "no new files under contracts/broadcast, deployments or cache (git status unchanged)" ||
  { fail "repo changes:"; echo "$dirty" | indent; }

echo
if ((FAIL == 0)); then echo "${G}${B}Rehearsal passed: $PASS checks.${N}"; else echo "${R}${B}Rehearsal FAILED: $FAIL of $((PASS + FAIL)) checks.${N}"; fi
((FAIL == 0))
