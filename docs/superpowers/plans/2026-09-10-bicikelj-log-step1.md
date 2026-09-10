# BicikeLJ Availability Logger — Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll the BicikeLJ GBFS feed once a minute and append per-station availability to Azure Blob Storage.

**Architecture:** A stateless Python job does one poll and exits; Azure Container Apps Job cron is the scheduler. It fetches `station_status` + `station_information`, validates the GBFS envelope, transforms status into JSONL, and appends the minute's rows to a per-UTC-day Append Blob. Station info is snapshotted once per day.

**Tech Stack:** Python 3.12, `httpx`, `azure-storage-blob`, `azure-identity`, `pytest`, Azurite (local Blob emulator), Docker, GitHub Actions → ghcr.io, Azure Container Apps Jobs.

**Spec:** `docs/superpowers/specs/2026-09-10-bicikelj-log-step1-design.md`

## Global Constraints

- Python `>=3.12`.
- Package name (import): `bicikelj_log`. `src/` layout.
- Storage sink is **Azure Blob Append Blobs**; one status blob per UTC day.
- Row/blob-day timestamp comes from the feed's `last_updated` (epoch UTC), **not** wall-clock.
- **No partial writes:** any fetch/validate failure → exit non-zero, write nothing.
- Retries only on transient network / 5xx (2 attempts); never retry malformed data.
- Registry is **ghcr.io** — never Azure Container Registry.
- Prod auth is **system-assigned Managed Identity** + `Storage Blob Data Contributor`; local/tests use an `AZURE_STORAGE_CONNECTION_STRING` (Azurite).
- Azure region: `germanywestcentral` (subscription policy allows only germanywestcentral / francecentral / switzerlandnorth / spaincentral / belgiumcentral).
- GBFS base URL: `https://api.cyclocity.fr/contracts/ljubljana/gbfs/v3/`. Both feeds' data key is `stations`.

---

### Task 1: Project scaffold + config

**Files:**
- Create: `pyproject.toml`
- Create: `src/bicikelj_log/__init__.py` (empty)
- Create: `src/bicikelj_log/config.py`
- Create: `tests/__init__.py` (empty)
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Config` dataclass with fields: `container: str`, `gbfs_base_url: str`, `account_url: str | None`, `connection_string: str | None`.
  - `Config.from_env() -> Config` — reads env, raises `ValueError` if neither `account_url` nor `connection_string` is set.

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "bicikelj-log"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "azure-storage-blob>=12.19",
    "azure-identity>=1.16",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Create empty package files**

Create `src/bicikelj_log/__init__.py` and `tests/__init__.py` as empty files.

- [ ] **Step 3: Write the failing test** — `tests/test_config.py`

```python
import pytest
from bicikelj_log.config import Config


