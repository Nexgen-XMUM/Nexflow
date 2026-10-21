"""Run with `python3 demo.py`; server dependencies come from the project .venv."""

import socket
import subprocess
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent


def create_demo_app():
    from fastapi.responses import FileResponse

    from backend.main import create_app, load_products

    application = create_app()

    @application.get("/", include_in_schema=False)
    def home():
        return FileResponse(ROOT / "backend" / "demo.html")

    @application.get("/demo/products", include_in_schema=False)
    def product_options():
        products = {product.id: product for product in load_products().values()}
        return [
            {"item": product.id, "name": product.name, "on_hand": product.on_hand}
            for product in products.values()
        ]

    return application


def main():
    python = ROOT / ".venv" / "bin" / "python"
    if not python.is_file():
        print("找不到项目的 .venv。请先建立项目虚拟环境并安装 requirements.txt。")
        return 1

    # Let the OS choose a free local port so other teammates' servers can keep running.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    print("\n正在启动 Nexflow 后端演示，自动使用项目 .venv…", flush=True)
    process = subprocess.Popen(
        [str(python), "-m", "uvicorn", "demo:create_demo_app", "--factory",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT,
    )
    try:
        deadline = time.monotonic() + 15
        while process.poll() is None and time.monotonic() < deadline:
            try:
                with urlopen(url, timeout=0.5) as response:
                    if response.status == 200:
                        break
            except (OSError, URLError):
                time.sleep(0.1)
        else:
            print("启动未完成。请检查上方报错；依赖可用项目 .venv 安装：")
            print(f'"{python}" -m pip install -r "{ROOT / "requirements.txt"}"')
            return 1

        print(f"\n演示已就绪：{url}", flush=True)
        print("页面里点“生成促销”，也可以点示例按钮。无需填写接口地址。", flush=True)
        print("如果浏览器没有自动打开，点击上面的地址即可。", flush=True)
        print("展示时保持这个窗口运行；结束后按 Ctrl+C。\n", flush=True)
        try:
            webbrowser.open(url)
        except webbrowser.Error:
            print("浏览器未自动打开，请使用上面的地址。", flush=True)
        return process.wait()
    except KeyboardInterrupt:
        print("\n正在关闭演示…", flush=True)
        return 0
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
