# Typical Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily job that turns the last 8 weeks of raw BicikeLJ status logs into 8 "typical availability" profiles (Mon–Sun + holiday, 96 × 15-min slots per station) and publishes them as public gzipped JSON in Azure Blob Storage.

**Architecture:** Pure math lives in `typical.py` (raw lines → per-day slot values → recency-weighted, shrunk profiles → JSON documents) and `daytypes.py` (Slovenian holiday calendar). `build_typical.py` is a second entrypoint in the existing package/image that reads the private raw container, calls the math, and publishes to a new public storage account via `PublicStore`. A second Container Apps Job runs it daily at 01:30 UTC.

**Tech Stack:** Python 3.12 stdlib (`zoneinfo`, `json`, `gzip`), `azure-storage-blob`, `azure-identity`, new dep `holidays`; pytest + Azurite; Bicep.

**Spec:** `docs/superpowers/specs/2026-09-23-typical-availability-design.md` — read it before starting; it holds the formula, output contract, and rationale.

## Global Constraints

- Python `>=3.12`; image stays `python:3.12-alpine`. The only new runtime dependency is `holidays` (pure Python).
- Constants in code, not env: `WINDOW_DAYS = 56`, `HALF_LIFE_DAYS = 21`, `K = 2` (int, so `meta.json` publishes `"k": 2`), `SLOT_MINUTES = 15`, `TZ = ZoneInfo("Europe/Ljubljana")`.
- Window = local days `[today−56, today−1]`, `today` = the run time converted to `Europe/Ljubljana`. Today is never included.
- Rows count only if `is_installed and is_renting`; dedupe on `(station_id, ts)` per file.
- Day types, in this order: `("mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday")`. Priors: Mon–Fri → weighted mean of non-holiday Mon–Fri; Sat/Sun → weighted mean of Sat+Sun+holiday; holiday → final `sun` value.
- Output: 9 blobs `v1/{mon,tue,wed,thu,fri,sat,sun,holiday,meta}.json` in container `typical`; headers `Content-Type: application/json`, `Content-Encoding: gzip`, `Cache-Control: public, max-age=3600`; 8 profiles uploaded first, `meta` last.
- Rounding: `bikes`, `docks` → 1 decimal; `p_empty`, `p_full` → 2 decimals; `days_used` → 1 decimal; missing → `null`.
- Profile `stations` keys == the station IDs of the latest `station_information` snapshot, in snapshot order; snapshot stations without data get 96 `null`s per field.
- If there is no usable value anywhere, exit 1 and publish nothing.
- Log line fields: `ts, ok, window_days_found, stations, rows_read, bad_lines, duration_ms, error`.
- Infra: region default `francecentral`; job cron `30 1 * * *` (UTC), 0.5 vCPU / 1 GiB, `replicaTimeout` 900, `replicaRetryLimit` 1; raw account stays `allowBlobPublicAccess: false`.

## Review Focus

1. **Run near midnight / DST:** the job fires at 01:30 UTC; the window must key off the Ljubljana date, not the UTC date (23:30 UTC Sep 22 → build date Sep 23). Test: `test_run_uses_local_date_not_utc_date` (Task 6).
2. **New station in the snapshot with no data yet:** must appear in every profile with all-`null` arrays, not be missing or crash. Test: `test_profile_document_shape_rounding_and_station_set` (Task 4).
3. **Non-renting station reporting 0 bikes:** these polls must not count toward `p_empty`. Test: `test_accumulator_excludes_not_installed_or_not_renting` (Task 2).
4. **First run right after deploy, only today's partial file exists:** must exit 1 and publish nothing. Test: `test_run_with_only_todays_data_publishes_nothing` (Task 6).
5. **Status data only for stations missing from the latest snapshot:** treated as "no usable data", nothing published. Test: `test_run_data_only_for_stations_missing_from_snapshot_fails` (Task 6).

## Local setup (once, before Task 1)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
docker run -d --rm --name azurite -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0 --skipApiVersionCheck
REQUIRE_AZURITE=1 pytest -q   # expect: all existing tests pass
```

`REQUIRE_AZURITE=1` makes Azurite-backed tests fail (instead of skip) if the emulator is not reachable.

## File Structure

| File | Responsibility |
|---|---|
| Create `src/bicikelj_log/daytypes.py` | `day_type(date)` + day-type name tuples |
| Create `src/bicikelj_log/typical.py` | All math: slotting, accumulation, weights, shrinkage, profiles, documents |
| Create `src/bicikelj_log/log.py` | One-line structured JSON log shared by both entrypoints |
| Create `src/bicikelj_log/build_typical.py` | Daily job entrypoint: window, read, compute, publish, log |
| Modify `src/bicikelj_log/config.py` | Public account URL + container settings |
| Modify `src/bicikelj_log/storage.py` | Raw reads, shared client factory, `PublicStore` |
| Modify `src/bicikelj_log/__main__.py` | Use shared `log.py` |
| Modify `pyproject.toml` | Add `holidays` |
| Modify `infra/main.bicep` | Public account, CORS, container, typical job, role assignments |
| Modify `README.md` | Document the new job and public URLs |
| Tests | `tests/test_daytypes.py`, `tests/test_typical.py`, `tests/test_build_typical.py` (new); `tests/test_config.py`, `tests/test_storage.py`, `tests/conftest.py` (extend) |

---

### Task 1: Day types

**Files:**
- Modify: `pyproject.toml`
- Create: `src/bicikelj_log/daytypes.py`
- Test: `tests/test_daytypes.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `DAY_TYPES: tuple[str, ...]` = `("mon","tue","wed","thu","fri","sat","sun","holiday")`; `WEEKDAY_TYPES: tuple[str, ...]` = `("mon","tue","wed","thu","fri")`; `day_type(day: date) -> str`.

- [ ] **Step 1: Add the dependency**

In `pyproject.toml`, change the `dependencies` list to:

```toml
dependencies = [
    "httpx>=0.27",
    "azure-storage-blob>=12.19",
    "azure-identity>=1.16",
    "holidays>=0.60",
]
```

Run: `pip install -e ".[dev]"`
Expected: installs `holidays`.

- [ ] **Step 2: Write the failing test**

Create `tests/test_daytypes.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_daytypes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bicikelj_log.daytypes'`

- [ ] **Step 4: Implement**

Create `src/bicikelj_log/daytypes.py`:

```python
from datetime import date

import holidays

DAY_TYPES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday")
WEEKDAY_TYPES = ("mon", "tue", "wed", "thu", "fri")

_SI_HOLIDAYS = holidays.country_holidays("SI")


def day_type(day: date) -> str:
    if day in _SI_HOLIDAYS:
        return "holiday"
    return DAY_TYPES[day.weekday()]
```

