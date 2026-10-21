import json
from itertools import combinations
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def inventory_file(tmp_path, monkeypatch):
    path = tmp_path / "inventory.json"
    path.write_bytes(main.INVENTORY_PATH.read_bytes())
    monkeypatch.setattr(main, "INVENTORY_PATH", path)
    return path


def test_croissant_demo_path():
    response = TestClient(app).post(
        "/api/generate-promo", json=[{"item": "croissant", "qty": 10}]
    )
    assert response.status_code == 200
    result = response.json()
    assert result["currency"] == "MYR"
    assert result["discount_rate"] == "0.50"
    assert result["items"] == [
        {
            "item": "croissant",
            "name": "Butter Croissant",
            "qty": 10,
            "unit_retail_price": "6.00",
            "unit_cost_price": "2.00",
            "unit_clearance_price": "3.00",
            "retail_total": "60.00",
            "cost_total": "20.00",
            "clearance_total": "30.00",
            "gross_profit_total": "10.00",
            "loss_total": "0.00",
            "estimated_co2e_kg": "2",
        }
    ]
    assert result["totals"] == {
        "qty": 10,
        "retail_total": "60.00",
        "cost_total": "20.00",
        "clearance_total": "30.00",
        "gross_profit_total": "10.00",
        "loss_total": "0.00",
        "estimated_co2e_kg": "2",
    }
    assert result["carbon"]["is_estimate"] is True
    assert result["promo"]["source"] == "local_demo"
    assert result["promo"]["is_fallback"] is False
    assert result["warnings"] == []


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {},
        {"items": [{"item": "croissant", "qty": 1}]},
        [None],
        [[]],
        [{}],
        [{"item": "croissant"}],
        [{"qty": 1}],
        [{"item": "", "qty": 1}],
        [{"item": "  ", "qty": 1}],
        [{"item": 1, "qty": 1}],
        [{"item": "croissant", "qty": 1, "role": "owner"}],
        [{"item": "croissant", "qty": 1, "retail_price": 0.01}],
    ],
)
def test_invalid_request_shape(client, body):
    response = client.post("/api/generate-promo", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("qty", [True, False, "1", "1.0", 1.0, 1.5, 0, -1, None, [], {}])
def test_invalid_quantity(client, qty):
    response = client.post(
        "/api/generate-promo", json=[{"item": "croissant", "qty": qty}]
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("content", ["", "{", '[{"item":"croissant","qty":}]'])
def test_invalid_json(client, content):
    response = client.post(
        "/api/generate-promo", content=content,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_invalid_unknown_item(client):
    response = client.post(
        "/api/generate-promo", json=[{"item": "pizza", "qty": 1}]
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNKNOWN_ITEM"
    assert response.json()["error"]["details"] == [{"index": 0, "item": "pizza"}]


@pytest.mark.parametrize("item", ["croissant", "croissants", " CROISSANTS "])
def test_alias_duplicate_is_invalid(client, item):
    response = client.post(
        "/api/generate-promo",
        json=[{"item": "croissant", "qty": 1}, {"item": item, "qty": 1}],
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "DUPLICATE_ITEM"


@pytest.mark.parametrize("item", ["croissants", " CROISSANT ", "Croissants"])
def test_alias_normalized(client, item):
    response = client.post("/api/generate-promo", json=[{"item": item, "qty": 1}])
    assert response.status_code == 200
    assert response.json()["items"][0]["item"] == "croissant"


@pytest.mark.parametrize("qty, status", [(1, 200), (18, 200), (19, 422), (10**50, 422)])
def test_stock_boundary(client, qty, status):
    response = client.post(
        "/api/generate-promo", json=[{"item": "croissant", "qty": qty}]
    )
    assert response.status_code == status
    if status == 422:
        assert response.json()["error"] == {
            "code": "INSUFFICIENT_STOCK",
            "message": "Requested quantity exceeds available stock.",
            "details": [{"index": 0, "item": "croissant", "available_qty": 18}],
        }


@pytest.mark.parametrize("method, route", [("GET", "/api/inventory"), ("POST", "/api/generate-promo")])
@pytest.mark.parametrize("damage", ["missing", "json", "fields", "negative", "alias", "id", "currency", "nan"])
def test_inventory_unavailable(client, inventory_file, damage, method, route):
    data = json.loads(inventory_file.read_text())
    if damage == "missing":
        inventory_file.unlink()
    elif damage == "json":
        inventory_file.write_text("{broken")
    else:
        if damage == "fields":
            del data["products"][0]["cost_price"]
        elif damage == "negative":
            data["products"][0]["on_hand"] = -1
        elif damage == "alias":
            data["products"][1]["aliases"].append(" CROISSANT ")
        elif damage == "id":
            data["products"][1]["id"] = "croissant"
        elif damage == "currency":
            data["currency"] = "USD"
        elif damage == "nan":
            data["products"][0]["retail_price"] = float("nan")
        inventory_file.write_text(json.dumps(data))
    response = client.request(method, route, **(
        {"json": [{"item": "croissant", "qty": 1}]} if method == "POST" else {}
    ))
    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "INVENTORY_UNAVAILABLE",
        "message": "Inventory data is unavailable or invalid.",
        "details": [],
    }
    assert str(inventory_file) not in response.text


def test_invalid_request_does_not_echo_input(client):
    response = client.post(
        "/api/generate-promo",
        json=[{"item": "croissant", "qty": "secret-example"}],
    )
    assert response.status_code == 422
    assert "secret-example" not in response.text


def test_money_and_carbon_multiple_items(client):
    response = client.post(
        "/api/generate-promo",
        json=[{"item": "croissant", "qty": 10}, {"item": "cake slice", "qty": 2}],
    )
    assert response.status_code == 200
    result = response.json()
    assert result["items"][1]["item"] == "chocolate_slice"
    assert result["items"][1]["estimated_co2e_kg"] == "0.6"
    assert result["totals"] == {
        "qty": 12,
        "retail_total": "76.00",
        "cost_total": "26.00",
        "clearance_total": "38.00",
        "gross_profit_total": "12.00",
        "loss_total": "0.00",
        "estimated_co2e_kg": "2.6",
    }


def test_money_half_cent_rounds_unit_before_multiplying(client, inventory_file):
    data = json.loads(inventory_file.read_text())
    data["products"][0]["retail_price"] = "6.01"
    inventory_file.write_text(json.dumps(data))
    response = client.post(
        "/api/generate-promo", json=[{"item": "croissant", "qty": 3}]
    )
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["unit_clearance_price"] == "3.01"
    assert item["retail_total"] == "18.03"
    assert item["clearance_total"] == "9.03"
    assert item["gross_profit_total"] == "3.03"


@pytest.mark.parametrize("mixed", [False, True])
def test_loss_is_allowed_and_not_offset_by_profitable_items(client, inventory_file, mixed):
    data = json.loads(inventory_file.read_text())
    data["products"][0]["cost_price"] = "4.00"
    inventory_file.write_text(json.dumps(data))
    body = [{"item": "croissant", "qty": 2}]
    if mixed:
        body.append({"item": "chocolate_slice", "qty": 3})
    response = client.post("/api/generate-promo", json=body)
    assert response.status_code == 200
    result = response.json()
    item = result["items"][0]
    assert item["unit_clearance_price"] == "3.00"
    assert item["gross_profit_total"] == "-2.00"
    assert item["loss_total"] == "2.00"
    assert result["totals"]["gross_profit_total"] == ("1.00" if mixed else "-2.00")
    assert result["totals"]["loss_total"] == "2.00"
    assert any(warning["code"] == "BELOW_COST" for warning in result["warnings"])
    assert "RM3.00" in result["promo"]["text"]
    assert "cost" not in result["promo"]["text"].casefold()


def test_money_break_even_is_not_a_loss(client, inventory_file):
    data = json.loads(inventory_file.read_text())
    data["products"][0]["cost_price"] = "3.00"
    inventory_file.write_text(json.dumps(data))
    response = client.post(
        "/api/generate-promo", json=[{"item": "croissant", "qty": 1}]
    )
    assert response.status_code == 200
    assert response.json()["totals"]["gross_profit_total"] == "0.00"
    assert response.json()["totals"]["loss_total"] == "0.00"
    assert response.json()["warnings"] == []


def test_carbon_decimal_precision(client):
    response = client.post(
        "/api/generate-promo",
        json=[
            {"item": "croissant", "qty": 10},
            {"item": "chocolate_slice", "qty": 2},
            {"item": "sourdough", "qty": 1},
        ],
    )
    assert response.status_code == 200
    assert response.json()["items"][2]["estimated_co2e_kg"] == "1.125"
    assert response.json()["totals"]["estimated_co2e_kg"] == "3.725"
    assert response.json()["carbon"]["is_estimate"] is True
    assert "not certified" in response.json()["carbon"]["note"]
    assert "credit" not in response.json()["totals"]


@pytest.mark.parametrize(
    "selection",
    [
        selection
        for count in range(1, 4)
        for selection in combinations(
            [("croissant", 18), ("chocolate_slice", 8), ("sourdough", 6)], count
        )
    ],
)
def test_local_promo_facts_and_length(client, selection):
    response = client.post(
        "/api/generate-promo",
        json=[{"item": item, "qty": qty} for item, qty in selection],
    )
    assert response.status_code == 200
    result = response.json()
    text = result["promo"]["text"]
    assert result["promo"]["source"] == "local_demo"
    assert result["promo"]["is_fallback"] is False
    assert "🥐" in text
    assert "lah" in text
    assert len(text.split()) <= 50
    for item in result["items"]:
        assert f'{item["qty"]} {item["name"]} at RM{item["unit_clearance_price"]} each' in text
    assert f'All {result["totals"]["qty"]} for RM{result["totals"]["clearance_total"]}' in text
    assert "cost" not in text.casefold()
    assert "phone" not in response.text
    assert "customers" not in result


def test_data_files_unchanged_after_success_failure_and_repeat(client, inventory_file):
    shared_data = Path(main.__file__).resolve().parents[1] / "data"
    directory = inventory_file.parent
    for name in ("users.json", "customers.json"):
        (directory / name).write_bytes((shared_data / name).read_bytes())
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    body = [{"item": "croissant", "qty": 10}]
    first = client.post("/api/generate-promo", json=body)
    second = client.post("/api/generate-promo", json=body)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    for invalid_body in (
        [{"item": "croissant", "qty": 19}],
        [*body, {"item": "pizza", "qty": 1}],
        [*body, {"item": "croissants", "qty": 1}],
        [{"item": "croissant", "qty": True}],
    ):
        assert client.post("/api/generate-promo", json=invalid_body).status_code == 422
    after = {path.name: path.read_bytes() for path in directory.iterdir()}
    assert after == before


@pytest.mark.parametrize(
    "method, route",
    [
        ("GET", "/api/customers"),
        ("GET", "/api/users"),
        ("GET", "/api/activity"),
        ("POST", "/api/approve"),
        ("POST", "/api/draft"),
        ("GET", "/data/customers.json"),
        ("GET", "/data/users.json"),
        ("GET", "/data/inventory.json"),
    ],
)
def test_private_and_out_of_scope_routes_are_not_exposed(client, method, route):
    assert client.request(method, route).status_code == 404


@pytest.mark.parametrize(
    "configured, origin, allowed",
    [
        ("", "http://localhost:5173", False),
        ("http://localhost:5173", "http://localhost:5173", True),
        ("http://localhost:5173", "http://localhost:5174", False),
        ("http://localhost:5173", "http://127.0.0.1:5173", False),
        ("http://localhost:5173", "https://localhost:5173", False),
        ("http://localhost:5173", "https://unlisted.example", False),
        (" http://localhost:5173, https://ui.example ", "https://ui.example", True),
    ],
)
@pytest.mark.parametrize("method, route", [("GET", "/api/inventory"), ("POST", "/api/generate-promo")])
def test_cors_exact_origins(monkeypatch, configured, origin, allowed, method, route):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", configured)
    with TestClient(main.create_app()) as cors_client:
        headers = {
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type",
        }
        preflight = cors_client.options(route, headers=headers)
        assert preflight.status_code == (200 if allowed else 400)
        response = cors_client.request(
            method, route, headers={"Origin": origin},
            **({"json": [{"item": "croissant", "qty": 1}]} if method == "POST" else {}),
        )
        assert response.status_code == 200
        for result in (preflight, response):
            if allowed:
                assert result.headers["access-control-allow-origin"] == origin
            else:
                assert "access-control-allow-origin" not in result.headers
            assert "access-control-allow-credentials" not in result.headers


@pytest.mark.parametrize(
    "origin",
    [
        "*", "https://*.example", "localhost:5173", "ftp://localhost:5173",
        "http://localhost:5173/", "http://localhost:5173/path",
        "http://name:password@localhost:5173", "http://localhost:bad",
        "http://localhost:5173?query=yes", "http://localhost:5173#fragment",
    ],
)
def test_cors_rejects_wildcard_or_invalid_origin(monkeypatch, origin):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", origin)
    with pytest.raises(ValueError, match="CORS_ALLOWED_ORIGINS"):
        main.create_app()


def test_cors_disallows_unneeded_method(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    with TestClient(main.create_app()) as cors_client:
        response = cors_client.options(
            "/api/generate-promo",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "DELETE",
            },
        )
        assert response.status_code == 400
