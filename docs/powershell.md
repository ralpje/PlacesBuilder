# Places PowerShell commands

Places Builder does not talk to Microsoft Places. You move data between the two with the Places PowerShell module. The same commands are in the app, on the office page under "PowerShell commands for Places", with your building id filled in and a copy button per command. They are generated from `src/shared/psCommands.ts`; keep this page in sync with that file.

Requirements: PowerShell 7.4 or later, and the Places Administrator or Exchange Administrator role.

## One time

```powershell
Install-Module -Name MicrosoftPlaces -Force
Connect-MicrosoftPlaces
```

Turn on buildings once per tenant. Without this, Places returns no buildings and no floors:

```powershell
Set-PlacesSettings -EnableBuildings 'Default:true'
```

## Before mapping: get the items

Find your building and copy its PlaceId:

```powershell
Get-PlaceV3 -Type Building | Format-Table DisplayName, PlaceId
```

Export the building with everything below it, then upload `places.csv` on the office page:

```powershell
Get-PlaceV3 -AncestorId '<building PlaceId>' | Export-Csv -Path places.csv -NoTypeInformation
```

The export also holds booking policies and delegates. Places Builder keeps only names, types, parents, capacity, floor order and the address, and drops the rest while reading the file.

## After mapping: put the map into Places

One map per building, one building per zip. To replace an existing map, remove it first:

```powershell
Remove-Map -BuildingId '<building PlaceId>'
New-Map -BuildingId '<building PlaceId>' -FilePath '<path to the downloaded zip>'
```

The zip already contains the Places IDs, so no correlation step is needed. A map can take up to an hour to appear. Every floor needs a unique SortOrder in Places that equals the floor ordinal in Places Builder.

## Fallback: if New-Map rejects the zip

Download `mapfeatures.csv` from the office page (already filled in), then:

```powershell
Import-MapCorrelations -MapFilePath '<path to the zip>' -CorrelationsFilePath '<path to mapfeatures.csv>'
```

Run `New-Map` with the `imdf_correlated.zip` that this produces.

## Later

Issue #53 plans reading and writing through Microsoft Graph so these steps can be done from the app. These commands stay available for people who do not want that.
