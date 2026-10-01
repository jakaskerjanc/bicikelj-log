import gzip
import json
from datetime import date

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import ContainerClient, ContentSettings

from .config import Config, ContainerTarget

INFO_PREFIX = "station_information/"
PUBLIC_PREFIX = "v1/"
PUBLIC_CONTENT_SETTINGS = ContentSettings(
    content_type="application/json",
    content_encoding="gzip",
    cache_control="public, max-age=3600",
)


def status_blob_path(day: date) -> str:
    return f"status/{day:%Y/%m/%d}.jsonl"


def info_blob_path(day: date) -> str:
    return f"{INFO_PREFIX}{day:%Y-%m-%d}.json"


def public_blob_path(name: str) -> str:
    return f"{PUBLIC_PREFIX}{name}.json"


def _container_client(
    connection_string: str | None, target: ContainerTarget, *, create: bool
) -> ContainerClient:
    if connection_string:
        cc = ContainerClient.from_connection_string(connection_string, target.container)
    else:
        from azure.identity import DefaultAzureCredential

        cc = ContainerClient(
            account_url=target.account_url,
            container_name=target.container,
            credential=DefaultAzureCredential(),
        )
    if create:
        # Read-only identities (the typical job on the raw account) must pass
        # create=False: Azure answers 403, not 409, for an existing container.
        try:
            cc.create_container()
        except ResourceExistsError:
            pass
    return cc


class BlobStore:
    def __init__(self, container_client: ContainerClient) -> None:
        self._cc = container_client

    @classmethod
    def from_config(cls, config: Config, *, create: bool = True) -> "BlobStore":
        return cls(_container_client(config.connection_string, config.raw_target, create=create))

    def append_status(self, day: date, data: bytes) -> None:
        blob = self._cc.get_blob_client(status_blob_path(day))
        try:
            # create_append_blob() unconditionally overwrites an existing
            # blob, so require absence via If-None-Match: * to make this a
            # true create-if-absent (otherwise every call would truncate).
            blob.create_append_blob(if_none_match="*")
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

    def read_status(self, day: date) -> bytes | None:
        """Whole UTC-day status blob (~5 MB), or None if that day was never logged."""
        try:
            return self._cc.get_blob_client(status_blob_path(day)).download_blob().readall()
        except ResourceNotFoundError:
            return None

    def latest_station_info(self) -> dict:
        names = [b.name for b in self._cc.list_blobs(name_starts_with=INFO_PREFIX)]
        if not names:
            raise ValueError("no station_information snapshot found")
        latest = max(names)  # YYYY-MM-DD names sort chronologically
        return json.loads(self._cc.get_blob_client(latest).download_blob().readall())


class PublicStore:
    def __init__(self, container_client: ContainerClient) -> None:
        self._cc = container_client

    @classmethod
    def from_config(cls, config: Config) -> "PublicStore":
        if not config.connection_string and not config.public_account_url:
            raise ValueError("Set BICIKELJ_PUBLIC_ACCOUNT_URL or AZURE_STORAGE_CONNECTION_STRING")
        # In Azure, Bicep creates the container (with public access); only Azurite needs it created here.
        create = bool(config.connection_string)
        return cls(_container_client(config.connection_string, config.public_target, create=create))

    def publish_json(self, name: str, doc: dict) -> None:
        body = gzip.compress(json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        self._cc.get_blob_client(public_blob_path(name)).upload_blob(
            body, overwrite=True, content_settings=PUBLIC_CONTENT_SETTINGS
        )
