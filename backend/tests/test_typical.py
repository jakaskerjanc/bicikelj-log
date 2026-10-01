import json
from datetime import date, datetime

import pytest

from bicikelj_log.typical import (
    FIELDS, SlotAccumulator, SlotValues, build_profiles, local_slot, shrink, weight,
    window_days,
)


def ts(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp())


def line(t: int, sid="1", bikes=5, docks=15, installed=True, renting=True) -> str:
    return json.dumps({"ts": t, "station_id": sid, "bikes": bikes, "docks": docks,
                       "bikes_disabled": 0, "docks_disabled": 0, "is_installed": installed,
                       "is_renting": renting, "is_returning": True, "last_reported": None})


# ---- slotting -------------------------------------------------------------

def test_local_slot_uses_ljubljana_time():
    # 06:10 UTC in summer = 08:10 CEST -> slot 32
    assert local_slot(ts("2026-09-21T06:10:00+00:00")) == (date(2026, 9, 21), 32)
    # 07:10 UTC in winter = 08:10 CET -> slot 32
    assert local_slot(ts("2026-12-07T07:10:00+00:00")) == (date(2026, 12, 7), 32)


def test_local_slot_crosses_utc_midnight_into_next_local_day():
    # 22:30 UTC on Sep 21 = 00:30 local on Sep 22 -> slot 2
    assert local_slot(ts("2026-09-21T22:30:00+00:00")) == (date(2026, 9, 22), 2)


def test_local_slot_on_dst_days():
    # 2026-10-25 (25 h): 02:30 local happens twice, both land in slot 10.
    assert local_slot(ts("2026-10-25T00:30:00+00:00")) == (date(2026, 10, 25), 10)
    assert local_slot(ts("2026-10-25T01:30:00+00:00")) == (date(2026, 10, 25), 10)
    # 2027-03-28 (23 h): 01:59 CET is followed by 03:00 CEST, slots 8-11 never occur.
    assert local_slot(ts("2027-03-28T00:59:00+00:00")) == (date(2027, 3, 28), 7)
    assert local_slot(ts("2027-03-28T01:00:00+00:00")) == (date(2027, 3, 28), 12)


# ---- accumulator -----------------------------------------------------------

def test_accumulator_averages_polls_in_a_slot():
    t0 = ts("2026-09-21T06:00:00+00:00")  # 08:00 local
    acc = SlotAccumulator()
    acc.add_lines([line(t0, bikes=0, docks=20), line(t0 + 300, bikes=4, docks=16),
                   line(t0 + 600, bikes=8, docks=0)])
    v = acc.daily_values()[("1", date(2026, 9, 21), 32)]
    assert v == SlotValues(bikes=4.0, docks=12.0, p_empty=pytest.approx(1 / 3), p_full=pytest.approx(1 / 3))


def test_accumulator_dedupes_station_and_ts_within_a_file():
    t0 = ts("2026-09-21T06:00:00+00:00")
    acc = SlotAccumulator()
    acc.add_lines([line(t0, bikes=2), line(t0, bikes=2), line(t0 + 300, bikes=4)])
    assert acc.rows_read == 2
    assert acc.daily_values()[("1", date(2026, 9, 21), 32)].bikes == 3.0


def test_accumulator_excludes_not_installed_or_not_renting():
    t0 = ts("2026-09-21T06:00:00+00:00")
    acc = SlotAccumulator()
    acc.add_lines([line(t0, bikes=0, renting=False), line(t0 + 60, bikes=0, installed=False),
                   line(t0 + 300, bikes=6)])
    v = acc.daily_values()[("1", date(2026, 9, 21), 32)]
    assert v.bikes == 6.0
    assert v.p_empty == 0.0  # the non-renting zero-bike polls must not count as "empty"


def test_accumulator_only_non_renting_polls_leaves_slot_absent():
    t0 = ts("2026-09-21T06:00:00+00:00")
    acc = SlotAccumulator()
    acc.add_lines([line(t0, renting=False)])
    assert acc.daily_values() == {}


def test_accumulator_skips_bad_and_blank_lines():
    t0 = ts("2026-09-21T06:00:00+00:00")
    acc = SlotAccumulator()
    acc.add_lines([b"{not json", line(t0).encode(), b"", b"\n", json.dumps({"ts": t0}).encode()])
    assert acc.bad_lines == 2
    assert acc.rows_read == 1


