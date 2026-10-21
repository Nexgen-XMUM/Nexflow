import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import ai_copy, main


REAL_CLIENT = httpx.Client
BODY = [{"item": "croissant", "qty": 10}]


def mock_provider(monkeypatch, handler):
    monkeypatch.setenv("AI_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-key")
    monkeypatch.setattr(
        ai_copy.httpx, "Client",
        lambda **kwargs: REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs),
    )


def completion(content, finish="stop"):
    return {"choices": [{"finish_reason": finish, "message": {"content": content}}]}


def test_ai_success_keeps_facts_and_only_sends_sale_data(monkeypatch):
    def handler(request):
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer test-only-key"
        payload = json.loads(request.content)
        assert payload["thinking"] == {"type": "disabled"}
        assert payload["response_format"] == {"type": "json_object"}
        assert json.loads(payload["messages"][1]["content"]) == [
            {"name": "Butter Croissant", "qty": 10, "unit_price": "3.00"}
        ]
        return httpx.Response(200, json=completion(json.dumps({
            "opening": "Bossku, jom makan! 🥐", "closing": "Sedap lah!"
        })))

    with TestClient(main.create_app()) as client:
        baseline = client.post("/api/generate-promo", json=BODY).json()
        mock_provider(monkeypatch, handler)
        response = client.post("/api/generate-promo", json=BODY)
    assert response.status_code == 200
    result = response.json()
    for field in ("items", "totals", "carbon", "warnings"):
        assert result[field] == baseline[field]
    assert result["promo"]["source"] == "deepseek"
    assert result["promo"]["is_fallback"] is False
    assert result["promo"]["fallback_reason"] is None
    assert "10 Butter Croissant at RM3.00 each" in result["promo"]["text"]
    assert "All 10 for RM30.00 (50% off)" in result["promo"]["text"]
    assert "test-only-key" not in response.text


@pytest.mark.parametrize("status", [401, 429, 500])
def test_provider_http_error_falls_back_without_exposing_body(monkeypatch, status):
    mock_provider(monkeypatch, lambda request: httpx.Response(
        status, text="secret-provider-error test-only-key"
    ))
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=BODY)
    assert response.status_code == 200
    assert response.json()["promo"]["fallback_reason"] == "AI_HTTP_ERROR"
    assert response.json()["promo"]["source"] == "local_demo"
    assert response.json()["promo"]["is_fallback"] is True
    assert "secret-provider-error" not in response.text
    assert "test-only-key" not in response.text


@pytest.mark.parametrize("error, reason", [
    (httpx.ReadTimeout, "AI_TIMEOUT"),
    (httpx.ConnectError, "AI_NETWORK_ERROR"),
])
def test_transport_failure_falls_back(monkeypatch, error, reason):
    def handler(request):
        raise error("secret exception", request=request)
    mock_provider(monkeypatch, handler)
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=BODY)
    assert response.status_code == 200
    assert response.json()["promo"]["fallback_reason"] == reason
    assert "secret exception" not in response.text


@pytest.mark.parametrize("data", [
    {}, {"choices": []}, completion(None), completion("not json"),
    completion('{"opening":"hi","closing":"bye"}', finish="length"),
    completion('{"opening":"","closing":"bye"}'),
    completion('{"opening":"RM1 only!","closing":"lah"}'),
    completion('{"opening":"Free delivery!","closing":"lah"}'),
    completion('{"opening":"hello","closing":"bye","price":"1"}'),
    completion(json.dumps({"opening": "hello " * 20, "closing": "bye"})),
])
def test_invalid_model_reply_falls_back(monkeypatch, data):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json=data))
    with TestClient(main.create_app()) as client:
        result = client.post("/api/generate-promo", json=BODY).json()
    assert result["promo"]["fallback_reason"] == "INVALID_AI_COPY"
    assert result["promo"]["is_fallback"] is True
    assert result["totals"]["clearance_total"] == "30.00"


def test_missing_key_and_unknown_provider_do_not_call_network(monkeypatch):
    def forbidden(**kwargs):
        pytest.fail("No network call expected")
    monkeypatch.setattr(ai_copy.httpx, "Client", forbidden)
    with TestClient(main.create_app()) as client:
        monkeypatch.setenv("AI_PROVIDER", "deepseek")
        result = client.post("/api/generate-promo", json=BODY).json()
        assert result["promo"]["fallback_reason"] == "MISSING_API_KEY"
        monkeypatch.setenv("AI_PROVIDER", "typo")
        result = client.post("/api/generate-promo", json=BODY).json()
        assert result["promo"]["fallback_reason"] == "INVALID_AI_PROVIDER"


def test_invalid_stock_does_not_call_ai(monkeypatch):
    def forbidden(offers):
        pytest.fail("Validate stock before calling AI")
    monkeypatch.setenv("AI_PROVIDER", "deepseek")
    monkeypatch.setattr(main, "deepseek_lines", forbidden)
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=[{"item": "croissant", "qty": 19}])
    assert response.status_code == 422


def test_dotenv_does_not_override_process_environment(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("AI_PROVIDER=deepseek\nDEEPSEEK_API_KEY=example\n")
    main.load_dotenv(path, override=False)
    assert main.os.environ["AI_PROVIDER"] == "local_demo"
    assert main.os.environ["DEEPSEEK_API_KEY"] == ""
