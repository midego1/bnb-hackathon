#!/usr/bin/env bash
# Production build of the web app against BSC testnet (chainId 97), served by a systemd user unit.
#
#   bash web/scripts/testnet-web.sh            build into web/.next-testnet and (re)start the unit   (pnpm testnet:web)
#   bash web/scripts/testnet-web.sh build      build only
#   bash web/scripts/testnet-web.sh start      (re)start the unit from the existing build
#
# Addresses come from contracts/deployments/97.json. No NEXT_PUBLIC_DEV_ACCOUNTS: there are no keys in the browser,
# testers connect their own wallet (MetaMask / any injected wallet via RainbowKit). The AI inspection runs in mock
# mode (no ANTHROPIC_API_KEY or INSPECTOR_PRIVATE_KEY is passed to the unit).
#
# Live demo (/demo "Play the demo" on chain 97): the build has NEXT_PUBLIC_DEMO_TESTNET=1 (a UI flag, no secret) and
# the unit gets DEMO_TESTNET_RUNNER=1 plus two PATHS, never key material: DEMO_TESTNET_SECRETS_DIR (the gitignored
# .orca/secrets, where the server keeps its demo wallets, mode 600) and DEMO_TESTNET_ENV_FILE (the repo-root .env with
# BSC_TESTNET_RPC_URL and the deployer keystore settings, used for gas top-ups). The server signs each demo step
# (lib/server/demoTestnet). DEMO_TESTNET_RUNNER=0 pnpm testnet:web serves the app with the live demo switched off.
#
# Secrets page (/settings/secrets, docs/SETUP.md): the unit gets SETTINGS_SECRETS_ENABLED=1 plus the paths it writes
# (the main checkout's .env and web/.env.local, state under .orca/). SETTINGS_SECRETS=0 pnpm testnet:web leaves it off.
#
# Env: TESTNET_WEB_HOST (default 127.0.0.1), TESTNET_WEB_PORT (default 3001), TESTNET_WEB_UNIT
# (default keyescrow-web-testnet), NEXT_PUBLIC_BSC_TESTNET_RPC_URL (default: the app's PublicNode default),
# DEMO_TESTNET_RUNNER (default 1), DEMO_TESTNET_SECRETS_DIR (default <main checkout>/.orca/secrets),
# DEMO_TESTNET_ENV_FILE (default <main checkout>/.env).
set -euo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENT="$WEB/../contracts/deployments/97.json"
HOST="${TESTNET_WEB_HOST:-127.0.0.1}"
PORT="${TESTNET_WEB_PORT:-3001}"
UNIT="${TESTNET_WEB_UNIT:-keyescrow-web-testnet}"
DIST=.next-testnet
# The main checkout (differs from the repo root inside a git worktree): the gitignored .env and .orca/ live there.
MAIN="$(dirname "$(git -C "$WEB" rev-parse --path-format=absolute --git-common-dir)")"
DEMO_RUNNER="${DEMO_TESTNET_RUNNER:-1}"
DEMO_SECRETS="${DEMO_TESTNET_SECRETS_DIR:-$MAIN/.orca/secrets}"
DEMO_ENV_FILE="${DEMO_TESTNET_ENV_FILE:-$MAIN/.env}"

[[ "$(jq -r .chainId "$DEPLOYMENT")" == 97 ]] || { echo "$DEPLOYMENT is not a chain 97 deployment" >&2; exit 1; }
ENV_VARS=(
  NEXT_DIST_DIR="$DIST"
  NEXT_PUBLIC_CHAIN_ID=97
  NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS="$(jq -r .escrowFactory "$DEPLOYMENT")"
  NEXT_PUBLIC_MOCK_USDT_ADDRESS="$(jq -r .token "$DEPLOYMENT")"
  NEXT_PUBLIC_DISPUTE_DESK_ADDRESS="$(jq -r .defaultArbiter "$DEPLOYMENT")"
  NEXT_PUBLIC_FLEET_VAULT_ADDRESS="$(jq -r '.fleetVault // ""' "$DEPLOYMENT")"
  NEXT_PUBLIC_DEV_ACCOUNTS=0
  NEXT_PUBLIC_DEMO_TESTNET=1
)
# Server-only (runtime) settings of the live demo runner: a flag and two paths.
RUNTIME_VARS=(DEMO_TESTNET_RUNNER="$DEMO_RUNNER" DEMO_TESTNET_SECRETS_DIR="$DEMO_SECRETS" DEMO_TESTNET_ENV_FILE="$DEMO_ENV_FILE")
# The live judge demo (/stage, /r) signs with the same demo wallets; STAGE_DEMO=0 switches it off.
RUNTIME_VARS+=(STAGE_DEMO="${STAGE_DEMO:-1}")
# Write-only secrets page: a flag and three paths, never a value.
RUNTIME_VARS+=(
  SETTINGS_SECRETS_ENABLED="${SETTINGS_SECRETS:-1}"
  SECRETS_ENV_FILE="$MAIN/.env"
  SECRETS_WEB_ENV_FILE="$MAIN/web/.env.local"
  SETTINGS_SECRETS_STATE_DIR="$MAIN/.orca"
)
[[ -n "${NEXT_PUBLIC_BSC_TESTNET_RPC_URL:-}" ]] && ENV_VARS+=(NEXT_PUBLIC_BSC_TESTNET_RPC_URL="$NEXT_PUBLIC_BSC_TESTNET_RPC_URL")

build() {
  echo "building $WEB/$DIST for chain 97"
  node "$WEB/scripts/media.mjs"
  (cd "$WEB" && env -u NEXT_PUBLIC_ANVIL_RPC_URL -u NEXT_PUBLIC_RPC_URL "${ENV_VARS[@]}" pnpm exec next build >/dev/null)
}

start() {
  [[ -f "$WEB/$DIST/BUILD_ID" ]] || { echo "no build in $WEB/$DIST: run with 'build' first" >&2; exit 1; }
  systemctl --user stop "$UNIT" 2>/dev/null || true
  systemctl --user reset-failed "$UNIT" 2>/dev/null || true
  local setenv=() v
  for v in "${ENV_VARS[@]}" "${RUNTIME_VARS[@]}" "PATH=$PATH" "HOME=$HOME" NODE_ENV=production; do setenv+=(--setenv="$v"); done
  systemd-run --user --unit "$UNIT" -p Restart=on-failure --working-directory="$WEB" "${setenv[@]}" \
    "$(command -v pnpm)" exec next start -H "$HOST" -p "$PORT"
  echo "started $UNIT on http://$HOST:$PORT (live demo runner: $([[ $DEMO_RUNNER == 1 ]] && echo on || echo off))"
}

case "${1:-all}" in
  build) build ;;
  start) start ;;
  all) build && start ;;
  *) echo "usage: $0 [build|start]" >&2; exit 64 ;;
esac
