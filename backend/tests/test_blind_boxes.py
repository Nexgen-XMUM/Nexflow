from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
import random

import pytest
from fastapi.testclient import TestClient

from backend.blind_boxes.algorithm import candidates, price, select
from backend.blind_boxes.pickup import LOCAL, RuleError, clock, validate_slot
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.blind_boxes.schemas import Batch, Preferences, OrderRequest, RedeemRequest
from backend.main import create_app

NOW = datetime(2026, 10, 22, 21, 30, tzinfo=LOCAL)
END = NOW + timedelta(minutes=30)


def batch(bid="bread", **changes):
    data = dict(batch_id=bid, product_id=bid, name=bid, category="bread", main_staple=True,
                cost_sen=200, retail_sen=600, weight_g=80, co2e_per_kg=2.5,
                on_hand=20, safe=True, storage_verified=True, allergens=["wheat"],
                diets=["vegetarian"], safe_until=NOW+timedelta(hours=2))
    return Batch(**(data | changes))


def request(key="request-0001", user="alice", **changes):
    return OrderRequest(**(dict(user_id=user, idempotency_key=key, pickup_start=NOW, pickup_end=END) | changes))


@pytest.fixture
def repo(tmp_path):
    r = Repository(tmp_path / "test.sqlite3")
    r.add_batches([batch(), batch("tea", category="drink", main_staple=False, cost_sen=100, retail_sen=400)])
    return r


class Winner(random.Random):
    def random(self):
        return 0.0


@pytest.mark.parametrize("changes,reason", [
    ({"safe": False}, "SAFETY_UNVERIFIED"),
    ({"storage_verified": False}, "SAFETY_UNVERIFIED"),
    ({"allergens": None}, "UNKNOWN_RESTRICTIONS"),
    ({"diets": None}, "UNKNOWN_RESTRICTIONS"),
    ({"safe_until": END-timedelta(seconds=1)}, "SAFETY_WINDOW"),
    ({"on_hand": 0}, "OUT_OF_STOCK"),
    ({"reserved": 20}, "OUT_OF_STOCK"),
])
def test_hard_filters(changes, reason):
    r = candidates([batch(**changes)], Preferences(), END, NOW)
    assert not r["candidates"]
    assert r["rejected"]["bread"] == reason


@pytest.mark.parametrize("preferences,reason", [
    (Preferences(avoid_allergens=["WHEAT"]), "ALLERGEN_CONFLICT"),
    (Preferences(required_diets=["vegan"]), "DIET_CONFLICT"),
])
def test_customer_constraints(preferences, reason):
    assert candidates([batch()], preferences, END, NOW)["rejected"]["bread"] == reason


def test_hand_calculated_price_score():
    r = candidates([batch(on_hand=2)], Preferences(), END, NOW)
    c = r["candidates"][0]
    assert c["qty"] == 2
    assert c["price_sen"] == 570  # 400 * 1.30 + 50
    assert c["gross_profit_sen"] == 120
    assert c["contribution_sen"] == 520
    assert c["scores"] == {"urgency": 50, "inventory": 100, "diversity": 50, "preference": 50, "total": 62.5}
    assert c["estimated_co2e_kg"] == pytest.approx(.4)
    assert c["hidden_probability"] == pytest.approx(.05 + .2*120/570)
    assert price(5) == 57  # 6.5 sen rounds half up to 7, plus 50


def test_cross_batch_limit_and_main_staple():
    rows = [batch("b1", product_id="bread", on_hand=1), batch("b2", product_id="bread", on_hand=2),
            batch("tea", category="drink", main_staple=False)]
    r = candidates(rows, Preferences(), END, NOW)
    assert r["candidates"]
    for c in r["candidates"]:
        bread = sum(x["qty"] for x in c["lines"] if x["batch_id"].startswith("b"))
        assert 1 <= bread <= 2
        assert 2 <= c["qty"] <= 4


def test_no_staple_or_poor_value():
    assert not candidates([batch(main_staple=False)], Preferences(), END, NOW)["candidates"]
    assert not candidates([batch(cost_sen=600)], Preferences(), END, NOW)["candidates"]


def test_search_bounds():
    rows = [batch(str(i)) for i in range(10)]
    r = candidates(rows, Preferences(), END, NOW, max_candidates=3)
    assert len(r["candidates"]) == 3 and r["search_truncated"]
    r = candidates(rows, Preferences(), END, NOW, max_nodes=1)
    assert r["search_truncated"] and r["reason"] == "SEARCH_LIMIT"


def test_random_only_top_five_and_reproducible():
    cs = candidates([batch(str(i)) for i in range(5)], Preferences(), END, NOW)["candidates"]
    for mode in ("standard", "surprise"):
        assert select(cs, mode, random.Random(42)) == select(cs, mode, random.Random(42))
        assert select(cs, mode, random.Random(1)) in cs[:5]


