<#
 Creates the Entra app registration for the web app and switches on App Service authentication.
 Run in Azure Cloud Shell (PowerShell) or locally after `az login`. Needs rights to create app registrations.
#>
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $SiteName,
  [string] $AllowedGroupId = ''
)
$ErrorActionPreference = 'Stop'
$tenant = az account show --query tenantId -o tsv
$redirect = "https://$SiteName.azurewebsites.net/.auth/login/aad/callback"

$appId = az ad app create --display-name "IMDF Builder ($SiteName)" --sign-in-audience AzureADMyOrg `
  --web-redirect-uris $redirect --enable-id-token-issuance true --query appId -o tsv
$sp = az ad sp create --id $appId --query id -o tsv
az ad app update --id $appId --set groupMembershipClaims=SecurityGroup | Out-Null
az ad sp update --id $sp --set appRoleAssignmentRequired=true | Out-Null   # only assigned users and groups can sign in
$secret = az ad app credential reset --id $appId --display-name "app-service" --years 2 --query password -o tsv

az webapp auth microsoft update -g $ResourceGroup -n $SiteName --client-id $appId --client-secret $secret `
  --issuer "https://login.microsoftonline.com/$tenant/v2.0" --yes | Out-Null
az webapp auth update -g $ResourceGroup -n $SiteName --enabled true --action RedirectToLoginPage `
  --redirect-provider azureactivedirectory --excluded-paths "/healthz" | Out-Null

# Second check inside the app. Without any group, the tenant users that Entra lets in are accepted.
if ($AllowedGroupId) {
  az webapp config appsettings set -g $ResourceGroup -n $SiteName --settings ALLOWED_GROUP_IDS=$AllowedGroupId | Out-Null
  $body = @{ principalId = $AllowedGroupId; resourceId = $sp; appRoleId = '00000000-0000-0000-0000-000000000000' } | ConvertTo-Json -Compress
  $body | az rest --method POST --uri "https://graph.microsoft.com/v1.0/groups/$AllowedGroupId/appRoleAssignments" --headers "Content-Type=application/json" --body '@-' | Out-Null
} else {
  az webapp config appsettings set -g $ResourceGroup -n $SiteName --settings ALLOW_ANY_AUTHENTICATED=1 | Out-Null
}
Write-Host "Done. Client ID: $appId"
Write-Host "Assign users or groups: Entra > Enterprise applications > IMDF Builder ($SiteName). Open https://$SiteName.azurewebsites.net"
