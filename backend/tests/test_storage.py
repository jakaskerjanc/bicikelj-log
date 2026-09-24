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
