# Places Builder

Convert PDF, PNG or JPG floor plans into IMDF packages for Microsoft Places.

Create offices with multiple floors, import the room list exported from Microsoft Places, align each plan on a satellite map, trace the rooms and match them to Places items. Then download the IMDF zip.

> **Status: early development.** The core editor works. IMDF details for Places are not yet verified against a real import (see [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md)). Expect changes.

## Run locally

Requires Node 22 or newer (releases are built and run on Node 24).

```
npm install
npm test
DEV_AUTH=1 npm run dev:server   # API on :3000, data in .data/
npm run dev:web                 # UI on :5173
```

## Build

```
npm run build && npm start
```

## Configuration

| Setting | Purpose |
| --- | --- |
| `STORAGE_ACCOUNT_URL`, `STORAGE_CONTAINER` | Azure Blob Storage (managed identity). Without it, data is kept in `.data/`. |
| `AZURE_MAPS_CLIENT_ID` / `AZURE_MAPS_KEY`, `BASEMAP` | Satellite basemap (`azure`, `osm` for development only, or `none`). |
| `ALLOWED_GROUP_IDS`, `ALLOWED_ROLES`, `ALLOWED_USER_IDS`, `ALLOW_ANY_AUTHENTICATED` | Access check on top of App Service authentication. |
| `ALLOWED_TENANT_IDS` | Only users of these Entra tenants are let in (the template sets your own tenant). Personal Microsoft accounts are always refused. |
| `DEV_AUTH` | Local development only. The server refuses to start with it in production. |

Want to run it yourself in Azure? See [docs/self-hosting.md](docs/self-hosting.md).

How it works: [docs/architecture.md](docs/architecture.md). How releases and version tags work: [docs/releasing.md](docs/releasing.md).

## Feedback

- Found a bug? [Open an issue](../../issues/new/choose).
- Missing a feature? [Open a feature request](../../issues/new/choose).
- Security problem? See [SECURITY.md](SECURITY.md). Please do not open a public issue.

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GNU Affero General Public License v3.0 only. See `LICENSE`.

The name, logo and domain names are not covered by the licence. See [TRADEMARKS.md](TRADEMARKS.md). Places Builder is an independent project, not affiliated with Microsoft.
