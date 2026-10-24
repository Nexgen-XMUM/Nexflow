"""SQLite unit of work. BEGIN IMMEDIATE serializes stock and policy decisions."""
import hashlib
import json
import random
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, time
from pathlib import Path
from uuid import uuid4

from .algorithm import candidates, select, eligible
from .calculator import calculate
from .pickup import LOCAL, RuleError, validate_slot, assert_pickup
from .schemas import Batch, Preferences, OrderRequest


class Repository:
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def transaction(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("BEGIN IMMEDIATE")
            for statement in (
                "CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, payload TEXT NOT NULL, on_hand INTEGER NOT NULL CHECK(on_hand>=0), reserved INTEGER NOT NULL CHECK(reserved>=0 AND reserved<=on_hand))",
                "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, no_show_at TEXT, payload TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0), frozen_until TEXT, penalty_at TEXT)",
                "CREATE TABLE IF NOT EXISTS donations (id TEXT PRIMARY KEY, source_order TEXT UNIQUE, status TEXT NOT NULL, created TEXT NOT NULL, recipient TEXT, payload TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS redemptions (request_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, expires TEXT NOT NULL, payload TEXT NOT NULL, order_id TEXT UNIQUE)",
            ):
                db.execute(statement)
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def batches(db):
        return [Batch.model_validate({**json.loads(r["payload"]), "on_hand": r["on_hand"], "reserved": r["reserved"]}) for r in db.execute("SELECT * FROM batches ORDER BY id")]

    def add_batches(self, batches):
        if len({b.batch_id for b in batches}) != len(batches) or any(b.reserved for b in batches):
            raise RuleError("INVALID_BATCHES", "Batch IDs must be unique and new stock cannot be reserved", 422)
        with self.transaction() as db:
            for b in batches:
                if db.execute("SELECT 1 FROM batches WHERE id=?", (b.batch_id,)).fetchone():
                    raise RuleError("BATCH_EXISTS", "Existing stock is never reset by import")
                # A product keeps the same classification and unit economics across batches.
                for existing in self.batches(db):
                    if existing.product_id == b.product_id:
                        fields = ("name", "category", "main_staple", "cost_sen", "retail_sen", "weight_g", "co2e_per_kg")
                        if any(getattr(existing, f) != getattr(b, f) for f in fields):
                            raise RuleError("PRODUCT_CONFLICT", "Product metadata differs between batches", 422)
                db.execute("INSERT INTO batches VALUES (?,?,?,0)", (b.batch_id, b.model_dump_json(), b.on_hand))
        return {"imported": len(batches), "demo_only": True}

    def inventory(self):
        with self.transaction() as db:
            return {"demo_only": True, "batches": [b.model_dump(mode="json") | {"available": b.on_hand-b.reserved} for b in self.batches(db)]}

    def block_batch(self, batch_id):
        """Operator can withdraw unsafe stock without freeing existing reservations."""
        with self.transaction() as db:
            row = db.execute("SELECT payload FROM batches WHERE id=?", (batch_id,)).fetchone()
            if not row:
                raise RuleError("BATCH_NOT_FOUND", "Batch not found", 404)
            payload = json.loads(row["payload"])
            payload["safe"] = False
            db.execute("UPDATE batches SET payload=? WHERE id=?", (json.dumps(payload), batch_id))
            return {"batch_id": batch_id, "safe": False, "demo_only": True}

    def suggest(self, request, now):
        validate_slot(request.pickup_start, request.pickup_end, now)
        with self.transaction() as db:
            result = candidates(self.batches(db), request.preferences, request.pickup_end, now)
        return {**result, "demo_only": True, "stock_reserved": False}

    def calculate(self, request, now, store, charities):
        """Read-only like suggest, but no slot check so leftovers can be planned after closing."""
        with self.transaction() as db:
            return calculate(self.batches(db), request.preferences, request.pickup_end, now,
                             store=store, charities=charities, top=request.top)

    @staticmethod
    def fingerprint(request):
        return hashlib.sha256(request.model_dump_json().encode()).hexdigest()

    @staticmethod
    def order_response(row):
        return {"order_id": row["id"], "user_id": row["user_id"], "status": row["status"],
                "pickup_start": row["start"], "pickup_end": row["end"], "demo_only": True,
                "payment": "simulated_paid", **json.loads(row["payload"])}

    @staticmethod
    def customer_order(order):
        """Return only fields intended for this local demo customer surface."""
        return {key: order[key] for key in (
            "order_id", "user_id", "status", "pickup_start", "pickup_end", "demo_only",
            "payment", "price_sen", "allergens", "pending_points", "points_awarded"
        )}

    @staticmethod
    def customer_quote(row):
        quote = json.loads(row["payload"])
        request, chosen = quote["request"], quote["chosen"]
        return {"quote_id": row["id"], "demo_only": True, "status": "QUOTED",
                "price_sen": chosen["price_sen"], "qty_range": {"min": 2, "max": 4},
                "allergens": chosen["allergens"], "pickup_start": request["pickup_start"],
                "pickup_end": request["pickup_end"], "expires_at": row["expires"],
                "stock_reserved": False}

    @staticmethod
    def check_buyer(db, user_id, now):
        db.execute("INSERT OR IGNORE INTO users(id) VALUES (?)", (user_id,))
        user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if user["frozen_until"] and datetime.fromisoformat(user["frozen_until"]) > now:
            raise RuleError("USER_FROZEN", "Demo user is temporarily frozen")
        day = now.astimezone(LOCAL).date().isoformat()
        count = db.execute("SELECT count(*) FROM orders WHERE user_id=? AND day=?", (user_id, day)).fetchone()[0]
        if count >= 2:
            raise RuleError("DAILY_LIMIT", "Maximum two boxes per demo user per day")
        return day

    @staticmethod
    def batch_snapshot(batch):
        return batch.model_dump(mode="json", exclude={"on_hand", "reserved"})

    def quote(self, request, now, rng=None):
        rng = rng or random.SystemRandom()
        self.sweep(now)
        fingerprint = self.fingerprint(request)
        with self.transaction() as db:
            old = db.execute("SELECT * FROM quotes WHERE request_key=?", (request.idempotency_key,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise RuleError("IDEMPOTENCY_CONFLICT", "Key already used for a different quote request")
                if old["order_id"]:
                    raise RuleError("QUOTE_ALREADY_CONFIRMED", "This quote already has an order")
                if datetime.fromisoformat(old["expires"]) <= now:
                    raise RuleError("QUOTE_EXPIRED", "Quote expired; request a new quote")
                return self.customer_quote(old)
            validate_slot(request.pickup_start, request.pickup_end, now, booking=True)
            self.check_buyer(db, request.user_id, now)
            batches = self.batches(db)
            result = candidates(batches, request.preferences, request.pickup_end, now)
            if not result["candidates"]:
                raise RuleError(result["reason"], "No eligible box available")
            chosen = dict(select(result["candidates"], request.mode, rng))
            chosen.update({"hidden": rng.random() < chosen["hidden_probability"],
                "preferences": request.preferences.model_dump(), "search_truncated": result["search_truncated"],
                "points_awarded": 0})
            chosen["pending_points"] = 10 if chosen["hidden"] else 0
            selected = {line["batch_id"] for line in chosen["lines"]}
            payload = {"request": request.model_dump(mode="json"), "chosen": chosen,
                "batches": {b.batch_id: self.batch_snapshot(b) for b in batches if b.batch_id in selected}}
            quote_id = uuid4().hex
            # The quote fixes the randomly selected contents but does not reserve stock.
            db.execute("INSERT INTO quotes VALUES (?,?,?,?,?,?,NULL)", (quote_id, request.user_id,
                request.idempotency_key, fingerprint, request.pickup_end.isoformat(), json.dumps(payload)))
            return self.customer_quote(db.execute("SELECT * FROM quotes WHERE id=?", (quote_id,)).fetchone())

    def save_quoted_order(self, db, request, chosen, fingerprint, day, now):
        for line in chosen["lines"]:
            changed = db.execute("UPDATE batches SET reserved=reserved+? WHERE id=? AND on_hand-reserved>=?",
                (line["qty"], line["batch_id"], line["qty"]))
            if changed.rowcount != 1:
                raise RuleError("STOCK_CONFLICT", "Quoted stock is unavailable; request a new quote")
        order_id = uuid4().hex
        db.execute("INSERT INTO orders VALUES (?,?,?,?,?,'RESERVED',?,?,?,NULL,?)", (
            order_id, request.user_id, request.idempotency_key, fingerprint, day, now.isoformat(),
            request.pickup_start.isoformat(), request.pickup_end.isoformat(), json.dumps(chosen)))
        return self.order_response(db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone())

    def confirm_quote(self, request, now):
        self.sweep(now)
        fingerprint = "quote:" + self.fingerprint(request)
        with self.transaction() as db:
            old = db.execute("SELECT * FROM orders WHERE request_key=?", (request.idempotency_key,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise RuleError("IDEMPOTENCY_CONFLICT", "Key already used for a different request")
                return self.customer_order(self.order_response(old))
            row = db.execute("SELECT * FROM quotes WHERE id=? AND user_id=?", (request.quote_id, request.user_id)).fetchone()
            if not row:
                raise RuleError("QUOTE_NOT_FOUND", "Quote not found for this demo user", 404)
            if row["order_id"]:
                raise RuleError("QUOTE_ALREADY_CONFIRMED", "Use the original confirmation key to read this order")
            if datetime.fromisoformat(row["expires"]) <= now:
                raise RuleError("QUOTE_EXPIRED", "Quote expired; request a new quote")
            payload = json.loads(row["payload"])
            original = OrderRequest.model_validate(payload["request"])
            booking = original.model_copy(update={"idempotency_key": request.idempotency_key})
            validate_slot(booking.pickup_start, booking.pickup_end, now, booking=True)
            day = self.check_buyer(db, request.user_id, now)
            current = {b.batch_id: b for b in self.batches(db)}
            for line in payload["chosen"]["lines"]:
                batch = current.get(line["batch_id"])
                if batch is None:
                    raise RuleError("STOCK_CONFLICT", "Quoted stock is unavailable; request a new quote")
                reason = eligible(batch, booking.preferences, booking.pickup_end, now)
                if reason and reason != "OUT_OF_STOCK":
                    raise RuleError("QUOTE_UNAVAILABLE", "Quoted batch no longer meets safety or preference requirements")
                if batch.on_hand - batch.reserved < line["qty"]:
                    raise RuleError("STOCK_CONFLICT", "Quoted stock is unavailable; request a new quote")
                if self.batch_snapshot(batch) != payload["batches"][batch.batch_id]:
                    raise RuleError("QUOTE_CHANGED", "Quoted batch information changed; request a new quote")
            order = self.save_quoted_order(db, booking, payload["chosen"], fingerprint, day, now)
            db.execute("UPDATE quotes SET order_id=? WHERE id=?", (order["order_id"], request.quote_id))
            return self.customer_order(order)

    def customer_account(self, user_id):
        # Demo identity only; no phone, payment or authentication data is involved.
        with self.transaction() as db:
            user = db.execute("SELECT points,frozen_until FROM users WHERE id=?", (user_id,)).fetchone()
            orders = [self.customer_order(self.order_response(row)) for row in db.execute(
                "SELECT * FROM orders WHERE user_id=? ORDER BY created DESC,id", (user_id,))]
            pending = sum(o["pending_points"] for o in orders)
            return {"demo_only": True, "user_id": user_id, "points": user["points"] if user else 0,
                    "pending_points": pending, "frozen_until": user["frozen_until"] if user else None,
                    "orders": orders}

    def order(self, request, now, rng=None):
        rng = rng or random.SystemRandom()
        self.sweep(now)
        fingerprint = self.fingerprint(request)
        with self.transaction() as db:
            old = db.execute("SELECT * FROM orders WHERE request_key=?", (request.idempotency_key,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise RuleError("IDEMPOTENCY_CONFLICT", "Key already used for a different request")
                return self.order_response(old)
            validate_slot(request.pickup_start, request.pickup_end, now, booking=True)
            db.execute("INSERT OR IGNORE INTO users(id) VALUES (?)", (request.user_id,))
            user = db.execute("SELECT * FROM users WHERE id=?", (request.user_id,)).fetchone()
            if user["frozen_until"] and datetime.fromisoformat(user["frozen_until"]) > now:
                raise RuleError("USER_FROZEN", "Demo user is temporarily frozen")
            day = now.astimezone(LOCAL).date().isoformat()
            count = db.execute("SELECT count(*) FROM orders WHERE user_id=? AND day=?", (request.user_id, day)).fetchone()[0]
            if count >= 2:
                raise RuleError("DAILY_LIMIT", "Maximum two boxes per demo user per day")
            result = candidates(self.batches(db), request.preferences, request.pickup_end, now)
            if not result["candidates"]:
                raise RuleError(result["reason"], "No eligible box available")
            chosen = dict(select(result["candidates"], request.mode, rng))
            chosen.update({"hidden": rng.random() < chosen["hidden_probability"], "preferences": request.preferences.model_dump(),
                           "search_truncated": result["search_truncated"], "points_awarded": 0})
            chosen["pending_points"] = 10 if chosen["hidden"] else 0
            for line in chosen["lines"]:
                changed = db.execute("UPDATE batches SET reserved=reserved+? WHERE id=? AND on_hand-reserved>=?", (line["qty"], line["batch_id"], line["qty"]))
                if changed.rowcount != 1:
                    raise RuleError("STOCK_CONFLICT", "Stock changed, retry with a new request")
            oid = uuid4().hex
            db.execute("INSERT INTO orders VALUES (?,?,?,?,?,'RESERVED',?,?,?,NULL,?)", (
                oid, request.user_id, request.idempotency_key, fingerprint, day, now.isoformat(),
                request.pickup_start.isoformat(), request.pickup_end.isoformat(), json.dumps(chosen)))
            return self.order_response(db.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone())

    def get_order(self, oid):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
            if not row:
                raise RuleError("ORDER_NOT_FOUND", "Order not found", 404)
            return self.order_response(row)

    @staticmethod
    def check_lines(db, payload, now, preferences=None):
        for line in payload["lines"]:
            row = db.execute("SELECT * FROM batches WHERE id=?", (line["batch_id"],)).fetchone()
            if not row or row["reserved"] < line["qty"] or row["on_hand"] < line["qty"]:
                raise RuleError("STOCK_CONFLICT", "Reserved stock unavailable")
            b = Batch.model_validate_json(row["payload"])
            if not b.safe or not b.storage_verified or b.allergens is None or b.diets is None or b.safe_until <= now:
                raise RuleError("UNSAFE_FOR_HANDOFF", "Food must remain verified and within its safety window")
            if preferences and (set(preferences.avoid_allergens) & {x.casefold() for x in b.allergens} or not set(preferences.required_diets) <= {x.casefold() for x in b.diets}):
                raise RuleError("RESTRICTION_CONFLICT", "Updated batch restrictions conflict with customer")

    @staticmethod
    def consume(db, payload):
        for line in payload["lines"]:
            changed = db.execute("UPDATE batches SET on_hand=on_hand-?,reserved=reserved-? WHERE id=? AND reserved>=? AND on_hand>=?",
                (line["qty"], line["qty"], line["batch_id"], line["qty"], line["qty"]))
            if changed.rowcount != 1:
                raise RuleError("STOCK_CONFLICT", "Cannot consume unavailable reserved stock")

    def pickup(self, oid, now, user_id=None):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
            if not row:
                raise RuleError("ORDER_NOT_FOUND", "Order not found", 404)
            if user_id is not None and row["user_id"] != user_id:
                raise RuleError("ORDER_NOT_FOUND", "Order not found for this demo user", 404)
            if row["status"] == "PICKED_UP":
                return self.order_response(row)
            if row["status"] != "RESERVED":
                raise RuleError("INVALID_STATE", "Only reserved orders can be picked up")
            assert_pickup(datetime.fromisoformat(row["start"]), datetime.fromisoformat(row["end"]), now)
            payload = json.loads(row["payload"])
            self.check_lines(db, payload, now, Preferences.model_validate(payload["preferences"]))
            self.consume(db, payload)
            payload["points_awarded"] = payload["pending_points"]
            payload["pending_points"] = 0
            db.execute("UPDATE users SET points=points+? WHERE id=?", (payload["points_awarded"], row["user_id"]))
            db.execute("UPDATE orders SET status='PICKED_UP',payload=? WHERE id=?", (json.dumps(payload), oid))
            return self.order_response(db.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone())

    def sweep(self, now):
        with self.transaction() as db:
            expired = [r for r in db.execute("SELECT * FROM orders WHERE status='RESERVED'") if datetime.fromisoformat(r["end"]) <= now]
            for row in expired:
                payload = json.loads(row["payload"])
                payload["pending_points"] = 0
                db.execute("UPDATE orders SET status='NO_SHOW',no_show_at=?,payload=? WHERE id=?", (now.isoformat(), json.dumps(payload), row["id"]))
                db.execute("INSERT INTO donations VALUES (?,?,'PENDING',?,NULL,?)", (uuid4().hex, row["id"], now.isoformat(), json.dumps(payload)))
                user = db.execute("SELECT * FROM users WHERE id=?", (row["user_id"],)).fetchone()
                cutoff = max(now-timedelta(days=30), datetime.fromisoformat(user["frozen_until"]) if user["frozen_until"] else now-timedelta(days=30))
                # Count the actual missed slot, not the time a delayed sweep happened.
                missed = sum(1 for r in db.execute("SELECT end FROM orders WHERE user_id=? AND status='NO_SHOW'", (row["user_id"],)) if cutoff < datetime.fromisoformat(r["end"]) <= now)
                if missed >= 2 and (not user["frozen_until"] or datetime.fromisoformat(user["frozen_until"]) <= now):
                    db.execute("UPDATE users SET frozen_until=?,penalty_at=? WHERE id=?", ((now+timedelta(days=7)).isoformat(), now.isoformat(), row["user_id"]))
            for b in self.batches(db):
                available = b.on_hand-b.reserved
                # Even after midnight a delayed sweep must remove expired stock.
                closing = now.astimezone(LOCAL).time() >= time(22,30)
                if available and (closing or b.safe_until <= now or not b.safe or not b.storage_verified):
                    payload = {"lines": [{"batch_id": b.batch_id, "qty": available}], "qty": available,
                               "weight_g": available*b.weight_g, "estimated_co2e_kg": available*b.weight_g/1000*b.co2e_per_kg}
                    db.execute("UPDATE batches SET reserved=reserved+? WHERE id=?", (available, b.batch_id))
                    db.execute("INSERT INTO donations VALUES (?,NULL,'PENDING',?,NULL,?)", (uuid4().hex, now.isoformat(), json.dumps(payload)))
            # Unsafe food is consumed as waste, never released for resale or counted as rescued.
            for row in list(db.execute("SELECT * FROM donations WHERE status='PENDING'")):
                payload = json.loads(row["payload"])
                try:
                    self.check_lines(db, payload, now)
                except RuleError as exc:
                    if exc.code != "UNSAFE_FOR_HANDOFF":
                        raise
                    self.consume(db, payload)
                    db.execute("UPDATE donations SET status='DISCARDED' WHERE id=?", (row["id"],))
            return {"no_shows_processed": len(expired), "demo_only": True}

    def donate(self, did, recipient, now):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM donations WHERE id=?", (did,)).fetchone()
            if not row:
                raise RuleError("DONATION_NOT_FOUND", "Donation not found", 404)
            if row["status"] == "DONATED":
                if row["recipient"] != recipient:
                    raise RuleError("RECIPIENT_CONFLICT", "Donation already handed to another recipient")
                return dict(row)
            if row["status"] != "PENDING":
                raise RuleError("INVALID_STATE", "Only pending donations can be handed over")
            payload = json.loads(row["payload"])
            self.check_lines(db, payload, now)
            self.consume(db, payload)
            db.execute("UPDATE donations SET status='DONATED',recipient=? WHERE id=?", (recipient, did))
            return dict(db.execute("SELECT * FROM donations WHERE id=?", (did,)).fetchone())

    def donations(self):
        with self.transaction() as db:
            return [{**dict(row), "payload": json.loads(row["payload"])} for row in db.execute("SELECT * FROM donations ORDER BY created,id")]

    def redeem(self, request, now):
        fingerprint = self.fingerprint(request)
        with self.transaction() as db:
            old = db.execute("SELECT * FROM redemptions WHERE request_key=?", (request.idempotency_key,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise RuleError("IDEMPOTENCY_CONFLICT", "Key already used for a different request")
                return json.loads(old["payload"])
            # 100 points = 100 sen; use whole points only, never round above the 30% cap.
            if request.points*100 > request.regular_price_sen*30:
                raise RuleError("REDEMPTION_LIMIT", "Points cover at most 30% of the regular price", 422)
            changed = db.execute("UPDATE users SET points=points-? WHERE id=? AND points>=?", (request.points, request.user_id, request.points))
            if changed.rowcount != 1:
                raise RuleError("INSUFFICIENT_POINTS", "Not enough earned points")
            payload = {"demo_only": True, "discount_sen": request.points, "paid_sen": request.regular_price_sen-request.points, "points_used": request.points}
            db.execute("INSERT INTO redemptions VALUES (?,?,?,?,?)", (request.idempotency_key, request.user_id, fingerprint, now.isoformat(), json.dumps(payload)))
            return payload

    def dashboard(self):
        with self.transaction() as db:
            orders = list(db.execute("SELECT * FROM orders"))
            picked = [json.loads(r["payload"]) for r in orders if r["status"] == "PICKED_UP"]
            all_paid = [json.loads(r["payload"]) for r in orders]
            donated = [json.loads(r["payload"]) for r in db.execute("SELECT * FROM donations WHERE status='DONATED'")]
            def total(rows, key):
                return sum(r[key] for r in rows)
            return {"demo_only": True, "simulated_revenue_sen": total(all_paid,"price_sen"),
                    "picked_up_contribution_sen": total(picked,"contribution_sen"),
                    "picked_up_gross_profit_sen": total(picked,"gross_profit_sen"),
                    "picked_up_qty": total(picked,"qty"), "donated_qty": total(donated,"qty"),
                    "picked_up_weight_g": total(picked,"weight_g"), "donated_weight_g": total(donated,"weight_g"),
                    "estimated_co2e_kg": round(total(picked+donated,"estimated_co2e_kg"), 6),
                    "carbon_note": "Food-footprint estimate only, not verified avoided emissions or carbon credits.",
                    "conversion_rate": None, "redemption_repurchase_rate": None,
                    "unavailable_reason": "No verified visitor or regular-order attribution data",
                    "users": [dict(r) for r in db.execute("SELECT id,points,frozen_until FROM users ORDER BY id")]}