(`holidays` expands years lazily on `in`, so one module-level object covers any date.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_daytypes.py -v`
Expected: all tests in the file pass

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src/bicikelj_log/daytypes.py tests/test_daytypes.py
git commit -m "feat: Slovenian day-type calendar for typical profiles"
```

---

### Task 2: Slotting and per-day slot accumulation

**Files:**
- Create: `src/bicikelj_log/typical.py`
- Test: `tests/test_typical.py`

**Interfaces:**
- Consumes: `DAY_TYPES`, `WEEKDAY_TYPES`, `day_type` from Task 1 (imported now, used in Task 3).
- Produces (all in `bicikelj_log.typical`):
  - Constants `TZ`, `WINDOW_DAYS`, `HALF_LIFE_DAYS`, `K`, `SLOT_MINUTES`, `SLOTS_PER_DAY` (= 96), `FIELDS = ("bikes","docks","p_empty","p_full")`.
  - `class SlotKey(NamedTuple): station_id: str; day: date; slot: int` — `day` is the local date. Plain `(sid, day, slot)` tuples compare/hash equal, so tests may use them as dict keys.
  - `class SlotValues(NamedTuple): bikes: float; docks: float; p_empty: float; p_full: float`
  - `DailySlots = dict[SlotKey, SlotValues]`.
  - `local_slot(ts: int) -> tuple[date, int]`
  - `class SlotAccumulator` with `add_lines(lines: Iterable[bytes | str]) -> None`, `daily_values() -> DailySlots`, and int attributes `rows_read`, `bad_lines`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_typical.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_typical.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bicikelj_log.typical'`

- [ ] **Step 3: Implement**

Create `src/bicikelj_log/typical.py` (the import block already includes what Tasks 3–4 need):

```python
"""Typical-availability math. Pure functions, no I/O.

raw JSONL lines -> SlotAccumulator -> daily slot values -> build_profiles()
-> profile_document() / meta_document().
"""
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple
from zoneinfo import ZoneInfo

from .daytypes import DAY_TYPES, WEEKDAY_TYPES, day_type

TZ = ZoneInfo("Europe/Ljubljana")
WINDOW_DAYS = 56
HALF_LIFE_DAYS = 21
K = 2
SLOT_MINUTES = 15
SLOTS_PER_DAY = 24 * 60 // SLOT_MINUTES
FIELDS = ("bikes", "docks", "p_empty", "p_full")
_DECIMALS = {"bikes": 1, "docks": 1, "p_empty": 2, "p_full": 2}


class SlotKey(NamedTuple):
    station_id: str
    day: date  # local (Europe/Ljubljana) date
    slot: int


class SlotValues(NamedTuple):
    bikes: float
    docks: float
    p_empty: float
    p_full: float


DailySlots = dict[SlotKey, SlotValues]


def local_slot(ts: int) -> tuple[date, int]:
    t = datetime.fromtimestamp(ts, TZ)
    return t.date(), (t.hour * 60 + t.minute) // SLOT_MINUTES


@dataclass(slots=True)  # ~0.5 M instances for the whole window; slots halve memory
class _SlotSums:
    bikes: float = 0.0
    docks: float = 0.0
    empty_polls: int = 0
    full_polls: int = 0
    polls: int = 0

    def mean(self) -> SlotValues:
        n = self.polls
        return SlotValues(self.bikes / n, self.docks / n, self.empty_polls / n, self.full_polls / n)


class SlotAccumulator:
    """Step 1: fold raw status lines into per-(station, local day, slot) values."""

    def __init__(self) -> None:
        self._sums: dict[SlotKey, _SlotSums] = {}
        self.rows_read = 0
        self.bad_lines = 0

    def add_lines(self, lines: Iterable[bytes | str]) -> None:
        """Add one raw file's lines. Dedupe is per call: a ts lives in exactly one UTC-day file."""
        seen: set[tuple[str, int]] = set()
        for line in lines:
            if not line.strip():
                continue
            try:
                r = json.loads(line)
                key = (str(r["station_id"]), int(r["ts"]))
                bikes, docks = float(r["bikes"]), float(r["docks"])
                usable = bool(r["is_installed"]) and bool(r["is_renting"])
            except (ValueError, KeyError, TypeError):
                self.bad_lines += 1
                continue
            if key in seen:
                continue
            seen.add(key)
            self.rows_read += 1
            if not usable:
                continue
            day, slot = local_slot(key[1])
            s = self._sums.setdefault(SlotKey(key[0], day, slot), _SlotSums())
            s.bikes += bikes
            s.docks += docks
            s.empty_polls += bikes == 0
            s.full_polls += docks == 0
            s.polls += 1

    def daily_values(self) -> DailySlots:
        return {k: s.mean() for k, s in self._sums.items()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_typical.py -v`
Expected: all tests in the file pass

- [ ] **Step 5: Commit**

```bash
git add src/bicikelj_log/typical.py tests/test_typical.py
git commit -m "feat: local-time 15-min slot accumulation of raw status rows"
```

---

### Task 3: Recency-weighted, shrunk profiles

**Files:**
- Modify: `src/bicikelj_log/typical.py` (append)
- Test: `tests/test_typical.py` (extend)

**Interfaces:**
- Consumes: `SlotValues`, `DailySlots`, constants from Task 2; `DAY_TYPES`, `WEEKDAY_TYPES`, `day_type` from Task 1.
- Produces:
  - `window_days(today: date) -> list[date]` — local days `[today−WINDOW_DAYS, today−1]`, oldest first. The **only** definition of the window; `build_profiles` and `build_typical` both use it.
  - `weight(day: date, build_date: date) -> float`
  - `shrink(n: float, x_d: float | None, prior: float | None) -> float | None` (uses `K`; `x_d` and `K` are the spec's formula names)
  - `@dataclass class Profile: days_used: float; stations: dict[str, dict[str, list[float | None]]]` — `stations[sid][field]` is a 96-long list, unrounded.
  - `build_profiles(daily: DailySlots, build_date: date) -> dict[str, Profile]` — keys are exactly `DAY_TYPES`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_typical.py`, replace the import line
`from bicikelj_log.typical import SlotAccumulator, SlotValues, local_slot` with:

```python
from bicikelj_log.typical import (
    FIELDS, SlotAccumulator, SlotValues, build_profiles, local_slot, shrink, weight,
    window_days,
)
```

Append to `tests/test_typical.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_typical.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_profiles'`

- [ ] **Step 3: Implement**

Append to `src/bicikelj_log/typical.py`:

```python
def window_days(today: date) -> list[date]:
    """Local days [today-WINDOW_DAYS, today-1], oldest first. Today is never included."""
    return [today - timedelta(days=i) for i in range(WINDOW_DAYS, 0, -1)]


def weight(day: date, build_date: date) -> float:
    return 0.5 ** ((build_date - day).days / HALF_LIFE_DAYS)


def shrink(n: float, x_d: float | None, prior: float | None) -> float | None:
    """Spec formula: (n·x_d + K·x_prior) / (n + K), falling back to whichever side exists."""
    if n <= 0 or x_d is None:
        return prior
    if prior is None:
        return x_d
    return (n * x_d + K * prior) / (n + K)


@dataclass
class Profile:
    days_used: float
    # station_id -> field -> SLOTS_PER_DAY values (None = no data)
    stations: dict[str, dict[str, list[float | None]]]


class _WeightedSum:
    __slots__ = ("w", "sums")

    def __init__(self) -> None:
        self.w = 0.0
        self.sums = [0.0] * len(FIELDS)

    def add(self, w: float, v: SlotValues) -> None:
        self.w += w
        for i, x in enumerate(v):
            self.sums[i] += w * x

    def mean(self, i: int) -> float | None:
        return self.sums[i] / self.w if self.w > 0 else None


def _group(dt: str) -> str:
    return "weekday" if dt in WEEKDAY_TYPES else "rest"


def build_profiles(daily: DailySlots, build_date: date) -> dict[str, Profile]:
    """Steps 2-3: recency-weighted, shrunk estimate per (station, day type, slot)."""
    window = set(window_days(build_date))
    by_type: dict[tuple[str, str, int], _WeightedSum] = {}
    by_group: dict[tuple[str, str, int], _WeightedSum] = {}
    days_seen: set[date] = set()  # days with data; see days_used below
    stations: set[str] = set()
    for (sid, day, slot), v in daily.items():
        if day not in window:
            continue
        dt = day_type(day)
        w = weight(day, build_date)
        by_type.setdefault((sid, dt, slot), _WeightedSum()).add(w, v)
        by_group.setdefault((sid, _group(dt), slot), _WeightedSum()).add(w, v)
        days_seen.add(day)
        stations.add(sid)

    # Σ w over the window's days of each type that have data (spec: days_used).
    # A day with no usable poll at all (logger outage) adds no evidence, so it
    # doesn't count; this is what makes days_used grow ~1/week after deploy.
    days_used = {dt: 0.0 for dt in DAY_TYPES}
    for day in days_seen:
        days_used[day_type(day)] += weight(day, build_date)

    profiles = {dt: Profile(days_used=days_used[dt], stations={}) for dt in DAY_TYPES}
    empty = _WeightedSum()
    for sid in stations:
        for dt in DAY_TYPES:  # "holiday" is last, so its prior ("sun") is already final
            out = {f: [None] * SLOTS_PER_DAY for f in FIELDS}
            for slot in range(SLOTS_PER_DAY):
                own = by_type.get((sid, dt, slot), empty)
                grp = by_group.get((sid, _group(dt), slot), empty)
                for i, f in enumerate(FIELDS):
                    if dt == "holiday":
                        prior = profiles["sun"].stations[sid][f][slot]
                    else:
                        prior = grp.mean(i)
                    out[f][slot] = shrink(own.w, own.mean(i), prior)
            profiles[dt].stations[sid] = out
    return profiles
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_typical.py -v`
Expected: all tests in the file pass (the golden test must give 9.57)

- [ ] **Step 5: Commit**

```bash
git add src/bicikelj_log/typical.py tests/test_typical.py
git commit -m "feat: recency-weighted shrinkage profiles per day type"
```

---

### Task 4: JSON documents

**Files:**
- Modify: `src/bicikelj_log/typical.py` (append)
- Test: `tests/test_typical.py` (extend)

**Interfaces:**
- Consumes: `Profile`, constants from Tasks 2–3.
- Produces:
  - `station_list(info_feed: dict) -> list[dict]` — each `{"id": str, "name": str, "lat", "lon", "capacity"}`, in feed order.
  - `profile_document(name: str, profile: Profile, station_ids: Iterable[str]) -> dict`
  - `meta_document(profiles: Mapping[str, Profile], stations: list[dict], generated_at: datetime) -> dict`
  - `has_any_value(docs: Iterable[dict]) -> bool`

- [ ] **Step 1: Write the failing tests**

In `tests/test_typical.py`, replace the import lines at the top with:

```python
import json
from datetime import date, datetime, timezone

import pytest

from bicikelj_log.typical import (
    FIELDS, SLOTS_PER_DAY, Profile, SlotAccumulator, SlotValues, build_profiles,
    has_any_value, local_slot, meta_document, profile_document, shrink,
    station_list, weight, window_days,
)
```

Append:

```python
# ---- documents -------------------------------------------------------------

INFO = {"data": {"stations": [
    {"station_id": "1", "name": [{"text": "PREŠERNOV TRG", "language": "sl"},
                                 {"text": "PRESEREN SQ", "language": "en"}],
     "lat": 46.05, "lon": 14.5, "capacity": 20},
    {"station_id": 2, "name": [{"text": "Only English", "language": "en"}],
     "lat": 46.06, "lon": 14.51, "capacity": 18},
]}}


def test_station_list_flattens_names_and_ids():
    assert station_list(INFO) == [
        {"id": "1", "name": "PREŠERNOV TRG", "lat": 46.05, "lon": 14.5, "capacity": 20},
        {"id": "2", "name": "Only English", "lat": 46.06, "lon": 14.51, "capacity": 18},
    ]


def test_profile_document_shape_rounding_and_station_set():
    bikes = [None] * SLOTS_PER_DAY
    bikes[SLOT] = 9.5678
    pe = [None] * SLOTS_PER_DAY
    pe[SLOT] = 0.12345
    prof = Profile(days_used=1.736, stations={
        "1": {"bikes": bikes, "docks": bikes, "p_empty": pe, "p_full": pe},
        "99": {"bikes": bikes, "docks": bikes, "p_empty": pe, "p_full": pe},  # not in snapshot
    })
    doc = profile_document("mon", prof, ["1", "2"])
    assert doc["profile"] == "mon"
    assert doc["days_used"] == 1.7
    assert set(doc["stations"]) == {"1", "2"}                 # 99 dropped, 2 present
    assert doc["stations"]["1"]["bikes"][SLOT] == 9.6
    assert doc["stations"]["1"]["p_empty"][SLOT] == 0.12
    assert doc["stations"]["2"]["bikes"] == [None] * SLOTS_PER_DAY  # new station: all null
    assert all(len(a) == SLOTS_PER_DAY for s in doc["stations"].values() for a in s.values())
    json.dumps(doc)  # serialisable


def test_meta_document():
    profiles = {dt: Profile(days_used=1.736 if dt == "mon" else 0.0, stations={})
                for dt in ("mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday")}
    meta = meta_document(profiles, station_list(INFO), datetime(2026, 9, 23, 1, 30, 12, tzinfo=timezone.utc))
    assert meta["generated_at"] == "2026-09-23T01:30:12Z"
    assert meta["timezone"] == "Europe/Ljubljana"
    assert (meta["slot_minutes"], meta["window_days"], meta["half_life_days"], meta["k"]) == (15, 56, 21, 2)
    assert json.dumps(meta["k"]) == "2"  # contract says "k": 2, not 2.0
    assert meta["profiles"]["mon"] == {"days_used": 1.7}
    assert list(meta["profiles"]) == ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday"]
    assert meta["stations"][0]["id"] == "1"


def test_has_any_value():
    nulls = {f: [None] * SLOTS_PER_DAY for f in FIELDS}
    assert has_any_value([{"stations": {"1": nulls}}]) is False
    some = dict(nulls, bikes=[1.0] + [None] * (SLOTS_PER_DAY - 1))
    assert has_any_value([{"stations": {"1": nulls}}, {"stations": {"1": some}}]) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_typical.py -v`
Expected: FAIL — `ImportError: cannot import name 'has_any_value'`

- [ ] **Step 3: Implement**

Append to `src/bicikelj_log/typical.py`:

```python
def _round(field: str, values: list[float | None]) -> list[float | None]:
    d = _DECIMALS[field]
    return [None if v is None else round(v, d) for v in values]


def _station_name(name) -> str:
    if isinstance(name, str):
        return name
    for n in name:
        if n.get("language") == "sl":
            return n["text"]
    return name[0]["text"] if name else ""


def station_list(info_feed: dict) -> list[dict]:
    """Current stations from a GBFS v3 station_information feed, flattened for meta.json."""
    return [
        {
            "id": str(s["station_id"]),
            "name": _station_name(s.get("name", [])),
            "lat": s["lat"],
            "lon": s["lon"],
            "capacity": s.get("capacity"),
        }
        for s in info_feed["data"]["stations"]
    ]


def profile_document(name: str, profile: Profile, station_ids: Iterable[str]) -> dict:
    nulls = {f: [None] * SLOTS_PER_DAY for f in FIELDS}
    stations = {}
    for sid in station_ids:
        values = profile.stations.get(sid, nulls)
        stations[sid] = {f: _round(f, values[f]) for f in FIELDS}
    return {"profile": name, "days_used": round(profile.days_used, 1), "stations": stations}


def meta_document(profiles: Mapping[str, Profile], stations: list[dict], generated_at: datetime) -> dict:
    return {
        "generated_at": generated_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ.key,
        "slot_minutes": SLOT_MINUTES,
        "window_days": WINDOW_DAYS,
        "half_life_days": HALF_LIFE_DAYS,
        "k": K,
        "profiles": {dt: {"days_used": round(profiles[dt].days_used, 1)} for dt in DAY_TYPES},
        "stations": stations,
    }


def has_any_value(docs: Iterable[dict]) -> bool:
    return any(
        v is not None
        for doc in docs
        for st in doc["stations"].values()
        for arr in st.values()
        for v in arr
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_typical.py -v`
Expected: all tests in the file pass

- [ ] **Step 5: Commit**

```bash
git add src/bicikelj_log/typical.py tests/test_typical.py
git commit -m "feat: profile and meta JSON documents for the public contract"
```

---

### Task 5: Config and storage (raw reads + public publisher)

**Files:**
- Modify: `src/bicikelj_log/config.py`
- Modify: `src/bicikelj_log/storage.py` (full replacement below; existing behaviour unchanged)
- Test: `tests/test_config.py`, `tests/test_storage.py` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Config.public_account_url: str | None` (default `None`), `Config.public_container: str` (default `"typical"`), read from `BICIKELJ_PUBLIC_ACCOUNT_URL` / `BICIKELJ_PUBLIC_CONTAINER`. Existing positional construction `Config(container=..., gbfs_base_url=..., account_url=..., connection_string=...)` keeps working.
  - `public_blob_path(name: str) -> str` → `"v1/<name>.json"`
  - `BlobStore.read_status(day: date) -> bytes | None`
  - `BlobStore.latest_station_info() -> dict` (raises `ValueError` if no snapshot)
  - `BlobStore.from_config(config, *, create: bool = True)` — the poller keeps the default; the typical job passes `create=False`.
  - `PublicStore(container_client)`, `PublicStore.from_config(config) -> PublicStore` (raises `ValueError` mentioning `BICIKELJ_PUBLIC_ACCOUNT_URL` if neither it nor a connection string is set; creates the container only with a connection string, i.e. Azurite — in Azure, Bicep creates it), `PublicStore.publish_json(name: str, doc: dict) -> None`
  - `_container_client(connection_string, account_url, container, *, create: bool) -> ContainerClient` — shared factory; calls `create_container()` (tolerating 409) only when `create` is true. The typical job holds only *Storage Blob Data Reader* on the raw account, where `create_container()` would get 403, so it must never call it.

- [ ] **Step 1: Write the failing config tests**

Append to `tests/test_config.py`:

```python


def test_from_env_reads_public_settings(monkeypatch):
    monkeypatch.setenv("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
    monkeypatch.setenv("BICIKELJ_PUBLIC_ACCOUNT_URL", "https://pub.blob.core.windows.net")
    monkeypatch.setenv("BICIKELJ_PUBLIC_CONTAINER", "typical2")
    cfg = Config.from_env()
    assert cfg.public_account_url == "https://pub.blob.core.windows.net"
    assert cfg.public_container == "typical2"


def test_from_env_public_defaults(monkeypatch):
    monkeypatch.setenv("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
    monkeypatch.delenv("BICIKELJ_PUBLIC_ACCOUNT_URL", raising=False)
    monkeypatch.delenv("BICIKELJ_PUBLIC_CONTAINER", raising=False)
    cfg = Config.from_env()
    assert cfg.public_account_url is None
    assert cfg.public_container == "typical"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_config.py -v`
Expected: FAIL — `AttributeError: 'Config' object has no attribute 'public_account_url'`

- [ ] **Step 3: Implement config**

In `src/bicikelj_log/config.py`:

After `DEFAULT_CONTAINER = "bicikelj"` add:

```python
DEFAULT_PUBLIC_CONTAINER = "typical"
```

After the `connection_string: str | None` field add:

```python
    public_account_url: str | None = None
    public_container: str = DEFAULT_PUBLIC_CONTAINER
```

In `from_env`, replace the `return cls(...)` call with:

```python
        return cls(
            container=os.environ.get("BICIKELJ_CONTAINER", DEFAULT_CONTAINER),
            gbfs_base_url=os.environ.get("BICIKELJ_GBFS_BASE_URL", DEFAULT_GBFS_BASE_URL),
            account_url=account_url,
            connection_string=connection_string,
            public_account_url=os.environ.get("BICIKELJ_PUBLIC_ACCOUNT_URL"),
            public_container=os.environ.get("BICIKELJ_PUBLIC_CONTAINER", DEFAULT_PUBLIC_CONTAINER),
        )
```

Run: `pytest tests/test_config.py -v`
Expected: all tests in the file pass

- [ ] **Step 4: Write the failing storage tests**

In `tests/test_storage.py`, replace the import block at the top with:

```python
import gzip
import json
from datetime import date

import pytest

from bicikelj_log.storage import (
    BlobStore, PublicStore, info_blob_path, public_blob_path, status_blob_path,
)
```

In `test_path_helpers`, add as the last line:

```python
    assert public_blob_path("mon") == "v1/mon.json"
```

Append:

```python


def test_read_status_returns_bytes_or_none(azurite_container):
    store = BlobStore(azurite_container)
    d = date(2026, 9, 10)
    assert store.read_status(d) is None
    store.append_status(d, b'{"a":1}\n')
    assert store.read_status(d) == b'{"a":1}\n'


def test_latest_station_info_picks_newest_snapshot(azurite_container):
    store = BlobStore(azurite_container)
    store.write_station_info_if_absent(date(2026, 9, 9), b'{"v":9}')
    store.write_station_info_if_absent(date(2026, 9, 11), b'{"v":11}')
    store.write_station_info_if_absent(date(2026, 9, 10), b'{"v":10}')
    assert store.latest_station_info() == {"v": 11}


def test_latest_station_info_raises_when_none(azurite_container):
    with pytest.raises(ValueError):
        BlobStore(azurite_container).latest_station_info()


def test_publish_json_gzips_with_headers(azurite_container):
    PublicStore(azurite_container).publish_json("mon", {"profile": "mon", "name": "PREŠERNOV"})
    blob = azurite_container.get_blob_client(public_blob_path("mon"))
    props = blob.get_blob_properties().content_settings
    assert props.content_type == "application/json"
    assert props.content_encoding == "gzip"
    assert props.cache_control == "public, max-age=3600"
    raw = blob.download_blob(decompress=False).readall()
    assert json.loads(gzip.decompress(raw)) == {"profile": "mon", "name": "PREŠERNOV"}


def test_publish_json_overwrites(azurite_container):
    store = PublicStore(azurite_container)
    store.publish_json("meta", {"v": 1})
    store.publish_json("meta", {"v": 2})
    raw = azurite_container.get_blob_client(public_blob_path("meta")).download_blob(decompress=False).readall()
    assert json.loads(gzip.decompress(raw)) == {"v": 2}


def test_public_store_requires_account_url_without_connection_string():
    from bicikelj_log.config import Config

    cfg = Config(container="c", gbfs_base_url="https://x/", account_url="https://raw", connection_string=None)
    with pytest.raises(ValueError, match="BICIKELJ_PUBLIC_ACCOUNT_URL"):
        PublicStore.from_config(cfg)


def _forbid_create(monkeypatch):
    from azure.storage.blob import ContainerClient

    def fail(self, *a, **kw):
        raise AssertionError("create_container must not be called")

    monkeypatch.setattr(ContainerClient, "create_container", fail)


def test_read_only_blob_store_never_creates_container(monkeypatch):
    from bicikelj_log.config import Config

    _forbid_create(monkeypatch)
    cfg = Config(container="c", gbfs_base_url="https://x/", account_url=None,
                 connection_string="UseDevelopmentStorage=true")
    BlobStore.from_config(cfg, create=False)


def test_public_store_in_azure_never_creates_container(monkeypatch):
    from bicikelj_log.config import Config

    _forbid_create(monkeypatch)
    cfg = Config(container="c", gbfs_base_url="https://x/", account_url="https://raw.blob.core.windows.net",
                 connection_string=None, public_account_url="https://pub.blob.core.windows.net")
    PublicStore.from_config(cfg)  # DefaultAzureCredential() is lazy: no network here


def test_public_store_creates_container_on_azurite(azurite_container):
    from azure.storage.blob import ContainerClient

    from bicikelj_log.config import Config
    from tests.conftest import AZURITE_CONN

    name = "pub-" + azurite_container.container_name[-12:]
    cfg = Config(container="c", gbfs_base_url="https://x/", account_url=None,
                 connection_string=AZURITE_CONN, public_container=name)
    try:
        PublicStore.from_config(cfg).publish_json("mon", {"v": 1})
    finally:
        ContainerClient.from_connection_string(AZURITE_CONN, name).delete_container()
```

- [ ] **Step 5: Run to verify failure**

Run: `REQUIRE_AZURITE=1 pytest tests/test_storage.py -v`
Expected: FAIL — `ImportError: cannot import name 'PublicStore'`

- [ ] **Step 6: Implement storage**

Replace `src/bicikelj_log/storage.py` with (the existing `append_status` / `write_station_info_if_absent` bodies are unchanged; `from_config` now uses a shared factory and gains `create`):

```python
import gzip
import json
from datetime import date

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import ContainerClient, ContentSettings

from .config import Config

INFO_PREFIX = "station_information/"
PUBLIC_PREFIX = "v1/"
PUBLIC_CONTENT_SETTINGS = ContentSettings(
    content_type="application/json",
    content_encoding="gzip",
    cache_control="public, max-age=3600",
)


def status_blob_path(day: date) -> str:
    return f"status/{day:%Y/%m/%d}.jsonl"


def info_blob_path(day: date) -> str:
    return f"{INFO_PREFIX}{day:%Y-%m-%d}.json"


def public_blob_path(name: str) -> str:
    return f"{PUBLIC_PREFIX}{name}.json"


def _container_client(
    connection_string: str | None, account_url: str | None, container: str, *, create: bool
) -> ContainerClient:
    if connection_string:
        cc = ContainerClient.from_connection_string(connection_string, container)
    else:
        from azure.identity import DefaultAzureCredential

        cc = ContainerClient(
            account_url=account_url,
            container_name=container,
            credential=DefaultAzureCredential(),
        )
    if create:
        # Read-only identities (the typical job on the raw account) must pass
        # create=False: Azure answers 403, not 409, for an existing container.
        try:
            cc.create_container()
        except ResourceExistsError:
            pass
    return cc


class BlobStore:
    def __init__(self, container_client: ContainerClient) -> None:
        self._cc = container_client

    @classmethod
    def from_config(cls, config: Config, *, create: bool = True) -> "BlobStore":
        return cls(_container_client(config.connection_string, config.account_url, config.container, create=create))

    def append_status(self, day: date, data: bytes) -> None:
        blob = self._cc.get_blob_client(status_blob_path(day))
        try:
            # create_append_blob() unconditionally overwrites an existing
            # blob, so require absence via If-None-Match: * to make this a
            # true create-if-absent (otherwise every call would truncate).
            blob.create_append_blob(if_none_match="*")
        except ResourceExistsError:
            pass
        blob.append_block(data)

    def write_station_info_if_absent(self, day: date, data: bytes) -> bool:
        blob = self._cc.get_blob_client(info_blob_path(day))
        try:
            blob.upload_blob(data, overwrite=False)
            return True
        except ResourceExistsError:
            return False

    def read_status(self, day: date) -> bytes | None:
        """Whole UTC-day status blob (~5 MB), or None if that day was never logged."""
        try:
            return self._cc.get_blob_client(status_blob_path(day)).download_blob().readall()
        except ResourceNotFoundError:
            return None

    def latest_station_info(self) -> dict:
        names = [b.name for b in self._cc.list_blobs(name_starts_with=INFO_PREFIX)]
        if not names:
            raise ValueError("no station_information snapshot found")
        latest = max(names)  # YYYY-MM-DD names sort chronologically
        return json.loads(self._cc.get_blob_client(latest).download_blob().readall())


class PublicStore:
    def __init__(self, container_client: ContainerClient) -> None:
        self._cc = container_client

    @classmethod
    def from_config(cls, config: Config) -> "PublicStore":
        if not config.connection_string and not config.public_account_url:
            raise ValueError("Set BICIKELJ_PUBLIC_ACCOUNT_URL or AZURE_STORAGE_CONNECTION_STRING")
        # In Azure, Bicep creates the container (with public access); only Azurite needs it created here.
        return cls(_container_client(config.connection_string, config.public_account_url,
                                     config.public_container, create=bool(config.connection_string)))

    def publish_json(self, name: str, doc: dict) -> None:
        body = gzip.compress(json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        self._cc.get_blob_client(public_blob_path(name)).upload_blob(
            body, overwrite=True, content_settings=PUBLIC_CONTENT_SETTINGS
        )
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `REQUIRE_AZURITE=1 pytest -v`
Expected: all pass, 0 skipped

- [ ] **Step 8: Commit**

```bash
git add src/bicikelj_log/config.py src/bicikelj_log/storage.py tests/test_config.py tests/test_storage.py
git commit -m "feat: raw status reads and gzipped public JSON publisher"
```

---

### Task 6: `build_typical` entrypoint

**Files:**
- Create: `src/bicikelj_log/log.py`
- Modify: `src/bicikelj_log/__main__.py`
- Create: `src/bicikelj_log/build_typical.py`
- Modify: `tests/conftest.py` (add `public_container` fixture)
- Test: `tests/test_build_typical.py`

**Interfaces:**
- Consumes: `DAY_TYPES` (Task 1); `TZ`, `window_days`, `SlotAccumulator`, `build_profiles`, `has_any_value`, `meta_document`, `profile_document`, `station_list` (Tasks 2–4); `Config`, `BlobStore.read_status`, `BlobStore.latest_station_info`, `PublicStore.publish_json`, `public_blob_path` (Task 5).
- Produces:
  - `log(**fields) -> None` in `bicikelj_log.log`
  - `utc_file_days(local_days: list[date]) -> list[date]`, `run(raw, public, *, now: datetime) -> int`, `main() -> int` in `bicikelj_log.build_typical`. `run` only needs duck-typed `raw.read_status`, `raw.latest_station_info`, `public.publish_json`.

- [ ] **Step 1: Extract the shared logger**

Create `src/bicikelj_log/log.py`:

```python
import json


def log(**fields) -> None:
    print(json.dumps(fields, separators=(",", ":")), flush=True)
```

In `src/bicikelj_log/__main__.py`, delete the `_log` function:

```python
def _log(**fields) -> None:
    print(json.dumps(fields, separators=(",", ":")), flush=True)
```

add below `from .config import Config`:

```python
from .log import log
```

and rename the three `_log(` calls in `run_once` and `main` to `log(`. (`import json` stays; it is still used for `json.dumps(info_feed, ...)`.)

Run: `pytest tests/test_main.py -v`
Expected: all tests in the file pass

- [ ] **Step 2: Add a second-container fixture**

In `tests/conftest.py`, append (Azurite-backed tests reach containers only via conftest fixtures):

```python


@pytest.fixture
def public_container(azurite_container):
    """A second container in the same Azurite account, like local dev.

    Depends on azurite_container so the skip/REQUIRE_AZURITE handling applies once.
    """
    from azure.storage.blob import ContainerClient

    cc = ContainerClient.from_connection_string(AZURITE_CONN, "pub-" + uuid.uuid4().hex[:12])
    cc.create_container()
    try:
        yield cc
    finally:
        cc.delete_container()
```

- [ ] **Step 3: Write the failing tests**

Create `tests/test_build_typical.py`:

```python
import gzip
import json
from datetime import date, datetime, timezone

import bicikelj_log.build_typical as bt
from bicikelj_log.daytypes import DAY_TYPES
from bicikelj_log.storage import BlobStore, PublicStore, public_blob_path
from bicikelj_log.typical import SLOTS_PER_DAY, window_days

NOW = datetime(2026, 9, 22, 23, 30, tzinfo=timezone.utc)  # 01:30 local on Sep 23
INFO = {"data": {"stations": [
    {"station_id": "1", "name": [{"text": "PREŠERNOV TRG", "language": "sl"}],
     "lat": 46.05, "lon": 14.5, "capacity": 20},
]}}


def status_line(iso: str, sid="1", bikes=5, docks=15) -> str:
    return json.dumps({"ts": int(datetime.fromisoformat(iso).timestamp()), "station_id": sid,
                       "bikes": bikes, "docks": docks, "bikes_disabled": 0, "docks_disabled": 0,
                       "is_installed": True, "is_renting": True, "is_returning": True,
                       "last_reported": None})


class FakeRaw:
    def __init__(self, files: dict[date, str], info=INFO):
        self.files, self.info, self.requested = files, info, []

    def read_status(self, day):
        self.requested.append(day)
        text = self.files.get(day)
        return text.encode() if text is not None else None

    def latest_station_info(self):
        return self.info


class FakePublic:
    def __init__(self, fail_on=None):
        self.published, self.fail_on = [], fail_on

    def publish_json(self, name, doc):
        if name == self.fail_on:
            raise OSError("upload failed")
        self.published.append((name, doc))


def last_log(capsys) -> dict:
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_utc_file_days_include_the_day_before_the_window():
    days = window_days(date(2026, 9, 23))
    files = bt.utc_file_days(days)
    assert len(files) == 57
    assert files[0] == date(2026, 7, 28)
    assert files[-1] == date(2026, 9, 22)


def test_run_uses_local_date_not_utc_date():
    raw = FakeRaw({})
    bt.run(raw, FakePublic(), now=NOW)  # 23:30 UTC Sep 22 = Sep 23 local
    assert raw.requested[-1] == date(2026, 9, 22)
    assert date(2026, 9, 23) not in raw.requested


def test_run_publishes_eight_profiles_then_meta(capsys):
    raw = FakeRaw({date(2026, 9, 21): status_line("2026-09-21T06:05:00+00:00", bikes=7) + "\n"})
    public = FakePublic()
    assert bt.run(raw, public, now=NOW) == 0
    names = [n for n, _ in public.published]
    assert names == list(DAY_TYPES) + ["meta"]
    mon = dict(public.published)["mon"]
    assert mon["stations"]["1"]["bikes"][32] == 7.0
    line = last_log(capsys)
    assert line["ok"] is True
    assert (line["window_days_found"], line["stations"], line["rows_read"], line["bad_lines"]) == (1, 1, 1, 0)


def test_run_with_no_data_publishes_nothing_and_fails(capsys):
    public = FakePublic()
    assert bt.run(FakeRaw({}), public, now=NOW) == 1
    assert public.published == []
    line = last_log(capsys)
    assert line["ok"] is False
    assert "no usable data" in line["error"]


def test_run_with_only_todays_data_publishes_nothing():
    # Only the incomplete current local day exists (first run right after deploy).
    raw = FakeRaw({date(2026, 9, 22): status_line("2026-09-22T22:10:00+00:00") + "\n"})
    public = FakePublic()
    assert bt.run(raw, public, now=NOW) == 1
    assert public.published == []


def test_run_data_only_for_stations_missing_from_snapshot_fails():
    raw = FakeRaw({date(2026, 9, 21): status_line("2026-09-21T06:05:00+00:00", sid="77") + "\n"})
    public = FakePublic()
    assert bt.run(raw, public, now=NOW) == 1
    assert public.published == []


def test_run_upload_failure_returns_one_and_skips_meta(capsys):
    raw = FakeRaw({date(2026, 9, 21): status_line("2026-09-21T06:05:00+00:00") + "\n"})
    public = FakePublic(fail_on="wed")
    assert bt.run(raw, public, now=NOW) == 1
    assert "meta" not in [n for n, _ in public.published]
    assert "upload failed" in last_log(capsys)["error"]


def test_main_logs_and_returns_one_on_config_failure(monkeypatch, capsys):
    def boom():
        raise ValueError("no creds")
    monkeypatch.setattr(bt.Config, "from_env", staticmethod(boom))
    assert bt.main() == 1
    line = last_log(capsys)
    assert line["ok"] is False and "no creds" in line["error"]


# ---- Azurite integration ---------------------------------------------------

class RecordingPublicStore(PublicStore):
    """Real PublicStore that also records upload order."""

    def __init__(self, container_client):
        super().__init__(container_client)
        self.order = []

    def publish_json(self, name, doc):
        super().publish_json(name, doc)
        self.order.append(name)


def _read_public(cc, name):
    blob = cc.get_blob_client(public_blob_path(name))
    return blob.get_blob_properties().content_settings, json.loads(
        gzip.decompress(blob.download_blob(decompress=False).readall()))


def test_run_end_to_end_on_azurite(azurite_container, public_container):
    raw = BlobStore(azurite_container)
    lines = "".join(status_line(f"2026-09-21T06:{m:02d}:00+00:00", bikes=b) + "\n"
                    for m, b in [(0, 4), (5, 6), (10, 8)])
    raw.append_status(date(2026, 9, 21), lines.encode())
    raw.write_station_info_if_absent(date(2026, 9, 21), json.dumps(INFO).encode())
    public = RecordingPublicStore(public_container)
    assert bt.run(raw, public, now=NOW) == 0

    assert public.order == list(DAY_TYPES) + ["meta"]  # meta uploaded last
    names = sorted(b.name for b in public_container.list_blobs())
    assert names == sorted(public_blob_path(n) for n in list(DAY_TYPES) + ["meta"])
    for dt in DAY_TYPES:
        settings, doc = _read_public(public_container, dt)
        assert (settings.content_type, settings.content_encoding, settings.cache_control) == (
            "application/json", "gzip", "public, max-age=3600")
        assert doc["profile"] == dt
        assert set(doc["stations"]) == {"1"}
        assert all(len(a) == SLOTS_PER_DAY for a in doc["stations"]["1"].values())
    _, mon = _read_public(public_container, "mon")
    assert mon["stations"]["1"]["bikes"][32] == 6.0
    settings, meta = _read_public(public_container, "meta")
    assert settings.content_encoding == "gzip"
    assert list(meta["profiles"]) == list(DAY_TYPES)
    assert meta["stations"][0]["name"] == "PREŠERNOV TRG"


def test_run_failure_leaves_existing_public_files_untouched(azurite_container, public_container):
    public = PublicStore(public_container)
    public.publish_json("mon", {"old": True})
    assert bt.run(BlobStore(azurite_container), public, now=NOW) == 1
    _, mon = _read_public(public_container, "mon")
    assert mon == {"old": True}
```

- [ ] **Step 4: Run to verify failure**

Run: `REQUIRE_AZURITE=1 pytest tests/test_build_typical.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bicikelj_log.build_typical'`

- [ ] **Step 5: Implement**

Create `src/bicikelj_log/build_typical.py`:

```python
"""Daily job: rebuild typical-availability profiles and publish them.

Run: python -m bicikelj_log.build_typical
"""
import sys
import time
from datetime import date, datetime, timedelta, timezone

from .config import Config
from .daytypes import DAY_TYPES
from .log import log
from .storage import BlobStore, PublicStore
from .typical import (
    TZ, SlotAccumulator, build_profiles, has_any_value, meta_document,
    profile_document, station_list, window_days,
)


def utc_file_days(local_days: list[date]) -> list[date]:
    """UTC-day status files covering the local days (Ljubljana is ahead of UTC,
    so a local day starts on the previous UTC day)."""
    first, last = local_days[0], local_days[-1]
    return [first - timedelta(days=1) + timedelta(days=i) for i in range((last - first).days + 2)]


def run(raw: BlobStore, public: PublicStore, *, now: datetime) -> int:
    start = time.monotonic()
    acc = SlotAccumulator()
    stats = dict(window_days_found=0, stations=0)
    try:
        today = now.astimezone(TZ).date()
        days = window_days(today)
        for d in utc_file_days(days):
            data = raw.read_status(d)
            if data is not None:
                stats["window_days_found"] += 1  # day files found (spec: missing files are skipped)
                acc.add_lines(data.splitlines())
        daily = acc.daily_values()
        stations = station_list(raw.latest_station_info())
        stats["stations"] = len(stations)
        profiles = build_profiles(daily, today)
        ids = [s["id"] for s in stations]
        docs = {dt: profile_document(dt, profiles[dt], ids) for dt in DAY_TYPES}
        if not has_any_value(docs.values()):
            raise ValueError("no usable data in window; nothing published")
        for dt in DAY_TYPES:
            public.publish_json(dt, docs[dt])
        public.publish_json("meta", meta_document(profiles, stations, now))  # last: see spec
        ok, error, rc = True, None, 0
    except Exception as e:  # noqa: BLE001 - top-level guard; old public files stay live
        ok, error, rc = False, str(e), 1
    log(ts=now.isoformat(), ok=ok, **stats, rows_read=acc.rows_read, bad_lines=acc.bad_lines,
        duration_ms=round((time.monotonic() - start) * 1000), error=error)
    return rc


def main() -> int:
    now = datetime.now(timezone.utc)
    try:
        config = Config.from_env()
        raw = BlobStore.from_config(config, create=False)  # Reader role only on the raw account
        public = PublicStore.from_config(config)
    except Exception as e:  # noqa: BLE001 - config/auth setup failed before run's guard
        log(ts=now.isoformat(), ok=False, window_days_found=0, stations=0, rows_read=0,
            bad_lines=0, duration_ms=0, error=str(e))
        return 1
    return run(raw, public, now=now)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `REQUIRE_AZURITE=1 pytest -v`
Expected: all pass, 0 skipped

- [ ] **Step 7: Smoke-run locally against Azurite**

```bash
export AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
export BICIKELJ_CONTAINER=bicikelj
python -m bicikelj_log            # one poll -> raw data for today (UTC)
python -m bicikelj_log.build_typical
```

Expected: the second command logs one JSON line with `"ok":false` and `"error":"no usable data in window; nothing published"`, because only today's data exists (the job never uses today). This is the correct first-run behaviour.

- [ ] **Step 8: Commit**

```bash
git add src/bicikelj_log/log.py src/bicikelj_log/__main__.py src/bicikelj_log/build_typical.py tests/conftest.py tests/test_build_typical.py
git commit -m "feat: build_typical daily job entrypoint"
```

---

### Task 7: Infrastructure and docs

**Files:**
- Modify: `infra/main.bicep`
- Modify: `README.md`

**Interfaces:**
- Consumes: entrypoint `python -m bicikelj_log.build_typical`; env vars `BICIKELJ_STORAGE_ACCOUNT_URL`, `BICIKELJ_CONTAINER`, `BICIKELJ_PUBLIC_ACCOUNT_URL`, `BICIKELJ_PUBLIC_CONTAINER` (Task 5).
- Produces: Bicep outputs `typicalJobName`, `publicBaseUrl`. Reuses the existing `alertActionGroup` (see "feat: email alert on container job failure") so a failed `typicalJob` execution emails `alertEmailAddress` the same way a failed poller-job execution already does.

- [ ] **Step 1: Add parameters and role ID**

In `infra/main.bicep`, replace the line

```bicep
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
```

with:

```bicep
@description('Container App Job name for the daily typical-availability build')
param typicalJobName string = 'bicikelj-typical-job'

@description('Cron expression (UTC) for the typical-availability build; 01:30 UTC is after local midnight in CET and CEST')
param typicalCronExpression string = '30 1 * * *'

@description('Public storage account for published profiles (3-24 lowercase alphanumeric chars)')
param publicStorageAccountName string = 'bicikeljpub${uniqueString(resourceGroup().id)}'

@description('Public blob container for published profiles')
param publicContainerName string = 'typical'

var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
```

- [ ] **Step 2: Add resources**

Insert immediately before `output storageAccountUrl`:

```bicep
resource publicStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: publicStorageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // Only derived, public profiles live here; raw data stays in the private account.
    allowBlobPublicAccess: true
  }
}

resource publicBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: publicStorage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'HEAD']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource publicContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: publicBlobService
  name: publicContainerName
  properties: {
    publicAccess: 'Blob'
  }
}

resource typicalJob 'Microsoft.App/jobs@2024-03-01' = {
  name: typicalJobName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppEnv.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: typicalCronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 900
      replicaRetryLimit: 1
    }
    template: {
      containers: [
        {
          name: typicalJobName
          image: image
          command: ['python', '-m', 'bicikelj_log.build_typical']
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'BICIKELJ_STORAGE_ACCOUNT_URL'
              value: 'https://${storage.name}.blob.core.windows.net'
            }
            {
              name: 'BICIKELJ_CONTAINER'
              value: containerName
            }
            {
              name: 'BICIKELJ_PUBLIC_ACCOUNT_URL'
              value: 'https://${publicStorage.name}.blob.core.windows.net'
            }
            {
              name: 'BICIKELJ_PUBLIC_CONTAINER'
              value: publicContainerName
            }
          ]
        }
      ]
    }
  }
}

