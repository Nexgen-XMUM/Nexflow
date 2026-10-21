import subprocess
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import demo
from backend.main import app


def test_demo_serves_page_and_real_api():
    with TestClient(demo.create_demo_app()) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "Nexflow" in page.text
        result = client.post(
            "/api/generate-promo", json=[{"item": "croissant", "qty": 10}]
        )
        assert result.status_code == 200
        assert result.json()["totals"]["clearance_total"] == "30.00"
        assert result.json()["totals"]["estimated_co2e_kg"] == "2"


def test_demo_product_options_have_no_private_fields():
    with TestClient(demo.create_demo_app()) as client:
        response = client.get("/demo/products")
        assert response.status_code == 200
        products = response.json()
        assert len(products) == 3
        assert products[0] == {
            "item": "croissant", "name": "Butter Croissant", "on_hand": 18
        }
        assert all(set(product) == {"item", "name", "on_hand"} for product in products)
        assert client.get("/data/customers.json").status_code == 404


def test_demo_routes_do_not_change_normal_app():
    with TestClient(app) as client:
        assert client.get("/").status_code == 404
        assert client.get("/demo/products").status_code == 404


@pytest.fixture
def launcher(monkeypatch, tmp_path):
    python = tmp_path / ".venv" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.touch()
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    listener = MagicMock()
    listener.__enter__.return_value.getsockname.return_value = ("127.0.0.1", 54321)
    monkeypatch.setattr(demo.socket, "socket", MagicMock(return_value=listener))
    process = MagicMock()
    process.poll.return_value = None

    def exit_normally(*args, **kwargs):
        process.poll.return_value = 0
        return 0

    process.wait.side_effect = exit_normally
    popen = MagicMock(return_value=process)
    monkeypatch.setattr(demo.subprocess, "Popen", popen)
    opened = MagicMock(return_value=True)
    monkeypatch.setattr(demo.webbrowser, "open", opened)
    response = MagicMock()
    response.__enter__.return_value.status = 200
    monkeypatch.setattr(demo, "urlopen", MagicMock(return_value=response))
    return python, process, popen, opened


def test_launcher_always_uses_project_venv(launcher, tmp_path):
    python, process, popen, opened = launcher
    assert demo.main() == 0
    command = popen.call_args.args[0]
    assert command[0] == str(python)
    assert "demo:create_demo_app" in command
    assert command[command.index("--host") + 1] == "127.0.0.1"
    assert popen.call_args.kwargs["cwd"] == tmp_path
    opened.assert_called_once_with("http://127.0.0.1:54321")
    process.terminate.assert_not_called()


def test_launcher_missing_venv_is_actionable(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    popen = MagicMock()
    monkeypatch.setattr(demo.subprocess, "Popen", popen)
    assert demo.main() == 1
    assert ".venv" in capsys.readouterr().out
    popen.assert_not_called()


def test_launcher_failed_start_does_not_open_browser(launcher, capsys):
    _, process, _, opened = launcher
    process.poll.return_value = 1
    assert demo.main() == 1
    assert "启动未完成" in capsys.readouterr().out
    opened.assert_not_called()


def test_launcher_timeout_stops_child(launcher, monkeypatch):
    _, process, _, opened = launcher
    monkeypatch.setattr(demo.time, "monotonic", MagicMock(side_effect=[0, 16]))
    assert demo.main() == 1
    process.terminate.assert_called_once()
    opened.assert_not_called()


def test_launcher_browser_failure_still_prints_address(launcher, capsys):
    _, _, _, opened = launcher
    opened.side_effect = demo.webbrowser.Error("No browser")
    assert demo.main() == 0
    assert "http://127.0.0.1:54321" in capsys.readouterr().out


@pytest.mark.parametrize("stuck", [False, True])
def test_launcher_interrupt_cleans_up_child(launcher, stuck):
    _, process, _, _ = launcher
    process.wait.side_effect = (
        [KeyboardInterrupt(), subprocess.TimeoutExpired("uvicorn", 5), 0]
        if stuck else [KeyboardInterrupt(), 0]
    )
    assert demo.main() == 0
    process.terminate.assert_called_once()
    assert process.kill.called is stuck
