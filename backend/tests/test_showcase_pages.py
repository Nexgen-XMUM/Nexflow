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


def test_welcome_page_is_served_at_root_as_the_bread_count_demo(tmp_path):
    with demo_client(tmp_path) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        page = response.text
    # Bread Count 欢迎页：样图托盘、识别预览、计数表、确认按钮、小怪兽
    for element in ('id="tray"', 'id="frame"', 'id="rows"', 'id="confirmBtn"', 'id="log"', 'id="monster"'):
        assert element in page
    assert "YOLOv8 Detection Preview · Simulated Results" in page
    assert 'href="/app#boss"' in page  # Enter NexFlow
    assert page.count('href="/login"') == 1  # 页脚保留登录页入口
    assert 'src="/showcase/images/' in page  # 样图走白名单静态路由
    assert "orbyte_smart_yield_with_onboarding.html" not in page


def test_welcome_preview_never_calls_an_inference_backend(tmp_path):
    """识别是纯前端预设动画：不连 8100、不调 /api/detect，也不写主系统数据。"""
    with demo_client(tmp_path) as client:
        page = client.get("/").text
    for forbidden in ("/api/detect", "/api/confirm", "/api/images", "/api/meta", "onxxruntime", "8100", "127.0.0.1"):
        assert forbidden not in page, f"欢迎页不应引用 {forbidden}"
    assert "live detection is not enabled" in page  # 上传照片只做预览
    assert "Simulated" in page and "never written to NexFlow stock" in page


def test_showcase_images_route_serves_only_the_five_samples(tmp_path):
    names = ["1_croissant_9.jpg", "2_sourdough_4.jpg", "3_croissant2_whitebread3.jpg",
             "4_croissant1_sourdough1.jpg", "5_croissant_6.jpg"]
    with demo_client(tmp_path) as client:
        for name in names:
            response = client.get(f"/showcase/images/{name}")
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/jpeg"
        # 目录内其它文件、模型、源码、路径穿越都不提供
        for name in ("best.pt", "model.b64.txt", "app.py", "index.html", "..%2Fweights%2Fbest.pt", "nothing.jpg"):
            assert client.get(f"/showcase/images/{name}").status_code == 404
        assert client.get("/showcase/images/").status_code == 404
        assert client.get("/impeccable/app.py").status_code == 404
        # 主工作台与 Demo 接口保持可用
        assert client.get("/app").status_code == 200
        assert client.get("/api/demo/session").status_code == 200


def test_welcome_page_assets_exist_on_disk(tmp_path):
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    for rel in ("impeccable/app.py", "impeccable/requirements.txt", "impeccable/start.bat",
                "impeccable/static/index.html", "impeccable/weights/best.pt",
                "impeccable/web_online/index.html"):
        assert (root / rel).is_file(), f"缺少独立原型文件 {rel}"
    for name in ("1_croissant_9.jpg", "2_sourdough_4.jpg", "3_croissant2_whitebread3.jpg",
                 "4_croissant1_sourdough1.jpg", "5_croissant_6.jpg"):
        assert (root / "impeccable" / "demo_images" / name).is_file()


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