resource typicalRawReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, typicalJob.id, storageBlobDataReaderRoleId)
  scope: storage
  properties: {
    principalId: typicalJob.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
  }
}

resource typicalPublicContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(publicStorage.id, typicalJob.id, storageBlobDataContributorRoleId)
  scope: publicStorage
  properties: {
    principalId: typicalJob.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

resource typicalJobFailureAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${typicalJobName}-failed-execution-alert'
  location: 'global'
  properties: {
    description: 'Fires when the ${typicalJobName} container job has a failed execution. Stateful (auto-resolves), so one email per incident plus a resolved notice.'
    severity: 2
    enabled: true
    scopes: [
      typicalJob.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    targetResourceType: 'Microsoft.App/jobs'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'FailedExecutions'
          metricName: 'Executions'
          metricNamespace: 'Microsoft.App/jobs'
          dimensions: [
            {
              name: 'state'
              operator: 'Include'
              values: [
                'Failed'
              ]
            }
          ]
          operator: 'GreaterThanOrEqual'
          threshold: 1
          timeAggregation: 'Total'
        }
      ]
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: alertActionGroup.id
      }
    ]
  }
}

```

Append at the end of the file (after `output jobName ...`):

```bicep
output typicalJobName string = typicalJob.name
output publicBaseUrl string = 'https://${publicStorage.name}.blob.core.windows.net/${publicContainerName}/v1/'
```

- [ ] **Step 3: Validate the template (no deploy)**

```bash
az bicep build -f infra/main.bicep --stdout > /dev/null
az deployment group validate -g bicikelj-rg -f infra/main.bicep \
  -p storageAccountName=bicikeljlcarkdmfjp24i \
  --query "properties.{state:provisioningState,error:error}" -o json
