from datetime import date
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
