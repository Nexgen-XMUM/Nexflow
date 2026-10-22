import httpx
import pytest


@pytest.fixture(autouse=True)
def isolate_ai_settings(monkeypatch):
    """Tests must never spend a developer's real API credits."""
    monkeypatch.setenv("AI_PROVIDER", "local_demo")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.delenv("DEEPSEEK_TOTAL_TIMEOUT_SECONDS", raising=False)

    def no_real_http(*args, **kwargs):
        pytest.fail("Tests must use mocked upstream HTTP, never a real provider")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", no_real_http)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", no_real_http)
