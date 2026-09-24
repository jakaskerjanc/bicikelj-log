# bicikelj-log

Polls the BicikeLJ GBFS feed every 5 minutes and appends per-station availability
to Azure Blob Storage. Step 1 of 2 (fetch & save).

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
   `AZURE_SUBSCRIPTION_ID`, `ALERT_EMAIL` (address to notify on job failures) as
   repo secrets.
4. Run the `deploy` workflow from the Actions tab (Run workflow), passing the
   resource group name.
5. Manual test run: `az containerapp job start -n bicikelj-log-job -g bicikelj-rg`.
6. Verify blobs appear under `status/YYYY/MM/DD.jsonl` in the storage account.

A failed job execution emails `ALERT_EMAIL` via an Azure Monitor alert on the job's
`Executions` metric. The alert is stateful (auto-resolves), so a sustained outage
sends one email when it fires and one when it resolves, not one per failed run.

Region defaults to `francecentral`: subscription policy allows only a few EU regions,
and `germanywestcentral` hits the Container Apps environment quota.

To preview or apply changes locally instead of via CI:

```bash
az deployment group create -g bicikelj-rg -f infra/main.bicep -p alertEmailAddress=you@example.com
```
