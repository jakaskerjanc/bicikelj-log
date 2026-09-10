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
