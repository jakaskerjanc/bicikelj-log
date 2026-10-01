import json
import os
import uuid
from dataclasses import asdict

import pytest

from bicikelj_log.models import StatusRow

AZURITE_CONN = (
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/"
    "K1SZFPTOtr/KBHBeksoGMGw==;"
    "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
)


def status_line(ts: int, sid="1", bikes=5, docks=15, installed=True, renting=True) -> str:
    """One raw status JSONL line, as the poller writes it."""
    row = StatusRow(ts=ts, station_id=sid, bikes=bikes, docks=docks, bikes_disabled=0,
                    docks_disabled=0, is_installed=installed, is_renting=renting,
                    is_returning=True, last_reported=None)
    return json.dumps(asdict(row))


@pytest.fixture
def azurite_container():
    from azure.storage.blob import ContainerClient
    from azure.core.exceptions import AzureError

    name = "test-" + uuid.uuid4().hex[:12]
    try:
        cc = ContainerClient.from_connection_string(AZURITE_CONN, name)
        cc.create_container()
    except AzureError as e:
        if os.environ.get("REQUIRE_AZURITE"):
            pytest.fail(f"Azurite required but unavailable: {e}")
        pytest.skip(f"Azurite not available: {e}")
    try:
        yield cc
    finally:
        cc.delete_container()


@pytest.fixture
def public_container(azurite_container):
    """A second container in the same Azurite account, like local dev.

    Depends on azurite_container so the skip/REQUIRE_AZURITE handling applies once.
    """
    from azure.storage.blob import ContainerClient

    cc = ContainerClient.from_connection_string(AZURITE_CONN, "pub-" + uuid.uuid4().hex[:12])
    cc.create_container()
    try:
        yield cc
    finally:
        cc.delete_container()
