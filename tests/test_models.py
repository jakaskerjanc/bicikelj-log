import json
from pathlib import Path

from bicikelj_log.models import StatusRow, status_rows, rows_to_jsonl

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text())


def test_status_rows_maps_fields_and_uses_feed_timestamp():
    rows = status_rows(load("station_status.json"))
    assert len(rows) == 2
    r0 = rows[0]
    assert r0 == StatusRow(
        ts=1757500800, station_id="1", bikes=5, docks=15,
        bikes_disabled=1, docks_disabled=0,
        is_installed=True, is_renting=True, is_returning=True,
        last_reported=1757500790,
    )


def test_status_rows_defaults_missing_optionals():
    rows = status_rows(load("station_status.json"))
    r1 = rows[1]
    assert r1.bikes_disabled == 0
    assert r1.docks_disabled == 0
    assert r1.last_reported is None
    assert r1.is_renting is False


def test_rows_to_jsonl_one_line_per_row_with_trailing_newline():
    rows = status_rows(load("station_status.json"))
    blob = rows_to_jsonl(rows)
    text = blob.decode("utf-8")
    lines = text.splitlines()
    assert len(lines) == 2
    assert text.endswith("\n")
    first = json.loads(lines[0])
    assert first["station_id"] == "1"
    assert first["ts"] == 1757500800
    assert first["bikes"] == 5
