import os
from dataclasses import dataclass
from typing import NamedTuple

DEFAULT_GBFS_BASE_URL = "https://api.cyclocity.fr/contracts/ljubljana/gbfs/v3/"
DEFAULT_CONTAINER = "bicikelj"
DEFAULT_PUBLIC_CONTAINER = "typical"


class ContainerTarget(NamedTuple):
    account_url: str | None
    container: str


@dataclass(frozen=True)
class Config:
    container: str
    gbfs_base_url: str
    account_url: str | None
    connection_string: str | None
    public_account_url: str | None = None
    public_container: str = DEFAULT_PUBLIC_CONTAINER

    @property
    def raw_target(self) -> ContainerTarget:
        return ContainerTarget(self.account_url, self.container)

    @property
    def public_target(self) -> ContainerTarget:
        return ContainerTarget(self.public_account_url, self.public_container)

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
            public_account_url=os.environ.get("BICIKELJ_PUBLIC_ACCOUNT_URL"),
            public_container=os.environ.get("BICIKELJ_PUBLIC_CONTAINER", DEFAULT_PUBLIC_CONTAINER),
        )
