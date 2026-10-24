"""展示外壳的三语言接入：欢迎页与登录/注册页使用 frontend/i18n.js。

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


def test_login_page_keeps_the_three_language_dictionary(tmp_path):
    """登录页接入不变；欢迎页默认英文，并提供独立的三语言选择。"""
    welcome, login, _ = fetch_pages(tmp_path)
    assert '<script src="/app/assets/i18n.js">' in login
    assert 'id="langSelect"' in login
    assert 'value="en"' in login and 'value="ms"' in login and 'value="zh-CN"' in login
    assert 'data-i18n-aria="app.langLabel"' in login
    assert "localStorage.setItem('nexflow_lang'" not in login
    # 初始 HTML 为英文；欢迎页使用当前文案的三语字典，不复用旧促销文案。
    assert '<html lang="en">' in welcome
    assert '<script src="/app/assets/i18n.js">' in welcome
    assert 'id="welcomeLanguage"' in welcome
    for language in ("en", "zh-CN", "ms"):
        assert f'value="{language}"' in welcome
    assert 'id="langSelect"' not in welcome


def test_login_page_uses_translation_keys_instead_of_hardcoded_copy(tmp_path):
    _, login, _ = fetch_pages(tmp_path)
    assert login.count('data-i18n="auth.') >= 15
    assert '<title data-i18n="auth.pageTitle">' in login
    # 动态文案也走字典：登录页的 Toast、校验提示与成功弹窗
    for key in ("auth.toast.filled", "auth.err.emailInvalid", "auth.modal.title", "auth.login.submitting"):
        assert key in login


def test_dictionary_carries_every_key_used_by_the_login_page(tmp_path):
    _, login, dictionary = fetch_pages(tmp_path)
    used = set()
    used.update(re.findall(r'data-i18n(?:-ph|-aria|-title)?="([a-z][A-Za-z.]+)"', login))
    used.update(re.findall(r"'((?:auth|welcome)\.[A-Za-z.]+)'", login))
    used.discard("auth.role.")  # 运行时拼接，实际键是 auth.role.owner/staff/user
    assert used, "没有解析到任何展示页词条"
    missing = sorted(key for key in used if "'" + key + "': [" not in dictionary)
    assert missing == [], "缺少字典词条：" + ", ".join(missing)
