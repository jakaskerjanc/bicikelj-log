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
