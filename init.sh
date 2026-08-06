#!/bin/bash
# Fast local verification loop for OpenMAIC.
# The code lives in OpenMAIC/; this script runs every gate from there.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/OpenMAIC"

echo "=== Verification ==="
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
echo "Heavier gates (run when your change touches them — not part of this fast loop):"
echo "  - cd OpenMAIC && pnpm build        # production build (asserts vendored maic-importer)"
echo "  - cd OpenMAIC && pnpm test:e2e     # playwright e2e on :3002"
