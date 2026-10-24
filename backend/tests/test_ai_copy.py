import asyncio
import json
import time
from itertools import combinations

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import ai_copy, main


REAL_CLIENT = httpx.AsyncClient
BODY = [{"item": "croissant", "qty": 10}]


def mock_provider(monkeypatch, handler):
    monkeypatch.setenv("AI_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-key")
    monkeypatch.setattr(
        ai_copy.httpx, "AsyncClient",
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
    assert "10 Butter Croissant: original RM6.00, clearance RM3.00/each" in result["promo"]["text"]
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
    None, [], {}, {"choices": None}, {"choices": {}}, {"choices": []},
    {"choices": [None]}, {"choices": [True]}, {"choices": ["bad"]},
    {"choices": [{"finish_reason": "stop", "message": None}]},
    {"choices": [{"finish_reason": "stop", "message": []}]},
    {"choices": [{"finish_reason": "stop", "message": {}}]},
    completion([]), completion({}), completion(None), completion("not json"),
    completion('{"opening":"hi","closing":"bye"}', finish="length"),
    completion('{"opening":"","closing":"bye"}'),
    completion('{"opening":"   ","closing":"   "}'),
    completion('{"opening":"   ","closing":"lah"}'),
    completion('{"opening":"Jom!","closing":"   "}'),
    completion(json.dumps({"opening": "\t\n\u2003", "closing": "lah"})),
    completion('{"opening":"RM1 only!","closing":"lah"}'),
    completion('{"opening":"Free delivery!","closing":"lah"}'),
    completion('{"opening":"Hello!","closing":"Enjoy!"}'),
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
    monkeypatch.setattr(ai_copy.httpx, "AsyncClient", forbidden)
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
    path.write_text("AI_PROVIDER=deepseek\nDEEPSEEK_API_KEY=example\n", encoding="utf-8")
    main.load_dotenv(path, override=False)
    assert main.os.environ["AI_PROVIDER"] == "local_demo"
    assert main.os.environ["DEEPSEEK_API_KEY"] == ""


@pytest.mark.parametrize("claim", [
    "Delivery included, halal certified!",
    "Delivery included!", "Halal certified!", "Shipping included!",
    "Voucher available!", "Minimum purchase required!", "Buy more, get more!",
    "Members exclusive!", "Cashback included!", "Today only!", "While supplies last!",
    "Stock guaranteed!", "Always available!", "Unlimited stock!",
    "Organically certified!", "Organic and approved!",
    "Reduce emissions!", "Earn carbon credits!", "Eco friendly!", "CO₂e saved!",
    "Save the planet!", "Zero waste!",
    "Penghantaran percuma!", "Diskaun dengan baucar!", "Stok dijamin!",
    "Ada sijil halal!", "Kurangkan pelepasan karbon!", "Dapat kredit karbon!",
])
def test_unsupported_claims_fall_back(monkeypatch, claim):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json=completion(
        json.dumps({"opening": claim, "closing": "Jom lah! 😊"})
    )))
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=BODY)
    assert response.status_code == 200
    promo = response.json()["promo"]
    assert promo["source"] == "local_demo"
    assert promo["is_fallback"] is True
    assert promo["fallback_reason"] == "INVALID_AI_COPY"
    assert claim not in promo["text"]


def test_valid_lines_are_stripped_before_use(monkeypatch):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json=completion(
        json.dumps({"opening": "  Bossku, jom makan! 🥐  ", "closing": "  Sedap lah!  "})
    )))
    with TestClient(main.create_app()) as client:
        result = client.post("/api/generate-promo", json=BODY).json()
    assert result["promo"]["source"] == "deepseek"
    assert "  " not in result["promo"]["text"]


SELECTIONS = [
    list(selection)
    for count in range(1, 4)
    for selection in combinations([
        {"item": "croissant", "qty": 18},
        {"item": "chocolate_slice", "qty": 8},
        {"item": "sourdough", "qty": 6},
    ], count)
]


@pytest.mark.parametrize("selection", SELECTIONS)
@pytest.mark.parametrize("valid", [True, False])
def test_ai_and_fallback_all_product_facts_and_word_limit(monkeypatch, selection, valid):
    # Exactly 15 words across both model lines, exercising the full model allowance.
    content = json.dumps({
        "opening": "Eh bossku jom makan sedap lah mari sini kawan semua 🥐",
        "closing": "Jom makan sama sama!",
    })
    mock_provider(monkeypatch, lambda request: httpx.Response(
        200, json=completion(content) if valid else {"choices": [None]}
    ))
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=selection)
    assert response.status_code == 200
    result = response.json()
    promo = result["promo"]
    assert promo["source"] == ("deepseek" if valid else "local_demo")
    assert promo["is_fallback"] is (not valid)
    assert len(promo["text"].split()) <= 50
    assert "lah" in promo["text"] and "🥐" in promo["text"]
    for item in result["items"]:
        assert (
            f'{item["qty"]} {item["name"]}: original RM{item["unit_retail_price"]}, '
            f'clearance RM{item["unit_clearance_price"]}/each'
        ) in promo["text"]


