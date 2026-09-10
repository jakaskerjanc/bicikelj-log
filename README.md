# bicikelj-log

Polls the BicikeLJ GBFS feed every minute and appends per-station availability
to Azure Blob Storage. Step 1 of 2 (fetch & save). See
`docs/superpowers/specs/2026-09-10-bicikelj-log-step1-design.md`.

## Local dev

```bash
pip install -e ".[dev]"
# start Azurite for storage tests
docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0
pytest -v
```

## Run one poll locally (against Azurite)

```bash
export AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
export BICIKELJ_CONTAINER=bicikelj
python -m bicikelj_log
```

## Deploy to Azure

1. Push to `main` → GitHub Actions builds and pushes the image to ghcr.io.
2. Make the ghcr package **public** so Container Apps can pull it.
3. Edit `OWNER` in `infra/provision.sh`, then run it.
4. Manual test run: `az containerapp job start -n bicikelj-log-job -g bicikelj-rg`.
5. Verify blobs appear under `status/YYYY/MM/DD.jsonl` in the storage account.

Region is pinned to `germanywestcentral` (subscription policy).

**Caveat:** `infra/provision.sh` runs `az storage container create --auth-mode login`,
which is a data-plane call. Your identity needs a blob data-plane role on the new
storage account (e.g. `Storage Blob Data Contributor` or `Owner`) — management-plane
`Contributor` alone gets a 403. Grant yourself that role before running, or switch
the script to `--auth-mode key`.
