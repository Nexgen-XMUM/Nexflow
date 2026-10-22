"""Run a deterministic simulation in a temporary database, at any real time."""
import json
import random
from datetime import datetime, timedelta
from tempfile import TemporaryDirectory
from pathlib import Path

from .pickup import LOCAL
from .repository import Repository
from .router import seed
from .schemas import OrderRequest


def main():
    now = datetime(2026, 10, 22, 21, 30, tzinfo=LOCAL)
    with TemporaryDirectory(prefix="nexflow-blind-box-") as folder:
        repo = Repository(Path(folder)/"demo.sqlite3")
        seed(repo, now)
        first = repo.order(OrderRequest(user_id="demo_alice", idempotency_key="demo-order-1",
            pickup_start=now, pickup_end=now+timedelta(minutes=30)), now, random.Random(4))
        picked = repo.pickup(first["order_id"], now+timedelta(minutes=10))
        second = repo.order(OrderRequest(user_id="demo_bob", idempotency_key="demo-order-2",
            pickup_start=now, pickup_end=now+timedelta(minutes=30)), now, random.Random(5))
        repo.sweep(now+timedelta(minutes=30))
        for donation in repo.donations():
            repo.donate(donation["id"], "DEMO charity handoff", now+timedelta(minutes=35))
        print(json.dumps({"simulation_time": now.isoformat(), "temporary_database": True,
            "picked_up_order": picked, "no_show_order": repo.get_order(second["order_id"]),
            "dashboard": repo.dashboard()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
