#!/usr/bin/env bash
# LOCAL ONLY. Rehearses the ERC-8004 registration of KeyEscrow Inspector (agent/scripts/register.ts) end to end
# against throwaway anvil nodes on 127.0.0.1: one started with --chain-id 97 (pretends to be BSC testnet) and one with
# --chain-id 56 (pretends to be BSC mainnet, to prove the refusal). Ports come from 28560-28569
# (override: REHEARSAL_PORTS="a b c d"). Everything is killed and every temp file removed on exit.
#
#   pnpm agent:rehearse
#
# The BSC testnet Identity Registry is stood in for by contracts/test/mocks/MockIdentityRegistry.sol, placed with
# anvil_setCode at the SDK's canonical testnet registry address, so register.ts runs unchanged (same chainId, same
# registry address); only the RPC URL differs. The deployer is a fresh keystore in a temp dir, funded with
# anvil_setBalance; the report-signing key is fresh too. Anvil's default dev key 0 is used only to prove the refusal.
set -uo pipefail

AGENT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$AGENT/.." && pwd)"
cd "$AGENT" || exit 1
TSX=("$AGENT/node_modules/.bin/tsx")
REGISTER=("${TSX[@]}" scripts/register.ts)
REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e # @bnbagent/sdk NETWORKS["bsc-testnet"].registryContract

if [[ -t 1 ]]; then G=$'\e[32m' R=$'\e[31m' B=$'\e[1m' D=$'\e[2m' N=$'\e[0m'; else G='' R='' B='' D='' N=''; fi
PASS=0 FAIL=0
pass() { printf '%sPASS%s %s\n' "$G" "$N" "$*"; PASS=$((PASS + 1)); }
fail() { printf '%sFAIL%s %s\n' "$R" "$N" "$*"; FAIL=$((FAIL + 1)); }
step() { printf '\n%s== %s%s\n' "$B" "$*" "$N"; }
indent() { sed "s/^/   ${D}|${N} /"; }

