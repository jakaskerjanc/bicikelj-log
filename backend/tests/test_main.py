import json
from datetime import datetime, timezone

import httpx

import bicikelj_log.__main__ as m
from bicikelj_log.config import Config


class FakeStore:
    def __init__(self):
        self.appends = []
        self.infos = []

    def append_status(self, day, data):
        self.appends.append((day, data))

    def write_station_info_if_absent(self, day, data):
        self.infos.append((day, data))
        return True


def _cfg():
    return Config(container="c", gbfs_base_url="https://x/", account_url=None, connection_string="cs")


def test_run_once_success_writes_and_returns_zero(monkeypatch):
    status = {"last_updated": "2025-09-10T12:00:00Z", "data": {"stations": [
        {"station_id": "1", "num_vehicles_available": 5, "num_docks_available": 15}]}}
    info = {"last_updated": "2025-09-10T12:00:00Z", "data": {"stations": [{"station_id": "1"}]}}
    monkeypatch.setattr(m, "fetch_feeds", lambda http, base: (status, info))
    store = FakeStore()
    with httpx.Client() as http:
        rc = m.run_once(_cfg(), http, store, now=datetime.now(timezone.utc))
    assert rc == 0
    assert len(store.appends) == 1
    assert store.appends[0][0].isoformat() == "2025-09-10"  # from feed last_updated UTC
    assert len(store.infos) == 1


def test_run_once_failure_writes_nothing_and_returns_one(monkeypatch):
    def boom(http, base):
        raise ValueError("bad feed")
    monkeypatch.setattr(m, "fetch_feeds", boom)
    store = FakeStore()
    with httpx.Client() as http:
        rc = m.run_once(_cfg(), http, store, now=datetime.now(timezone.utc))
    assert rc == 1
    assert store.appends == []
    assert store.infos == []


def test_main_logs_and_returns_one_on_config_failure(monkeypatch, capsys):
    def boom():
        raise ValueError("no creds")
    monkeypatch.setattr(m.Config, "from_env", staticmethod(boom))
    rc = m.main()
    assert rc == 1
    out = capsys.readouterr().out.strip()
    line = json.loads(out.splitlines()[-1])
    assert line["ok"] is False
    assert "no creds" in line["error"]
