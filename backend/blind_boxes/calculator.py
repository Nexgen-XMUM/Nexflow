"""Blind-box calculator: top-N box options, else a leftover plan (orphanage donation or biofuel).

Pure: no IO, stock mutation or AI. Charity list and store location are passed in by the router.
"""
import math
from collections import defaultdict

from .algorithm import candidates, eligible

VERSION = "blind-calculator-v1"
# Anaerobic-digestion estimates for mixed food waste; demo constants, not measured plant data.
BIOGAS_M3_PER_KG = 0.12
METHANE_SHARE = 0.60
KWH_PER_BIOGAS_M3 = 6.0
# Preference conflicts do not make food unsafe, so it can still be donated.
DONATABLE_REASONS = {None, "ALLERGEN_CONFLICT", "DIET_CONFLICT"}


def distance_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def leftovers(batches, preferences, pickup_end, now):
    """Every batch with free stock, split into donatable (safe) and biofuel (unsafe/unknown)."""
    rows = {"donatable": [], "biofuel": []}
    for b in batches:
        available = b.on_hand - b.reserved
        if available <= 0:
            continue
        reason = eligible(b, preferences, pickup_end, now)
        rows["donatable" if reason in DONATABLE_REASONS else "biofuel"].append({
            "batch_id": b.batch_id, "product_id": b.product_id, "name": b.name, "category": b.category,
            "qty": available, "weight_kg": available * b.weight_g / 1000,
            "estimated_co2e_kg": available * b.weight_g / 1000 * b.co2e_per_kg, "reason": reason,
        })
    return rows


def summarize(rows):
    by_category = defaultdict(lambda: {"qty": 0, "weight_kg": 0.0})
    for r in rows:
        by_category[r["category"]]["qty"] += r["qty"]
        by_category[r["category"]]["weight_kg"] += r["weight_kg"]
    return {"qty": sum(r["qty"] for r in rows), "weight_kg": sum(r["weight_kg"] for r in rows),
            "estimated_co2e_kg": sum(r["estimated_co2e_kg"] for r in rows),
            "by_category": dict(sorted(by_category.items())), "items": rows}


def biofuel(weight_kg):
    biogas = weight_kg * BIOGAS_M3_PER_KG
    return {"weight_kg": weight_kg, "biogas_m3": biogas, "methane_m3": biogas * METHANE_SHARE,
            "energy_kwh": biogas * KWH_PER_BIOGAS_M3, "is_estimate": True,
            "formula": {"biogas_m3_per_kg": BIOGAS_M3_PER_KG, "methane_share": METHANE_SHARE,
                        "kwh_per_biogas_m3": KWH_PER_BIOGAS_M3}}


def calculate(batches, preferences, pickup_end, now, *, store=None, charities=(), top=3, max_charities=3):
    found = candidates(batches, preferences, pickup_end, now)
    base = {"algorithm_version": VERSION, "rejected": found["rejected"],
            "search_truncated": found["search_truncated"], "demo_only": True, "stock_reserved": False}
    if found["candidates"]:
        return {**base, "status": "OPTIONS", "options": found["candidates"][:top], "fallback": None}

    rows = leftovers(batches, preferences, pickup_end, now)
    donatable, waste = summarize(rows["donatable"]), summarize(rows["biofuel"])
    categories = set(donatable["by_category"])
    nearby = sorted(
        ({"name": c["name"], "address": c.get("address"), "contact": c.get("contact"),
          "distance_km": round(distance_km(store, c), 2),
          "accepts": sorted(categories & set(c.get("accepts", categories)))}
         for c in charities if store and categories & set(c.get("accepts", categories))),
        key=lambda c: (c["distance_km"], c["name"]),
    )[:max_charities]
    # Safe food with nowhere to go still becomes biofuel rather than silently disappearing.
    fuel_kg = waste["weight_kg"] + (0 if nearby else donatable["weight_kg"])
    choices = []
    if nearby:
        choices.append({"type": "ORPHANAGE_DONATION", "weight_kg": donatable["weight_kg"], "recipients": nearby})
    if fuel_kg:
        choices.append({"type": "BIOFUEL", **biofuel(fuel_kg)})
    return {**base, "status": "NO_OPTIONS", "options": [], "fallback": {
        "reason": found["reason"], "donatable": donatable, "inedible": waste, "choices": choices}}