repo_state() { git -C "$ROOT" status --porcelain --untracked-files=all -- agent/deployments contracts; }
BEFORE="$(repo_state)"
TMP="$(mktemp -d)"
PIDS=()
cleanup() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; wait "$p" 2>/dev/null; done
  rm -rf "${TMP:?}"
  return 0
}
trap cleanup EXIT INT TERM

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
FREE=()
for p in ${REHEARSAL_PORTS:-$(seq 28560 28569)}; do port_free "$p" && FREE+=("$p"); done
((${#FREE[@]} >= 4)) || { echo "need 4 free ports in 28560-28569"; exit 1; }
P97="${FREE[0]}" P56="${FREE[1]}" PDEAD="${FREE[2]}" PAGENT="${FREE[3]}"
RPC97="http://127.0.0.1:$P97" RPC56="http://127.0.0.1:$P56"

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
  INSPECTOR_PRIVATE_KEY INSPECTOR_SIGNER_ADDRESS INSPECTOR_AGENT_ID INSPECTOR_AGENT_REGISTRY INSPECTOR_DEPLOYMENT \
  INSPECTOR_CHAIN_ID ERC8004_REGISTRY_ADDRESS ALLOW_NON_LOCAL_BROADCAST FORCE_REREGISTER AGENT_PUBLIC_URL AGENT_URL \
  ANTHROPIC_API_KEY VISION_LLM_PROVIDER RPC_URL RPC_URL_BSC_TESTNET BNBAGENT_USE_PAYMASTER; do unset "$v"; done
export KEYESCROW_NO_DOTENV=1 INSPECTOR_DEPLOYMENTS_DIR="$TMP/deployments"

echo "${B}KeyEscrow Inspector ERC-8004 registration rehearsal (LOCAL anvil only)${N}"
echo "anvil --chain-id 97 on :$P97, anvil --chain-id 56 on :$P56, nothing on :$PDEAD, agent on :$PAGENT"
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

step "0. Stand-in ERC-8004 Identity Registry at the canonical BSC testnet address (local chainId-97 node only)"
CODE="$(cd "$ROOT/contracts" && forge inspect test/mocks/MockIdentityRegistry.sol:MockIdentityRegistry deployedBytecode 2>/dev/null | tail -n1)"
[[ "$CODE" =~ ^0x[0-9a-f]+$ ]] || { echo "forge inspect failed (run: cd contracts && forge build)"; exit 1; }
cast rpc anvil_setCode "$REGISTRY" "$CODE" --rpc-url "$RPC97" >/dev/null
[[ "$(cast code "$REGISTRY" --rpc-url "$RPC97")" == "$CODE" ]] && pass "MockIdentityRegistry code at $REGISTRY" ||
  fail "anvil_setCode did not take"

mkdir -p "$TMP/keystores"
printf 'rehearsal-only\n' >"$TMP/password"
KS_JSON="$(cast wallet new "$TMP/keystores" --password-file "$TMP/password" --json 2>/dev/null ||
  cast wallet new "$TMP/keystores" --unsafe-password rehearsal-only --json)"
DEPLOYER="$(jq -r '.data[0].address' <<<"$KS_JSON")"
KEYSTORE="$(jq -r '.data[0].path' <<<"$KS_JSON")"
SIGNER_KEY="$(cast wallet new --json | jq -r '.data[0].private_key')" # throwaway, never leaves this process
SIGNER="$(cast wallet address --private-key "$SIGNER_KEY")"
OTHER_KEY="$(cast wallet new --json | jq -r '.data[0].private_key')"
ANVIL0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ANVIL0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil default dev key 0 (public)
echo "deployer (fresh temp keystore) $DEPLOYER   report signer (fresh key) $SIGNER"

cfg=(env BSC_TESTNET_RPC_URL="$RPC97" DEPLOYER_ADDRESS="$DEPLOYER" DEPLOYER_KEYSTORE="$KEYSTORE"
  DEPLOYER_PASSWORD_FILE="$TMP/password" INSPECTOR_SIGNER_ADDRESS="$SIGNER" AGENT_PUBLIC_URL="http://127.0.0.1:$PAGENT")

step "1. Preflight fails cleanly: nothing configured / unreachable RPC / mainnet / anvil account"
expect 1 "BSC_TESTNET_RPC_URL is not set" "check with nothing configured" -- "${REGISTER[@]}" check
expect 1 "unreachable" "check with an unreachable RPC" -- \
  "${cfg[@]}" BSC_TESTNET_RPC_URL="http://127.0.0.1:$PDEAD" "${REGISTER[@]}" check
expect 2 "BSC MAINNET\): refused" "check against a chainId-56 RPC" -- \
  "${cfg[@]}" BSC_TESTNET_RPC_URL="$RPC56" "${REGISTER[@]}" check
expect 1 "anvil default account" "anvil default account as deployer refused" -- \
  "${cfg[@]}" DEPLOYER_ADDRESS="$ANVIL0" DEPLOYER_KEYSTORE= PRIVATE_KEY="$ANVIL0_KEY" "${REGISTER[@]}" check
expect 1 "exactly one of" "two wallets configured refused" -- "${cfg[@]}" PRIVATE_KEY="$SIGNER_KEY" "${REGISTER[@]}" check

step "2. Unfunded deployer fails the balance check; funded (anvil_setBalance 0.1, local only) passes"
expect 1 "needs about" "check, unfunded" -- "${cfg[@]}" "${REGISTER[@]}" check
cast rpc anvil_setBalance "$DEPLOYER" 0x16345785d8a0000 --rpc-url "$RPC97" >/dev/null
SHOW_LINES=12 expect 0 "preflight OK; nothing was sent" "check, funded" -- "${cfg[@]}" "${REGISTER[@]}" check
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPC97")" == 0 ]] && pass "preflight sent nothing (deployer nonce 0)" ||
  fail "preflight changed the deployer nonce"

step "3. Register refuses without the opt-in flag / without confirmation"
expect 3 "ALLOW_NON_LOCAL_BROADCAST=true" "register without ALLOW_NON_LOCAL_BROADCAST" -- \
  "${cfg[@]}" "${REGISTER[@]}" register --yes
