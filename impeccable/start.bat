@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 优先用本机已有的 YOLO 环境；没有就在本文件夹建 .venv 并安装依赖（第一次需要联网）
set PY=C:\yolo-project\.venv\Scripts\python.exe
if not exist "%PY%" (
  if not exist ".venv\Scripts\python.exe" (
    echo 第一次运行：正在创建 .venv 并安装依赖...
    python -m venv .venv || (echo 找不到 python，请先安装 Python 3.10+ & pause & exit /b 1)
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (pause & exit /b 1)
  )
  set PY=.venv\Scripts\python.exe
)
echo 正在载入 YOLO 模型，浏览器几秒后自动打开 http://127.0.0.1:8100
start "" cmd /c "timeout /t 6 >nul & start http://127.0.0.1:8100"
"%PY%" app.py
pause
