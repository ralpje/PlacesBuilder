# Contributing

Thanks for helping. Bug reports, feature requests and pull requests are welcome.

## Before you start
- Search existing issues first.
- For larger changes, open an issue to discuss the idea before writing code.

## Development
```
npm install
npm test
npm run typecheck
```
Pull requests need passing tests and typecheck. Keep changes focused. Add tests for new logic in `src/shared` and `src/server`.

## Do not include
Real floor plans, Places exports or tenant data of your organisation. Use made-up sample data.

## Licensing of contributions
The project is licensed under AGPL-3.0-only. Contributions may need a signed contributor license agreement (CLA) so the maintainer can also offer the software under other terms (for example a hosted service). A CLA bot will explain this on your first pull request once it is set up.

## Releases
Maintainers publish a release by pushing a tag, for example `git tag v0.2.0 && git push origin v0.2.0`. The Release workflow builds the app package (`placesbuilder-<tag>.zip`) with a `SHA256SUMS` file and generates release notes from merged pull requests.
