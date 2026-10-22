"""Quote/confirmation contracts: sealed contents, price stability and atomic booking."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json

import pytest
from fastapi.testclient import TestClient

from backend.blind_boxes.pickup import RuleError, clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.blind_boxes.schemas import QuoteConfirmRequest
from backend.main import create_app
from backend.tests.test_blind_boxes import NOW, END, batch, request, repo, Winner


def confirmation(quote, key="confirm-0001", user="alice"):
    return QuoteConfirmRequest(quote_id=quote["quote_id"], user_id=user, idempotency_key=key)


def test_quote_persists_and_hides_contents_without_reserving(repo):
    before = repo.inventory()
    quote = repo.quote(request(), NOW, Winner())
    assert quote["qty_range"] == {"min": 2, "max": 4}
    assert quote["price_sen"] > 0 and quote["allergens"] == ["wheat"]
    assert set(quote) == {"quote_id", "demo_only", "status", "price_sen", "qty_range",
        "allergens", "pickup_start", "pickup_end", "expires_at", "stock_reserved"}
    assert not quote["stock_reserved"]
    assert repo.inventory() == before
    assert Repository(repo.path).quote(request(), NOW) == quote
    assert repo.dashboard()["simulated_revenue_sen"] == 0


def test_confirmation_uses_stored_box_price_and_reward(repo, monkeypatch):
    quote = repo.quote(request(), NOW, Winner())
    import backend.blind_boxes.repository as module
    monkeypatch.setattr(module, "select", lambda *args: pytest.fail("Confirmation must never redraw"))
    req = confirmation(quote)
    order = repo.confirm_quote(req, NOW)
    assert order["price_sen"] == quote["price_sen"]
    assert order["allergens"] == quote["allergens"]
    assert order["pending_points"] == 10 and order["points_awarded"] == 0
    assert "lines" not in order and "cost_sen" not in order
    assert repo.confirm_quote(req, END) == repo.customer_order(repo.get_order(order["order_id"]))
    full = repo.get_order(order["order_id"])
    with repo.transaction() as db:
        chosen = json.loads(db.execute("SELECT payload FROM quotes").fetchone()[0])["chosen"]
    assert full["lines"] == chosen["lines"]
    assert sum(b["reserved"] for b in repo.inventory()["batches"]) == full["qty"]


def test_expired_quote_and_wrong_user(repo):
    q = repo.quote(request(), NOW)
    with pytest.raises(RuleError) as exc:
        repo.confirm_quote(confirmation(q, user="bob"), NOW)
    assert exc.value.code == "QUOTE_NOT_FOUND"
    with pytest.raises(RuleError) as exc:
        repo.confirm_quote(confirmation(q), END)
    assert exc.value.code == "QUOTE_EXPIRED"
    assert repo.dashboard()["simulated_revenue_sen"] == 0


def test_quote_keys_and_double_confirmation(repo):
    q = repo.quote(request(), NOW)
    with pytest.raises(RuleError) as exc:
        repo.quote(request(user="bob"), NOW)
    assert exc.value.code == "IDEMPOTENCY_CONFLICT"
    repo.confirm_quote(confirmation(q), NOW)
    with pytest.raises(RuleError) as exc:
        repo.confirm_quote(confirmation(q, key="confirm-0002"), NOW)
    assert exc.value.code == "QUOTE_ALREADY_CONFIRMED"
    q2 = repo.quote(request(key="quote-0002"), NOW)
    with pytest.raises(RuleError) as exc:
        repo.confirm_quote(confirmation(q2), NOW)
    assert exc.value.code == "IDEMPOTENCY_CONFLICT"


@pytest.mark.parametrize("change", ["blocked", "metadata"])
def test_confirmation_rechecks_safety_and_disclosures(repo, change):
    q = repo.quote(request(), NOW, Winner())
    with repo.transaction() as db:
        quoted = json.loads(db.execute("SELECT payload FROM quotes").fetchone()[0])
    bid = quoted["chosen"]["lines"][0]["batch_id"]
    if change == "blocked":
        repo.block_batch(bid)
    else:
        with repo.transaction() as db:
            payload = json.loads(db.execute("SELECT payload FROM batches WHERE id=?", (bid,)).fetchone()[0])
            payload["allergens"] = ["wheat", "egg"]
            db.execute("UPDATE batches SET payload=? WHERE id=?", (json.dumps(payload), bid))
    with pytest.raises(RuleError) as exc:
        repo.confirm_quote(confirmation(q), NOW)
    assert exc.value.code in {"QUOTE_UNAVAILABLE", "QUOTE_CHANGED"}
    assert repo.dashboard()["simulated_revenue_sen"] == 0


def test_two_quotes_compete_for_last_box(tmp_path):
    r = Repository(tmp_path / "race.sqlite3")
    r.add_batches([batch(on_hand=2)])
    qs = [r.quote(request(key=f"quote-{i:04}", user=f"u{i}"), NOW) for i in range(2)]
    def confirm(i):
        try:
            return r.confirm_quote(confirmation(qs[i], key=f"confirm-{i:04}", user=f"u{i}"), NOW)["status"]
        except RuleError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(confirm, range(2)))
    assert sorted(outcomes) == ["RESERVED", "STOCK_CONFLICT"]
    assert r.inventory()["batches"][0]["reserved"] == 2


def test_same_confirmation_concurrent(repo):
    q = repo.quote(request(), NOW)
    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(lambda _: repo.confirm_quote(confirmation(q), NOW)["order_id"], range(4)))
    assert len(set(ids)) == 1
    assert sum(b["reserved"] for b in repo.inventory()["batches"]) == repo.get_order(ids[0])["qty"]


def test_confirmation_rechecks_purchase_limit(repo):
    q = repo.quote(request(key="quote-limit"), NOW)
    for i in range(2):
        repo.order(request(key=f"buy-limit-{i}"), NOW)
    with pytest.raises(RuleError) as exc:
        repo.confirm_quote(confirmation(q), NOW)
    assert exc.value.code == "DAILY_LIMIT"


def test_quote_api_rejects_price_override_and_keeps_contents_server_side(repo):
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    app.dependency_overrides[clock] = lambda: NOW
    with TestClient(app) as client:
        response = client.post("/api/blind-boxes/quotes", json=request().model_dump(mode="json"))
        assert response.status_code == 200, response.text
        quote = response.json()
        body = confirmation(quote).model_dump()
        assert client.post("/api/blind-boxes/quotes/confirm", json=body | {"price_sen": 1}).status_code == 422
        paid = client.post("/api/blind-boxes/quotes/confirm", json=body)
        assert paid.status_code == 200, paid.text
        assert paid.json()["price_sen"] == quote["price_sen"]
        assert "lines" not in quote and "lines" not in paid.json()
        assert "cost_sen" not in quote and "hidden" not in quote
