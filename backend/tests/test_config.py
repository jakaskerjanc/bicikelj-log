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


def test_from_env_reads_public_settings(monkeypatch):
    monkeypatch.setenv("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
    monkeypatch.setenv("BICIKELJ_PUBLIC_ACCOUNT_URL", "https://pub.blob.core.windows.net")
    monkeypatch.setenv("BICIKELJ_PUBLIC_CONTAINER", "typical2")
    cfg = Config.from_env()
    assert cfg.public_account_url == "https://pub.blob.core.windows.net"
    assert cfg.public_container == "typical2"


def test_from_env_public_defaults(monkeypatch):
    monkeypatch.setenv("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
    monkeypatch.delenv("BICIKELJ_PUBLIC_ACCOUNT_URL", raising=False)
    monkeypatch.delenv("BICIKELJ_PUBLIC_CONTAINER", raising=False)
    cfg = Config.from_env()
    assert cfg.public_account_url is None
    assert cfg.public_container == "typical"
