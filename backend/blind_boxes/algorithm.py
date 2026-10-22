"""Pure bounded search. No IO, AI, stock mutation or customer-controlled RNG."""
import math
import random
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

from .schemas import Batch, Preferences

VERSION = "rescue-demo-v1"
MARKUP = Decimal("0.30")
PACKAGING_SEN = 50
MAX_CANDIDATES = 300
MAX_NODES = 20000


def eligible(batch: Batch, preferences: Preferences, pickup_end, now):
    if not batch.safe or not batch.storage_verified:
        return "SAFETY_UNVERIFIED"
    if batch.allergens is None or batch.diets is None:
        return "UNKNOWN_RESTRICTIONS"
    if batch.safe_until <= now or batch.safe_until < pickup_end:
        return "SAFETY_WINDOW"
    if set(preferences.avoid_allergens) & {x.casefold() for x in batch.allergens}:
        return "ALLERGEN_CONFLICT"
    if not set(preferences.required_diets) <= {x.casefold() for x in batch.diets}:
        return "DIET_CONFLICT"
    if batch.on_hand <= batch.reserved:
        return "OUT_OF_STOCK"
    return None


def price(cost_sen):
    return int((Decimal(cost_sen) * (1 + MARKUP)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) + PACKAGING_SEN


def candidates(batches, preferences, pickup_end, now, *, max_candidates=MAX_CANDIDATES, max_nodes=MAX_NODES):
    rejected = {b.batch_id: reason for b in batches if (reason := eligible(b, preferences, pickup_end, now))}
    pool = sorted((b for b in batches if b.batch_id not in rejected), key=lambda b: (b.safe_until, b.batch_id))
    stock = Counter()
    for b in pool:
        stock[b.product_id] += b.on_hand - b.reserved
    max_stock = max(stock.values(), default=1)
    drinks = sum(b.on_hand - b.reserved for b in pool if b.category == "drink")
    drink_ratio = drinks / max(1, sum(stock.values()))
    result, nodes, truncated = [], 0, False

    def visit(start, units, counts):
        nonlocal nodes, truncated
        nodes += 1
        if nodes > max_nodes or len(result) >= max_candidates:
            truncated = True
            return
        if len(units) >= 2 and any(b.main_staple for b in units):
            cost = sum(b.cost_sen for b in units)
            retail = sum(b.retail_sen for b in units)
            sale = price(cost)
            if sale * 100 <= retail * 70:
                n = len(units)
                u = sum(100 * max(0, min(1, 1 - (b.safe_until - now).total_seconds() / 14400)) for b in units) / n
                i = sum(100 * stock[b.product_id] / max_stock for b in units) / n
                d = 100 * min(len({b.category for b in units}) / 2, 1)
                f = sum(100 if b.category in preferences.likes else 0 if b.category in preferences.dislikes else 50 for b in units) / n
                score = .35*u + .25*i + .25*d + .15*f
                gross = sale - cost - PACKAGING_SEN
                chance = min(.20, .05 + .20 * (gross / sale) + .10 * drink_ratio)
                qty = Counter(b.batch_id for b in units)
                result.append({
                    "lines": [{"batch_id": bid, "qty": count} for bid, count in sorted(qty.items())],
                    "qty": n, "cost_sen": cost, "retail_sen": retail,
                    "price_sen": sale, "packaging_sen": PACKAGING_SEN,
                    "gross_profit_sen": gross, "contribution_sen": sale-PACKAGING_SEN,
                    "weight_g": sum(b.weight_g for b in units),
                    "estimated_co2e_kg": sum(b.weight_g / 1000 * b.co2e_per_kg for b in units),
                    "scores": {"urgency": u, "inventory": i, "diversity": d, "preference": f, "total": score},
                    "hidden_probability": chance,
                    "allergens": sorted({a for b in units for a in b.allergens}),
                    "algorithm_version": VERSION,
                })
        if len(units) == 4:
            return
        used = Counter(b.batch_id for b in units)
        for idx in range(start, len(pool)):
            b = pool[idx]
            if counts[b.product_id] >= 2 or used[b.batch_id] >= b.on_hand-b.reserved:
                continue
            counts[b.product_id] += 1
            visit(idx, units+[b], counts)
            counts[b.product_id] -= 1
            if truncated:
                return

    visit(0, [], Counter())
    result.sort(key=lambda c: (-c["scores"]["total"], str(c["lines"])))
    return {"candidates": result, "rejected": rejected, "search_truncated": truncated,
            "nodes_visited": min(nodes, max_nodes), "reason": None if result else "SEARCH_LIMIT" if truncated else "NO_FEASIBLE_COMBINATION"}


def select(candidates, mode="standard", rng=None):
    if not candidates:
        raise ValueError("Cannot draw from an empty candidate set")
    rng = rng or random.SystemRandom()
    top = sorted(candidates, key=lambda c: c["scores"]["total"], reverse=True)[:5]
    highest = top[0]["scores"]["total"]
    temperature = 5 if mode == "standard" else 10
    weights = [math.exp((c["scores"]["total"]-highest)/temperature) for c in top]
    chosen = rng.choices(top, weights=weights, k=1)[0]
    return chosen
