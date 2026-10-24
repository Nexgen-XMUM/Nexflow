"""NexFlow 面包盘点：本地后端（FastAPI + YOLO）同时提供前端页面。

启动：双击 start.bat（或 python app.py）→ http://127.0.0.1:8100
换模型：覆盖 weights/best.pt，或设置环境变量 BREAD_MODEL=其他 best.pt 路径（品种名自动从模型读取）
"""
import json
import os
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from ultralytics import YOLO

ROOT = Path(__file__).parent
MODEL_PATH = os.environ.get("BREAD_MODEL", str(ROOT / "weights" / "best.pt"))
CONF = float(os.environ.get("BREAD_CONF", "0.35"))   # 低于此值的框直接丢弃
IMGSZ = int(os.environ.get("BREAD_IMGSZ", "640"))
LOW_CONF = 0.5                                        # 低于此值的框提示店员复核
IMAGE_DIR = ROOT / "demo_images"
CONFIRM_DIR = ROOT / "confirmed"
CONFIRM_DIR.mkdir(exist_ok=True)
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

model = YOLO(MODEL_PATH)
model.predict(np.zeros((IMGSZ, IMGSZ, 3), np.uint8), imgsz=IMGSZ, verbose=False)  # 预热

app = FastAPI(title="NexFlow Bread Count")
# NexFlow /app（8000 端口）的“拍照盘点”也会跨域调用这里的接口
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:8000", "http://localhost:8000"],
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.mount("/images", StaticFiles(directory=IMAGE_DIR), name="images")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/meta")
def meta():
    return {"model": Path(MODEL_PATH).name, "classes": list(model.names.values()),
            "conf": CONF, "low_conf": LOW_CONF, "imgsz": IMGSZ}


@app.get("/api/images")
def images():
    return sorted(p.name for p in IMAGE_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTS)


@app.post("/api/detect")
async def detect(request: Request, name: str | None = None):
    """name=demo_images 里的文件名；或者不带 name，请求体直接放上传的图片字节。"""
    if name:
        path = (IMAGE_DIR / name).resolve()
        if path.parent != IMAGE_DIR.resolve() or not path.is_file():
            raise HTTPException(404, f"Image not found: {name}")
        img = cv2.imread(str(path))
    else:
        img = cv2.imdecode(np.frombuffer(await request.body(), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not read the image. Upload a JPG or PNG.")

    t0 = time.perf_counter()
    r = model.predict(img, imgsz=IMGSZ, conf=CONF, verbose=False)[0]
    elapsed_ms = round((time.perf_counter() - t0) * 1000)

    detections, by_class = [], defaultdict(list)
    for box, cls, conf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
        label = model.names[int(cls)]
        detections.append({"label": label, "conf": round(conf, 3), "box": [round(v, 1) for v in box],
                           "low_conf": conf < LOW_CONF})
        by_class[label].append(conf)

    counts = sorted(({"label": k, "count": len(v), "avg_conf": round(sum(v) / len(v), 3),
                      "low_conf_count": sum(c < LOW_CONF for c in v)} for k, v in by_class.items()),
                    key=lambda c: -c["count"])
    h, w = img.shape[:2]
    return {"source": name or "upload", "width": w, "height": h, "elapsed_ms": elapsed_ms,
            "model": Path(MODEL_PATH).name, "detections": detections, "counts": counts,
            "total": len(detections)}


@app.post("/api/confirm")
async def confirm(request: Request):
    """body: {source, ai_counts: {品种: 数量}, confirmed_counts: {品种: 数量}}"""
    body = await request.json()
    ai, confirmed = body.get("ai_counts"), body.get("confirmed_counts")
    if not isinstance(ai, dict) or not isinstance(confirmed, dict):
        raise HTTPException(400, "ai_counts and confirmed_counts must be objects")
    for k, v in confirmed.items():
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise HTTPException(400, f"Quantity for {k} must be a whole number of 0 or more")

    now = datetime.now()
    record_id = now.strftime("%Y%m%d-%H%M%S-%f")[:-3]
    confirmed = {k: v for k, v in confirmed.items() if v > 0}
    record = {
        "id": record_id,
        "confirmed_at": now.isoformat(timespec="seconds"),
        "source": body.get("source"),
        "model": Path(MODEL_PATH).name,
        "ai_counts": ai,
        "confirmed_counts": confirmed,
        "ai_total": sum(ai.values()),
        "confirmed_total": sum(confirmed.values()),
        "corrections": {k: confirmed.get(k, 0) - ai.get(k, 0)
                        for k in set(ai) | set(confirmed) if confirmed.get(k, 0) != ai.get(k, 0)},
        "note": "Demo: saved locally only, not synced to NexFlow stock",
    }
    (CONFIRM_DIR / f"{record_id}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), "utf-8")
    return record


@app.get("/api/confirmations")
def confirmations(limit: int = 10):
    files = sorted(CONFIRM_DIR.glob("*.json"), reverse=True)[:limit]
    return [json.loads(f.read_text("utf-8")) for f in files]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8100")))