def sv(bikes: float) -> SlotValues:
    return SlotValues(bikes, 20 - bikes, 0.0, 0.0)


# ---- window, weights and shrinkage -----------------------------------------

def test_window_is_56_local_days_before_today():
    days = window_days(date(2026, 9, 23))
    assert len(days) == 56
    assert days[0] == date(2026, 7, 29)
    assert days[-1] == date(2026, 9, 22)


def test_weight_halves_every_21_days():
    assert weight(date(2026, 9, 1), date(2026, 9, 22)) == pytest.approx(0.5)
    assert weight(date(2026, 9, 22), date(2026, 9, 22)) == 1.0


def test_shrink():
    assert shrink(2.0, 10.0, 4.0) == pytest.approx(7.0)
    assert shrink(0.0, None, 4.0) == 4.0
    assert shrink(0.0, None, None) is None
    assert shrink(1.0, 3.0, None) == 3.0


# ---- build_profiles --------------------------------------------------------

BUILD = date(2026, 9, 22)
SLOT = 32


def _golden_daily():
    # Station 1, slot 32 (08:00), weekdays Sep 14-21 2026 — real data from the spec.
    bikes = {14: 13.0, 15: 2.0, 16: 14 / 3, 17: 44 / 3, 18: 23 / 3, 21: 9.0}
    return {("1", date(2026, 9, d), SLOT): sv(b) for d, b in bikes.items()}


def test_golden_worked_example_from_spec():
    p = build_profiles(_golden_daily(), BUILD)
    assert p["mon"].stations["1"]["bikes"][SLOT] == pytest.approx(9.57, abs=0.01)
    assert p["mon"].days_used == pytest.approx(1.736, abs=0.001)


def test_day_type_without_own_data_equals_weekday_prior():
    daily = {k: v for k, v in _golden_daily().items() if k[1] != date(2026, 9, 18)}  # drop the Friday
    p = build_profiles(daily, BUILD)
    fri = p["fri"].stations["1"]["bikes"][SLOT]
    num = sum(weight(d, BUILD) * v.bikes for (_, d, _), v in daily.items())
    den = sum(weight(d, BUILD) for (_, d, _) in daily)
    assert fri == pytest.approx(num / den)
    assert p["fri"].days_used == 0.0


def test_holiday_without_data_equals_sunday():
    daily = {("1", date(2026, 9, 19), SLOT): sv(3.0), ("1", date(2026, 9, 20), SLOT): sv(7.0)}
    p = build_profiles(daily, BUILD)
    for f in FIELDS:
        assert p["holiday"].stations["1"][f] == p["sun"].stations["1"][f]
    assert p["holiday"].days_used == 0.0


def test_weekend_data_does_not_leak_into_weekday_profiles():
    daily = {("1", date(2026, 9, 20), SLOT): sv(7.0)}  # a Sunday only
    p = build_profiles(daily, BUILD)
    assert p["mon"].stations["1"]["bikes"][SLOT] is None
    assert p["sat"].stations["1"]["bikes"][SLOT] == pytest.approx(7.0)


def test_holiday_date_is_excluded_from_its_weekday():
    build = date(2026, 12, 30)
    daily = {("1", date(2026, 12, 25), SLOT): sv(1.0),   # Christmas (Friday)
             ("1", date(2026, 12, 18), SLOT): sv(9.0)}   # regular Friday
    p = build_profiles(daily, build)
    assert p["fri"].stations["1"]["bikes"][SLOT] == pytest.approx(9.0)


def test_slot_with_no_data_anywhere_is_none():
    p = build_profiles(_golden_daily(), BUILD)
    assert p["mon"].stations["1"]["bikes"][SLOT + 1] is None


def test_days_outside_window_are_ignored():
    daily = {("1", date(2026, 7, 27), SLOT): sv(99.0),   # 57 days before BUILD
             ("1", BUILD, SLOT): sv(99.0),               # today (incomplete)
             ("1", date(2026, 9, 21), SLOT): sv(9.0)}
    p = build_profiles(daily, BUILD)
    assert p["mon"].stations["1"]["bikes"][SLOT] == pytest.approx(9.0)
