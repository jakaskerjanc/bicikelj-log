"""Daily job: rebuild typical-availability profiles and publish them.

Run: python -m bicikelj_log.build_typical
"""
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone

from .config import Config
from .daytypes import DAY_TYPES
from .log import log
from .models import station_list
from .storage import BlobStore, PublicStore
from .typical import (
    TZ, SlotAccumulator, build_profiles, has_any_value, meta_document,
    profile_document, window_days,
)


@dataclass
class RunStats:
    """Fields of the job's one JSON log line; zeros when the run never got going."""
    window_days_found: int = 0  # day files found (spec: missing files are skipped)
    stations: int = 0
    rows_read: int = 0
    bad_lines: int = 0
    duration_ms: int = 0


def _log_run(now: datetime, stats: RunStats, error: str | None) -> None:
    log(ts=now.isoformat(), ok=error is None, **asdict(stats), error=error)


def utc_file_days(local_days: list[date]) -> list[date]:
    """UTC-day status files covering the local days (Ljubljana is ahead of UTC,
    so a local day starts on the previous UTC day)."""
    first, last = local_days[0], local_days[-1]
    return [first - timedelta(days=1) + timedelta(days=i) for i in range((last - first).days + 2)]


def run(raw: BlobStore, public: PublicStore, *, now: datetime) -> int:
    start = time.monotonic()
    accumulator = SlotAccumulator()
    stats = RunStats()
    error = None
    try:
        today = now.astimezone(TZ).date()
        days = window_days(today)
        for d in utc_file_days(days):
            data = raw.read_status(d)
            if data is not None:
                stats.window_days_found += 1
                accumulator.add_lines(data.splitlines())
        daily = accumulator.daily_values()
        stations = station_list(raw.latest_station_info())
        stats.stations = len(stations)
        profiles = build_profiles(daily, today)
        ids = [s["id"] for s in stations]
        docs = {dt: profile_document(dt, profiles[dt], ids) for dt in DAY_TYPES}
        if not has_any_value(docs.values()):
            raise ValueError("no usable data in window; nothing published")
        for dt in DAY_TYPES:
            public.publish_json(dt, docs[dt])
        public.publish_json("meta", meta_document(profiles, stations, now))  # last: see spec
    except Exception as e:  # noqa: BLE001 - top-level guard; old public files stay live
        error = str(e)
    stats.rows_read, stats.bad_lines = accumulator.rows_read, accumulator.bad_lines
    stats.duration_ms = round((time.monotonic() - start) * 1000)
    _log_run(now, stats, error)
    return 0 if error is None else 1


def main() -> int:
    now = datetime.now(timezone.utc)
    try:
        config = Config.from_env()
        raw = BlobStore.from_config(config, create=False)  # Reader role only on the raw account
        public = PublicStore.from_config(config)
    except Exception as e:  # noqa: BLE001 - config/auth setup failed before run's guard
        _log_run(now, RunStats(), str(e))
        return 1
    return run(raw, public, now=now)


if __name__ == "__main__":
    sys.exit(main())
