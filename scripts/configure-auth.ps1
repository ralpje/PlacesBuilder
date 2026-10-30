<#
 Creates (or reuses) the Entra app registration for the web app and switches on App Service authentication.
 Run in Azure Cloud Shell (PowerShell) or locally after `az login`. Needs rights to create app registrations.
 Safe to run again: an existing registration with the same name is reused and gets a new secret.
#>
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $SiteName,
  [string] $AllowedGroupId = ''
)
$ErrorActionPreference = 'Stop'

# az is a native command: PowerShell does not stop on its errors, so check each call.
function Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit code $LASTEXITCODE)." }
  return $out
}

az config set extension.use_dynamic_install=yes_without_prompt extension.dynamic_install_allow_preview=true 2>$null | Out-Null
$tenant = Az account show --query tenantId -o tsv
$redirect = "https://$SiteName.azurewebsites.net/.auth/login/aad/callback"
$name = "IMDF Builder ($SiteName)"

$appId = Az ad app list --display-name $name --query "[0].appId" -o tsv
if (-not $appId) {
  $appId = Az ad app create --display-name $name --sign-in-audience AzureADMyOrg --web-redirect-uris $redirect --enable-id-token-issuance true --query appId -o tsv
}
$sp = Az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
if (-not $sp) { $sp = Az ad sp create --id $appId --query id -o tsv }
Az ad app update --id $appId --set groupMembershipClaims=SecurityGroup | Out-Null
Az ad sp update --id $sp --set appRoleAssignmentRequired=true | Out-Null   # only assigned users and groups can sign in
$secret = Az ad app credential reset --id $appId --display-name "app-service" --years 2 --query password -o tsv

# Sites created from the template may still use the old (v1) auth settings model.
Az webapp auth config-version upgrade -g $ResourceGroup -n $SiteName 2>$null | Out-Null
$global:LASTEXITCODE = 0   # the upgrade fails harmlessly when the app already uses v2

Az webapp auth microsoft update -g $ResourceGroup -n $SiteName --client-id $appId --client-secret $secret `
  --issuer "https://login.microsoftonline.com/$tenant/v2.0" --yes | Out-Null
Az webapp auth update -g $ResourceGroup -n $SiteName --enabled true --action RedirectToLoginPage `
  --redirect-provider azureactivedirectory --excluded-paths "/healthz" | Out-Null

# Second check inside the app. Without a group, every user that Entra lets in is accepted.
if ($AllowedGroupId) {
  Az webapp config appsettings set -g $ResourceGroup -n $SiteName --settings ALLOWED_GROUP_IDS=$AllowedGroupId ALLOW_ANY_AUTHENTICATED=0 | Out-Null
  $body = @{ principalId = $AllowedGroupId; resourceId = $sp; appRoleId = '00000000-0000-0000-0000-000000000000' } | ConvertTo-Json -Compress
  $body | Az rest --method POST --uri "https://graph.microsoft.com/v1.0/groups/$AllowedGroupId/appRoleAssignments" --headers "Content-Type=application/json" --body '@-' | Out-Null
} else {
  Az webapp config appsettings set -g $ResourceGroup -n $SiteName --settings ALLOW_ANY_AUTHENTICATED=1 | Out-Null
}
Write-Host "Done. Client ID: $appId"
Write-Host "Assign users or groups: Entra > Enterprise applications > $name. Then open https://$SiteName.azurewebsites.net"
