import json

import pytest
from fastapi.testclient import TestClient

from backend.blind_boxes.calculator import biofuel, calculate, distance_km
from backend.blind_boxes.pickup import clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.blind_boxes.schemas import Preferences
from backend.main import create_app
from backend.tests.test_blind_boxes import END, NOW, batch

STORE = {"lat": 2.8327, "lng": 101.7066}
NEAR = {"name": "Near", "lat": 2.8460, "lng": 101.7200, "accepts": ["bread", "drink"]}
FAR = {"name": "Far", "lat": 2.9200, "lng": 101.6550, "accepts": ["bread"]}
TEA = dict(category="drink", main_staple=False, cost_sen=100, retail_sen=400)


def test_returns_top_n_options():
    r = calculate([batch(), batch("tea", **TEA)], Preferences(), END, NOW, top=2)
    assert r["status"] == "OPTIONS" and len(r["options"]) == 2 and r["fallback"] is None
    totals = [o["scores"]["total"] for o in r["options"]]
    assert totals == sorted(totals, reverse=True)


def test_no_options_lists_leftovers_and_nearest_orphanage():
    # Only a drink: no staple, so no box is possible, but the drink is safe to donate.
    r = calculate([batch("tea", **TEA, on_hand=5)], Preferences(), END, NOW,
                  store=STORE, charities=[FAR, NEAR])
    assert r["status"] == "NO_OPTIONS" and r["options"] == []
    fb = r["fallback"]
    assert fb["reason"] == "NO_FEASIBLE_COMBINATION"
    assert fb["donatable"]["qty"] == 5 and fb["donatable"]["by_category"]["drink"]["qty"] == 5
    donation, = [c for c in fb["choices"] if c["type"] == "ORPHANAGE_DONATION"]
    assert [x["name"] for x in donation["recipients"]] == ["Near"]  # Far does not accept drinks
    assert all(c["type"] != "BIOFUEL" for c in fb["choices"])


def test_unsafe_food_goes_to_biofuel_never_donation():
    r = calculate([batch(safe=False, on_hand=10)], Preferences(), END, NOW, store=STORE, charities=[NEAR])
    fb = r["fallback"]
    assert fb["donatable"]["qty"] == 0 and fb["inedible"]["qty"] == 10
    assert [c["type"] for c in fb["choices"]] == ["BIOFUEL"]
    fuel = fb["choices"][0]
    assert fuel["weight_kg"] == pytest.approx(0.8) and fuel["biogas_m3"] == pytest.approx(0.096)
    assert fuel["is_estimate"] is True


def test_safe_food_without_charity_falls_back_to_biofuel():
    r = calculate([batch("tea", **TEA, on_hand=5)], Preferences(), END, NOW, store=STORE, charities=[])
    assert [c["type"] for c in r["fallback"]["choices"]] == ["BIOFUEL"]


def test_formula_and_distance():
    assert biofuel(10) | {"formula": None} == {"weight_kg": 10, "biogas_m3": pytest.approx(1.2),
        "methane_m3": pytest.approx(0.72), "energy_kwh": pytest.approx(7.2), "is_estimate": True, "formula": None}
    assert distance_km(STORE, STORE) == 0 and 1 < distance_km(STORE, NEAR) < 3


def test_calculate_endpoint(tmp_path, monkeypatch):
    repo = Repository(tmp_path / "db.sqlite3")
    repo.add_batches([batch("tea", **TEA, on_hand=3)])
    (tmp_path / "charities.json").write_text(json.dumps({"store": STORE, "charities": [NEAR]}), "utf-8")
    monkeypatch.setenv("CHARITIES_PATH", str(tmp_path / "charities.json"))
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    app.dependency_overrides[clock] = lambda: NOW
    client = TestClient(app)
    body = {"pickup_start": NOW.isoformat(), "pickup_end": END.isoformat()}
    r = client.post("/api/blind-boxes/calculate", json=body)
    assert r.status_code == 200 and r.json()["fallback"]["choices"][0]["recipients"][0]["name"] == "Near"
    bad = client.post("/api/blind-boxes/calculate", json=body | {"top": 0})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_REQUEST"
    assert repo.inventory()["batches"][0]["reserved"] == 0  # read-only
