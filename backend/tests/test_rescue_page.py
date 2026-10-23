import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend.blind_boxes.pickup import clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.main import create_app
from backend.tests.test_blind_boxes import NOW, batch

# After closing, so the sweep moves leftovers into the donation list.
CLOSED = NOW + timedelta(hours=1, minutes=1)
TEA = dict(category="drink", main_staple=False, cost_sen=100, retail_sen=400)
BODY = {"pickup_start": NOW.isoformat(), "pickup_end": (NOW + timedelta(minutes=30)).isoformat()}


def test_rescue_page_served_and_linked():
    client = TestClient(create_app())
    alias = client.get("/app/rescue", follow_redirects=False)
    assert alias.status_code == 307 and alias.headers["location"] == "/app#rescue"
    page = client.get("/app")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"]
    for text in ('id="rescueModule"', 'data-tab="rescue"', 'id="rescue-hoAck"', "推荐，尚未联系",
                 "不进入捐赠", "未来业务（未实现）", "不是经认证的减排量"):
        assert text in page.text
    module = client.get("/app/assets/rescue-module.js")
    assert module.status_code == 200
    assert "/api/blind-boxes" in module.text and "/donations/handoff" in module.text
    for text in ("已送达", "模拟交易", "tradeBtn", "fuelBtn", "localStorage"):
        assert text not in module.text
    for asset in ("integration.js", "integration.css", "rescue-module.css"):
        assert client.get("/app/assets/" + asset).status_code == 200
    assert client.get("/app/assets/rescue.html").status_code == 404


@pytest.fixture
def rescue(tmp_path, monkeypatch):
    def make(batches, now=NOW):
        repo = Repository(tmp_path / "db.sqlite3")
        if batches:
            repo.add_batches(batches)
        (tmp_path / "charities.json").write_text(json.dumps({"store": {"lat": 2.8327, "lng": 101.7066}, "charities": [
            {"name": "Demo Orphanage A (placeholder)", "lat": 2.846, "lng": 101.72, "accepts": ["bread", "drink"]}]}), "utf-8")
        monkeypatch.setenv("CHARITIES_PATH", str(tmp_path / "charities.json"))
        app = create_app()
        app.dependency_overrides[repository] = lambda: repo
        app.dependency_overrides[clock] = lambda: now
        return TestClient(app), repo
    return make


def stock(repo):
    return {b["batch_id"]: (b["on_hand"], b["reserved"]) for b in repo.inventory()["batches"]}


def test_with_box_options_calculation_is_read_only(rescue):
    client, repo = rescue([batch(on_hand=5), batch("tea", **TEA, on_hand=5)])
    before = stock(repo)
    r = client.post("/api/blind-boxes/calculate", json=BODY).json()
    assert r["status"] == "OPTIONS" and r["options"]
    assert {line["batch_id"] for o in r["options"] for line in o["lines"]} <= set(before)
    assert stock(repo) == before


def test_no_box_separates_donatable_from_inedible(rescue):
    client, _ = rescue([batch("tea", **TEA, on_hand=3), batch("stale", safe=False, on_hand=2)])
    fb = client.post("/api/blind-boxes/calculate", json=BODY).json()["fallback"]
    assert [i["batch_id"] for i in fb["donatable"]["items"]] == ["tea"]
    assert [(i["batch_id"], i["reason"]) for i in fb["inedible"]["items"]] == [("stale", "SAFETY_UNVERIFIED")]
    assert {c["type"] for c in fb["choices"]} == {"ORPHANAGE_DONATION", "BIOFUEL"}
    fuel, = [c for c in fb["choices"] if c["type"] == "BIOFUEL"]
    assert fuel["weight_kg"] == pytest.approx(fb["inedible"]["weight_kg"])  # donatable food is not counted as waste


def test_empty_inventory(rescue):
    client, _ = rescue([])
    r = client.post("/api/blind-boxes/calculate", json=BODY).json()
    assert r["status"] == "NO_OPTIONS"
    assert r["fallback"]["donatable"]["qty"] == 0 and r["fallback"]["inedible"]["qty"] == 0
    assert r["fallback"]["choices"] == []
    assert client.get("/api/blind-boxes/donations").json()["donations"] == []


def test_pending_then_handoff_and_repeat_never_double_counts(rescue):
    client, repo = rescue([batch("tea", **TEA, on_hand=3), batch("stale", safe=False, on_hand=2)], now=CLOSED)
    # Recommendation alone changes nothing.
    client.post("/api/blind-boxes/calculate", json=BODY)
    assert client.get("/api/blind-boxes/donations").json()["donations"] == []
    assert stock(repo) == {"tea": (3, 0), "stale": (2, 0)}

    client.post("/api/blind-boxes/sweep")
    client.post("/api/blind-boxes/sweep")  # repeated sweep adds nothing
    rows = client.get("/api/blind-boxes/donations").json()["donations"]
    assert sorted(r["status"] for r in rows) == ["DISCARDED", "PENDING"]
    pending, = [r for r in rows if r["status"] == "PENDING"]
    assert pending["payload"]["lines"] == [{"batch_id": "tea", "qty": 3}] and pending["recipient"] is None
    assert stock(repo) == {"tea": (3, 3), "stale": (0, 0)}  # reserved, not yet deducted
    assert client.get("/api/blind-boxes/dashboard").json()["donated_qty"] == 0

    action = {"donation_id": pending["id"], "recipient": "Demo Orphanage A (placeholder)"}
    first = client.post("/api/blind-boxes/donations/handoff", json=action)
    again = client.post("/api/blind-boxes/donations/handoff", json=action)
    assert first.status_code == again.status_code == 200 and first.json() == again.json()
    assert first.json()["status"] == "DONATED"
    other = client.post("/api/blind-boxes/donations/handoff", json=action | {"recipient": "Someone else"})
    assert other.status_code == 409 and other.json()["error"]["code"] == "RECIPIENT_CONFLICT"

    assert stock(repo) == {"tea": (0, 0), "stale": (0, 0)}
    dash = client.get("/api/blind-boxes/dashboard").json()
    assert dash["donated_qty"] == 3 and dash["donated_weight_g"] == 240
    discarded, = [r for r in client.get("/api/blind-boxes/donations").json()["donations"] if r["status"] == "DISCARDED"]
    assert discarded["recipient"] is None  # inedible food never becomes a donation


def test_unknown_donation_returns_404(rescue):
    client, _ = rescue([])
    r = client.post("/api/blind-boxes/donations/handoff", json={"donation_id": "nope", "recipient": "x"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "DONATION_NOT_FOUND"
