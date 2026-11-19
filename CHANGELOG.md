# Changelog

All notable changes to `pg-lo` are documented here. The package has **no
release tags**; `package.json` is at `1.0.1`. Dates are UTC, from the commit
history (2026-08-29 .. 2026-11-18).

## [1.0.1] - 2026-09-03..2026-11-18

### Added

- mdaics-generated API docs added and committed under `docs/`; `npm run docs`
  script wired (`f9ccd80`, `5f9a7b3`, `85863da`).

### Changed

- `createPgLo` accepts a connected `pg.Client` **or** `pg.Pool` (`48d7075`).
- Development dependencies bumped: vitest and @vitest/coverage-v8 to `^4.1.12`
  (`346e702`).

### Documentation

- README claims aligned with verified behavior (`2c15ebd`).

## [1.0.0] - 2026-08-29

Initial commit and streaming release (`86fbf37`, `28d639c`): typed
`LargeObject` (`lo_*` calls) and `LargeObjectManager` APIs, streaming
reads/writes with the `tmpDir` filesystem cache, `tee()` stream splitter,
examples and the vitest suite (unit + e2e with Faker image buffer compare),
ISC license, Node `>=18` documented requirement.