def test_from_env_reads_connection_string(monkeypatch):
    monkeypatch.delenv("BICIKELJ_STORAGE_ACCOUNT_URL", raising=False)
    monkeypatch.setenv("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
    monkeypatch.setenv("BICIKELJ_CONTAINER", "bicikelj")
    cfg = Config.from_env()
    assert cfg.connection_string == "UseDevelopmentStorage=true"
    assert cfg.container == "bicikelj"
    assert cfg.gbfs_base_url.endswith("/gbfs/v3/")


def test_from_env_defaults_container_and_url(monkeypatch):
    monkeypatch.delenv("AZURE_STORAGE_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("BICIKELJ_CONTAINER", raising=False)
    monkeypatch.setenv("BICIKELJ_STORAGE_ACCOUNT_URL", "https://acct.blob.core.windows.net")
    cfg = Config.from_env()
    assert cfg.account_url == "https://acct.blob.core.windows.net"
    assert cfg.container == "bicikelj"


def test_from_env_requires_a_credential(monkeypatch):
    monkeypatch.delenv("AZURE_STORAGE_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("BICIKELJ_STORAGE_ACCOUNT_URL", raising=False)
    with pytest.raises(ValueError):
        Config.from_env()
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `pip install -e ".[dev]" && pytest tests/test_config.py -v`
Expected: FAIL (`ModuleNotFoundError: bicikelj_log.config`).

- [ ] **Step 5: Implement `src/bicikelj_log/config.py`**

```python
import os
from dataclasses import dataclass

DEFAULT_GBFS_BASE_URL = "https://api.cyclocity.fr/contracts/ljubljana/gbfs/v3/"
DEFAULT_CONTAINER = "bicikelj"


@dataclass(frozen=True)
class Config:
    container: str
    gbfs_base_url: str
    account_url: str | None
    connection_string: str | None

    @classmethod
    def from_env(cls) -> "Config":
        account_url = os.environ.get("BICIKELJ_STORAGE_ACCOUNT_URL")
        connection_string = os.environ.get("AZURE_STORAGE_CONNECTION_STRING")
        if not account_url and not connection_string:
            raise ValueError(
                "Set BICIKELJ_STORAGE_ACCOUNT_URL or AZURE_STORAGE_CONNECTION_STRING"
            )
        return cls(
            container=os.environ.get("BICIKELJ_CONTAINER", DEFAULT_CONTAINER),
            gbfs_base_url=os.environ.get("BICIKELJ_GBFS_BASE_URL", DEFAULT_GBFS_BASE_URL),
            account_url=account_url,
            connection_string=connection_string,
        )
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pytest tests/test_config.py -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/bicikelj_log/__init__.py src/bicikelj_log/config.py tests/__init__.py tests/test_config.py
git commit -m "feat: project scaffold + config from env"
```

---

### Task 2: Fixtures + status transform

**Files:**
- Create: `tests/fixtures/station_status.json`
- Create: `tests/fixtures/station_information.json`
- Create: `src/bicikelj_log/models.py`
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `StatusRow` frozen dataclass: `ts: int`, `station_id: str`, `bikes: int`, `docks: int`, `bikes_disabled: int`, `docks_disabled: int`, `is_installed: bool`, `is_renting: bool`, `is_returning: bool`, `last_reported: int | None`.
  - `status_rows(status_feed: dict) -> list[StatusRow]` — `ts` = `status_feed["last_updated"]`; reads `status_feed["data"]["stations"]`; missing `num_*_disabled` default `0`; missing `last_reported` default `None`.
  - `rows_to_jsonl(rows: list[StatusRow]) -> bytes` — newline-delimited JSON, one row per line, trailing newline, UTF-8.

- [ ] **Step 1: Create `tests/fixtures/station_status.json`** (2-station envelope)

```json
{
  "last_updated": 1757500800,
  "ttl": 1,
  "version": "3.0",
  "data": {
    "stations": [
      {
        "station_id": "1",
        "num_vehicles_available": 5,
        "num_docks_available": 15,
        "num_vehicles_disabled": 1,
        "num_docks_disabled": 0,
        "is_installed": true,
        "is_renting": true,
        "is_returning": true,
        "last_reported": 1757500790
      },
      {
        "station_id": "2",
        "num_vehicles_available": 0,
        "num_docks_available": 20,
        "is_installed": true,
        "is_renting": false,
        "is_returning": true
      }
    ]
  }
}
```

- [ ] **Step 2: Create `tests/fixtures/station_information.json`** (matching 2 stations)

```json
{
  "last_updated": 1757500800,
  "ttl": 300,
  "version": "3.0",
  "data": {
    "stations": [
      {"station_id": "1", "name": [{"text": "Station One", "language": "en"}], "lat": 46.05, "lon": 14.5, "address": "Addr 1", "capacity": 21},
      {"station_id": "2", "name": [{"text": "Station Two", "language": "en"}], "lat": 46.06, "lon": 14.51, "address": "Addr 2", "capacity": 20}
    ]
  }
}
```

- [ ] **Step 3: Write the failing test** — `tests/test_models.py`

```python
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
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL (`ModuleNotFoundError: bicikelj_log.models`).

- [ ] **Step 5: Implement `src/bicikelj_log/models.py`**

```python
import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class StatusRow:
    ts: int
    station_id: str
    bikes: int
    docks: int
    bikes_disabled: int
    docks_disabled: int
    is_installed: bool
    is_renting: bool
    is_returning: bool
    last_reported: int | None


def status_rows(status_feed: dict) -> list[StatusRow]:
    ts = status_feed["last_updated"]
    stations = status_feed["data"]["stations"]
    rows: list[StatusRow] = []
    for s in stations:
        rows.append(
            StatusRow(
                ts=ts,
                station_id=str(s["station_id"]),
                bikes=s["num_vehicles_available"],
                docks=s["num_docks_available"],
                bikes_disabled=s.get("num_vehicles_disabled", 0),
                docks_disabled=s.get("num_docks_disabled", 0),
                is_installed=s.get("is_installed", False),
                is_renting=s.get("is_renting", False),
                is_returning=s.get("is_returning", False),
                last_reported=s.get("last_reported"),
            )
        )
    return rows


def rows_to_jsonl(rows: list[StatusRow]) -> bytes:
    lines = [json.dumps(asdict(r), separators=(",", ":")) for r in rows]
    return ("\n".join(lines) + "\n").encode("utf-8")
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures src/bicikelj_log/models.py tests/test_models.py
git commit -m "feat: status transform to JSONL rows + test fixtures"
```

---

### Task 3: GBFS client (fetch + envelope validation)

**Files:**
- Create: `src/bicikelj_log/client.py`
- Test: `tests/test_client.py`

**Interfaces:**
- Consumes: nothing (uses fixtures via monkeypatch in tests).
- Produces:
  - `validate_envelope(feed: dict, data_key: str = "stations") -> None` — raises `ValueError` if `data` missing, `data[data_key]` missing, or list is empty.
  - `fetch_json(client: httpx.Client, url: str, retries: int = 2) -> dict` — GET + `raise_for_status`; retry on `httpx.HTTPError` and 5xx up to `retries` times with 0.5s×attempt backoff; re-raise final error.
  - `fetch_feeds(client: httpx.Client, base_url: str) -> tuple[dict, dict]` — fetch `station_status.json` then `station_information.json`, validate each, return `(status, info)`.

- [ ] **Step 1: Write the failing test** — `tests/test_client.py`

```python
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pytest tests/test_client.py -v`
Expected: FAIL (`ModuleNotFoundError: bicikelj_log.client`).

- [ ] **Step 3: Implement `src/bicikelj_log/client.py`**

```python
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pytest tests/test_client.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/bicikelj_log/client.py tests/test_client.py
git commit -m "feat: GBFS client with envelope validation and retry"
```

---

### Task 4: Blob storage (Append Blob + daily info snapshot)

Integration tests run against **Azurite**. Start it first:
`docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0`

**Files:**
- Create: `src/bicikelj_log/storage.py`
- Create: `tests/conftest.py`
- Test: `tests/test_storage.py`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces:
  - `status_blob_path(day: date) -> str` → `"status/YYYY/MM/DD.jsonl"`.
  - `info_blob_path(day: date) -> str` → `"station_information/YYYY-MM-DD.json"`.
  - `class BlobStore`:
    - `BlobStore(container_client)` — wraps an `azure.storage.blob.ContainerClient`.
    - `BlobStore.from_config(config: Config) -> BlobStore` — builds from connection string, else `account_url` + `DefaultAzureCredential`; ensures the container exists.
    - `append_status(self, day: date, data: bytes) -> None` — create the Append Blob if absent, then append one block.
    - `write_station_info_if_absent(self, day: date, data: bytes) -> bool` — upload if absent (`overwrite=False`); return `True` if written, `False` if it already existed.

- [ ] **Step 1: Write `tests/conftest.py`** (Azurite container fixture, skips if unavailable)

```python
import uuid

import pytest

AZURITE_CONN = (
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/"
    "K1SZFPTOtr/KBHBeksoGMGw==;"
    "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
)


@pytest.fixture
def azurite_container():
    from azure.storage.blob import ContainerClient
    from azure.core.exceptions import AzureError

    name = "test-" + uuid.uuid4().hex[:12]
    try:
        cc = ContainerClient.from_connection_string(AZURITE_CONN, name)
        cc.create_container()
    except AzureError as e:
        pytest.skip(f"Azurite not available: {e}")
    try:
        yield cc
    finally:
        cc.delete_container()
```

- [ ] **Step 2: Write the failing test** — `tests/test_storage.py`

```python
from datetime import date

from bicikelj_log.storage import BlobStore, status_blob_path, info_blob_path


def test_path_helpers():
    d = date(2026, 9, 10)
    assert status_blob_path(d) == "status/2026/09/10.jsonl"
    assert info_blob_path(d) == "station_information/2026-09-10.json"


def test_append_status_creates_then_extends(azurite_container):
    store = BlobStore(azurite_container)
    d = date(2026, 9, 10)
    store.append_status(d, b'{"a":1}\n')
    store.append_status(d, b'{"a":2}\n')
    blob = azurite_container.get_blob_client(status_blob_path(d))
    content = blob.download_blob().readall()
    assert content == b'{"a":1}\n{"a":2}\n'


def test_write_station_info_only_once(azurite_container):
    store = BlobStore(azurite_container)
    d = date(2026, 9, 10)
    assert store.write_station_info_if_absent(d, b'{"v":1}') is True
    assert store.write_station_info_if_absent(d, b'{"v":2}') is False
    blob = azurite_container.get_blob_client(info_blob_path(d))
    assert blob.download_blob().readall() == b'{"v":1}'
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL (`ModuleNotFoundError: bicikelj_log.storage`). (If Azurite is down, the two integration tests skip; `test_path_helpers` still errors on import — that's the expected failure.)

- [ ] **Step 4: Implement `src/bicikelj_log/storage.py`**

```python
from datetime import date

from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import ContainerClient

from .config import Config


def status_blob_path(day: date) -> str:
    return f"status/{day:%Y/%m/%d}.jsonl"


def info_blob_path(day: date) -> str:
    return f"station_information/{day:%Y-%m-%d}.json"


class BlobStore:
    def __init__(self, container_client: ContainerClient) -> None:
        self._cc = container_client

    @classmethod
    def from_config(cls, config: Config) -> "BlobStore":
        if config.connection_string:
            cc = ContainerClient.from_connection_string(
                config.connection_string, config.container
            )
        else:
            from azure.identity import DefaultAzureCredential

            cc = ContainerClient(
                account_url=config.account_url,
                container_name=config.container,
                credential=DefaultAzureCredential(),
            )
        try:
            cc.create_container()
        except ResourceExistsError:
            pass
        return cls(cc)

    def append_status(self, day: date, data: bytes) -> None:
        blob = self._cc.get_blob_client(status_blob_path(day))
        try:
            blob.create_append_blob()
        except ResourceExistsError:
            pass
        blob.append_block(data)

    def write_station_info_if_absent(self, day: date, data: bytes) -> bool:
        blob = self._cc.get_blob_client(info_blob_path(day))
        try:
            blob.upload_blob(data, overwrite=False)
            return True
        except ResourceExistsError:
            return False
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pytest tests/test_storage.py -v`
Expected: PASS (3 tests, with Azurite running).

- [ ] **Step 6: Commit**

```bash
git add src/bicikelj_log/storage.py tests/conftest.py tests/test_storage.py
git commit -m "feat: Blob append storage + daily station-info snapshot"
```

---

### Task 5: Orchestration entrypoint

**Files:**
- Create: `src/bicikelj_log/__main__.py`
- Test: `tests/test_main.py`

**Interfaces:**
- Consumes: `Config` (T1), `fetch_feeds` (T3), `status_rows`/`rows_to_jsonl` (T2), `BlobStore` (T4).
- Produces:
  - `run_once(config, http, store, *, now) -> int` — orchestrate one poll; return `0` on success, `1` on any exception. `store` is a `BlobStore`; `http` is an `httpx.Client`. Derives blob day from `status_feed["last_updated"]` (UTC). Prints one structured JSON log line to stdout.
  - `main() -> int` — build `Config.from_env()`, open `httpx.Client(timeout=10)`, `BlobStore.from_config`, call `run_once`.
  - Module runs `sys.exit(main())` under `__main__`.

- [ ] **Step 1: Write the failing test** — `tests/test_main.py`

```python
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
    status = {"last_updated": 1757500800, "data": {"stations": [
        {"station_id": "1", "num_vehicles_available": 5, "num_docks_available": 15}]}}
    info = {"last_updated": 1757500800, "data": {"stations": [{"station_id": "1"}]}}
    monkeypatch.setattr(m, "fetch_feeds", lambda http, base: (status, info))
    store = FakeStore()
    with httpx.Client() as http:
        rc = m.run_once(_cfg(), http, store, now=datetime.now(timezone.utc))
    assert rc == 0
    assert len(store.appends) == 1
    assert store.appends[0][0].isoformat() == "2026-09-10"  # from feed last_updated UTC
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pytest tests/test_main.py -v`
Expected: FAIL (`AttributeError: module has no attribute run_once`).

- [ ] **Step 3: Implement `src/bicikelj_log/__main__.py`**

```python
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
        day = datetime.fromtimestamp(status_feed["last_updated"], tz=timezone.utc).date()
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
    config = Config.from_env()
    with httpx.Client(timeout=10) as http:
        store = BlobStore.from_config(config)
        return run_once(config, http, store, now=datetime.now(timezone.utc))


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pytest tests/test_main.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `pytest -v`
Expected: all tests pass (Azurite tests skip if the emulator is not running).

- [ ] **Step 6: Commit**

```bash
git add src/bicikelj_log/__main__.py tests/test_main.py
git commit -m "feat: one-poll orchestration entrypoint with structured logging"
```

---

### Task 6: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: the package + `pyproject.toml`.
- Produces: an image whose `CMD` runs `python -m bicikelj_log`.

- [ ] **Step 1: Write `.dockerignore`**

```
.git
__pycache__
*.pyc
tests
docs
.venv
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM python:3.12-slim

RUN useradd --create-home --uid 10001 app
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

USER app
CMD ["python", "-m", "bicikelj_log"]
```

- [ ] **Step 3: Build the image, verify it builds**

Run: `docker build -t bicikelj-log:dev .`
Expected: build succeeds.

- [ ] **Step 4: Verify the entrypoint fails cleanly without config**

Run: `docker run --rm bicikelj-log:dev; echo "exit=$?"`
Expected: prints the `ValueError` from `Config.from_env` and `exit=1` (no crash/traceback loop; non-zero exit).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: Dockerfile running python -m bicikelj_log as non-root"
```

---

### Task 7: CI — build & push image to ghcr.io

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `Dockerfile`.
- Produces: image `ghcr.io/<owner>/<repo>:latest` (+ SHA tag) on push to `main`. Also runs the test suite.

- [ ] **Step 1: Write `.github/workflows/build.yml`**

```yaml
name: build
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      azurite:
        image: mcr.microsoft.com/azure-storage/azurite
        ports:
          - 10000:10000
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: pytest -v

  build-and-push:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ github.sha }}
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml')); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: run tests (with Azurite) and push image to ghcr on main"
```

Note: after first push to `main`, make the ghcr package **public** (repo → Packages → package settings) so Container Apps can pull without a registry secret.

---

### Task 8: Azure provisioning script + README

**Files:**
- Create: `infra/provision.sh`
- Create: `README.md`

**Interfaces:**
- Consumes: the ghcr image path.
- Produces: documented, runnable `az` commands to stand up the storage account, container, Container Apps environment, and the scheduled Job with Managed Identity + RBAC.

- [ ] **Step 1: Write `infra/provision.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Edit these ---
RG=bicikelj-rg
LOCATION=germanywestcentral          # policy-allowed region
STORAGE=bicikeljlog$RANDOM           # must be globally unique, lowercase
CONTAINER=bicikelj
ENV=bicikelj-env
JOB=bicikelj-log-job
IMAGE=ghcr.io/OWNER/bicikelj-log:latest   # <-- set your ghcr owner/repo

# --- Register providers (first time only) ---
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ManagedIdentity --wait

# --- Resource group ---
az group create -n "$RG" -l "$LOCATION"

# --- Storage account + blob container ---
az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --access-tier Hot
az storage container create --account-name "$STORAGE" -n "$CONTAINER" --auth-mode login

ACCOUNT_URL="https://$STORAGE.blob.core.windows.net"

# --- Container Apps environment ---
az containerapp env create -n "$ENV" -g "$RG" -l "$LOCATION"

# --- Scheduled job (every minute), system-assigned identity ---
az containerapp job create -n "$JOB" -g "$RG" --environment "$ENV" \
  --trigger-type Schedule --cron-expression "* * * * *" \
  --replica-timeout 60 --replica-retry-limit 0 \
  --cpu 0.25 --memory 0.5Gi \
  --image "$IMAGE" \
  --mi-system-assigned \
  --env-vars "BICIKELJ_STORAGE_ACCOUNT_URL=$ACCOUNT_URL" "BICIKELJ_CONTAINER=$CONTAINER"

# --- Grant the job's identity write access to Blob ---
PRINCIPAL_ID=$(az containerapp job show -n "$JOB" -g "$RG" --query identity.principalId -o tsv)
STORAGE_ID=$(az storage account show -n "$STORAGE" -g "$RG" --query id -o tsv)
az role assignment create --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" --scope "$STORAGE_ID"

echo "Provisioned. Trigger a manual run with:"
echo "  az containerapp job start -n $JOB -g $RG"
```

- [ ] **Step 2: Write `README.md`** (quickstart + local dev)

````markdown
# bicikelj-log

Polls the BicikeLJ GBFS feed every minute and appends per-station availability
to Azure Blob Storage. Step 1 of 2 (fetch & save). See
`docs/superpowers/specs/2026-09-10-bicikelj-log-step1-design.md`.

## Local dev

```bash
pip install -e ".[dev]"
# start Azurite for storage tests
docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0
pytest -v
```

## Run one poll locally (against Azurite)

```bash
export AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
export BICIKELJ_CONTAINER=bicikelj
python -m bicikelj_log
```

## Deploy to Azure

1. Push to `main` → GitHub Actions builds and pushes the image to ghcr.io.
2. Make the ghcr package **public** so Container Apps can pull it.
3. Edit `OWNER` in `infra/provision.sh`, then run it.
4. Manual test run: `az containerapp job start -n bicikelj-log-job -g bicikelj-rg`.
5. Verify blobs appear under `status/YYYY/MM/DD.jsonl` in the storage account.

Region is pinned to `germanywestcentral` (subscription policy).
````

- [ ] **Step 3: Make the script executable and syntax-check it**

Run: `chmod +x infra/provision.sh && bash -n infra/provision.sh && echo ok`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add infra/provision.sh README.md
git commit -m "docs: Azure provisioning script + README quickstart"
```

---

## Self-Review Notes

- **Spec coverage:** source API + envelope validation (T3), transform/`ts` from `last_updated` (T2), Append-Blob per-UTC-day layout + daily info snapshot (T4), one-poll/exit + no-partial-write + structured log + retry (T3/T5), Dockerfile non-root ghcr image (T6/T7), Container Apps Job cron + Managed Identity + RBAC + region + provider registration (T8). Cost/non-goals are design-only, no task needed.
- **Placeholder scan:** none — every code step is concrete; `OWNER` in T8 is an explicit user-edit marker, not a plan placeholder.
- **Type consistency:** `Config`, `StatusRow`, `status_rows`/`rows_to_jsonl`, `fetch_feeds`, `BlobStore.append_status`/`write_station_info_if_absent`, and `run_once(config, http, store, *, now)` names/signatures match across tasks.
