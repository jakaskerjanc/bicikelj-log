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

var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

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
    description: 'Fires when the ${jobName} container job has a failed execution. Evaluated hourly and auto-resolves, so at most ~1-2 emails/hour during a sustained outage.'
    severity: 2
    enabled: true
    scopes: [
      job.id
    ]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
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
