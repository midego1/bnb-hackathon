#!/usr/bin/env bash
# Brand gate: the product is KeyScrow. Fails on "KeyEscrow" or "KeyCrow" anywhere in tracked files, except the
# identifiers that keep the old name (contracts/src: the deployed, verified source; iOS target/module/paths, hash inputs, deploy history, the README's "formerly" note).
# Names like KeyEscrowState, KEYESCROW_* and keyescrow-web are not matched (case-sensitive, whole word).
cd "$(git rev-parse --show-toplevel)"
hits=$(git grep -n -I -P '\bKeyEscrow\b|KeyCrow' -- . \
  ':!contracts/broadcast' ':!contracts/src' ':!web/public/demo/lease.pdf' ':!web/scripts/brand-check.sh' ':!ios/project.yml' ':!ios/.gitignore' \
  | grep -v -P 'import KeyEscrow$|`?KeyEscrow(/|\.xcodeproj|\.app\b)|-scheme +KeyEscrow\b|`KeyEscrow` target|^ios/README.md:\d+:  KeyEscrow/$' \
  | grep -v -P '^web/scripts/testnet-world.mts:\d+: +leaseHash: keccak256|^agent/scripts/sample.ts:\d+: +// sha256\("KeyEscrow' \
  | grep -v -P '^README(\.zh-CN)?\.md:\d+:KeyScrow.*KeyEscrow|^web/tests/i18n.test.ts:.*KeyEscrow\|KeyCrow')
[ -z "$hits" ] && { echo "brand: ok (KeyScrow)"; exit 0; }
echo "Old product name found (the product is KeyScrow):"; echo "$hits"; exit 1
