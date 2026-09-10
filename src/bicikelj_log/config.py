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
