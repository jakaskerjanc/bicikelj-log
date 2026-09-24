import os
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
        if os.environ.get("REQUIRE_AZURITE"):
            pytest.fail(f"Azurite required but unavailable: {e}")
        pytest.skip(f"Azurite not available: {e}")
    try:
        yield cc
    finally:
        cc.delete_container()
