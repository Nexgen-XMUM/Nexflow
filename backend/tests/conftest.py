import pytest


@pytest.fixture(autouse=True)
def isolate_ai_settings(monkeypatch):
    """Tests must never spend a developer's real API credits."""
    monkeypatch.setenv("AI_PROVIDER", "local_demo")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
