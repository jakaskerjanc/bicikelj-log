import pytest
from bicikelj_log.config import Config


def test_from_env_reads_connection_string(monkeypatch):
    monkeypatch.delenv("BICIKELJ_STORAGE_ACCOUNT_URL", raising=False)
    monkeypatch.delenv("BICIKELJ_GBFS_BASE_URL", raising=False)
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
