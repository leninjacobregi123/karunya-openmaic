#!/bin/bash
# Harness startup + verification for OpenMAIC.
# The code lives in OpenMAIC/; this script runs every gate from there.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/OpenMAIC"

echo "=== Harness Initialization ==="
echo "Workspace root: $ROOT"
echo "App dir:        $APP"
cd "$APP"

echo ""
echo "=== pnpm install ==="
pnpm install

echo ""
echo "=== prettier (format check) ==="
pnpm check

echo ""
echo "=== eslint ==="
pnpm lint

echo ""
echo "=== tsc --noEmit (type check) ==="
npx tsc --noEmit

echo ""
echo "=== i18n key parity ==="
pnpm check:i18n-keys

echo ""
echo "=== unit tests (vitest) ==="
pnpm test

echo ""
echo "=== Verification Complete ==="
echo ""
echo "Heavier gates (run when your change touches them — NOT part of fast loop):"
echo "  - cd OpenMAIC && pnpm build        # production build (asserts vendored maic-importer)"
echo "  - cd OpenMAIC && pnpm test:e2e     # playwright e2e on :3002"
echo ""
echo "Next steps:"
echo "1. Read feature_list.json to see current feature state"
echo "2. Pick ONE feature whose status is not 'done' and whose dependencies are 'done'"
echo "3. Implement only that feature"
echo "4. Re-run ./init.sh before claiming done; record evidence in feature_list.json + progress.md"
