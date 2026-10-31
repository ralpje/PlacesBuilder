// Places Builder: single-tenant self-host kit.
// Deploys a Linux Web App (Node 22) that runs a released app package, Blob Storage (managed identity, no keys)
// and an Azure Maps account for satellite imagery. Sign-in is added afterwards by scripts/configure-auth.ps1
// (or by passing entraClientId and entraClientSecret).

targetScope = 'resourceGroup'

@description('Globally unique web app name. The site becomes https://<siteName>.azurewebsites.net. Lowercase letters, digits and hyphens.')
@minLength(2)
@maxLength(40)
param siteName string

@description('Region for all resources.')
param location string = resourceGroup().location

@description('App Service plan size. B1 is enough for a handful of users.')
@allowed([ 'B1', 'B2', 'B3', 'P0v3', 'P1v3' ])
param planSku string = 'B1'

@description('Release of Places Builder to run, for example v0.1.3. Releases are published on GitHub.')
param appVersion string = 'v0.1.3'

@description('URL of the app package (zip). Normally derived from appVersion. The app runs straight from this file and fetches it again at every restart.')
param packageUrl string = 'https://github.com/ralpje/placesbuilder/releases/download/${appVersion}/placesbuilder-${appVersion}.zip'

@description('Optional. Client ID of an existing Entra app registration. Leave empty to run scripts/configure-auth.ps1 after deployment, which creates it for you.')
param entraClientId string = ''

@description('Client secret for the app registration above. Only needed together with entraClientId.')
@secure()
param entraClientSecret string = ''

@description('Comma-separated Entra group object IDs allowed to use the app. Needs the groups claim on the app registration.')
param allowedGroupIds string = ''

@description('Comma-separated Entra user object IDs allowed to use the app.')
param allowedUserIds string = ''

@description('Let every user of your tenant in. Only set this when the enterprise application has "Assignment required" = Yes. With no group, user or this switch the app denies everyone.')
param allowAnyTenantUser bool = false

var suffix = take(uniqueString(resourceGroup().id, siteName), 6)
var planName = 'plan-${siteName}'
var storageName = toLower(take('st${replace(siteName, '-', '')}${suffix}', 24))
var mapsName = 'maps-${siteName}'
var containerName = 'imdf'
var storageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var mapsDataReader = '423170ca-a8f6-4b0f-8487-9e4eb8f49bfa'
var hasAuth = !empty(entraClientId) && !empty(entraClientSecret)

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
    isVersioningEnabled: true
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: { publicAccess: 'None' }
}

resource maps 'Microsoft.Maps/accounts@2023-06-01' = {
  name: mapsName
  location: 'global'
  sku: { name: 'G2' }
  kind: 'Gen2'
  properties: { disableLocalAuth: true }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: { name: planSku }
  properties: { reserved: true }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: siteName
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node server/index.mjs'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/healthz'
    }
  }
}

var baseSettings = {
  WEBSITE_RUN_FROM_PACKAGE: packageUrl
  NODE_ENV: 'production'
  STORAGE_CONTAINER: containerName
  STORAGE_ACCOUNT_URL: storage.properties.primaryEndpoints.blob
  BASEMAP: 'azure'
  AZURE_MAPS_CLIENT_ID: maps.properties.uniqueId
  ALLOWED_GROUP_IDS: allowedGroupIds
  ALLOWED_USER_IDS: allowedUserIds
  ALLOW_ANY_AUTHENTICATED: allowAnyTenantUser ? '1' : '0'
}
var authSettings = hasAuth ? { MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: entraClientSecret } : {}

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: union(baseSettings, authSettings)
}

resource authSettingsV2 'Microsoft.Web/sites/config@2023-12-01' = if (hasAuth) {
  parent: site
  name: 'authsettingsV2'
  dependsOn: [ appSettings ]
  properties: {
    platform: { enabled: true, runtimeVersion: '~1' }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: [ '/healthz' ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
          clientId: entraClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
        }
        validation: { allowedAudiences: [ 'api://${entraClientId}', entraClientId ] }
      }
    }
    login: { tokenStore: { enabled: false } }
  }
}

resource storageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, site.id, storageBlobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributor)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource mapsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: maps
  name: guid(maps.id, site.id, mapsDataReader)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', mapsDataReader)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output siteName string = site.name
output siteUrl string = 'https://${site.properties.defaultHostName}'
output storageAccount string = storage.name
