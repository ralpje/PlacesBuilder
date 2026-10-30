# IMDF Builder for Places

Web app that turns PDF/PNG/JPG floor plans into IMDF zip packages for Microsoft Places. Runs as an Azure Web App (Node 22), signs in through Entra ID (Easy Auth), stores data in Azure Blob Storage.

## Run locally
    npm install
    npm test                 # pure-logic tests (no packages needed)
    DEV_AUTH=1 npm run dev:server   # API on :3000, data in .data/
    npm run dev:web                 # UI on :5173, proxies /api

## Build and start
    npm run build && npm start

## App Service settings
- Runtime Node 22, startup `npm start` (or deploy `dist/` + package.json).
- Authentication: Microsoft Entra provider, "Require authentication". In the enterprise app set **Assignment required = Yes** and assign a group.
- Second check (fails closed): `ALLOWED_GROUP_IDS`, `ALLOWED_ROLES` or `ALLOWED_USER_IDS`; or `ALLOW_ANY_AUTHENTICATED=1` to rely on assignment alone. (Group claims must be added to the token.)
- Storage: `STORAGE_ACCOUNT_URL=https://<account>.blob.core.windows.net`, `STORAGE_CONTAINER=imdf`; give the web app's managed identity **Storage Blob Data Contributor**.
- Basemap: Azure Maps account (S1) with `AZURE_MAPS_CLIENT_ID` (managed identity needs "Azure Maps Data Reader") or `AZURE_MAPS_KEY`; `BASEMAP=azure|osm|none`. OSM is for development only.
- Never set `DEV_AUTH` in production (the server refuses to start).

## Workflow
Create office → upload Places export (floors are created) → per floor: prepare plan, position on map, trace and match → Check → download IMDF zip (+ correlation CSV).

## Unverified
IMDF details for Places (categories, section/desk representation, fixture rotation) come from public docs and must be tested with a real import. See docs/OPEN-QUESTIONS.md.
