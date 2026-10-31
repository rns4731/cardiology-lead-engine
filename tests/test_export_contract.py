"""The JSON contract between the engine and the web app."""
import json
import os

import pytest

from engine.bundle_check import validate
from engine.export_web import OUT, SCHEMA_VERSION, camel


def test_in_memory_bundle_is_valid(small_bundle):
    assert validate(small_bundle) == []


def test_bundle_is_strict_json(small_bundle):
    json.dumps(small_bundle, allow_nan=False)


def test_label_never_leaves_engine(small_bundle):
    text = json.dumps(small_bundle["leads"])
    assert "will_move" not in text and "willMove" not in text


def test_identifier_keys_survive_camelcase(small_bundle):
    keys = {s["key"] for s in small_bundle["signals"]}
    assert set(small_bundle["meta"]["weights"]) == keys
    assert set(small_bundle["leads"][0]["contributions"]) == keys


def test_camel_converts_fields_not_ids():
    out = camel({"active_share": 1, "weights": {"career_stage": 2},
                 "nested": [{"best_viability": 3}]})
    assert out == {"activeShare": 1, "weights": {"career_stage": 2},
                   "nested": [{"bestViability": 3}]}


def test_validator_catches_corruption(small_bundle):
    broken = json.loads(json.dumps(small_bundle))
    broken["leads"][0]["group"] = "no-such-group"
    broken["leads"][1]["willMove24mo"] = 1
    problems = validate(broken)
    assert any("unknown group" in p for p in problems)
    assert any("hidden outcome" in p for p in problems)


@pytest.mark.parametrize("source", ["synthetic", "real"])
def test_bundles_on_disk(source):
    """The files the app actually serves. Skips a source that was never exported."""
    path = os.path.join(OUT, source, "bundle.json")
    if not os.path.exists(path):
        pytest.skip(f"{source} bundle not exported")
    with open(path) as f:
        b = json.load(f)
    assert b["schemaVersion"] == SCHEMA_VERSION, "re-run: python -m engine.export_web"
    assert validate(b) == []
