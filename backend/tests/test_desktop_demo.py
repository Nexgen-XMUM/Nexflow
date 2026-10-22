from datetime import date

import pytest
from backend.main import INVENTORY_PATH

from fastapi.testclient import TestClient

from backend.desktop_demo import create_demo_app
from backend.main import create_app


def test_demo_clock_and_database_are_isolated(tmp_path):
    database = tmp_path / "demo.sqlite3"
    with TestClient(create_demo_app(database, date(2026, 10, 22))) as client:
        session = client.get("/api/demo/session").json()
        assert session["now"] == "2026-10-22T21:35:00+08:00"
        assert client.get("/api/blind-boxes/inventory").json()["batches"] == []
        assert client.post("/api/blind-boxes/demo-seed").status_code == 200
        assert client.post("/api/blind-boxes/demo-seed").status_code == 409
        assert database.exists()
    normal = TestClient(create_app())
    assert normal.get("/api/demo/session").status_code == 404
    assert normal.post("/api/demo/close").status_code == 404
    assert normal.post("/api/demo/leftovers", json=[]).status_code == 404


def test_predicted_paid_picked_and_donated_statistics_are_distinct(tmp_path):
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", date(2026, 10, 22))) as client:
        client.post("/api/blind-boxes/demo-seed").raise_for_status()
        before = client.get("/api/blind-boxes/dashboard").json()
        forecast = client.post("/api/generate-promo", json=[{"item": "croissant", "qty": 10}]).json()
        assert forecast["totals"]["clearance_total"] == "30.00"
        assert client.get("/api/blind-boxes/dashboard").json() == before
        body = {"user_id": "demo_mei", "idempotency_key": "desktop-demo-order-0001",
                "pickup_start": "2026-10-22T21:30:00+08:00", "pickup_end": "2026-10-22T22:00:00+08:00"}
        order = client.post("/api/blind-boxes/orders", json=body).json()
        assert order["status"] == "RESERVED"
        paid = client.get("/api/blind-boxes/dashboard").json()
        assert paid["simulated_revenue_sen"] == order["price_sen"] > 0
        assert paid["picked_up_qty"] == paid["donated_qty"] == paid["estimated_co2e_kg"] == 0
        response = client.post("/api/blind-boxes/pickup", json={"order_id": order["order_id"]})
        assert response.status_code == 200
        picked = client.get("/api/blind-boxes/dashboard").json()
        assert picked["picked_up_qty"] == order["qty"] > 0
        assert picked["simulated_revenue_sen"] == paid["simulated_revenue_sen"]
        close = client.post("/api/demo/close").json()
        assert close["now"] == "2026-10-22T22:31:00+08:00"
        pending = [r for r in client.get("/api/blind-boxes/donations").json()["donations"] if r["status"] == "PENDING"]
        assert pending and client.get("/api/blind-boxes/dashboard").json()["donated_qty"] == 0
        request = {"donation_id": pending[0]["id"], "recipient": "DEMO centre"}
        first = client.post("/api/blind-boxes/donations/handoff", json=request)
        assert first.status_code == 200
        assert client.post("/api/blind-boxes/donations/handoff", json=request).json() == first.json()
        final = client.get("/api/blind-boxes/dashboard").json()
        assert final["donated_qty"] == pending[0]["payload"]["qty"]
        assert final["simulated_revenue_sen"] == paid["simulated_revenue_sen"]
        assert final["conversion_rate"] is final["redemption_repurchase_rate"] is None


def test_close_can_be_repeated_without_creating_more_donations(tmp_path):
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", date(2026, 10, 22))) as client:
        client.post("/api/blind-boxes/demo-seed").raise_for_status()
        client.post("/api/demo/close").raise_for_status()
        first = client.get("/api/blind-boxes/donations").json()
        client.post("/api/demo/close").raise_for_status()
        assert client.get("/api/blind-boxes/donations").json() == first


def test_same_recorded_surplus_reaches_donation_without_a_second_sample(tmp_path):
    catalogue_before = INVENTORY_PATH.read_bytes()
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", date(2026, 10, 22))) as client:
        request = [{"item": "croissant", "qty": 10}]
        promo = client.post("/api/generate-promo", json=request).json()
        assert promo["totals"]["clearance_total"] == "30.00"
        first = client.post("/api/demo/leftovers", json=request)
        assert first.status_code == 200
        assert first.json()["registered_qty"] == 10 and first.json()["source"] == "eod_leftovers"
        assert "Synthetic" in first.json()["safety_note"]
        assert client.get("/api/demo/session").json()["leftovers_registered"] is True
        assert client.post("/api/demo/leftovers", json=request).json() == first.json()
        assert client.post("/api/demo/leftovers", json=[{"item": "croissant", "qty": 9}]).status_code == 409
        inventory = client.get("/api/blind-boxes/inventory").json()["batches"]
        assert len(inventory) == 1 and inventory[0]["name"] == promo["items"][0]["name"]
        assert inventory[0]["on_hand"] == 10
        assert client.get("/api/blind-boxes/dashboard").json()["simulated_revenue_sen"] == 0
        client.post("/api/demo/close").raise_for_status()
        pending = client.get("/api/blind-boxes/donations").json()["donations"]
        assert len(pending) == 1 and pending[0]["payload"]["qty"] == 10
        assert pending[0]["payload"]["lines"][0]["batch_id"] == first.json()["batch_ids"][0]
        client.post("/api/blind-boxes/donations/handoff", json={"donation_id": pending[0]["id"], "recipient": "DEMO centre"}).raise_for_status()
        dashboard = client.get("/api/blind-boxes/dashboard").json()
        assert dashboard["donated_qty"] == 10 and dashboard["estimated_co2e_kg"] == 2
        assert dashboard["picked_up_qty"] == dashboard["simulated_revenue_sen"] == 0
    assert INVENTORY_PATH.read_bytes() == catalogue_before


@pytest.mark.parametrize("rows", [[], [{"item":"croissant","qty":0}], [{"item":"croissant","qty":1.5}],
    [{"item":"croissant","qty":True}], [{"item":"croissant","qty":19}], [{"item":"unknown","qty":1}],
    [{"item":"croissant","qty":1},{"item":"croissants","qty":1}]])
def test_invalid_demo_registration_does_not_import_batches(tmp_path, rows):
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", date(2026, 10, 22))) as client:
        assert client.post("/api/demo/leftovers", json=rows).status_code == 422
        assert client.get("/api/blind-boxes/inventory").json()["batches"] == []


def test_cannot_mix_an_independent_seed_with_the_recorded_surplus(tmp_path):
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", date(2026, 10, 22))) as client:
        client.post("/api/blind-boxes/demo-seed").raise_for_status()
        before = client.get("/api/blind-boxes/inventory").json()
        assert client.post("/api/demo/leftovers", json=[{"item":"croissant","qty":10}]).status_code == 409
        assert client.get("/api/blind-boxes/inventory").json() == before


def test_registration_after_closing_is_rejected(tmp_path):
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", date(2026, 10, 22))) as client:
        client.post("/api/demo/close").raise_for_status()
        assert client.post("/api/demo/leftovers", json=[{"item":"croissant","qty":10}]).status_code == 409
        assert client.get("/api/blind-boxes/inventory").json()["batches"] == []
