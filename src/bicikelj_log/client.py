import time

import httpx


def validate_envelope(feed: dict, data_key: str = "stations") -> None:
    data = feed.get("data")
    if not isinstance(data, dict) or data_key not in data:
        raise ValueError(f"GBFS envelope missing data.{data_key}")
    items = data[data_key]
    if not isinstance(items, list) or len(items) == 0:
        raise ValueError(f"GBFS data.{data_key} is empty")


def fetch_json(client: httpx.Client, url: str, retries: int = 2) -> dict:
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code < 500:
                raise
            last_exc = e
        except httpx.HTTPError as e:
            last_exc = e
        if attempt < retries:
            time.sleep(0.5 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def fetch_feeds(client: httpx.Client, base_url: str) -> tuple[dict, dict]:
    status = fetch_json(client, base_url + "station_status.json")
    validate_envelope(status, "stations")
    info = fetch_json(client, base_url + "station_information.json")
    validate_envelope(info, "stations")
    return status, info
