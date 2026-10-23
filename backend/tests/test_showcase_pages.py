"""展示外壳：欢迎页 → 登录/注册展示页 → 现有工作台 /app。

这些页面只挂在比赛演示入口（backend.desktop_demo）上，普通服务的路由保持不变。
"""
from datetime import date

from fastapi.testclient import TestClient

from backend.desktop_demo import create_demo_app
from backend.main import create_app

DAY = date(2026, 10, 23)


def demo_client(tmp_path):
    return TestClient(create_demo_app(tmp_path / "demo.sqlite3", DAY))


def test_welcome_page_is_served_at_root_with_live_links(tmp_path):
    with demo_client(tmp_path) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        page = response.text
        assert 'id="launchDemoBtn"' in page
        assert page.count('href="/login"') == 3  # 顶部按钮、Hero 主按钮、底部 CTA
        # 旧文件链接与失效锚点都已修掉，不允许再指向不存在的页面
        assert "orbyte_smart_yield_with_onboarding.html" not in page
        assert 'href="#benefits"' not in page
        assert 'id="preview"' in page  # 导航「指挥台预览」有真实落点


def test_login_page_points_at_the_workspace(tmp_path):
    with demo_client(tmp_path) as client:
        response = client.get("/login")
        assert response.status_code == 200
        page = response.text
    assert 'id="loginForm"' in page and 'id="signupForm"' in page
    assert 'href="/app#boss"' in page  # 成功弹窗的主按钮
    assert 'href="welcome_page.html"' not in page  # 相对旧链接
    assert 'href="index.html"' not in page
    assert "DEMO_DESTINATION = '/app#boss'" in page  # 自动跳转目标


def test_login_and_signup_never_block_the_demo_flow(tmp_path):
    """登录/注册处理函数里不允许出现验证拦截，任意输入都必须能进入系统。"""
    with demo_client(tmp_path) as client:
        page = client.get("/login").text
    for form in ("loginForm", "signupForm"):
        start = page.index(f"$('#{form}').addEventListener('submit'")
        handler = page[start:page.index("});", page.index("demoEnter(", start)) + 3]
        assert "return;" not in handler, f"{form} 提交被验证拦截，会卡死演示流程"
        assert "demoEnter(" in handler, f"{form} 提交没有走演示进入流程"
    assert "location.assign(DEMO_DESTINATION)" in page  # 过渡后自动进入老板界面


def test_workspace_and_demo_api_are_still_served(tmp_path):
    with demo_client(tmp_path) as client:
        assert client.get("/app").status_code == 200
        assert client.get("/app/assets/i18n.js").status_code == 200
        session = client.get("/api/demo/session").json()
        assert session["demo_only"] is True
        assert session["now"] == "2026-10-23T21:35:00+08:00"
        assert client.get("/api/products").status_code == 200


def test_normal_service_routes_are_unchanged():
    """普通服务（uvicorn backend.main:app）不暴露展示外壳与演示接口。"""
    with TestClient(create_app()) as client:
        assert client.get("/").status_code == 404
        assert client.get("/login").status_code == 404
        assert client.get("/api/demo/session").status_code == 404
        assert client.get("/app").status_code == 200
