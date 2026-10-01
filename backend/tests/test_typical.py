import json
from datetime import date, datetime

import pytest

from bicikelj_log.typical import SlotAccumulator, SlotValues, local_slot


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
