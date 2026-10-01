from datetime import date

from bicikelj_log.daytypes import DAY_TYPES, day_type


def test_regular_days_map_to_weekday_names():
    # 2026-09-21 is a Monday.
    assert [day_type(date(2026, 9, 21 + i)) for i in range(7)] == list(DAY_TYPES[:7])


def test_fixed_slovenian_holidays():
    assert day_type(date(2026, 12, 25)) == "holiday"  # Christmas, Friday
    assert day_type(date(2026, 6, 25)) == "holiday"   # Statehood Day, Thursday


def test_moving_holiday_easter_monday():
    assert day_type(date(2027, 3, 29)) == "holiday"


def test_holiday_on_weekend_is_holiday():
    assert day_type(date(2026, 10, 31)) == "holiday"  # Reformation Day, Saturday
    assert day_type(date(2026, 11, 1)) == "holiday"   # Remembrance Day, Sunday
