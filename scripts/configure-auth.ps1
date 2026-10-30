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

# Named Invoke-Az on purpose: PowerShell is case-insensitive, so a function called Az would call itself.
# az is a native command: PowerShell does not stop on its errors, so check each call.
function Invoke-Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit code $LASTEXITCODE)." }
  return $out
}

try { Invoke-Az config set extension.use_dynamic_install=yes_without_prompt | Out-Null } catch { }
$tenant = Invoke-Az account show --query tenantId -o tsv
$redirect = "https://$SiteName.azurewebsites.net/.auth/login/aad/callback"
$name = "IMDF Builder ($SiteName)"

$appId = Invoke-Az ad app list --display-name $name --query "[0].appId" -o tsv
if (-not $appId) {
  $appId = Invoke-Az ad app create --display-name $name --sign-in-audience AzureADMyOrg --web-redirect-uris $redirect --enable-id-token-issuance true --query appId -o tsv
}
$sp = Invoke-Az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
if (-not $sp) { $sp = Invoke-Az ad sp create --id $appId --query id -o tsv }
# Without this tag the portal hides the service principal from Enterprise applications.
Invoke-Az ad sp update --id $sp --set "tags=['WindowsAzureActiveDirectoryIntegratedApp']" | Out-Null
Invoke-Az ad app update --id $appId --set groupMembershipClaims=SecurityGroup | Out-Null
Invoke-Az ad sp update --id $sp --set appRoleAssignmentRequired=true | Out-Null   # only assigned users and groups can sign in
$secret = Invoke-Az ad app credential reset --id $appId --display-name "app-service" --years 2 --query password -o tsv

# Sites created from the template may still use the old (v1) auth settings model.
try { Invoke-Az webapp auth config-version upgrade -g $ResourceGroup -n $SiteName | Out-Null }
catch { Write-Host 'Auth settings are already on v2 (or could not be upgraded); continuing.' }

Invoke-Az webapp auth microsoft update -g $ResourceGroup -n $SiteName --client-id $appId --client-secret $secret `
  --issuer "https://login.microsoftonline.com/$tenant/v2.0" --yes | Out-Null
Invoke-Az webapp auth update -g $ResourceGroup -n $SiteName --enabled true --action RedirectToLoginPage `
  --redirect-provider azureactivedirectory --excluded-paths "/healthz" | Out-Null

# Second check inside the app. Without a group, every user that Entra lets in is accepted.
if ($AllowedGroupId) {
  Invoke-Az webapp config appsettings set -g $ResourceGroup -n $SiteName --settings ALLOWED_GROUP_IDS=$AllowedGroupId ALLOW_ANY_AUTHENTICATED=0 | Out-Null
  $body = @{ principalId = $AllowedGroupId; resourceId = $sp; appRoleId = '00000000-0000-0000-0000-000000000000' } | ConvertTo-Json -Compress
  $tmp = New-TemporaryFile
  Set-Content -Path $tmp -Value $body -Encoding utf8
  try {
    Invoke-Az rest --method POST --uri "https://graph.microsoft.com/v1.0/groups/$AllowedGroupId/appRoleAssignments" --headers "Content-Type=application/json" --body "@$($tmp.FullName)" | Out-Null
  } catch { Write-Warning "Could not assign the group to the app automatically. Add it under Enterprise applications > Users and groups. $_" }
  finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
} else {
  Invoke-Az webapp config appsettings set -g $ResourceGroup -n $SiteName --settings ALLOW_ANY_AUTHENTICATED=1 | Out-Null
}
Write-Host "Done. Client ID: $appId"
Write-Host "Assign users or groups: https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/Users/objectId/$sp/appId/$appId"
Write-Host "(or Entra > Enterprise applications > $name). Then open https://$SiteName.azurewebsites.net"
