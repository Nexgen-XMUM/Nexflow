from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend.blind_boxes.pickup import clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.main import create_app
from backend.tests.test_blind_boxes import NOW, Winner, batch, request


@pytest.fixture
def customer(tmp_path, monkeypatch):
    import backend.blind_boxes.repository as module

    monkeypatch.setattr(module.random, "SystemRandom", Winner)
    repo = Repository(tmp_path / "customer.sqlite3")
    repo.add_batches([batch()])
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    app.dependency_overrides[clock] = lambda: NOW
    with TestClient(app) as client:
        yield client, repo


def test_imported_customer_quote_confirmation_pickup_and_redemption(customer):
    client, repo = customer
    before = repo.inventory()
    quoted = client.post("/api/blind-boxes/quotes", json=request().model_dump(mode="json"))
    assert quoted.status_code == 200
    quote = quoted.json()
    assert quote["stock_reserved"] is False
    assert not {"lines", "cost_sen", "hidden"} & quote.keys()
    assert repo.inventory() == before

    body = {"quote_id": quote["quote_id"], "user_id": "alice", "idempotency_key": "confirm-0001"}
    confirmed = client.post("/api/blind-boxes/quotes/confirm", json=body)
    assert confirmed.status_code == 200
    order = confirmed.json()
    assert order["price_sen"] == quote["price_sen"]
    reserved = repo.inventory()
    assert sum(b["reserved"] for b in reserved["batches"]) > 0
    assert client.post("/api/blind-boxes/quotes/confirm", json=body).json() == order
    assert repo.inventory() == reserved

    account_url = "/api/blind-boxes/customer/account?user_id=alice"
    assert client.get(account_url).json()["pending_points"] == 10
    pickup = {"order_id": order["order_id"], "user_id": "alice"}
    assert client.post("/api/blind-boxes/customer/pickup", json=pickup).json()["status"] == "PICKED_UP"
    assert client.post("/api/blind-boxes/customer/pickup", json=pickup).status_code == 200
    account = client.get(account_url).json()
    assert account["points"] == 10 and account["pending_points"] == 0
    assert len(account["orders"]) == 1
    assert sum(b["reserved"] for b in repo.inventory()["batches"]) == 0

    redemption = {"user_id": "alice", "idempotency_key": "redeem-0001", "regular_price_sen": 1000, "points": 5}
    assert client.post("/api/blind-boxes/points/redeem", json=redemption).status_code == 200
    assert client.post("/api/blind-boxes/points/redeem", json=redemption).status_code == 200
    assert client.get(account_url).json()["points"] == 5


def test_customer_pickup_keeps_existing_time_and_identity_checks(customer):
    client, repo = customer
    later = request(pickup_start=NOW + timedelta(minutes=30), pickup_end=NOW + timedelta(hours=1))
    quote = client.post("/api/blind-boxes/quotes", json=later.model_dump(mode="json")).json()
    body = {"quote_id": quote["quote_id"], "user_id": "alice", "idempotency_key": "confirm-later"}
    order = client.post("/api/blind-boxes/quotes/confirm", json=body).json()
    response = client.post("/api/blind-boxes/customer/pickup", json={"order_id": order["order_id"], "user_id": "bob"})
    assert response.status_code == 404
    response = client.post("/api/blind-boxes/customer/pickup", json={"order_id": order["order_id"], "user_id": "alice"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "OUTSIDE_PICKUP_SLOT"
    assert repo.get_order(order["order_id"])["status"] == "RESERVED"
