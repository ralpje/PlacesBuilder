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
| `src/server` | HTTP server (`index.ts`), API routes (`api.ts`), authentication (`auth.ts`), configuration (`config.ts`), workspaces and tenant isolation (`workspaces.ts`), the repository over storage (`repo.ts`, `storage.ts`, `blobStorage.ts`), Azure Maps token proxy (`maps.ts`). |
| `src/web` | React app: shell, offices, office editor, team page, no-access page. |
| `deploy/main.bicep` | The self-host template (Deploy to Azure button). |
| `scripts/` | `configure-auth.ps1` (self-host sign-in), build scripts. |

## Request flow

1. The browser calls the site. App Service authentication signs the user in with Entra ID and passes the identity to the app in the `X-MS-CLIENT-PRINCIPAL` header (the app is never reachable without it in production; `/healthz` is the only excluded path).
2. `auth.ts` decodes the principal: user id = `oid` claim, tenant = `tid` claim, issuer must belong to that tenant, personal Microsoft accounts are refused. Self-host additionally applies the access policy (`ALLOWED_TENANT_IDS`, groups, users, roles); the hosted edition does not use that policy.
3. `workspaces.resolve(user)` chooses the workspace (see below). Every data route works on the repository of that workspace only.
4. The repository reads and writes JSON and image blobs through a storage interface. Locally that is the `.data/` folder; in Azure it is Blob Storage with the web app's managed identity. No storage keys exist (`allowSharedKeyAccess: false`).

## Editions and workspaces

The same code runs in two editions, selected by `EDITION`:

| | `selfhost` (default) | `hosted` |
| --- | --- | --- |
| Workspace | One shared workspace for everyone who is let in | One per Entra tenant (workspace id = tenant id) |
| Who gets in | Assignment in Entra, plus optional group/user/role lists and `ALLOWED_TENANT_IDS` | Any work or school account; the first user of a tenant becomes owner; others need an invitation |
| Identity | `oid` | `tid` + `oid`, never e-mail or UPN |
| Entra app registration | Single tenant | Multi-tenant (`organizations` issuer) |

Tenant isolation is enforced in the repository layer, not in the routes: `PrefixedStorage` confines a workspace to its key prefix and rejects `.` and `..` segments. Every route has a cross-tenant test (`test/workspaces.test.ts`).

### Blob layout

Self-host (`SingleWorkspace`):

```
offices/<officeId>/office.json
offices/<officeId>/floors/<floorId>/floor.json
offices/<officeId>/floors/<floorId>/plan.png          rendered plan
offices/<officeId>/floors/<floorId>/original.bin      the uploaded file
```

Hosted (`TenantWorkspaces`), all under a tenant prefix:

```
tenants/<tid>/tenant.json                  owner hint (masked), created time
tenants/<tid>/members/<oid>.json           role: owner | member
tenants/<tid>/invites/<sha256(email)[:32]>.json
tenants/<tid>/data/offices/...             same layout as above
```

The first user of a tenant is written with a conditional create (`If-None-Match: *`), so exactly one user wins when two sign in at the same moment. Invitations are matched on the lower-cased sign-in address. A workspace has at most 25 members plus open invitations. Only masked owner details are ever stored or shown to other users of the tenant.

## Credentials and secrets (self-host kit)

| What | Where it lives | Notes |
| --- | --- | --- |
| Storage access | Web app system-assigned managed identity, role *Storage Blob Data Contributor* | No keys, no connection strings |
| Azure Maps access | Same identity, role *Azure Maps Data Reader* | Maps account has local auth disabled |
| Entra client secret (sign-in) | App setting `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` | Written by `configure-auth.ps1`; valid 2 years; rerun the script to rotate |
| Package location | App setting `WEBSITE_RUN_FROM_PACKAGE` | A public URL, no credential |

The script never prints the secret. Nothing secret is part of the repository or the release.

## Extension points

The core exposes interfaces so that a hosted edition can live in a separate repository without copying core code: the workspace resolver (`Workspaces` / `Workspace` in `workspaces.ts`), the sign-in and tenant checks, and the optional workspace admin routes (`/api/workspace`, present only when the resolver offers `admin`). Billing, quotas and hosted infrastructure are not part of this repository.
