# pg-lo

Minimal, typed wrapper for **PostgreSQL Large Objects** (`pg_largeobject`) with streaming + filesystem cache.

> **Author:** [Rayen Boussayed](https://github.com/rayenboussayed) — `rayenboussayed@gmail.com` · [https://github.com/rayenboussayed/pg-lo](https://github.com/rayenboussayed/pg-lo)

[![npm version](https://img.shields.io/npm/v/pg-lo)](https://www.npmjs.com/package/pg-lo) [![license ISC](https://img.shields.io/npm/l/pg-lo)](https://github.com/rayenboussayed/pg-lo/blob/main/LICENSE)

- ESM + TypeScript (strict)
- `pg` client with transaction-aware `lo_*` calls
- `LargeObject` low-level API (`loread`/`lowrite`/`lo_lseek64`/`lo_tell64`/`lo_close`)
- `LargeObjectManager` high-level API (`createFromStream` / `openReadableStream` with `tmpDir` cache)
- `tee` utility (`src/utils.ts:24`) — splits a `Readable` into two `PassThrough` branches
- Tests: Vitest unit (mocked) + e2e (real Postgres) + Faker image buffer compare

## Install

```bash
npm install pg
# this package (local)
npm install ./packages/pg-lo
```

Requires Node `>=18`, Postgres `>=14` (tested on `postgres:18`), `pg ^8.23`.

Development (`npm install`, `npm run build`, `npm run docs`) requires Node `>=22.17` because mdaics is a dev dependency. The published package does not declare an engines constraint; its documented requirement is Node `>=18`.

## Quick start

```ts
import { Client } from "pg";
import { createPgLo } from "pg-lo";
import { Readable } from "node:stream";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });

// upload — must be inside a transaction
await client.query("BEGIN");
const oid = await lom.createFromStream(Readable.from(Buffer.from("hello pg-lo")));
await client.query("COMMIT");
console.log("oid", oid);

// download — also inside a transaction (cache hit avoids DB)
await client.query("BEGIN");
const readable = await lom.openReadableStream(oid);
const chunks: Buffer[] = [];
for await (const c of readable) chunks.push(c as Buffer);
const stored = Buffer.concat(chunks);
await client.query("COMMIT");

console.log("equal?", stored.equals(Buffer.from("hello pg-lo"))); // true
```

See `examples/01-basic.ts:1` for runnable version.

## API

### `createPgLo(options)` — `src/index.ts:40`

```ts
import { createPgLo } from "./src/index.js";
type PgLoOptions = {
  client: Client;          // connected pg client
  tmpDir?: string;         // default "<cwd>/tmp/pg-lo"
  deleteTmpDirOnExit?: boolean; // rm tmpDir on beforeExit
};
const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });
```

### `LargeObjectManager` — `src/lom.ts:39`

```ts
class LargeObjectManager {
  create(): Promise<number> // SELECT lo_create(0) → oid
  open(oid, mode?: "r"|"w"|"rw"): Promise<LargeObject> // SELECT lo_open
  createFromStream(readable: Readable, signal?: AbortSignal): Promise<number>
  openReadableStream(oid, chunkSize=16384, signal?: AbortSignal): Promise<Readable>
  unlink(oid): Promise<void> // lo_unlink + rm cache
  sizeOf(oid): Promise<number> // stat cache or lo.size()
}
```

- `createFromStream` (`src/lom.ts:91`) — `tee`s source: one branch → `LargeObject.getWritableStream` → `lowrite`, other → `tmpDir/<oid>` cache via `setImmediate`+`pipeline`. Must be inside `BEGIN`/`COMMIT`.
- `openReadableStream` (`src/lom.ts:139`) — cache hit → `fs.createReadStream`, miss → `lo_open`+`seek(SET 0)`+`getReadableStream` then `tee` to populate cache.

### `LargeObject` — `src/lo.ts:32`

```ts
class LargeObject {
  read(length: number): Promise<Buffer> // loread
  write(buffer: Buffer): Promise<void>  // lowrite
  seek(offset: number, whence?: SeekWhence): Promise<number> // lo_lseek64
  tell(): Promise<number>               // lo_tell64
  size(): Promise<number>               // tell + seek END + seek restore
  close(): Promise<void>                // lo_close
  getReadableStream(chunkSize?, signal?): Readable // liread loop, auto-close
  getWritableStream(signal?): Writable  // lowrite per chunk, auto-close on final
}
enum SeekWhence { SET=0, CUR=1, END=2 }
type LargeObjectOpenMode = "r"|"w"|"rw"
```

### `tee(source, signal?)` — `src/utils.ts:24`

Split a `Readable` into two `PassThrough` streams with backpressure, error and end forwarding.

## Documentation

Per-file API docs are generated with [mdaics](https://www.npmjs.com/package/mdaics) and committed under `docs/` (`docs/index.md`, `docs/lom.md`, `docs/lo.md`, `docs/utils.md`).

Regenerate after changing `src/` or any TSDoc comment, and commit the result:

```sh
npm run docs
```

`npm run docs` runs `npm run build` first, so the `dist:` pointer lines in each `docs/*.md` resolve against a fresh `dist/`. The docs describe the source tree of this repository, not the published package; a release can lag the tree. Do not hand-edit the generated files.

One known artifact: the `SeekWhence` enum members render as `SeekWhence[undefined]` because jsdoc-to-markdown cannot name computed enum members. The `SeekWhence` block itself carries the semantics (`SET = 0`, `CUR = 1`, `END = 2`).

## Examples

| File | What it shows |
|------|---------------|
| `examples/01-basic.ts` | Buffer upload/download + `equals` compare |
| `examples/02-faker-image.ts` | **Faker image** simulation — `faker.image.dataUri({type:'svg-base64'})` → `Buffer.from(base64)` → `createFromStream` → `openReadableStream` → `original.equals(stored)` + `Buffer.compare` + `sizeOf` — mirrors `tests/e2e/lom.e2e.test.ts:89` |
| `examples/03-file-stream.ts` | `fs.createReadStream` upload / `pipeline` download, file-level `equals` |
| `examples/04-transaction.ts` | `withTransaction` helper, low-level `LargeObject` with `SeekWhence` |
| `examples/05-http-server.ts` | **HTTP streaming** — `POST /upload` (`application/octet-stream` `req` → `createFromStream(req)`) + `GET /file/:oid` (`openReadableStream` → `pipeline(stream,res)`) with `fetch` demo + `original.equals(stored)` |

Run any:

```bash
make docker-run-postgres   # start postgres:18 on 5432, db=db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/02-faker-image.ts
DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/05-http-server.ts
# or: npm run example:http  # defaults to PORT=3456
curl -X POST --data-binary @/etc/hosts -H "Content-Type: application/octet-stream" http://localhost:3456/upload
curl http://localhost:3456/file/<oid> --output out.bin
```

See `examples/README.md` for details.

## Transactions

All `lo_*` operations **must** be inside a transaction. The library does **not** manage `BEGIN`/`COMMIT` — the caller does:

```ts
await client.query("BEGIN");
try {
  const oid = await lom.createFromStream(stream);
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
}
```

`04-transaction.ts` shows a reusable `withTransaction` helper. Cache files are filesystem-only and survive `ROLLBACK` — cleaned on `unlink` or `tmpDir` removal.

## Cache

`tmpDir/<oid>` stores payloads. `openReadableStream` checks `fs.existsSync` first (`src/lom.ts:145`), so second read is fast and avoids DB. `sizeOf` (`src/lom.ts:189`) uses `stat` when cached. Cache write is background (`setImmediate` → `pipeline(tee1, fs.createWriteStream)`). Provide a dedicated empty tmpDir per test run (see `tests/e2e/helpers/*`, `vitest` tmp via `fs.mkdtemp`).

## Types

Strict TypeScript, `verbatimModuleSyntax`, `nodenext`. Types are exported from `src/index.ts:7` `PgLoOptions`, `src/lo.ts:5` `LargeObjectOpenMode` and `src/lo.ts:8` `SeekWhence`.

## Testing

```bash
npm run test:run       # all 43 tests (34 unit, 9 e2e)
npm run test:unit      # vitest run tests/unit — mocked pg, no DB
npm run test:e2e       # vitest run tests/e2e — real PG + faker buffer compare
npm run test:coverage  # v8: 92% stmts, 81% branch
./node_modules/.bin/tsc --noEmit # typecheck (src only)
```

E2E Faker image flow (`tests/e2e/lom.e2e.test.ts:89`): `fakeImageBuffer(1)` → `Readable.from(original)` → `createFromStream` → `await setTimeout(50)` for cache → `openReadableStream` → `streamToBuffer` → `expect(stored.equals(original)).toBe(true)` — sequential (pg client not concurrent-safe, see `examples/02-faker-image.ts`).

## Project structure

```
src/
  index.ts  — createPgLo factory
  lom.ts    — LargeObjectManager
  lo.ts     — LargeObject + SeekWhence
  types.ts  — PgLoClient (Client | Pool); types-only, not in the generated docs
  utils.ts  — tee
docs/     — generated API docs (npm run docs), one .md per documented src file
tests/
  unit/     — mocked unit tests (utils, lo, lom, index)
  e2e/      — real PG + faker image buffer compare
examples/
  01-basic.ts, 02-faker-image.ts, 03-file-stream.ts, 04-transaction.ts, 05-http-server.ts
```

## Author

**Rayen Boussayed** — [@rayenboussayed](https://github.com/rayenboussayed) · [rayenboussayed@gmail.com](mailto:rayenboussayed@gmail.com) · Tlemcen, Algeria

- GitHub: [https://github.com/rayenboussayed](https://github.com/rayenboussayed)
- Repository: [https://github.com/rayenboussayed/pg-lo](https://github.com/rayenboussayed/pg-lo)
- Issues: [https://github.com/rayenboussayed/pg-lo/issues](https://github.com/rayenboussayed/pg-lo/issues)

## License

ISC — see [LICENSE](LICENSE) (same as `package.json:43`)
