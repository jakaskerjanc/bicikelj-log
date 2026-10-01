@description('Azure region (subscription policy allows only a few EU regions; germanywestcentral hits MaxNumberOfEnvironmentsInSubExceeded for Container Apps)')
param location string = 'francecentral'

@description('Blob container name for the JSONL output')
param containerName string = 'bicikelj'

@description('Container Apps environment name')
param environmentName string = 'bicikelj-env'

@description('Container App Job name')
param jobName string = 'bicikelj-log-job'

@description('Container image to run')
param image string = 'ghcr.io/jakaskerjanc/bicikelj-log:latest'

@description('Cron expression for the polling schedule')
param cronExpression string = '*/5 * * * *'

@description('Storage account name (must be globally unique, 3-24 lowercase alphanumeric chars)')
param storageAccountName string = 'bicikelj${uniqueString(resourceGroup().id)}'

@description('Email address notified when the container job fails')
param alertEmailAddress string

@description('Container App Job name for the daily typical-availability build')
param typicalJobName string = 'bicikelj-typical-job'

@description('Cron expression (UTC) for the typical-availability build; 01:30 UTC is after local midnight in CET and CEST')
param typicalCronExpression string = '30 1 * * *'

@description('Public storage account for published profiles (3-24 lowercase alphanumeric chars)')
param publicStorageAccountName string = 'bicikeljpub${uniqueString(resourceGroup().id)}'

@description('Public blob container for published profiles')
param publicContainerName string = 'typical'

var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: containerName
}

resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppEnv.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 300
      replicaRetryLimit: 1
    }
    template: {
      containers: [
        {
          name: jobName
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'BICIKELJ_STORAGE_ACCOUNT_URL'
              value: 'https://${storage.name}.blob.core.windows.net'
            }
            {
              name: 'BICIKELJ_CONTAINER'
              value: containerName
            }
          ]
        }
      ]
    }
  }
}

resource blobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, job.id, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    principalId: job.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

resource alertActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${jobName}-alerts'
  location: 'global'
  properties: {
    groupShortName: 'bicikelj'
    enabled: true
    emailReceivers: [
      {
        name: 'owner'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

resource jobFailureAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${jobName}-failed-execution-alert'
  location: 'global'
  properties: {
    description: 'Fires when the ${jobName} container job has a failed execution. Stateful (auto-resolves), so one email per incident plus a resolved notice.'
    severity: 2
    enabled: true
    scopes: [
      job.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    targetResourceType: 'Microsoft.App/jobs'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'FailedExecutions'
          metricName: 'Executions'
          metricNamespace: 'Microsoft.App/jobs'
          dimensions: [
            {
              name: 'state'
              operator: 'Include'
              values: [
                'Failed'
              ]
            }
          ]
          operator: 'GreaterThanOrEqual'
          threshold: 1
          timeAggregation: 'Total'
        }
      ]
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: alertActionGroup.id
      }
    ]
  }
}

resource publicStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: publicStorageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // Only derived, public profiles live here; raw data stays in the private account.
    allowBlobPublicAccess: true
  }
}

resource publicBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: publicStorage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'HEAD']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource publicContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: publicBlobService
  name: publicContainerName
  properties: {
    publicAccess: 'Blob'
  }
}

resource typicalJob 'Microsoft.App/jobs@2024-03-01' = {
  name: typicalJobName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppEnv.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: typicalCronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 900
      replicaRetryLimit: 1
    }
    template: {
      containers: [
        {
          name: typicalJobName
          image: image
          command: ['python', '-m', 'bicikelj_log.build_typical']
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'BICIKELJ_STORAGE_ACCOUNT_URL'
              value: 'https://${storage.name}.blob.core.windows.net'
            }
            {
              name: 'BICIKELJ_CONTAINER'
              value: containerName
            }
            {
              name: 'BICIKELJ_PUBLIC_ACCOUNT_URL'
              value: 'https://${publicStorage.name}.blob.core.windows.net'
            }
            {
              name: 'BICIKELJ_PUBLIC_CONTAINER'
              value: publicContainerName
            }
          ]
        }
      ]
    }
  }
}

resource typicalRawReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, typicalJob.id, storageBlobDataReaderRoleId)
  scope: storage
  properties: {
    principalId: typicalJob.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
  }
}

resource typicalPublicContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(publicStorage.id, typicalJob.id, storageBlobDataContributorRoleId)
  scope: publicStorage
  properties: {
    principalId: typicalJob.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

resource typicalJobFailureAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${typicalJobName}-failed-execution-alert'
  location: 'global'
  properties: {
    description: 'Fires when the ${typicalJobName} container job has a failed execution. Stateful (auto-resolves), so one email per incident plus a resolved notice.'
    severity: 2
    enabled: true
    scopes: [
      typicalJob.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    targetResourceType: 'Microsoft.App/jobs'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'FailedExecutions'
          metricName: 'Executions'
          metricNamespace: 'Microsoft.App/jobs'
          dimensions: [
            {
              name: 'state'
              operator: 'Include'
              values: [
                'Failed'
              ]
            }
          ]
          operator: 'GreaterThanOrEqual'
          threshold: 1
          timeAggregation: 'Total'
        }
      ]
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: alertActionGroup.id
      }
    ]
  }
}

output storageAccountUrl string = 'https://${storage.name}.blob.core.windows.net'
output jobName string = job.name
output typicalJobName string = typicalJob.name
output publicBaseUrl string = 'https://${publicStorage.name}.blob.core.windows.net/${publicContainerName}/v1/'
