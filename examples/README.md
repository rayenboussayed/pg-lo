# Examples — `pg-lo`

Runnable TypeScript examples for `pg-lo`. Each file is self-contained, typed, and documented.

## Prereqs

```bash
# Postgres (uses Makefile helper)
make docker-run-postgres
# or provide your own
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/db
```

Install deps (from package root):

```bash
npm install
# optional: tsx for running examples
npm install -D tsx
```

## Run

```bash
npx tsx examples/01-basic.ts
npx tsx examples/02-faker-image.ts
npx tsx examples/03-file-stream.ts
npx tsx examples/04-transaction.ts
npx tsx examples/05-http-server.ts  # starts HTTP server + auto demo
# or via npm scripts
npm run example:http
```

All examples use `DATABASE_URL` env or default `postgres://postgres:postgres@localhost:5432/db`.

## Examples

| File | Description |
|------|-------------|
| `01-basic.ts` | Minimal upload/download with `Buffer` + `streamToBuffer`, `equals` check |
| `02-faker-image.ts` | **Faker image** file-upload simulation — `faker.image.dataUri({type:'svg-base64'})` → `Buffer.from(base64)` → `createFromStream` → `openReadableStream` → `original.equals(stored)` — mirrors e2e test `tests/e2e/lom.e2e.test.ts:78` |
| `03-file-stream.ts` | Upload `fs.createReadStream`, download via `pipeline` to `fs.createWriteStream`, compare files |
| `04-transaction.ts` | Correct transaction pattern + `withTransaction` helper, low-level `LargeObject` (`SeekWhence`, `read`/`write`/`seek`/`tell`/`size`) |
| `05-http-server.ts` | **HTTP streaming** — `POST /upload` reads `req` (`application/octet-stream`) → `lom.createFromStream(req)` → `{oid}`; `GET /file/:oid` → `lom.openReadableStream(oid)` → `pipeline(stream, res)` with `Content-Length` from `lom.sizeOf`; `DELETE /file/:oid`; health check; faker buffer demo with `fetch` + `original.equals(stored)` |

## Notes

- **Transactions required:** All `lo_*` calls must be inside `BEGIN`/`COMMIT` (see `04-transaction.ts`). Cache hits (`tmp/pg-lo/<oid>`) avoid DB.
- **Cache:** `LargeObjectManager` (`src/lom.ts:12`) caches under `tmpDir/<oid>` via `tee` (`src/utils.ts:3`). See `examples/02-faker-image.ts` wait for cache.
- **Cleanup:** `lom.unlink(oid)` removes DB object + cache file.
