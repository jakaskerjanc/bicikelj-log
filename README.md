# bicikelj-log

Polls the BicikeLJ GBFS feed every 5 minutes and appends per-station availability
to Azure Blob Storage (step 1), and rebuilds "typical availability" profiles once a
day from that history (step 2, see `docs/superpowers/specs/2026-09-23-typical-availability-design.md`).

## Repository layout

- `backend/` — Python package, tests and Dockerfile for the container jobs.
- `frontend/` — static Mapbox web app (Vite + React + TS) that shows the typical profiles; deployed to GitHub Pages.
  Commands below run from the repo root.
- `infra/` — Bicep for all Azure resources (shared).
- `docs/` — specs and plans.

## Local dev

```bash
pip install -e "./backend[dev]"
# start Azurite for storage tests
docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0
pytest backend -v
```

## Run one poll locally (against Azurite)

```bash
export AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
export BICIKELJ_CONTAINER=bicikelj
python -m bicikelj_log
```

## Typical availability (daily build)

`python -m bicikelj_log.build_typical` reads the last 56 local days of `status/`,
computes 8 profiles (Mon–Sun + holiday, 96 × 15-min slots per station) and publishes
gzipped JSON to the public container:

```
https://<publicStorageAccount>.blob.core.windows.net/typical/v1/meta.json
https://<publicStorageAccount>.blob.core.windows.net/typical/v1/{mon,tue,wed,thu,fri,sat,sun,holiday}.json
```

The exact base URL is the `publicBaseUrl` deployment output. In Azure it runs as
`bicikelj-typical-job` daily at 01:30 UTC. Trigger it manually after the first deploy:

```bash
az containerapp job start -n bicikelj-typical-job -g bicikelj-rg
```

After the first deploy, wait ~5 minutes before this: new role assignments take time to
propagate, and an early 403 (and failure-alert email) is not a bug.

Locally (Azurite) both containers live in the dev account:

```bash
export AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
python -m bicikelj_log.build_typical
```

It exits 1 and publishes nothing until at least one full local day of data exists.

## Frontend (typical availability map)

`frontend/` is a static site that reads the published `typical/v1/*.json` and shows each
station's chance of being empty (bikes) or full (docks) for any weekday and 15-minute
slot. Live at `https://jakaskerjanc.github.io/bicikelj-log/`. Design:
`docs/superpowers/specs/2026-10-01-typical-availability-frontend-design.md`.

```bash
cd frontend
npm ci
cp .env.example .env.local   # then fill in both values
npm run dev                  # http://localhost:5173/bicikelj-log/
npm test && npm run typecheck
```

Before the backend has published anything, use synthetic data:

```bash
npm run fake-data
VITE_DATA_BASE_URL=/bicikelj-log/dev-data/v1/ npm run dev
```

The `frontend` workflow tests every PR and deploys `main` to GitHub Pages. One-time setup:

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. Mapbox: create a public (`pk.`) token with URL restrictions
   `https://jakaskerjanc.github.io/bicikelj-log/` and `http://localhost:5173`.
3. Repo secret `MAPBOX_TOKEN` = that token; repo variable `DATA_BASE_URL` = the
   `publicBaseUrl` deployment output (ends in `/typical/v1/`).

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

A failed execution of either job (`bicikelj-log-job` or `bicikelj-typical-job`) emails
`ALERT_EMAIL` via an Azure Monitor alert on that job's `Executions` metric. Each job has
its own alert, but both notify the same action group, so no extra deploy parameters are
needed. The alerts are stateful (auto-resolve), so a sustained outage sends one email
when it fires and one when it resolves, not one per failed run.

Region defaults to `francecentral`: subscription policy allows only a few EU regions,
and `germanywestcentral` hits the Container Apps environment quota.

To preview or apply changes locally instead of via CI:

```bash
az deployment group create -g bicikelj-rg -f infra/main.bicep -p alertEmailAddress=you@example.com
```
