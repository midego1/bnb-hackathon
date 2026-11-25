#!/usr/bin/env bash
# Production build of the web app against BSC testnet (chainId 97), served by a systemd user unit.
#
#   bash web/scripts/testnet-web.sh            build into web/.next-testnet and (re)start the unit   (pnpm testnet:web)
#   bash web/scripts/testnet-web.sh build      build only
#   bash web/scripts/testnet-web.sh start      (re)start the unit from the existing build
#
# Addresses come from contracts/deployments/97.json. No NEXT_PUBLIC_DEV_ACCOUNTS: there are no keys in the browser,
# testers connect their own wallet (MetaMask / any injected wallet via RainbowKit). Server-side secrets are not
# passed either, so the AI inspection runs in mock mode unless ANTHROPIC_API_KEY is added to the unit.
#
# Env: TESTNET_WEB_HOST (default 127.0.0.1), TESTNET_WEB_PORT (default 3001), TESTNET_WEB_UNIT
# (default keyescrow-web-testnet), NEXT_PUBLIC_BSC_TESTNET_RPC_URL (default: the app's PublicNode default).
set -euo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENT="$WEB/../contracts/deployments/97.json"
HOST="${TESTNET_WEB_HOST:-127.0.0.1}"
PORT="${TESTNET_WEB_PORT:-3001}"
UNIT="${TESTNET_WEB_UNIT:-keyescrow-web-testnet}"
DIST=.next-testnet

[[ "$(jq -r .chainId "$DEPLOYMENT")" == 97 ]] || { echo "$DEPLOYMENT is not a chain 97 deployment" >&2; exit 1; }
ENV_VARS=(
  NEXT_DIST_DIR="$DIST"
  NEXT_PUBLIC_CHAIN_ID=97
  NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS="$(jq -r .escrowFactory "$DEPLOYMENT")"
  NEXT_PUBLIC_MOCK_USDT_ADDRESS="$(jq -r .token "$DEPLOYMENT")"
  NEXT_PUBLIC_DISPUTE_DESK_ADDRESS="$(jq -r .defaultArbiter "$DEPLOYMENT")"
  NEXT_PUBLIC_DEV_ACCOUNTS=0
)
[[ -n "${NEXT_PUBLIC_BSC_TESTNET_RPC_URL:-}" ]] && ENV_VARS+=(NEXT_PUBLIC_BSC_TESTNET_RPC_URL="$NEXT_PUBLIC_BSC_TESTNET_RPC_URL")

build() {
  echo "building $WEB/$DIST for chain 97"
  (cd "$WEB" && env -u NEXT_PUBLIC_ANVIL_RPC_URL -u NEXT_PUBLIC_RPC_URL "${ENV_VARS[@]}" pnpm exec next build >/dev/null)
}

start() {
  [[ -f "$WEB/$DIST/BUILD_ID" ]] || { echo "no build in $WEB/$DIST: run with 'build' first" >&2; exit 1; }
  systemctl --user stop "$UNIT" 2>/dev/null || true
  systemctl --user reset-failed "$UNIT" 2>/dev/null || true
  local setenv=() v
  for v in "${ENV_VARS[@]}" "PATH=$PATH" "HOME=$HOME" NODE_ENV=production; do setenv+=(--setenv="$v"); done
  systemd-run --user --unit "$UNIT" -p Restart=on-failure --working-directory="$WEB" "${setenv[@]}" \
    "$(command -v pnpm)" exec next start -H "$HOST" -p "$PORT"
  echo "started $UNIT on http://$HOST:$PORT"
}

case "${1:-all}" in
  build) build ;;
  start) start ;;
  all) build && start ;;
  *) echo "usage: $0 [build|start]" >&2; exit 64 ;;
esac
