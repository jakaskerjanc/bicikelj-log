# bicikelj-log

Polls the BicikeLJ GBFS feed every 5 minutes and appends per-station availability
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

Infra is defined in `infra/main.bicep` and deployed via the `deploy` GitHub Actions
workflow (`workflow_dispatch`, manual trigger only — it never runs on push).

1. Push to `main` → GitHub Actions builds and pushes the image to ghcr.io.
2. Make the ghcr package **public** so Container Apps can pull it.
3. One-time: create an Azure AD app registration with a federated credential for
   this repo's GitHub Actions OIDC, grant it Contributor + User Access Administrator
   on the target resource group, and set `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID` as repo secrets.
4. Run the `deploy` workflow from the Actions tab (Run workflow), passing the
   resource group name.
5. Manual test run: `az containerapp job start -n bicikelj-log-job -g bicikelj-rg`.
6. Verify blobs appear under `status/YYYY/MM/DD.jsonl` in the storage account.

Region is pinned to `germanywestcentral` (subscription policy).

To preview or apply changes locally instead of via CI:

```bash
az deployment group create -g bicikelj-rg -f infra/main.bicep
```
