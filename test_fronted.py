import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend import main


def test_catalogue_uses_inventory_without_private_fields(tmp_path, monkeypatch):
    data = json.loads(main.INVENTORY_PATH.read_text())
    data["products"][0]["name"] = "New catalogue name"
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps(data))
    monkeypatch.setattr(main, "INVENTORY_PATH", path)
    before = path.read_bytes()
    with TestClient(main.app) as client:
        response = client.get("/api/products")
        assert response.status_code == 200
        options = response.json()["products"]
        assert options == [
            {key: product[key] for key in ("id", "name", "aliases", "on_hand")}
            for product in data["products"]
        ]
        result = client.post("/api/generate-promo", json=[{"item": options[0]["id"], "qty": 10}])
        assert result.json()["totals"]["retail_total"] == "60.00"
        assert result.json()["totals"]["cost_total"] == "20.00"
        assert result.json()["totals"]["clearance_total"] == "30.00"
        assert result.json()["totals"]["gross_profit_total"] == "10.00"
        assert result.json()["totals"]["estimated_co2e_kg"] == "2"
        assert client.get("/app").status_code == 200
    assert path.read_bytes() == before


def test_catalogue_unavailable_is_actionable(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "INVENTORY_PATH", tmp_path / "missing.json")
    with TestClient(main.app) as client:
        response = client.get("/api/products")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "INVENTORY_UNAVAILABLE"


def test_frontend_entry_does_not_expose_repository():
    with TestClient(main.app) as client:
        page = client.get("/app")
        assert page.status_code == 200
        assert "text/html" in page.headers["content-type"]
        assert page.text.replace("\r\n", "\n") == (Path(__file__).resolve().parent / "frontend" / "index.html").read_text(encoding="utf-8")
        assert "/api/products" in page.text
        assert 'id="guide-sidebar"' in page.text
        assert 'id="themeToggleBtn"' in page.text
        assert 'id="tab-blind"' in page.text
        assert 'id="quote-form"' in page.text
        assert 'id="pay-submit"' in page.text
        assert 'id="redeem-form"' not in page.text
        for asset in ('customer.js', 'customer.css'):
            response = client.get('/app/assets/' + asset)
            assert response.status_code == 200
            expected = (Path(__file__).resolve().parent / 'frontend' / asset).read_text(encoding='utf-8')
            assert response.text.replace('\r\n', '\n') == expected.replace('\r\n', '\n')
        assert 'id="consumerShop"' in page.text
        assert '/api/blind-boxes/inventory' in page.text
        assert '/api/blind-boxes/calculate' in page.text
        assert '100 sen = RM1' in page.text
        for path in ("/data/inventory.json", "/data/customers.json", "/backend/main.py", "/api/approve"):
            assert client.get(path).status_code == 404


def test_catalogue_cors(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:5173")
    with TestClient(main.create_app()) as client:
        for origin, allowed in [("http://127.0.0.1:5173", True), ("http://localhost:5173", False)]:
            response = client.get("/api/products", headers={"Origin": origin})
            assert (response.headers.get("access-control-allow-origin") == origin) is allowed
            preflight = client.options("/api/products", headers={
                "Origin": origin, "Access-Control-Request-Method": "GET",
            })
            assert preflight.status_code == (200 if allowed else 400)