```

Expected: build succeeds (the `no-hardcoded-env-urls` linter warnings also appear for the existing resources and are accepted); validate prints `"state": "Succeeded"`, `"error": null`.

- [ ] **Step 4: Document**

In `README.md`, change the intro paragraph to:

```markdown
Polls the BicikeLJ GBFS feed every 5 minutes and appends per-station availability
to Azure Blob Storage (step 1), and rebuilds "typical availability" profiles once a
day from that history (step 2, see `docs/superpowers/specs/2026-09-23-typical-availability-design.md`).
```

Change the existing alert paragraph (added in "feat: email alert on container job failure") from "A failed job execution" to cover both jobs:

```markdown
A failed execution of either job (`bicikelj-log-job` or `bicikelj-typical-job`) emails
`ALERT_EMAIL` via an Azure Monitor alert on that job's `Executions` metric. Each job has
its own alert, but both notify the same action group, so no extra deploy parameters are
needed. The alerts are stateful (auto-resolve), so a sustained outage sends one email
when it fires and one when it resolves, not one per failed run.
```

Add after the "Run one poll locally (against Azurite)" section:

````markdown
## Typical availability (daily build)

`python -m bicikelj_log.build_typical` reads the last 56 local days of `status/`,
computes 8 profiles (Mon–Sun + holiday, 96 × 15-min slots per station) and publishes
gzipped JSON to the public container:

```
https://<publicStorageAccount>.blob.core.windows.net/typical/v1/meta.json
https://<publicStorageAccount>.blob.core.windows.net/typical/v1/{mon,tue,wed,thu,fri,sat,sun,holiday}.json
```

The exact base URL is the `publicBaseUrl` deployment output. In Azure it runs as
`bicikelj-typical-job` daily at 01:30 UTC. Trigger it manually after the first deploy:

```bash
az containerapp job start -n bicikelj-typical-job -g bicikelj-rg
```

After the first deploy, wait ~5 minutes before this: new role assignments take time to
propagate, and an early 403 (and failure-alert email) is not a bug.

Locally (Azurite) both containers live in the dev account:

```bash
export AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
python -m bicikelj_log.build_typical
```

It exits 1 and publishes nothing until at least one full local day of data exists.
````

- [ ] **Step 5: Commit**

```bash
git add infra/main.bicep README.md
git commit -m "build: public profile storage + daily typical-build job in Bicep"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full test suite**

