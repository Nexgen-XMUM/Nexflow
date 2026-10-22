from fastapi.testclient import TestClient

from backend.main import create_app


def test_rescue_page_served_and_linked():
    client = TestClient(create_app())
    page = client.get("/app/rescue")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"]
    for text in ("/api/blind-boxes", "不是经认证的减排量或碳信用", "模拟交易"):
        assert text in page.text
    assert 'href="/app/rescue"' in client.get("/app").text
