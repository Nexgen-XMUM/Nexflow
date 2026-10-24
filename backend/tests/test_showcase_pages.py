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
        # 小怪兽欢迎页：顶部 Log in 与底部 Launch the demo 都打开内嵌登录弹窗
        assert 'id="loginLink"' in page and 'id="ctaLogin"' in page
        assert 'id="monster"' in page and 'id="loginForm"' in page
        # 唯一指向 /login 的入口是「创建账号」
        assert page.count('href="/login"') == 1
        # 顶部导航的四个锚点都必须有真实落点
        for anchor in ("purpose", "features", "numbers", "voices"):
            assert f'href="#{anchor}"' in page
            assert f'id="{anchor}"' in page
        # 旧文件链接与失效锚点都已修掉，不允许再指向不存在的页面
        assert "orbyte_smart_yield_with_onboarding.html" not in page
        assert 'href="#benefits"' not in page


def test_welcome_demo_entry_always_opens_the_owner_workspace(tmp_path):
    """任意邮箱、任意密码、任意角色都直接进入 /app#boss，不做校验也不分角色跳转。"""
    with demo_client(tmp_path) as client:
        page = client.get("/").text
    start = page.index("$('#loginForm').addEventListener('submit'")
    handler = page[start:page.index("});", start) + 3]
    assert "location.assign('/app#boss')" in handler
    assert "'/app#' + role" not in page  # 不再按角色分别跳转
    assert "return;" not in handler.split("location.assign")[0]  # 提交前没有验证拦截
    assert "orbyte_demo_user" in handler  # 只记录演示身份用于回显
    # 密码不会写入任何存储
    assert "password" not in handler.lower().replace("$('#password')", "")


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
