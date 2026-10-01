import gzip
import json
from datetime import date

import pytest

from bicikelj_log.storage import (
    BlobStore, PublicStore, info_blob_path, public_blob_path, status_blob_path,
)


def test_path_helpers():
    d = date(2026, 9, 10)
    assert status_blob_path(d) == "status/2026/09/10.jsonl"
    assert info_blob_path(d) == "station_information/2026-09-10.json"
    assert public_blob_path("mon") == "v1/mon.json"


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


def test_read_status_returns_bytes_or_none(azurite_container):
    store = BlobStore(azurite_container)
    d = date(2026, 9, 10)
    assert store.read_status(d) is None
    store.append_status(d, b'{"a":1}\n')
    assert store.read_status(d) == b'{"a":1}\n'


def test_latest_station_info_picks_newest_snapshot(azurite_container):
    store = BlobStore(azurite_container)
    store.write_station_info_if_absent(date(2026, 9, 9), b'{"v":9}')
    store.write_station_info_if_absent(date(2026, 9, 11), b'{"v":11}')
    store.write_station_info_if_absent(date(2026, 9, 10), b'{"v":10}')
    assert store.latest_station_info() == {"v": 11}


def test_latest_station_info_raises_when_none(azurite_container):
    with pytest.raises(ValueError):
        BlobStore(azurite_container).latest_station_info()


def test_publish_json_gzips_with_headers(azurite_container):
    PublicStore(azurite_container).publish_json("mon", {"profile": "mon", "name": "PREŠERNOV"})
    blob = azurite_container.get_blob_client(public_blob_path("mon"))
    props = blob.get_blob_properties().content_settings
    assert props.content_type == "application/json"
    assert props.content_encoding == "gzip"
    assert props.cache_control == "public, max-age=3600"
    raw = blob.download_blob(decompress=False).readall()
    assert json.loads(gzip.decompress(raw)) == {"profile": "mon", "name": "PREŠERNOV"}


def test_publish_json_overwrites(azurite_container):
    store = PublicStore(azurite_container)
    store.publish_json("meta", {"v": 1})
    store.publish_json("meta", {"v": 2})
    raw = azurite_container.get_blob_client(public_blob_path("meta")).download_blob(decompress=False).readall()
    assert json.loads(gzip.decompress(raw)) == {"v": 2}


def test_public_store_requires_account_url_without_connection_string():
    from bicikelj_log.config import Config

    cfg = Config(container="c", gbfs_base_url="https://x/", account_url="https://raw", connection_string=None)
    with pytest.raises(ValueError, match="BICIKELJ_PUBLIC_ACCOUNT_URL"):
        PublicStore.from_config(cfg)


def _forbid_create(monkeypatch):
    from azure.storage.blob import ContainerClient

    def fail(self, *a, **kw):
        raise AssertionError("create_container must not be called")

    monkeypatch.setattr(ContainerClient, "create_container", fail)


def test_read_only_blob_store_never_creates_container(monkeypatch):
    from bicikelj_log.config import Config

    _forbid_create(monkeypatch)
    cfg = Config(container="c", gbfs_base_url="https://x/", account_url=None,
                 connection_string="UseDevelopmentStorage=true")
    BlobStore.from_config(cfg, create=False)


def test_public_store_in_azure_never_creates_container(monkeypatch):
    from bicikelj_log.config import Config

    _forbid_create(monkeypatch)
    cfg = Config(container="c", gbfs_base_url="https://x/", account_url="https://raw.blob.core.windows.net",
                 connection_string=None, public_account_url="https://pub.blob.core.windows.net")
    PublicStore.from_config(cfg)  # DefaultAzureCredential() is lazy: no network here


def test_public_store_creates_container_on_azurite(azurite_container):
    from azure.storage.blob import ContainerClient

    from bicikelj_log.config import Config
    from tests.conftest import AZURITE_CONN

    name = "pub-" + azurite_container.container_name[-12:]
    cfg = Config(container="c", gbfs_base_url="https://x/", account_url=None,
                 connection_string=AZURITE_CONN, public_container=name)
    try:
        PublicStore.from_config(cfg).publish_json("mon", {"v": 1})
    finally:
        ContainerClient.from_connection_string(AZURITE_CONN, name).delete_container()