def test_order_pickup_idempotence_and_persistence(repo):
    req = request()
    order = repo.order(req, NOW, Winner())
    assert order["pending_points"] == 10
    assert repo.order(req, NOW)["order_id"] == order["order_id"]
    reserved = sum(b["reserved"] for b in repo.inventory()["batches"])
    assert reserved == order["qty"]
    done = repo.pickup(order["order_id"], NOW)
    assert done["points_awarded"] == 10 and done["pending_points"] == 0
    assert repo.pickup(order["order_id"], NOW) == done
    assert Repository(repo.path).get_order(order["order_id"])["status"] == "PICKED_UP"
    assert repo.dashboard()["users"][0]["points"] == 10
    assert sum(b["reserved"] for b in repo.inventory()["batches"]) == 0


def test_key_conflict_and_daily_limit(repo):
    repo.order(request(), NOW)
    with pytest.raises(RuleError, match="different request"):
        repo.order(request(user="bob"), NOW)
    repo.order(request(key="request-0002"), NOW)
    with pytest.raises(RuleError) as exc:
        repo.order(request(key="request-0003"), NOW)
    assert exc.value.code == "DAILY_LIMIT"


def test_concurrent_last_stock(tmp_path):
    repo = Repository(tmp_path/"race.sqlite3")
    repo.add_batches([batch(on_hand=2)])
    def buy(i):
        try:
            return repo.order(request(key=f"concurrent-{i}", user=f"u{i}"), NOW)["status"]
        except RuleError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(buy, range(2)))
    assert results.count("RESERVED") == 1
    assert results.count("NO_FEASIBLE_COMBINATION") == 1
    assert repo.inventory()["batches"][0]["reserved"] == 2


def test_reservation_rollback(repo, monkeypatch):
    before = repo.inventory()
    import backend.blind_boxes.repository as module
    original = module.select
    def corrupt(cs, mode, rng):
        c = dict(original(cs, mode, rng))
        c["lines"] = c["lines"] + [{"batch_id": "missing", "qty": 1}]
        return c
    monkeypatch.setattr(module, "select", corrupt)
    with pytest.raises(RuleError):
        repo.order(request(), NOW)
    assert repo.inventory() == before
    assert repo.dashboard()["simulated_revenue_sen"] == 0


def test_no_show_freeze_and_donation_no_double_count(repo):
    orders = [repo.order(request(key=f"noshow-{i:03}"), NOW) for i in range(2)]
    assert repo.sweep(END)["no_shows_processed"] == 2
    assert repo.sweep(END)["no_shows_processed"] == 0
    assert repo.dashboard()["users"][0]["frozen_until"] is not None
    with pytest.raises(RuleError) as exc:
        repo.order(request(key="frozen-request", pickup_start=END, pickup_end=END+timedelta(minutes=30)), END)
    assert exc.value.code == "USER_FROZEN"
    assert repo.dashboard()["picked_up_qty"] == repo.dashboard()["donated_qty"] == 0
    for d in repo.donations():
        repo.donate(d["id"], "Demo charity", END)
        repo.donate(d["id"], "Demo charity", END)
    assert repo.dashboard()["donated_qty"] == sum(o["qty"] for o in orders)
    assert repo.dashboard()["users"][0]["points"] == 0


def test_expired_food_discarded(repo):
    order = repo.order(request(), NOW)
    repo.sweep(NOW+timedelta(hours=3))
    assert repo.get_order(order["order_id"])["status"] == "NO_SHOW"
    assert all(d["status"] == "DISCARDED" for d in repo.donations())
    assert all(b["on_hand"] == b["reserved"] == 0 for b in repo.inventory()["batches"])
    assert repo.dashboard()["donated_qty"] == 0


def test_close_sweep_is_idempotent(repo):
    close = NOW+timedelta(hours=1)
    repo.sweep(close)
    before = repo.inventory()
    count = len(repo.donations())
    repo.sweep(close)
    assert before == repo.inventory() and len(repo.donations()) == count


def test_points_redemption(repo):
    oid = repo.order(request(), NOW, Winner())["order_id"]
    repo.pickup(oid, NOW)
    r = RedeemRequest(user_id="alice", idempotency_key="redeem-001", regular_price_sen=100, points=10)
    assert repo.redeem(r, NOW)["paid_sen"] == 90
    assert repo.redeem(r, NOW)["paid_sen"] == 90
    assert repo.dashboard()["users"][0]["points"] == 0
    with pytest.raises(RuleError):
        repo.redeem(r.model_copy(update={"idempotency_key": "redeem-002"}), NOW)
    with pytest.raises(RuleError) as exc:
        repo.redeem(r.model_copy(update={"idempotency_key": "redeem-003", "points": 31}), NOW)
    assert exc.value.code == "REDEMPTION_LIMIT"


@pytest.mark.parametrize("when", [NOW-timedelta(minutes=1), END])
def test_pickup_time_boundaries(repo, when):
    oid = repo.order(request(), NOW)["order_id"]
    with pytest.raises(RuleError):
        repo.pickup(oid, when)
    assert repo.get_order(oid)["status"] == "RESERVED"


def test_release_and_naive_dates(repo):
    with pytest.raises(RuleError) as exc:
        repo.order(request(), NOW-timedelta(minutes=1))
    assert exc.value.code == "NOT_RELEASED"
    with pytest.raises(ValueError):
        request(pickup_end=END.replace(tzinfo=None))


