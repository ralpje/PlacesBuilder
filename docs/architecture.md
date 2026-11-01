# Architecture

How Places Builder is put together, where data lives and which credentials exist. For the release process see [releasing.md](releasing.md); for the self-host setup see [self-hosting.md](self-hosting.md).

## Overview

```
Browser (React + MapLibre + pdf.js)
   |  HTTPS
   v
Azure App Service (Linux, Node 24)  --- App Service authentication ("Easy Auth", Entra ID)
   |   runs one Node process: static web app + JSON API (node:http, no framework)
   |
   |-- Azure Blob Storage   (managed identity, container "imdf")   all offices, floors, plans, members
   |-- Azure Maps           (managed identity, Data Reader)        satellite tiles
```

One package (`placesbuilder-<tag>.zip`, built from `dist/server` and `dist/web`) is the whole product. App Service runs it straight from the zip (`WEBSITE_RUN_FROM_PACKAGE` = URL of the release asset), so a release is "installed" by pointing the setting at another version.

## Code layout

| Path | What it holds |
| --- | --- |
| `src/shared` | Logic that runs in browser and server and is covered by tests: IMDF generation and validation (`imdf.ts`, `validate.ts`), Places CSV import (`csv.ts`, `places.ts`), geometry, georeferencing, matching rooms to Places items, shared types, the version stamp (`version.ts`). |
| `src/server` | HTTP server (`index.ts`), API routes (`api.ts`), authentication (`auth.ts`), configuration (`config.ts`), the repository over storage (`repo.ts`, `storage.ts`, `blobStorage.ts`), Azure Maps token proxy (`maps.ts`). |
| `src/web` | React app: shell, offices and the office editor. |
| `deploy/main.bicep` | The self-host template (Deploy to Azure button). |
| `scripts/` | `configure-auth.ps1` (self-host sign-in), build scripts. |

## Request flow

1. The browser calls the site. App Service authentication signs the user in with Entra ID and passes the identity to the app in the `X-MS-CLIENT-PRINCIPAL` header (the app is never reachable without it in production; `/healthz` is the only excluded path).
2. `auth.ts` decodes the principal: user id = `oid` claim, tenant = `tid` claim, issuer must belong to that tenant, personal Microsoft accounts are refused. The access policy then applies: `ALLOWED_TENANT_IDS`, and the optional group, user and role lists.
3. The API routes work on one repository that sits on the storage layer. Everyone who is let in works in the same workspace.
4. The repository reads and writes JSON and image blobs through a storage interface. Locally that is the `.data/` folder; in Azure it is Blob Storage with the web app's managed identity. No storage keys exist (`allowSharedKeyAccess: false`).

## Data

Everyone who is let in shares one workspace. Blob layout in the container `imdf`:

```
offices/<officeId>/office.json
offices/<officeId>/floors/<floorId>/floor.json
offices/<officeId>/floors/<floorId>/plan.png          rendered plan
offices/<officeId>/floors/<floorId>/original.bin      the uploaded file
```

Identity is the Entra object id (`oid` claim), never the e-mail address or UPN. Soft delete and versioning on the container allow recovery of deleted or overwritten items.

## Limits

Optional limits protect storage and cost. All are off by default and are set with app settings (see the configuration table in the README):

| Setting | Limit |
| --- | --- |
| `MAX_OFFICES` | Number of offices in the workspace |
| `MAX_FLOORS_PER_OFFICE` | Number of floors in one office |
| `MAX_UPLOAD_MB` | Size of one uploaded file (plan image or original). The built-in ceilings (25 MB for a plan image, 40 MB for an original) stay in force; this setting can only lower them |
| `MAX_STORAGE_MB` | Total size of all stored files of the workspace |

The repository layer enforces them, so every route is covered: creating an office or floor, and uploading a plan image or an original. A request over a limit is refused with HTTP 403 (count and storage) or 413 (file size) and a message that names the limit. Replacing a file does not count twice. The storage total is read from the storage listing when a file is uploaded, so two uploads at the very same moment can pass the check together and exceed the limit slightly; the next upload is refused. `/api/config` returns the active limits.

### Request limits

Two more optional settings limit how fast one signed-in user can call the server, which keeps the cost of the map service under control:

| Setting | Limit |
| --- | --- |
| `RATE_LIMIT_PER_MINUTE` | API requests per user per minute (map tiles are not counted here; `/api/config` is never limited) |
| `TILE_LIMIT_PER_HOUR` | Map tile requests per user per hour |

Both are off by default. A request over a limit gets HTTP 429 with a `Retry-After` header (seconds) and a JSON message. The counters are fixed windows kept in memory per server process, so they reset on a restart and are not shared between several instances; with N instances a user can reach roughly N times the limit. Users are told apart by tenant and object ID when available, never by e-mail. The map in the editor shows a notice when tiles are refused.

## Credentials and secrets (self-host kit)

| What | Where it lives | Notes |
| --- | --- | --- |
| Storage access | Web app system-assigned managed identity, role *Storage Blob Data Contributor* | No keys, no connection strings |
| Azure Maps access | Same identity, role *Azure Maps Data Reader* | Maps account has local auth disabled |
| Entra client secret (sign-in) | App setting `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` | Written by `configure-auth.ps1`; valid 2 years; rerun the script to rotate |
| Package location | App setting `WEBSITE_RUN_FROM_PACKAGE` | A public URL, no credential |

The script never prints the secret. Nothing secret is part of the repository or the release.
