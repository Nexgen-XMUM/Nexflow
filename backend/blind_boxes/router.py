import os
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.routing import APIRoute

from . import charity
from .pickup import LOCAL, RuleError, clock
from .repository import Repository
from .schemas import Batch, SuggestRequest, OrderRequest, ActionRequest, DonationAction, RedeemRequest


class DomainRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except RuleError as exc:
                raise HTTPException(exc.status, detail={"code": exc.code, "message": exc.message, "details": []}) from None
        return handler


async def sweep_loop(app):
    while True:
        await asyncio.sleep(60)
        try:
            repo = app.dependency_overrides.get(repository, repository)()
            now = app.dependency_overrides.get(clock, clock)()
            if repo.path.exists():
                await asyncio.to_thread(repo.sweep, now)
        except Exception:
            # Keep the next sweep alive; do not log food/customer payloads or secrets.
            logging.getLogger(__name__).error("Blind-box sweep failed; next minute will retry")


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(sweep_loop(app))
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


router = APIRouter(prefix="/api/blind-boxes", tags=["Blind boxes LOCAL DEMO"], route_class=DomainRoute, lifespan=lifespan)


def repository():
    default = Path(__file__).resolve().parents[2] / "data" / "local" / "blind-boxes.sqlite3"
    return Repository(os.getenv("BLIND_BOX_DB_PATH", str(default)))


Repo = Annotated[Repository, Depends(repository)]
Now = Annotated[datetime, Depends(clock)]


@router.post("/demo-seed")
def seed(repo: Repo, now: Now):
    """Explicit synthetic stock for today's demo. Never resets existing stock."""
    day = now.astimezone(LOCAL).date()
    end = datetime.combine(day, time(23, 30), LOCAL)
    rows = []
    for pid, name, category, staple, cost, retail, grams, stock, allergens in (
        ("bread", "DEMO Bread", "bread", True, 200, 600, 80, 18, ["wheat", "milk"]),
        ("cake", "DEMO Cake", "dessert", False, 300, 800, 120, 8, ["wheat", "milk", "egg"]),
        ("tea", "DEMO Tea", "drink", False, 100, 400, 250, 10, []),
    ):
        rows.append(Batch(batch_id=f"demo-{day}-{pid}", product_id=pid, name=name, category=category,
            main_staple=staple, cost_sen=cost, retail_sen=retail, weight_g=grams, co2e_per_kg=2.5,
            on_hand=stock, safe=True, storage_verified=True, allergens=allergens, diets=["vegetarian"], safe_until=end))
    return repo.add_batches(rows)


@router.post("/batches")
def import_batches(batches: Annotated[list[Batch], Body(min_length=1, max_length=100)], repo: Repo):
    """Local operator import; supplied safety facts are not externally verified."""
    return repo.add_batches(batches)


@router.get("/inventory")
def inventory(repo: Repo):
    return repo.inventory()


@router.post("/batches/{batch_id}/block")
def block(batch_id: str, repo: Repo):
    return repo.block_batch(batch_id)


@router.post("/suggest")
def suggest(request: SuggestRequest, repo: Repo, now: Now):
    return repo.suggest(request, now)


@router.post("/orders")
def order(request: OrderRequest, repo: Repo, now: Now):
    return repo.order(request, now)


@router.get("/orders/{order_id}")
def get_order(order_id: str, repo: Repo):
    return repo.get_order(order_id)


@router.post("/pickup")
def pickup(request: ActionRequest, repo: Repo, now: Now):
    return repo.pickup(request.order_id, now)


@router.post("/sweep")
def sweep(repo: Repo, now: Now):
    """Manual repeatable sweep, also run every minute while the app is running."""
    return charity.sweep(repo, now)


@router.get("/donations")
def donations(repo: Repo):
    return {"demo_only": True, "donations": repo.donations()}


@router.post("/donations/handoff")
def handoff(request: DonationAction, repo: Repo, now: Now):
    return charity.handoff(repo, request.donation_id, request.recipient, now)


@router.post("/points/redeem")
def redeem(request: RedeemRequest, repo: Repo, now: Now):
    return repo.redeem(request, now)


@router.get("/dashboard")
def dashboard(repo: Repo):
    return repo.dashboard()
