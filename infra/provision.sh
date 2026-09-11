#!/usr/bin/env bash
set -euo pipefail

# --- Edit these ---
RG=bicikelj-rg
LOCATION=germanywestcentral          # policy-allowed region
STORAGE=bicikeljlog$RANDOM           # must be globally unique, lowercase
CONTAINER=bicikelj
ENV=bicikelj-env
JOB=bicikelj-log-job
IMAGE=ghcr.io/jakaskerjanc/bicikelj-log:latest

# --- Register providers (first time only) ---
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ManagedIdentity --wait

# --- Resource group ---
az group create -n "$RG" -l "$LOCATION"

# --- Storage account + blob container ---
az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --access-tier Hot
az storage container create --account-name "$STORAGE" -n "$CONTAINER" --auth-mode key

ACCOUNT_URL="https://$STORAGE.blob.core.windows.net"

# --- Container Apps environment ---
az containerapp env create -n "$ENV" -g "$RG" -l "$LOCATION"

# --- Scheduled job (every minute), system-assigned identity ---
az containerapp job create -n "$JOB" -g "$RG" --environment "$ENV" \
  --trigger-type Schedule --cron-expression "*/5 * * * *" \
  --replica-timeout 60 --replica-retry-limit 0 \
  --cpu 0.25 --memory 0.5Gi \
  --image "$IMAGE" \
  --mi-system-assigned \
  --env-vars "BICIKELJ_STORAGE_ACCOUNT_URL=$ACCOUNT_URL" "BICIKELJ_CONTAINER=$CONTAINER"

# --- Grant the job's identity write access to Blob ---
PRINCIPAL_ID=$(az containerapp job show -n "$JOB" -g "$RG" --query identity.principalId -o tsv)
STORAGE_ID=$(az storage account show -n "$STORAGE" -g "$RG" --query id -o tsv)
az role assignment create --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" --scope "$STORAGE_ID"

echo "Provisioned. Trigger a manual run with:"
echo "  az containerapp job start -n $JOB -g $RG"
