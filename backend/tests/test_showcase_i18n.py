"""展示外壳的三语言接入：欢迎页与登录/注册页共用 frontend/i18n.js 与 nexflow_lang。

只校验接入契约（字典、切换器、键覆盖），业务流程校验见 test_showcase_pages.py。
"""
import re
from datetime import date

from fastapi.testclient import TestClient

from backend.desktop_demo import create_demo_app

DAY = date(2026, 10, 23)


def fetch_pages(tmp_path):
    with TestClient(create_demo_app(tmp_path / "demo.sqlite3", DAY)) as client:
        welcome = client.get("/")
        login = client.get("/login")
        dictionary = client.get("/app/assets/i18n.js")
    assert welcome.status_code == 200 and login.status_code == 200
    assert dictionary.status_code == 200
    return welcome.text, login.text, dictionary.text


def test_showcase_pages_share_the_workspace_dictionary(tmp_path):
    for page in fetch_pages(tmp_path)[:2]:
        # 复用同一个字典文件与同一套语言状态，不另起一套 i18n 实现
        assert '<script src="/app/assets/i18n.js">' in page
        # 语言切换器：原生 select（键盘可用）、三种语言、可访问名称
        assert 'id="langSelect"' in page
        assert 'value="en"' in page and 'value="ms"' in page and 'value="zh-CN"' in page
        assert 'data-i18n-aria="app.langLabel"' in page
        # 页面自己不写语言状态，交给 i18n.js 的 localStorage 键
        assert "localStorage.setItem('nexflow_lang'" not in page


def test_showcase_pages_use_translation_keys_instead_of_hardcoded_copy(tmp_path):
    welcome, login, _ = fetch_pages(tmp_path)
    assert welcome.count('data-i18n="home.') >= 30
    assert login.count('data-i18n="auth.') >= 15
    assert '<title data-i18n="home.pageTitle">' in welcome
    assert '<title data-i18n="auth.pageTitle">' in login
    # 动态文案也走字典：登录页的 Toast、校验提示与成功弹窗
    for key in ("auth.toast.filled", "auth.err.emailInvalid", "auth.modal.title", "auth.login.submitting"):
        assert key in login


def test_dictionary_carries_every_key_used_by_the_showcase_pages(tmp_path):
    welcome, login, dictionary = fetch_pages(tmp_path)
    used = set()
    for page in (welcome, login):
        used.update(re.findall(r'data-i18n(?:-ph|-aria|-title)?="([a-z][A-Za-z.]+)"', page))
        used.update(re.findall(r"'((?:auth|home|welcome)\.[A-Za-z.]+)'", page))
    used.discard("auth.role.")  # 运行时拼接，实际键是 auth.role.owner/staff/user
    assert used, "没有解析到任何展示页词条"
    missing = sorted(key for key in used if "'" + key + "': [" not in dictionary)
    assert missing == [], "缺少字典词条：" + ", ".join(missing)
