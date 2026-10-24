"""Local competition runner: temporary database and explicit application clock only."""
import argparse
import os
from datetime import datetime, time
from threading import Lock
from typing import Annotated

from fastapi import Body, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.blind_boxes.pickup import LOCAL, clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.main import PromoItem, create_app, load_products
from backend.blind_boxes.schemas import Batch

# 展示外壳页面与主工作台放在同一目录，由 FastAPI 直接返回，无需额外静态服务器。
SHOWCASE = Path(__file__).resolve().parents[1] / "frontend"
SOURCE_ZIP_DOWNLOAD = (
    Path(__file__).resolve().parents[1]
    / "downloads"
    / "Orbyte-Smart-Yield-Nexgen-source.zip"
)

# 欢迎页只用 impeccable/ 原型里的这五张样图；白名单同时挡住了其它任何文件。
SHOWCASE_IMAGE_DIR = Path(__file__).resolve().parents[1] / "impeccable" / "demo_images"
SHOWCASE_IMAGES = frozenset({
    "1_croissant_9.jpg",
    "2_sourdough_4.jpg",
    "3_croissant2_whitebread3.jpg",
    "4_croissant1_sourdough1.jpg",
    "5_croissant_6.jpg",
})


def create_demo_app(database: Path, day=None):
    # Force local copy before create_app loads optional .env settings.
    os.environ["AI_PROVIDER"] = "local_demo"
    os.environ["DEEPSEEK_API_KEY"] = ""
    demo_day = day or datetime.now(LOCAL).date()
    session = {"now": datetime.combine(demo_day, time(21, 35), LOCAL)}
    repo = Repository(database)
    # 比赛演示初始积分：固定演示账户在新建临时库时获得 100 分，方便展示积分兑换。
    # 每次启动都会新建临时数据库，因此重启后恢复 100 分；刷新页面、重复读取账户
    # 或兑换都不会再次赠送。普通服务不调用此方法。
    repo.seed_demo_points("demo_mei_ling", 100)
    registration = {"fingerprint": None, "result": None}
    registration_lock = Lock()
    application = create_app()
    application.dependency_overrides[repository] = lambda: repo
    application.dependency_overrides[clock] = lambda: session["now"]

    def status():
        return {"demo_only": True, "temporary_database": True, "now": session["now"].isoformat(),
                "leftovers_registered": registration["result"] is not None}

    # 展示外壳：欢迎页 → 登录/注册展示页 → 正式工作台 /app。
    # 只挂在比赛演示入口上，普通服务（uvicorn backend.main:app）的路由保持不变。
    @application.get("/", include_in_schema=False)
    def welcome_page():
        return FileResponse(SHOWCASE / "welcome_page.html")

    @application.get("/login", include_in_schema=False)
    def login_signup_page():
        return FileResponse(SHOWCASE / "login_signup_page.html")

    @application.get("/download/source.zip", include_in_schema=False)
    def download_source_zip():
        if not SOURCE_ZIP_DOWNLOAD.is_file():
            raise HTTPException(status_code=404, detail="Source ZIP not available")
        return FileResponse(
            SOURCE_ZIP_DOWNLOAD,
            media_type="application/zip",
            filename="Orbyte-Smart-Yield-Nexgen-source.zip",
        )

    @application.get("/showcase/images/{filename}", include_in_schema=False)
    def showcase_image(filename: str):
        """只提供欢迎页使用的五张内置样图。

        impeccable/ 是队友的独立 YOLO 原型，这里仅按文件名白名单取图，不暴露目录、
        不提供模型/源码/JSON，也不提供任何推理接口。
        """
        if filename not in SHOWCASE_IMAGES:
            raise HTTPException(status_code=404, detail="Image not found")
        path = SHOWCASE_IMAGE_DIR / filename
        return FileResponse(path, media_type="image/jpeg")

    @application.get("/api/demo/session", tags=["Competition demo only"])
    def demo_session():
        return status()

    @application.post("/api/demo/leftovers", tags=["Competition demo only"])
    def register_leftovers(items: Annotated[list[PromoItem], Body(min_length=1, max_length=100)]):
        # These classification/safety facts are explicit synthetic demo profiles,
        # never inferred food-safety facts and never available in the normal app.
        profiles = {
            "croissant": ("bread", True, ["wheat", "milk"]),
            "chocolate_slice": ("dessert", False, ["wheat", "milk", "egg"]),
            "sourdough": ("bread", True, ["wheat"]),
        }
        products = load_products()
        seen, batches = set(), []
        for item in items:
            product = products.get(item.item.casefold())
            if product is None or product.id not in profiles:
                raise HTTPException(422, detail="This item has no synthetic demo batch profile")
            if product.id in seen or item.qty > product.on_hand:
                raise HTTPException(422, detail="Duplicate item or quantity above catalogue stock")
            seen.add(product.id)
            category, staple, allergens = profiles[product.id]
            grams = product.weight_kg * 1000
            if grams != grams.to_integral_value():
                raise HTTPException(422, detail="Demo profile requires a whole-gram item weight")
            batches.append(Batch(
                batch_id=f"demo-leftovers-{demo_day}-{product.id}", product_id=f"demo-leftovers-{product.id}",
                name=product.name, category=category, main_staple=staple,
                cost_sen=int(product.cost_price * 100), retail_sen=int(product.retail_price * 100),
                weight_g=int(grams), co2e_per_kg=float(product.co2e_per_kg), on_hand=item.qty,
                safe=True, storage_verified=True, allergens=allergens, diets=["vegetarian"],
                safe_until=datetime.combine(demo_day, time(23, 30), LOCAL)))
        fingerprint = tuple(sorted((b.product_id, b.on_hand) for b in batches))
        with registration_lock:
            if registration["fingerprint"] == fingerprint:
                return registration["result"]
            if registration["result"] is not None or repo.inventory()["batches"]:
                raise HTTPException(409, detail="Demo inventory already registered; restart for a fresh session")
            if session["now"].time() >= time(22, 30):
                raise HTTPException(409, detail="Register demo leftovers before closing")
            imported = repo.add_batches(batches)
            result = {**imported, "registered_qty": sum(b.on_hand for b in batches),
                      "batch_ids": [b.batch_id for b in batches], "source": "eod_leftovers",
                      "safety_note": "Synthetic demo profiles only, not actual food safety verification"}
            registration.update(fingerprint=fingerprint, result=result)
            return result

    @application.post("/api/demo/close", tags=["Competition demo only"])
    def close():
        with registration_lock:
            session["now"] = datetime.combine(demo_day, time(22, 31), LOCAL)
            repo.sweep(session["now"])
            return status()

    return application


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    import uvicorn
    with TemporaryDirectory(prefix="nexflow-desktop-") as folder:
        application = create_demo_app(Path(folder) / "demo.sqlite3")
        print(f"Competition demo: http://127.0.0.1:{args.port}/app", flush=True)
        print("Local copy; temporary database; application clock starts at 21:35 UTC+08:00.", flush=True)
        uvicorn.run(application, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
