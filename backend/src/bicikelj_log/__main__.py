import json
import sys
import time
from datetime import datetime, timezone

import httpx

from .client import fetch_feeds
from .config import Config
from .models import rows_to_jsonl, status_rows
from .storage import BlobStore


def _log(**fields) -> None:
    print(json.dumps(fields, separators=(",", ":")), flush=True)


def run_once(config: Config, http: httpx.Client, store: BlobStore, *, now: datetime) -> int:
    start = time.monotonic()
    try:
        status_feed, info_feed = fetch_feeds(http, config.gbfs_base_url)
        rows = status_rows(status_feed)
        day = datetime.fromtimestamp(rows[0].ts, tz=timezone.utc).date()
        store.append_status(day, rows_to_jsonl(rows))
        store.write_station_info_if_absent(
            day, json.dumps(info_feed, separators=(",", ":")).encode("utf-8")
        )
        _log(ts=now.isoformat(), ok=True, station_count=len(rows),
             duration_ms=round((time.monotonic() - start) * 1000), error=None)
        return 0
    except Exception as e:  # noqa: BLE001 - top-level guard, no partial write
        _log(ts=now.isoformat(), ok=False, station_count=0,
             duration_ms=round((time.monotonic() - start) * 1000), error=str(e))
        return 1


def main() -> int:
    now = datetime.now(timezone.utc)
    try:
        config = Config.from_env()
        with httpx.Client(timeout=10) as http:
            store = BlobStore.from_config(config)
            return run_once(config, http, store, now=now)
    except Exception as e:  # noqa: BLE001 - config/auth setup failed before run_once's guard
        _log(ts=now.isoformat(), ok=False, station_count=0, duration_ms=0, error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
