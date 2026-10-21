import json
import os
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, StringConstraints
from starlette.exceptions import HTTPException as StarletteHTTPException


INVENTORY_PATH = Path(__file__).resolve().parents[1] / "data" / "inventory.json"
DISCOUNT_RATE = Decimal("0.50")
CENT = Decimal("0.01")
Money = Annotated[
    Decimal, PlainSerializer(lambda value: format(value, ".2f"), return_type=str)
]
CarbonValue = Annotated[
    Decimal,
    PlainSerializer(lambda value: format(value.normalize(), "f"), return_type=str),
]
NonemptyText = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1)
]
NonnegativeMoney = Annotated[
    Decimal, Field(ge=0, decimal_places=2, allow_inf_nan=False)
]


class Product(BaseModel):
    id: NonemptyText
    name: NonemptyText
    aliases: list[NonemptyText]
    retail_price: NonnegativeMoney
    cost_price: NonnegativeMoney
    weight_kg: Decimal = Field(gt=0, allow_inf_nan=False)
    co2e_per_kg: Decimal = Field(ge=0, allow_inf_nan=False)
    on_hand: int = Field(strict=True, ge=0)


class Inventory(BaseModel):
    currency: Literal["MYR"]
    carbon_unit: Literal["kg CO2e"]
    products: list[Product] = Field(min_length=1)


class PromoItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item: NonemptyText
    qty: int = Field(strict=True, gt=0)


class ApiError(BaseModel):
    code: str
    message: str
    details: list[dict] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ApiError


class Totals(BaseModel):
    qty: int
    retail_total: Money
    cost_total: Money
    clearance_total: Money
    gross_profit_total: Money
    loss_total: Money
    estimated_co2e_kg: CarbonValue


class ItemResult(Totals):
    item: str
    name: str
    unit_retail_price: Money
    unit_cost_price: Money
    unit_clearance_price: Money


class CarbonInfo(BaseModel):
    is_estimate: Literal[True] = True
    note: str = (
        "Based on product weight and the supplied CO2e factor; "
        "not certified emissions reductions or carbon credits."
    )


class PromoCopy(BaseModel):
    text: str
    source: Literal["local_demo"] = "local_demo"
    is_fallback: Literal[False] = False


class PromoWarning(BaseModel):
    code: str
    message: str


class PromoResponse(BaseModel):
    currency: Literal["MYR"] = "MYR"
    discount_rate: Money = DISCOUNT_RATE
    items: list[ItemResult]
    totals: Totals
    carbon: CarbonInfo
    promo: PromoCopy
    warnings: list[PromoWarning]


def local_demo_copy(items: list[ItemResult], totals: Totals) -> str:
    # shortcut: covers the current three products; revisit length when the catalogue grows.
    offers = "; ".join(
        f"{item.qty} {item.name} at RM{item.unit_clearance_price:.2f} each"
        for item in items
    )
    return (
        f"🥐 Eh, bakery deals lah! {offers}. "
        f"All {totals.qty} for RM{totals.clearance_total:.2f} (50% off). 😊"
    )


def load_products() -> dict[str, Product]:
    try:
        with INVENTORY_PATH.open(encoding="utf-8") as source:
            inventory = Inventory.model_validate(json.load(source, parse_float=Decimal))
        lookup = {}
        for product in inventory.products:
            for name in [product.id, *product.aliases]:
                key = name.casefold()
                if key in lookup and lookup[key] is not product:
                    raise ValueError("Product identifiers must be unambiguous.")
                lookup[key] = product
        return lookup
    except (OSError, UnicodeError, ValueError):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "INVENTORY_UNAVAILABLE",
                "message": "Inventory data is unavailable or invalid.",
                "details": [],
            },
        ) from None


async def invalid_request(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "INVALID_REQUEST",
                "message": "Request must be a non-empty array of items with positive integer quantities.",
                "details": [
                    {"location": list(error["loc"]), "code": error["type"]}
                    for error in exc.errors()
                ],
            }
        },
    )


async def http_error(_request: Request, exc: StarletteHTTPException):
    error = exc.detail if isinstance(exc.detail, dict) else {
        "code": "HTTP_ERROR", "message": str(exc.detail), "details": []
    }
    return JSONResponse(
        status_code=exc.status_code, content={"error": error}, headers=exc.headers
    )


def generate_promo(
    request_items: Annotated[list[PromoItem], Body(min_length=1)],
) -> PromoResponse:
    products = load_products()
    seen = set()
    results = []
    for index, row in enumerate(request_items):
        product = products.get(row.item.casefold())
        if product is None:
            raise HTTPException(status_code=422, detail={
                "code": "UNKNOWN_ITEM", "message": "Item was not found in inventory.",
                "details": [{"index": index, "item": row.item}],
            })
        if product.id in seen:
            raise HTTPException(status_code=422, detail={
                "code": "DUPLICATE_ITEM", "message": "Each product must appear only once.",
                "details": [{"index": index, "item": product.id}],
            })
        seen.add(product.id)
        if row.qty > product.on_hand:
            raise HTTPException(status_code=422, detail={
                "code": "INSUFFICIENT_STOCK",
                "message": "Requested quantity exceeds available stock.",
                "details": [{"index": index, "item": product.id, "available_qty": product.on_hand}],
            })
        retail = product.retail_price
        cost = product.cost_price
        clearance = (retail * (1 - DISCOUNT_RATE)).quantize(
            CENT, rounding=ROUND_HALF_UP
        )
        gross_profit = (clearance - cost) * row.qty
        results.append(
            ItemResult(
                item=product.id,
                name=product.name,
                qty=row.qty,
                unit_retail_price=retail,
                unit_cost_price=cost,
                unit_clearance_price=clearance,
                retail_total=retail * row.qty,
                cost_total=cost * row.qty,
                clearance_total=clearance * row.qty,
                gross_profit_total=gross_profit,
                loss_total=max(-gross_profit, Decimal("0")),
                estimated_co2e_kg=(
                    row.qty * product.weight_kg * product.co2e_per_kg
                ),
            )
        )
    totals = Totals(
        **{
            field: sum((getattr(item, field) for item in results), 0)
            for field in Totals.model_fields
        }
    )
    return PromoResponse(
        items=results,
        totals=totals,
        carbon=CarbonInfo(),
        promo=PromoCopy(text=local_demo_copy(results, totals)),
        warnings=[
            PromoWarning(
                code="BELOW_COST",
                message=f"{item.item}: clearance price is below cost; loss is MYR {item.loss_total:.2f}.",
            )
            for item in results
            if item.loss_total > 0
        ],
    )


def create_app() -> FastAPI:
    origins = [
        value.strip()
        for value in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
        if value.strip()
    ]
    for origin in origins:
        try:
            parsed = urlsplit(origin)
            valid = (
                "*" not in origin
                and parsed.scheme in {"http", "https"}
                and parsed.hostname
                and not (parsed.path or parsed.query or parsed.fragment)
                and parsed.username is None
                and parsed.password is None
            )
            parsed.port  # Validate the optional port as well.
        except ValueError:
            valid = False
        if not valid:
            raise ValueError(
                "CORS_ALLOWED_ORIGINS requires exact http(s) origins without paths or wildcards."
            )
    application = FastAPI(title="Nexflow Backend", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["POST"],
        allow_headers=["Content-Type"],
    )
    application.add_exception_handler(RequestValidationError, invalid_request)
    application.add_exception_handler(StarletteHTTPException, http_error)
    application.post(
        "/api/generate-promo",
        response_model=PromoResponse,
        responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    )(generate_promo)
    return application


app = create_app()
