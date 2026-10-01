from datetime import date

import holidays

DAY_TYPES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday")
WEEKDAY_TYPES = ("mon", "tue", "wed", "thu", "fri")

_SI_HOLIDAYS = holidays.country_holidays("SI")


def day_type(day: date) -> str:
    if day in _SI_HOLIDAYS:
        return "holiday"
    return DAY_TYPES[day.weekday()]
