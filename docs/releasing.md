# Releases and versions

## Version tags

Versions are git tags of the form `vMAJOR.MINOR.PATCH` (for example `v0.2.1`). While the major version is 0, minor versions may change behaviour or data handling; patch versions are fixes. Every tag is a release: there is no separate "build" and "release" step to keep in sync. The tag is the single source of the version.

## What a tag does

Pushing a tag (`git tag v0.2.2 && git push origin v0.2.2`; maintainers only) starts the **Release** workflow:

1. Installs, runs tests and typecheck on Node 24.
2. Builds with `APP_VERSION=<tag>`. The tag is stamped into the web app and the server (`__APP_VERSION__`, see `src/shared/version.ts`). The sidebar footer shows it (and the server version if it ever differs); `/api/config` returns the server version. Bug reports ask for that version.
3. Zips `dist/server` and `dist/web` as `placesbuilder-<tag>.zip`.
4. Stamps the tag into `deploy/main.bicep` (`param appVersion`) and compiles it to `azuredeploy.json`.
5. Publishes the GitHub release with four assets: the zip, `azuredeploy.json`, `configure-auth.ps1` and `SHA256SUMS` (checksums of the three files). If a release for the tag already exists (made in the UI), the assets are attached to it.
6. Force-pushes `azuredeploy.json` to the branch `deploy-template`. The Deploy to Azure button reads the template from there, because the portal fetches it in the browser and GitHub release downloads have no CORS headers.

Normal pull requests never publish anything. The rule is: no direct commits to `main`; changes go through a pull request with passing CI (tests, typecheck, build, Bicep compile and lint) and a signed CLA.

## How each edition picks up a release

**Self-host.** A release is not pushed to anyone. An administrator moves their site to it by changing one setting (see [self-hosting.md](self-hosting.md#updating)):

```powershell
az webapp config appsettings set -g <rg> -n <site> `
  --settings WEBSITE_RUN_FROM_PACKAGE=https://github.com/ralpje/placesbuilder/releases/download/<tag>/placesbuilder-<tag>.zip
```

The app restarts on that package. Going back is the same command with the old tag. Data lives in the storage account and is not touched. A new deployment from the template uses the `appVersion` that was stamped into it; the "latest" template links always point at the newest release.

**Hosted edition (separate private repository).** The hosted service pins a release tag in a file (`CORE_VERSION`) and runs exactly that package. A scheduled job there opens a pull request when a newer release exists; merging it starts the hosted pipeline: verify the release (checksum, and this repository's tests at that tag, including tenant isolation), deploy to staging, then production by a manual run. Rolling back is a manual run with an earlier tag. Nothing in this repository knows about the hosted pipeline; the only contract is the release assets above and the `EDITION=hosted` behaviour of the app.

So one change flows like this:

```
pull request -> CI -> merge to main -> tag vX.Y.Z -> Release workflow -> GitHub release (zip, template, checksums)
                                                                  |-> self-host: administrators change WEBSITE_RUN_FROM_PACKAGE when they choose
                                                                  |-> hosted: bump PR in the private repo -> staging -> production
```

## Dependencies

Dependabot proposes npm and GitHub Actions updates weekly. They are ordinary pull requests: they must pass CI before they are merged, and major upgrades can need code changes (maplibre-gl 6 and the move to named imports is an example).

## Runtime support

The release is built and deployed on Node 24 LTS; `engines` allows Node 22 or newer. Node 22 reaches end of life on 2027-04-30 and Node 24 on 2028-04-30: move the build, the Bicep `linuxFxVersion` and the docs together when that happens.