@pytest.mark.parametrize("failure, reason", [
    ("structure", "INVALID_AI_COPY"), ("blank", "INVALID_AI_COPY"),
    ("claim", "INVALID_AI_COPY"), ("http", "AI_HTTP_ERROR"),
    ("network", "AI_NETWORK_ERROR"), ("timeout", "AI_TIMEOUT"),
    ("deadline", "AI_TIMEOUT"),
])
def test_fallback_keeps_loss_money_carbon_and_warnings(monkeypatch, tmp_path, failure, reason):
    data = json.loads(main.INVENTORY_PATH.read_text(encoding="utf-8"))
    data["products"][0]["cost_price"] = "4.00"
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(main, "INVENTORY_PATH", path)
    before = path.read_bytes()
    body = [{"item": "croissant", "qty": 2}, {"item": "chocolate_slice", "qty": 3}]

    async def handler(request):
        if failure == "deadline":
            await asyncio.sleep(10)
        if failure == "timeout":
            raise httpx.ReadTimeout("secret", request=request)
        if failure == "network":
            raise httpx.ConnectError("secret", request=request)
        if failure == "http":
            return httpx.Response(500, text="secret")
        if failure == "structure":
            return httpx.Response(200, json={"choices": [None]})
        return httpx.Response(200, json=completion(json.dumps({
            "opening": "   " if failure == "blank" else "Delivery included, halal certified!",
            "closing": "Sedap lah!",
        })))

    with TestClient(main.create_app()) as client:
        baseline = client.post("/api/generate-promo", json=body).json()
        mock_provider(monkeypatch, handler)
        monkeypatch.setenv("DEEPSEEK_TOTAL_TIMEOUT_SECONDS", "0.05")
        response = client.post("/api/generate-promo", json=body)
    assert response.status_code == 200
    result = response.json()
    for field in ("currency", "discount_rate", "items", "totals", "carbon", "warnings"):
        assert result[field] == baseline[field]
    assert result["totals"]["loss_total"] == "2.00"
    assert result["totals"]["gross_profit_total"] == "1.00"
    assert result["totals"]["clearance_total"] == "18.00"
    assert result["totals"]["estimated_co2e_kg"] == "1.3"
    assert result["warnings"][0]["code"] == "BELOW_COST"
    assert result["promo"]["text"] == baseline["promo"]["text"]
    assert result["promo"]["is_fallback"] is True
    assert result["promo"]["fallback_reason"] == reason
    assert path.read_bytes() == before


def test_total_deadline_cancels_keepalive_body_and_closes_request(monkeypatch):
    state = {"calls": 0, "chunks": 0, "cancelled": False, "closed": False}

    class KeepAlive(httpx.AsyncByteStream):
        async def __aiter__(self):
            try:
                while True:
                    state["chunks"] += 1
                    yield b"\n"
                    await asyncio.sleep(0.005)
            finally:
                state["cancelled"] = True

        async def aclose(self):
            state["closed"] = True

    async def handler(request):
        state["calls"] += 1
        return httpx.Response(200, stream=KeepAlive())

    mock_provider(monkeypatch, handler)
    monkeypatch.setenv("DEEPSEEK_TOTAL_TIMEOUT_SECONDS", "0.05")
    started = time.monotonic()
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=BODY)
    elapsed = time.monotonic() - started
    assert response.status_code == 200
    assert response.json()["promo"]["fallback_reason"] == "AI_TIMEOUT"
    assert response.json()["promo"]["is_fallback"] is True
    assert 0.04 <= elapsed < 2
    assert state["calls"] == 1
    assert state["chunks"] >= 2
    assert state["cancelled"] and state["closed"]


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "oops", ""])
def test_invalid_total_timeout_config_falls_back_without_network(monkeypatch, value):
    monkeypatch.setenv("AI_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-key")
    monkeypatch.setenv("DEEPSEEK_TOTAL_TIMEOUT_SECONDS", value)
    with TestClient(main.create_app()) as client:
        response = client.post("/api/generate-promo", json=BODY)
    assert response.status_code == 200
    assert response.json()["promo"]["fallback_reason"] == "INVALID_AI_CONFIG"
    assert response.json()["promo"]["is_fallback"] is True


@pytest.mark.parametrize("configured, expected", [(None, 15.0), ("2.5", 2.5)])
def test_total_timeout_default_and_override(monkeypatch, configured, expected):
    real_timeout = asyncio.timeout
    observed = []

    def capture_timeout(delay):
        observed.append(delay)
        return real_timeout(delay)

    monkeypatch.setattr(ai_copy.asyncio, "timeout", capture_timeout)
    if configured is not None:
        monkeypatch.setenv("DEEPSEEK_TOTAL_TIMEOUT_SECONDS", configured)
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json=completion(
        json.dumps({"opening": "Jom makan! 🥐", "closing": "Sedap lah!"})
    )))
    with TestClient(main.create_app()) as client:
        result = client.post("/api/generate-promo", json=BODY).json()
    assert result["promo"]["source"] == "deepseek"
    assert observed == [expected]
