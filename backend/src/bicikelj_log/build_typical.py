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
