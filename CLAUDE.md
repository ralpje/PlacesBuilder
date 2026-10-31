# Places Builder (public repo)

Web app: floor plan (PDF/PNG/JPG) to IMDF zip for Microsoft Places. TypeScript, React, Vite, node:http server, Azure Blob Storage.

## Commands
- `npm test` (node test runner, no extra packages needed for the logic tests)
- `npm run typecheck`, `npm run build`

## Rules
- This repo is public. No secrets, tenant data, customer data or private business plans.
- Hosted-only features (billing, admin, hosted infra) belong in the private repo ralpje/placesbuilder-online, not here. Core code exposes extension points instead.
- Identity is keyed by Entra `tid` + `oid`, never email or UPN.
- Tenant isolation is enforced in the repository layer; every route needs a cross-tenant test.
- Changes go through a branch and a pull request. No direct commits to main.
- IMDF assumptions that are unverified are listed in docs/OPEN-QUESTIONS.md. Keep it current.