expect 3 "pass --yes" "register with the flag but no confirmation (no TTY)" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${REGISTER[@]}" register </dev/null
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPC97")" == 0 ]] && pass "still nothing sent (deployer nonce 0)" ||
  fail "deployer nonce changed"

step "4. The registration, against the LOCAL chainId-97 anvil (BNB Agent SDK ERC8004Agent, keystore wallet)"
SHOW_LINES=14 expect 0 "agent #0 registered" "register --yes" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${REGISTER[@]}" register --yes
F="$TMP/deployments/97.json"
if [[ -f "$F" ]]; then
  jq 'del(.agentURI) + {agentURI: (.agentURI[0:60] + "…")}' "$F" | indent
  [[ "$(jq -r .chainId "$F")" == 97 && "$(jq -r .owner "$F")" == "$DEPLOYER" && "$(jq -r .reportSigner "$F")" == "$SIGNER" &&
    "$(jq -r .agentRegistry "$F")" == "eip155:97:$REGISTRY" ]] &&
    pass "97.json: chainId 97, owner = keystore wallet, reportSigner = signer, canonical registry" ||
    fail "unexpected values in 97.json"
else
  fail "no $F"
fi
URI="$(cast call "$REGISTRY" 'tokenURI(uint256)(string)' 0 --rpc-url "$RPC97" | tr -d '"')"
echo "${URI#data:application/json;base64,}" | base64 -d | jq -c '{name, services: [.services[] | {name, endpoint}], registrations}' | indent
grep -q 'registrations":\[{"agentId":0' <<<"$(echo "${URI#data:application/json;base64,}" | base64 -d)" &&
  pass "on-chain tokenURI is the SDK registration file with registrations[agentId 0]" || fail "tokenURI lacks registrations"
expect 1 "already registered as agent #0" "second register refuses (97.json exists)" -- \
  "${cfg[@]}" ALLOW_NON_LOCAL_BROADCAST=true "${REGISTER[@]}" register --yes
[[ "$(repo_state)" == "$BEFORE" ]] && pass "nothing written to agent/deployments (the real 97.json untouched)" ||
  fail "agent/deployments changed"

step "5. The agent signs reports as ERC-8004 agent #0; MCP + A2A calls; on-chain verification"
AGENT_ENV=(env AGENT_PORT="$PAGENT" INSPECTOR_PRIVATE_KEY="$SIGNER_KEY" INSPECTOR_DEPLOYMENT="$F")
"${AGENT_ENV[@]}" "${TSX[@]}" src/main.ts >"$TMP/agent.log" 2>&1 &
PIDS+=("$!")
for _ in $(seq 1 75); do curl -sf "http://127.0.0.1:$PAGENT/health" >/dev/null && break; sleep 0.2; done
indent <"$TMP/agent.log"
curl -sf "http://127.0.0.1:$PAGENT/health" | grep -q '"agentId":"0"' && pass "agent up, identity ERC-8004 agent #0" ||
  fail "agent did not start with the registered identity"
export AGENT_URL="http://127.0.0.1:$PAGENT"
SHOW_LINES=40 expect 0 '"inspectorSignature": "0x' "MCP tools/call inspect_move_out" -- "${TSX[@]}" scripts/call-mcp.ts
SHOW_LINES=12 expect 0 '"agentId": "0"' "A2A message/send inspect_move_out" -- "${TSX[@]}" scripts/call-a2a.ts
SHOW_LINES=12 expect 0 "VERIFIED: signed by KeyEscrow Inspector, ERC-8004 agent #0" "verify against the registry" -- \
  env BSC_TESTNET_RPC_URL="$RPC97" "${TSX[@]}" scripts/verify.ts
expect 1 "lists reportSigner" "agent refuses a key that is not the registered reportSigner" -- \
  timeout 30 env AGENT_PORT="$PDEAD" INSPECTOR_PRIVATE_KEY="$OTHER_KEY" INSPECTOR_DEPLOYMENT="$F" "${TSX[@]}" src/main.ts

step "6. setAgentURI: point the agent at a new public URL (pnpm agent:set-uri), with the same guards"
NEWURL="http://localhost:$PAGENT" # same agent, another URL: the registered endpoints no longer match it
uri() { cast call "$REGISTRY" 'tokenURI(uint256)(string)' 0 --rpc-url "$RPC97" | tr -d '"'; }
URI0="$(uri)" NONCE0="$(cast nonce "$DEPLOYER" --rpc-url "$RPC97")"
expect 1 "fix with pnpm agent:set-uri" "verify flags endpoints that are not on the new URL" -- \
  env BSC_TESTNET_RPC_URL="$RPC97" AGENT_URL="$NEWURL" "${TSX[@]}" scripts/verify.ts
expect 1 "is owned by" "set-uri-check refuses a DEPLOYER_ADDRESS that does not own the agent" -- \
  "${cfg[@]}" AGENT_PUBLIC_URL="$NEWURL" DEPLOYER_ADDRESS="$SIGNER" "${REGISTER[@]}" set-uri-check
SHOW_LINES=10 expect 0 "preflight OK; nothing was sent" "set-uri-check" -- \
  "${cfg[@]}" AGENT_PUBLIC_URL="$NEWURL" "${REGISTER[@]}" set-uri-check
expect 3 "ALLOW_NON_LOCAL_BROADCAST=true" "set-uri without ALLOW_NON_LOCAL_BROADCAST" -- \
  "${cfg[@]}" AGENT_PUBLIC_URL="$NEWURL" "${REGISTER[@]}" set-uri --yes
expect 3 "pass --yes" "set-uri with the flag but no confirmation (no TTY)" -- \
  "${cfg[@]}" AGENT_PUBLIC_URL="$NEWURL" ALLOW_NON_LOCAL_BROADCAST=true "${REGISTER[@]}" set-uri </dev/null
[[ "$(cast nonce "$DEPLOYER" --rpc-url "$RPC97")" == "$NONCE0" && "$(uri)" == "$URI0" ]] &&
  pass "nothing sent so far (nonce and tokenURI unchanged)" || fail "a refused set-uri changed the chain"
SHOW_LINES=8 expect 0 "now lists $NEWURL/.well-known/agent-card.json, $NEWURL/mcp" "set-uri --yes" -- \
  "${cfg[@]}" AGENT_PUBLIC_URL="$NEWURL" ALLOW_NON_LOCAL_BROADCAST=true "${REGISTER[@]}" set-uri --yes
[[ "$(jq -r .agentURI "$F")" == "$(uri)" && "$(uri)" != "$URI0" && "$(jq -r .publicUrl "$F")" == "$NEWURL" &&
  "$(jq -r .setUriTx "$F")" =~ ^0x[0-9a-f]{64}$ && "$(jq -r .registerTx "$F")" =~ ^0x && "$(jq -r .updatedAt "$F")" != null ]] &&
  pass "97.json: agentURI = new on-chain tokenURI, publicUrl, setUriTx, updatedAt; registerTx kept" ||
  fail "unexpected 97.json after set-uri"
SHOW_LINES=4 expect 0 "VERIFIED" "verify: endpoints on the new URL, registrations[] still agent #0" -- \
  env BSC_TESTNET_RPC_URL="$RPC97" AGENT_URL="$NEWURL" "${TSX[@]}" scripts/verify.ts
expect 1 "already has this agentURI" "set-uri again with the same URL sends nothing" -- \
  "${cfg[@]}" AGENT_PUBLIC_URL="$NEWURL" ALLOW_NON_LOCAL_BROADCAST=true "${REGISTER[@]}" set-uri --yes

step "7. Repo left clean"
dirty="$(diff <(printf "%s\n" "$BEFORE") <(printf "%s\n" "$(repo_state)") || true)"
[[ -z "$dirty" ]] && pass "git status of agent/deployments and contracts unchanged" || { fail "repo changes:"; echo "$dirty" | indent; }

echo
if ((FAIL == 0)); then echo "${G}${B}Rehearsal passed: $PASS checks.${N}"; else echo "${R}${B}Rehearsal FAILED: $FAIL of $((PASS + FAIL)) checks.${N}"; fi
((FAIL == 0))