def test_api_contract_and_existing_promo(repo):
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    app.dependency_overrides[clock] = lambda: NOW
    with TestClient(app) as client:
        body = request().model_dump(mode="json")
        response = client.post("/api/blind-boxes/orders", json=body)
        assert response.status_code == 200, response.text
        oid = response.json()["order_id"]
        assert client.post("/api/blind-boxes/pickup", json={"order_id": oid}).json()["status"] == "PICKED_UP"
        invalid = client.post("/api/blind-boxes/orders", json={})
        assert invalid.status_code == 422
        assert "blind-box" in invalid.json()["error"]["message"]
        missing = client.get("/api/blind-boxes/orders/missing")
        assert missing.status_code == 404 and missing.json()["error"]["code"] == "ORDER_NOT_FOUND"
        assert client.get("/api/blind-boxes/dashboard").json()["picked_up_qty"] > 0
        assert client.post("/api/generate-promo", json=[{"item":"croissant","qty":10}]).json()["totals"]["clearance_total"] == "30.00"


def test_import_is_all_or_nothing(repo):
    before = repo.inventory()
    with pytest.raises(RuleError):
        repo.add_batches([batch("new"), batch()])
    assert repo.inventory() == before


def test_safety_withdrawal_blocks_pickup_and_donation(repo):
    order = repo.order(request(), NOW, Winner())
    repo.block_batch(order["lines"][0]["batch_id"])
    with pytest.raises(RuleError) as exc:
        repo.pickup(order["order_id"], NOW)
    assert exc.value.code == "UNSAFE_FOR_HANDOFF"
    assert repo.dashboard()["users"][0]["points"] == 0
    repo.sweep(END)
    assert all(d["status"] == "DISCARDED" for d in repo.donations())
    assert repo.dashboard()["donated_qty"] == 0


def test_expired_handoff_is_rejected(repo):
    repo.order(request(), NOW)
    repo.sweep(END)
    did = repo.donations()[0]["id"]
    with pytest.raises(RuleError) as exc:
        repo.donate(did, "Charity", NOW+timedelta(hours=3))
    assert exc.value.code == "UNSAFE_FOR_HANDOFF"
    assert repo.dashboard()["donated_qty"] == 0


def test_freeze_ends_and_counter_resets(repo):
    for i in range(2):
        repo.order(request(key=f"freeze-{i:04}"), NOW)
    repo.sweep(END)
    future = NOW+timedelta(days=8)
    repo.add_batches([batch("future", safe_until=future+timedelta(hours=2))])
    req = request(key="after-freeze", pickup_start=future, pickup_end=future+timedelta(minutes=30))
    order = repo.order(req, future)
    assert order["status"] == "RESERVED"
    repo.sweep(future+timedelta(minutes=30))
    freeze = datetime.fromisoformat(repo.dashboard()["users"][0]["frozen_until"])
    assert freeze < future  # One new no-show does not reapply the previous two.


def test_same_request_concurrent(repo):
    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(lambda _: repo.order(request(), NOW)["order_id"], range(4)))
    assert len(set(ids)) == 1
    assert sum(b["reserved"] for b in repo.inventory()["batches"]) == repo.get_order(ids[0])["qty"]


def test_seed_and_api_donation_workflow(tmp_path):
    repo = Repository(tmp_path/"api.sqlite3")
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    current = [NOW]
    app.dependency_overrides[clock] = lambda: current[0]
    with TestClient(app) as client:
        assert client.post("/api/blind-boxes/demo-seed").status_code == 200
        assert client.post("/api/blind-boxes/demo-seed").status_code == 409
        req = request().model_dump(mode="json")
        suggest_body = {k:v for k,v in req.items() if k not in ("user_id","idempotency_key")}
        suggestions = client.post("/api/blind-boxes/suggest", json=suggest_body).json()
        assert suggestions["candidates"] and not suggestions["stock_reserved"]
        order = client.post("/api/blind-boxes/orders", json=req).json()
        current[0] = END
        assert client.post("/api/blind-boxes/sweep").json()["no_shows_processed"] == 1
        ds = client.get("/api/blind-boxes/donations").json()["donations"]
        result = client.post("/api/blind-boxes/donations/handoff", json={"donation_id":ds[0]["id"],"recipient":"DEMO charity"})
        assert result.status_code == 200, result.text
        dashboard = client.get("/api/blind-boxes/dashboard").json()
        assert dashboard["donated_qty"] == order["qty"] and dashboard["picked_up_qty"] == 0
        assert dashboard["conversion_rate"] is None


def test_background_sweep_uses_server_clock(repo, monkeypatch):
    import asyncio
    import importlib
    module = importlib.import_module("backend.blind_boxes.router")
    repo.order(request(), NOW)
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    app.dependency_overrides[clock] = lambda: END
    calls = 0

    async def sleep_once(seconds):
        nonlocal calls
        assert seconds == 60
        calls += 1
        if calls > 1:
            raise asyncio.CancelledError()

    monkeypatch.setattr(module.asyncio, "sleep", sleep_once)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(module.sweep_loop(app))
    assert repo.donations()[0]["status"] == "PENDING"
