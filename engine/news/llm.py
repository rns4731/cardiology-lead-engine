"""Claude API access for the news pipeline: key from .env, one model, an on-disk cache.

Every call is cached by a hash of (model, system, user, schema, effort), so re-running the
pipeline or rebuilding bundles never re-bills, and results are reproducible. The cache
holds full prompts -- real articles included -- so it lives in data/raw/llm (git-ignored);
only compact, verified outputs are written to data/cache/.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.path.join(ROOT, "data", "raw", "llm")
MODEL = "claude-opus-5-5"
_lock = threading.Lock()
_client = None
USAGE = {"calls": 0, "cached": 0, "input_tokens": 0, "output_tokens": 0}


def _load_env() -> None:
    path = os.path.join(ROOT, ".env")
    if os.environ.get("ANTHROPIC_API_KEY") or not os.path.exists(path):
        return
    for line in open(path):
        k, _, v = line.strip().partition("=")
        if k and v and not k.startswith("#"):
            os.environ.setdefault(k, v)


def client():
    global _client
    with _lock:
        if _client is None:
            import anthropic

            _load_env()
            _client = anthropic.Anthropic(max_retries=6)
        return _client


class LLMError(RuntimeError):
    pass


def call_json(system: str, user: str, schema: dict, *, tag: str, effort: str = "medium",
              max_tokens: int = 8000) -> dict:
    """One structured-output call (cached). Raises LLMError on refusal or truncation."""
    key = hashlib.sha256(json.dumps([MODEL, system, user, schema, effort], sort_keys=True).encode()).hexdigest()
    path = os.path.join(CACHE_DIR, tag, key[:2], key + ".json")
    if os.path.exists(path):
        with open(path) as f:
            with _lock:
                USAGE["cached"] += 1
            return json.load(f)["output"]
    resp = client().beta.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # on a policy decline the API retries on a fallback model
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    if resp.stop_reason == "refusal":
        raise LLMError("model declined")
    if resp.stop_reason == "max_tokens":
        raise LLMError("output truncated (max_tokens)")
    text = next(b.text for b in resp.content if b.type == "text")
    out = json.loads(text)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({"model": resp.model, "usage": {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens},
                   "output": out}, f)
    with _lock:
        USAGE["calls"] += 1
        USAGE["input_tokens"] += resp.usage.input_tokens
        USAGE["output_tokens"] += resp.usage.output_tokens
    return out


def cost_usd() -> float:
    """Spend so far this run at claude-opus-5-5 list prices ($4 / $20 per million tokens)."""
    return USAGE["input_tokens"] * 4e-6 + USAGE["output_tokens"] * 20e-6
