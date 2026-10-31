# Host Places Builder in your own Azure tenant

You get your own private copy: one web app, one storage account and one Azure Maps account in your subscription. Only people you assign can sign in. Nothing is shared with anyone else.

You need an Azure subscription, permission to create resources (Contributor on a resource group) and permission to create an Entra app registration (for example Application Developer). Use the Azure Cloud Shell in PowerShell mode, or PowerShell with the Azure CLI (`az login`).

## 1. Deploy the resources

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fralpje%2Fplacesbuilder%2Fdeploy-template%2Fazuredeploy.json)

Choose or create a resource group and pick a globally unique **Site name**. Write both down: the next steps use them as `<your-resource-group>` and `<your-unique-name>`. Replace everything between `<` and `>` with your own value. Leave the sign-in fields empty for now. Deployment takes a few minutes.

Prefer the command line?

```powershell
az group create -n <your-resource-group> -l <region, for example westeurope>
az deployment group create -g <your-resource-group> `
  --template-uri https://github.com/ralpje/placesbuilder/releases/latest/download/azuredeploy.json `
```

## 2. Set up sign-in

```powershell
Invoke-WebRequest https://github.com/ralpje/placesbuilder/releases/latest/download/configure-auth.ps1 -OutFile configure-auth.ps1
./configure-auth.ps1 -ResourceGroup <your-resource-group> -SiteName <your-unique-name> -AllowedGroupId <optional group object id>
```

The script creates the app registration, requires assignment, turns on App Service authentication and prints a link. You can run it again safely.

## 3. Give people access

In Entra, open **Enterprise applications**, find "Places Builder (<site name>)", then **Users and groups** and add the people or a group. If Entra asks for admin approval at first sign-in, a Global Administrator can grant it under **Permissions** on the same enterprise application.

Open `https://<your-unique-name>.azurewebsites.net`.

## Updating

Each release on GitHub has a version such as `v0.2.0`. To move to it, point the app at that package:

```powershell
az webapp config appsettings set -g <your-resource-group> -n <your-unique-name> `
  --settings WEBSITE_RUN_FROM_PACKAGE=https://github.com/ralpje/placesbuilder/releases/download/v0.2.0/placesbuilder-v0.2.0.zip
```

The app restarts on the new version. To go back, set the old version again. Your data is in the storage account and is not touched by updates.

## Costs and data

You pay Azure for the App Service plan (B1 by default), the storage account and Azure Maps usage. Floor plans and offices are stored in the `imdf` container with versioning and 14-day soft delete turned on. Access uses the web app's managed identity, not keys.

## Status

This kit is new and has not been tested by many people yet. Please report problems as an issue.

## Using the maps in Microsoft Places

After exporting from Places Builder, upload the zip with Places PowerShell (Exchange or Places administrator; one building per zip):

```powershell
New-Map -BuildingId <building PlaceId> -FilePath "<path to the downloaded zip>"
```

The Places IDs are already inside the zip. A map can take up to an hour to appear. To replace a map, run `Remove-Map -BuildingId <building PlaceId>` first. Every floor must have a unique SortOrder in Places that equals the floor ordinal in Places Builder.
