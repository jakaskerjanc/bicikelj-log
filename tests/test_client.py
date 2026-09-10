import json
from pathlib import Path

import httpx
import pytest

from bicikelj_log.client import validate_envelope, fetch_feeds

FIXTURES = Path(__file__).parent / "fixtures"


def load_text(name):
    return (FIXTURES / name).read_text()


def test_validate_envelope_rejects_missing_data():
    with pytest.raises(ValueError):
        validate_envelope({"last_updated": 1}, "stations")


def test_validate_envelope_rejects_empty_stations():
    with pytest.raises(ValueError):
        validate_envelope({"data": {"stations": []}}, "stations")


def test_validate_envelope_accepts_good_feed():
    validate_envelope(json.loads(load_text("station_status.json")), "stations")


def _mock_client(routes):
    def handler(request):
        return routes[request.url.path]
    transport = httpx.MockTransport(handler)
    return httpx.Client(transport=transport, base_url="https://api.example")


def test_fetch_feeds_returns_status_then_info():
    base = "/contracts/ljubljana/gbfs/v3/"
    routes = {
        base + "station_status.json": httpx.Response(200, text=load_text("station_status.json")),
        base + "station_information.json": httpx.Response(200, text=load_text("station_information.json")),
    }
    with _mock_client(routes) as c:
        status, info = fetch_feeds(c, "https://api.example" + base)
    assert status["data"]["stations"][0]["station_id"] == "1"
    assert info["data"]["stations"][0]["station_id"] == "1"


def test_fetch_feeds_raises_on_malformed_status():
    base = "/contracts/ljubljana/gbfs/v3/"
    routes = {
        base + "station_status.json": httpx.Response(200, text='{"data": {"stations": []}}'),
        base + "station_information.json": httpx.Response(200, text=load_text("station_information.json")),
    }
    with _mock_client(routes) as c:
        with pytest.raises(ValueError):
            fetch_feeds(c, "https://api.example" + base)
