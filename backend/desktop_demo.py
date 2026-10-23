"""Local competition runner: temporary database and explicit application clock only."""
import argparse
import os
from datetime import datetime, time
from threading import Lock
from typing import Annotated

from fastapi import Body, HTTPException
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.blind_boxes.pickup import LOCAL, clock
from backend.blind_boxes.repository import Repository
from backend.blind_boxes.router import repository
from backend.main import PromoItem, create_app, load_products
from backend.blind_boxes.schemas import Batch


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
