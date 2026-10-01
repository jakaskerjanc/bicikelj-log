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
