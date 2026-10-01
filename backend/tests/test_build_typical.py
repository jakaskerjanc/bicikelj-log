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
