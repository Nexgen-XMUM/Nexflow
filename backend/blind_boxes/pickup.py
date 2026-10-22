from datetime import datetime, time, timedelta, timezone

LOCAL = timezone(timedelta(hours=8), "Asia/Kuala_Lumpur")


class RuleError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def clock() -> datetime:
    return datetime.now(timezone.utc)


def validate_slot(start: datetime, end: datetime, now: datetime, *, booking=False):
    start, end, now = (value.astimezone(LOCAL) for value in (start, end, now))
    slots = {(time(21, 30), time(22)), (time(22), time(22, 30))}
    if start.date() != end.date() or (start.time(), end.time()) not in slots:
        raise RuleError("INVALID_SLOT", "Choose 21:30-22:00 or 22:00-22:30 at UTC+08:00", 422)
    if start.date() != now.date() or now >= end:
        raise RuleError("INVALID_SLOT", "Choose an unexpired slot for today", 422)
    if booking and now.time() < time(21, 30):
        raise RuleError("NOT_RELEASED", "Orders open at 21:30 local store time")


def assert_pickup(start: datetime, end: datetime, now: datetime):
    if not start <= now < end:
        raise RuleError("OUTSIDE_PICKUP_SLOT", "Pickup requires the booked time slot")
