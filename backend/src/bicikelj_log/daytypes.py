from datetime import date, timedelta
from enum import StrEnum

import holidays


class DayType(StrEnum):
    MON = "mon"
    TUE = "tue"
    WED = "wed"
    THU = "thu"
    FRI = "fri"
    SAT = "sat"
    SUN = "sun"
    HOLIDAY = "holiday"


DAY_TYPES = tuple(DayType)
WEEKDAY_TYPES = DAY_TYPES[:5]

_SI_HOLIDAYS = holidays.country_holidays("SI")


def day_type(day: date) -> DayType:
    if day in _SI_HOLIDAYS:
        return DayType.HOLIDAY
    return DAY_TYPES[day.weekday()]


def upcoming_holidays(start: date, days: int = 365) -> list[str]:
    """ISO dates of Slovenian public holidays in [start, start + days), ascending."""
    window = (start + timedelta(days=i) for i in range(days))
    return [d.isoformat() for d in window if d in _SI_HOLIDAYS]
