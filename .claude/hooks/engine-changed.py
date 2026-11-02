#!/usr/bin/env python3
"""PostToolUse hook: after an edit to engine/ or to the bundle contract, remind Claude of the
follow-through (re-export, validate, test, mirror types.ts). Silent for every other file;
never blocks and never fails the tool call."""
import json
import sys

try:
    data = json.load(sys.stdin)
    path = (data.get("tool_input") or {}).get("file_path") or ""
except Exception:
    sys.exit(0)

msg = None
if "/engine/" in path and path.endswith(".py"):
    msg = ("engine/ changed: rebuild, re-export and test in Docker (`docker compose up --build -d && "
           "docker compose --profile test run --rm tests`); for the dev server and web tests also write the "
           "bundles to web/public/data (see /export-data). If a seed-42 metric moved, update the docs that "
           "quote it (.claude/CLAUDE.md invariant 8).")
    if path.endswith(("export_web.py", "bundle_check.py", "insights.py")):
        msg += (" Bundle shape may have changed: bump SCHEMA_VERSION, mirror web/src/types.ts, "
                "and add a bundle_check rule for any field a page dereferences.")
elif path.endswith("web/src/types.ts"):
    msg = ("types.ts mirrors engine/export_web.py: change both together, bump SCHEMA_VERSION, "
           "update engine/bundle_check.py, then re-export.")

if msg:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}}))
sys.exit(0)
