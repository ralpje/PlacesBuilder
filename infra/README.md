# Deploying to Azure

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fralpje%2FPlacesBuilder%2Fmain%2Finfra%2Fazuredeploy.json)

(The button works for other people only while the repository is public.)

## What gets created
Storage account (private, no keys), Linux App Service plan + Web App (Node 22, managed identity), Azure Maps account (satellite tiles, Entra auth only), and the role assignments the app needs. You need Owner or User Access Administrator on the resource group to deploy it.

## Steps
1. Click the button, choose a resource group and a unique `siteName`, deploy.
2. Run `scripts/configure-auth.ps1 -ResourceGroup <rg> -SiteName <name> [-AllowedGroupId <guid>]` in Azure Cloud Shell or a local PowerShell with Azure CLI. It creates the Entra app registration, switches on App Service authentication, requires user assignment and stores the secret.
3. Add users or a group under Entra → Enterprise applications → (your app) → Users and groups.

Until step 2 is done the app answers every request with 503. Authentication is never optional.

## Updates
The app runs from `packageUrl` (default: the latest GitHub release asset `app.zip`, built by `.github/workflows/release.yml` on every push to `main`). The file is fetched again on each restart, so **restart the web app to update** (Portal → Restart, or `az webapp restart`). To follow your own fork, change `packageUrl` to your fork's release URL. To pin a version, use a tagged release URL.
