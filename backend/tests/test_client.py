import json
from pathlib import Path

import httpx
import pytest

from bicikelj_log.client import validate_envelope, fetch_feeds, fetch_json

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


def _sequence_client(steps):
    """steps: list of httpx.Response or Exception instances, consumed in order."""
    calls = {"count": 0}

    def handler(request):
        i = calls["count"]
        calls["count"] += 1
        step = steps[i]
        if isinstance(step, Exception):
            raise step
        return step

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="https://api.example")
    return client, calls


def test_fetch_json_retries_on_5xx_then_succeeds(monkeypatch):
    monkeypatch.setattr("bicikelj_log.client.time.sleep", lambda s: None)
    steps = [
        httpx.Response(503, text="unavailable"),
        httpx.Response(200, text=load_text("station_status.json")),
    ]
    client, calls = _sequence_client(steps)
    with client as c:
        result = fetch_json(c, "https://api.example/station_status.json")
    assert result["data"]["stations"][0]["station_id"] == "1"
    assert calls["count"] == 2


def test_fetch_json_retries_on_network_error_then_succeeds(monkeypatch):
    monkeypatch.setattr("bicikelj_log.client.time.sleep", lambda s: None)
    steps = [
        httpx.ConnectError("boom"),
        httpx.Response(200, text=load_text("station_status.json")),
    ]
    client, calls = _sequence_client(steps)
    with client as c:
        result = fetch_json(c, "https://api.example/station_status.json")
    assert result["data"]["stations"][0]["station_id"] == "1"
    assert calls["count"] == 2


def test_fetch_json_does_not_retry_on_4xx(monkeypatch):
    monkeypatch.setattr("bicikelj_log.client.time.sleep", lambda s: None)
    steps = [httpx.Response(404, text="not found")]
    client, calls = _sequence_client(steps)
    with client as c:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_json(c, "https://api.example/station_status.json")
    assert calls["count"] == 1


def test_fetch_json_reraises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr("bicikelj_log.client.time.sleep", lambda s: None)
    steps = [
        httpx.Response(500, text="err"),
        httpx.Response(500, text="err"),
        httpx.Response(500, text="err"),
    ]
    client, calls = _sequence_client(steps)
    with client as c:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_json(c, "https://api.example/station_status.json")
    assert calls["count"] == 3
