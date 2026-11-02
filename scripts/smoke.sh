#!/usr/bin/env bash
# The test ladder, cheapest rung first; stops at the first failure.
#   scripts/smoke.sh          full ladder (+ screenshots if the dev server is up on :5190)
#   scripts/smoke.sh --fast   skip the production build and screenshots
set -euo pipefail
cd "$(dirname "$0")/.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1
PY=.venv/bin/python
step() { printf "\n\033[1m▶ %s\033[0m\n" "$1"; }

step "1/6 engine tests (pytest)"
$PY -m pytest

step "2/6 rebuild bundles from current engine (offline; Real data from cached CMS pulls)"
$PY -m engine.export_web --offline

step "3/6 bundle contract (engine/bundle_check.py)"
$PY -m engine.bundle_check

step "4/6 web typecheck"
npm --prefix web run -s typecheck

step "5/6 web tests (units, every route, link crawl)"
npm --prefix web test --silent

if [[ $FAST == 0 ]]; then
  step "6/6 production build"
  npm --prefix web run -s build
  if curl -s -o /dev/null --max-time 2 http://localhost:5190/; then
    step "visual QA in real Chrome → outputs/screens/"
    (cd web && node scripts/screenshots.mjs)
  else
    echo "(dev server not on :5190 — skipped screenshots; start it with: npm --prefix web run dev)"
  fi
fi

printf "\n\033[32m✔ all rungs green\033[0m\n"
