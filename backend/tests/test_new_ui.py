from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.blind_boxes.pickup import clock
from backend.blind_boxes.router import repository
from backend.tests.test_blind_boxes import NOW, request, repo, Winner


def test_new_ui_serves_pan_and_only_named_assets():
    root = Path(__file__).resolve().parents[2]
    with TestClient(create_app()) as client:
        page = client.get("/app/new-ui")
        assert page.status_code == 200
        assert page.content == (root / "orbyte smart yield.html").read_bytes()
        assert 'data-role="consumer"' in page.text
        assert '/ui/blind-boxes.js' in page.text
        for name in ("blind-boxes.js", "blind-boxes.css"):
            assert client.get("/ui/" + name).content == (root / "frontend" / name).read_bytes()
        assert client.get("/ui/main.py").status_code == 404
        assert client.get("/ui/.env").status_code == 404
        assert client.get("/app").content == (root / "frontend/index.html").read_bytes()


def test_customer_account_only_own_orders_and_points(repo):
    own = repo.order(request(user="demo_mei_ling"), NOW, Winner())
    other = repo.order(request(key="other-user-001", user="someone_else"), NOW)
    repo.pickup(own["order_id"], NOW)
    app = create_app()
    app.dependency_overrides[repository] = lambda: repo
    app.dependency_overrides[clock] = lambda: NOW
    with TestClient(app) as client:
        result = client.get("/api/blind-boxes/customer/account?user_id=demo_mei_ling").json()
        assert result["points"] == 10
        assert [o["order_id"] for o in result["orders"]] == [own["order_id"]]
        assert result["orders"][0]["status"] == "PICKED_UP"
        assert "lines" not in result["orders"][0]
        assert "cost_sen" not in result["orders"][0]
        assert client.get("/api/blind-boxes/customer/account?user_id=missing").json()["orders"] == []
