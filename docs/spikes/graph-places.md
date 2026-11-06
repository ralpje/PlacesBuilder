# Spike: Places through Microsoft Graph (issue #53, phase 0)

Goal: settle the open points before building phases 2 and 3. Use a **test tenant** and a **test building** that has no map you care about. Run it with an account that has the Exchange Administrator role (or Places Administrator, to see whether that is enough).

Results go into `docs/OPEN-QUESTIONS.md`. **Redact before pasting anywhere public**: replace tenant ids, building ids, names and addresses. Paste response *shapes* (property names, types, status codes, error texts), not data.

Everything below runs in PowerShell 7 on any OS. Nothing here is used by the app.

## 0. Setup

```powershell
Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
Connect-MgGraph -Scopes 'Place.Read.All'
(Get-MgContext).Scopes
```

Note: did the sign-in ask for **admin approval**, or did it work with only your own consent? Which scopes are listed?

Buildings must be enabled once (skip if done): `Set-PlacesSettings -EnableBuildings 'Default:true'` (MicrosoftPlaces module).

## 1. List buildings

```powershell
$u = 'https://graph.microsoft.com/v1.0/places/microsoft.graph.building?$select=id,displayName,placeId,geoCoordinates,address'
$r = Invoke-MgGraphRequest -Uri $u
$r.value.Count; $r.value | Select-Object -First 1 | ConvertTo-Json -Depth 5
$r.Keys   # is there '@odata.nextLink'?
```

Record: the property names returned; whether `id` and `placeId` are different values; whether the list is empty when buildings are not enabled (optional: test before the Set-PlacesSettings step).

## 2. Items below a building

Pick a building and set `$b` to its `id`. Compare with `Get-PlaceV3 -AncestorId <PlaceId> | Export-Csv` of the same building.

```powershell
$b = '<building id from step 1>'
foreach ($t in 'floor','section','room','workspace','desk') {
  $x = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/places/$b/descendants/microsoft.graph.$t"
  "{0}: {1} items, nextLink: {2}" -f $t, $x.value.Count, [bool]$x.'@odata.nextLink'
  $x.value | Select-Object -First 1 | ConvertTo-Json -Depth 5
}
```

Record, per type: property names (is there `sortOrder` on floors, `capacity` on rooms, a parent id?), whether the `id` equals the CSV `PlaceId` or something else (this decides which value goes in `directory_id`), and whether the counts equal the CSV. If a type fails (400/404), note the exact error.

## 3. Paging and the 2,500 limit

Only if a building has many items: does `@odata.nextLink` appear, and does following it work (`Invoke-MgGraphRequest -Uri $x.'@odata.nextLink'`)? Otherwise note that you could not test it.

## 4. Write permission

```powershell
Disconnect-MgGraph
Connect-MgGraph -Scopes 'Place.ReadWrite.All'
```

Record: did consent need an admin? Does it work for the account without the Exchange Administrator role (if you have such a test account)?

## 5. Dry run and error shapes

Use a zip from Places Builder for that building (the real export).

```powershell
$zip = '<path to the downloaded zip>'
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))
$pid2 = '<building PlaceId>'   # check: does the URL take id or placeId? try both
$uri = "https://graph.microsoft.com/v1.0/places/$pid2/microsoft.graph.building/ingestMapFile"

$body = @{ file = $b64; importSettings = @{ isDryRun = $true } } | ConvertTo-Json -Depth 4
try { Invoke-MgGraphRequest -Method POST -Uri $uri -Body $body -ContentType 'application/json' -OutputType HttpResponseMessage |
      ForEach-Object { $_.StatusCode; $_.Content.ReadAsStringAsync().Result } }
catch { $_.ErrorDetails.Message }
```

Record: status code, body, which id the URL accepts. If you get a 400 about the setting, repeat with the key `importSetting` instead of `importSettings`, and note which one works.

Error shapes (still with `isDryRun = $true`), record the status and message of each:
1. A file that is not a zip (base64 of a text file).
2. A zip with a broken package (for example without `venue.geojson`).
3. A zip for a different building than the one in the URL.

## 6. Real import

Same call with `isDryRun = $false`. Record: status (expected 204), how long until the map shows in Places, and whether the dry run said anything the real run did not.

## 7. Second import without removing the map

Run step 6 again with a changed zip (move one unit). Record: does it **replace**, **merge**, or **fail**, and the message.

## 8. Removing a map

Does Graph have a call for it? Try (these are guesses, record the outcome of each, including 404):

```powershell
Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/beta/places/$pid2/microsoft.graph.building/map"
```

If nothing works, `Remove-Map -BuildingId <PlaceId>` stays the way and the app will say so.

## 9. Size (optional)

Upload larger zips (about 5 MB, 20 MB) with `isDryRun = $true`. Record the first size that fails and the error.

## Results

| # | Question | Result |
| --- | --- | --- |
| 0 | Admin consent needed for `Place.Read.All`? | |
| 1 | Properties on buildings; `id` vs `placeId` | |
| 2 | Which id equals the CSV PlaceId; floor `sortOrder`, room `capacity` present | |
| 3 | Paging with `nextLink` | |
| 4 | Admin consent for `Place.ReadWrite.All`; works without the role? | |
| 5 | URL id type; `importSettings` or `importSetting`; error shapes | |
| 6 | Real import: status, delay | |
| 7 | Second import: replace, merge or fail | |
| 8 | Removing a map through Graph | |
| 9 | Size limit | |
