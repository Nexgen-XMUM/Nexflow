import json

from fastapi.testclient import TestClient

from backend import main


def test_inventory_can_supply_promo_items_without_modifying_data(tmp_path, monkeypatch):
    path = tmp_path / "inventory.json"
    before = main.INVENTORY_PATH.read_bytes()
    path.write_bytes(before)
    monkeypatch.setattr(main, "INVENTORY_PATH", path)
    with TestClient(main.create_app()) as client:
        response = client.get("/api/inventory")
        assert response.status_code == 200
        result = response.json()
        assert result["currency"] == "MYR"
        assert result["products"] == [
            {"id": "croissant", "name": "Butter Croissant", "retail_price": "6.00", "on_hand": 18},
            {"id": "chocolate_slice", "name": "Chocolate Cake Slice", "retail_price": "8.00", "on_hand": 8},
            {"id": "sourdough", "name": "Sourdough Loaf", "retail_price": "14.00", "on_hand": 6},
        ]
        promo = client.post("/api/generate-promo", json=[
            {"item": item["id"], "qty": 1} for item in result["products"]
        ])
        assert promo.status_code == 200
        assert path.read_bytes() == before

        # A later read must reflect the file, including an out-of-stock product.
        data = json.loads(before)
        data["products"][0]["on_hand"] = 0
        data["products"][0]["retail_price"] = "6.01"
        path.write_text(json.dumps(data), encoding="utf-8")
        updated = client.get("/api/inventory").json()["products"][0]
        assert updated["on_hand"] == 0
        assert updated["retail_price"] == "6.01"
