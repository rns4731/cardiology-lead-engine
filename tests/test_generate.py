"""Generator: reproducibility, realism, and no claims about real organizations."""
import pandas as pd

from engine.generate_data import METRO_COORDS, METROS, generate, generate_from_identities

REAL_SYSTEMS = ["Banner Health", "OhioHealth", "Mount Carmel", "Vanderbilt", "Atrium Health",
                "Novant", "BayCare", "AdventHealth", "UCHealth", "Duke Health", "WakeMed",
                "HCA", "Ascension", "Baylor Scott"]


def test_reproducible(universe):
    pd.testing.assert_frame_equal(universe, generate(n=1200, seed=42))


def test_seed_changes_universe(universe):
    assert not universe["propensity_score" if "propensity_score" in universe else "age"].equals(
        generate(n=1200, seed=43)["age"])


def test_base_rate_is_realistic(universe):
    """A 24-month move to independence is a minority event; ~10-30% keeps lift honest."""
    assert 0.10 <= universe["will_move_24mo"].mean() <= 0.30


def test_npi_unique(universe):
    assert universe["npi"].is_unique


def test_hospital_systems_are_fictional():
    """Simulated distress events are attached to systems -- never to a real one."""
    names = [s for systems in METROS.values() for s in systems]
    for real in REAL_SYSTEMS:
        assert not any(real.lower() in n.lower() for n in names), real


def test_every_metro_has_coordinates():
    assert set(METROS) == set(METRO_COORDS)


def test_identity_overlay_preserves_real_fields():
    ids = pd.DataFrame([
        {"npi": 1111111111, "name": "Dr. Real One", "metro": "Austin, TX", "subspecialty": "Interventional"},
        {"npi": 2222222222, "name": "Dr. Real Two", "metro": "Denver, CO", "subspecialty": "Electrophysiology"},
    ])
    out = generate_from_identities(ids, seed=1)
    for col in ["npi", "name", "metro", "subspecialty"]:
        assert list(out[col]) == list(ids[col])
