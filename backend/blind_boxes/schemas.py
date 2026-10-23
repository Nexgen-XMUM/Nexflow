"""Amounts use integer sen internally; timestamps must include a timezone."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Batch(Model):
    batch_id: str = Field(min_length=1, max_length=80)
    product_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    category: Literal["bread", "dessert", "drink", "meal"]
    main_staple: bool = Field(strict=True)
    cost_sen: int = Field(strict=True, ge=0, le=1000000)
    retail_sen: int = Field(strict=True, gt=0, le=1000000)
    weight_g: int = Field(strict=True, gt=0, le=100000)
    co2e_per_kg: float = Field(ge=0, le=100, allow_inf_nan=False)
    on_hand: int = Field(strict=True, ge=0, le=100000)
    reserved: int = Field(default=0, strict=True, ge=0)
    safe: bool = Field(strict=True)
    storage_verified: bool = Field(strict=True)
    allergens: list[str] | None = None
    diets: list[str] | None = None
    safe_until: AwareDatetime

    @model_validator(mode="after")
    def stock_consistent(self):
        if self.reserved > self.on_hand:
            raise ValueError("Reserved stock exceeds on-hand stock")
        return self


class Preferences(Model):
    avoid_allergens: list[str] = Field(default_factory=list, max_length=30)
    required_diets: list[str] = Field(default_factory=list, max_length=30)
    likes: list[str] = Field(default_factory=list, max_length=20)
    dislikes: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def normalize(self):
        for field in ("avoid_allergens", "required_diets", "likes", "dislikes"):
            setattr(self, field, sorted({v.strip().casefold() for v in getattr(self, field) if v.strip()}))
        if set(self.likes) & set(self.dislikes):
            raise ValueError("A preference cannot be both liked and disliked")
        return self


class SuggestRequest(Model):
    pickup_start: AwareDatetime
    pickup_end: AwareDatetime
    mode: Literal["standard", "surprise"] = "standard"
    preferences: Preferences = Field(default_factory=Preferences)


class CalculateRequest(SuggestRequest):
    top: int = Field(default=3, strict=True, ge=1, le=10)


class OrderRequest(SuggestRequest):
    user_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    idempotency_key: str = Field(min_length=8, max_length=100)


class ActionRequest(Model):
    order_id: str = Field(min_length=1, max_length=80)


class QuoteConfirmRequest(Model):
    quote_id: str = Field(min_length=1, max_length=80)
    user_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    idempotency_key: str = Field(min_length=8, max_length=100)
    # Legacy clients omit points; 0 keeps the previous pay-in-full behaviour.
    points_used: int = Field(default=0, strict=True, ge=0)


class CustomerPickupRequest(ActionRequest):
    user_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


class DonationAction(Model):
    donation_id: str = Field(min_length=1, max_length=80)
    recipient: str = Field(min_length=1, max_length=120)


class RedeemRequest(Model):
    user_id: str = Field(min_length=1, max_length=80)
    idempotency_key: str = Field(min_length=8, max_length=100)
    regular_price_sen: int = Field(strict=True, gt=0, le=1000000)
    points: int = Field(strict=True, gt=0)