Run: `REQUIRE_AZURITE=1 pytest -v`
Expected: all pass, 0 skipped.

- [ ] **Step 2: Image builds and the entrypoint imports**

```bash
docker build -t bicikelj-log:dev .
docker run --rm bicikelj-log:dev python -c "import bicikelj_log.build_typical, holidays; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Real-data sanity check (optional, needs Azure CLI login with key access)**

Download recent raw data and run the job with fake stores to confirm the numbers:

```bash
mkdir -p /tmp/bike && az storage blob download-batch --account-name bicikeljlcarkdmfjp24i \
  -s bicikelj -d /tmp/bike --pattern 'status/*' --auth-mode key -o none
az storage blob download --account-name bicikeljlcarkdmfjp24i -c bicikelj \
  -n station_information/2026-09-22.json -f /tmp/bike/si.json --auth-mode key -o none
python - <<'EOF'
import json, pathlib
from datetime import datetime, timezone
import bicikelj_log.build_typical as bt
root = pathlib.Path("/tmp/bike")
class Raw:
    def read_status(self, d):
        p = root / f"status/{d:%Y/%m/%d}.jsonl"
        return p.read_bytes() if p.exists() else None
    def latest_station_info(self):
        return json.load(open(root / "si.json"))
class Pub:
    docs = {}
    def publish_json(self, n, doc): self.docs[n] = doc
p = Pub()
bt.run(Raw(), p, now=datetime(2026, 9, 21, 23, 30, tzinfo=timezone.utc))
print(p.docs["mon"]["stations"]["1"]["bikes"][32], p.docs["mon"]["days_used"])
EOF
```

Expected: `9.6 1.7` (the spec's worked example).

Deployment itself (running the `deploy` workflow, then `az containerapp job start -n bicikelj-typical-job -g bicikelj-rg`) is a separate, user-triggered step and is not part of this plan.
