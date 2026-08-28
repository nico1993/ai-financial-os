#!/usr/bin/env bash
# Standalone smoke test for CategorizationProvider/Ollama (CAT-4/5,
# ADR-0026) -- run this instead of smoke-test.sh when the only thing you
# actually want to know is "does Ollama produce usable categorization
# output right now?" No Docker or Redis required; .env just needs to
# exist (env.ts validates its full schema on import, same as
# apps/worker/src/index.ts), not to point at anything actually running.
#
# Data source: real Plaid sandbox transactions when .env has real
# PLAID_CLIENT_ID/PLAID_SECRET sandbox values (the same ones smoke-test.sh
# uses for its Plaid round-trip stage); synthetic samples otherwise.
#
#   bash test-categorization.sh                 # real sandbox data if configured
#   bash test-categorization.sh --fake           # force synthetic samples
#   bash test-categorization.sh --limit=40       # categorize more than the default 20
set -uo pipefail

cd "$(dirname "$0")" 2>/dev/null || true
if [ ! -f pnpm-workspace.yaml ] && [ -d "$HOME/Projects/ai-financial-os" ]; then
  cd "$HOME/Projects/ai-financial-os"
fi
[ -f pnpm-workspace.yaml ] || { echo "Run this from inside ai-financial-os." >&2; exit 1; }

[ -f .env ] || { echo ".env missing -- run 'bash dev-setup.sh' first." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm not on PATH." >&2; exit 1; }

pnpm --filter @financial-os/worker test:categorization -- "$@"
