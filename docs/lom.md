## Classes

<dl>
<dt><a href="#LargeObjectManager">LargeObjectManager</a></dt>
<dd><p>Manages PostgreSQL large objects (<code>pg_largeobject</code>) with filesystem caching.</p>
<p>Each large object is identified by an <code>oid</code>. This manager:</p>
<ul>
<li>creates / opens / unlinks objects via <code>lo_*</code> SQL,</li>
<li>streams data via <code>LargeObject</code>,</li>
<li>caches payloads under <code>tmpDir/&lt;oid&gt;</code> to avoid repeated DB reads.</li>
</ul>
<p>All <code>lo_*</code> calls must run inside a transaction. The caller is
responsible for <code>BEGIN</code>/<code>COMMIT</code>/<code>ROLLBACK</code>.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#INV_WRITE">INV_WRITE</a></dt>
<dd><p>Flag for <code>lo_open</code> — write. Matches PostgreSQL <code>INV_WRITE</code>.</p>
</dd>
<dt><a href="#INV_READ">INV_READ</a></dt>
<dd><p>Flag for <code>lo_open</code> — read. Matches PostgreSQL <code>INV_READ</code>.</p>
</dd>
</dl>

<a name="LargeObjectManager"></a>

## LargeObjectManager
Manages PostgreSQL large objects (`pg_largeobject`) with filesystem caching.

Each large object is identified by an `oid`. This manager:
- creates / opens / unlinks objects via `lo_*` SQL,
- streams data via `LargeObject`,
- caches payloads under `tmpDir/<oid>` to avoid repeated DB reads.

All `lo_*` calls must run inside a transaction. The caller is
responsible for `BEGIN`/`COMMIT`/`ROLLBACK`.

**Kind**: global class  
src: src/lom.ts:39  
dist: dist/lom.js:35

* [LargeObjectManager](#LargeObjectManager)
    * [new LargeObjectManager()](#new_LargeObjectManager_new)
    * [.createCachePath()](#LargeObjectManager+createCachePath) ⇒ <code>string</code>
    * [.create()](#LargeObjectManager+create) ⇒ <code>Promise&lt;number&gt;</code>
    * [.open(oid, mode)](#LargeObjectManager+open) ⇒ <code>Promise&lt;LargeObject&gt;</code>
    * [.createFromStream(readable, signal)](#LargeObjectManager+createFromStream) ⇒ <code>Promise&lt;number&gt;</code>
    * [.openReadableStream(oid, chunkSize, signal)](#LargeObjectManager+openReadableStream) ⇒ <code>Promise&lt;Readable&gt;</code>
    * [.unlink(oid)](#LargeObjectManager+unlink) ⇒ <code>Promise&lt;void&gt;</code>
    * [.sizeOf(oid)](#LargeObjectManager+sizeOf) ⇒ <code>Promise&lt;number&gt;</code>

<a name="new_LargeObjectManager_new"></a>

### new LargeObjectManager()
**Example**  
```ts
import { Client } from "pg";
import { createPgLo } from "./index.js";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });

await client.query("BEGIN");
const oid = await lom.createFromStream(Readable.from(Buffer.from("hello")));
await client.query("COMMIT");
```
<a name="LargeObjectManager+createCachePath"></a>

### largeObjectManager.createCachePath() ⇒ <code>string</code>
Build cache file path for an oid.

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  
src: src/lom.ts:46  
dist: dist/lom.js:43
<a name="LargeObjectManager+create"></a>

### largeObjectManager.create() ⇒ <code>Promise&lt;number&gt;</code>
Create a new empty large object.

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  
**Returns**: <code>Promise&lt;number&gt;</code> - The new `oid`.  
src: src/lom.ts:54  
dist: dist/lom.js:50
<a name="LargeObjectManager+open"></a>

### largeObjectManager.open(oid, mode) ⇒ <code>Promise&lt;LargeObject&gt;</code>
Open an existing large object.

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  
**Returns**: <code>Promise&lt;LargeObject&gt;</code> - `LargeObject` handle (caller must `close()` or use stream auto-close).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| oid | <code>number</code> |  | Object id. |
| mode | <code>LargeObjectOpenMode</code> | <code>r</code> | Open mode: `r` (read), `w` (write), `rw` (both). Default `r`. |

src: src/lom.ts:67  
dist: dist/lom.js:60
<a name="LargeObjectManager+createFromStream"></a>

### largeObjectManager.createFromStream(readable, signal) ⇒ <code>Promise&lt;number&gt;</code>
Create a new large object from a `Readable`.

Streams data into Postgres (`lowrite`) and concurrently caches to
`tmpDir/<oid>` via `tee`. Resolves with the new `oid` when the
DB write finishes. Cache write happens asynchronously via `setImmediate`.

Must be called inside a transaction.

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  
**Returns**: <code>Promise&lt;number&gt;</code> - The new `oid`.  

| Param | Type | Description |
| --- | --- | --- |
| readable | <code>Readable</code> | Source stream. |
| signal | <code>AbortSignal</code> | Optional abort signal. |

src: src/lom.ts:91  
dist: dist/lom.js:82
<a name="LargeObjectManager+openReadableStream"></a>

### largeObjectManager.openReadableStream(oid, chunkSize, signal) ⇒ <code>Promise&lt;Readable&gt;</code>
Open a readable stream for an existing large object.

If a cache file exists at `tmpDir/<oid>`, returns a fast
`fs.createReadStream`. Otherwise streams from Postgres and
populates the cache in the background (via `tee` + `setImmediate`).

Must be called inside a transaction when reading from DB (cache
hits avoid DB).

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  
**Returns**: <code>Promise&lt;Readable&gt;</code> - Readable emitting `Buffer` chunks.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| oid | <code>number</code> |  | Object id. |
| chunkSize | <code>number</code> | <code>16384</code> | Bytes per `loread` (default 16384). |
| signal | <code>AbortSignal</code> |  | Optional abort signal. |

src: src/lom.ts:139  
dist: dist/lom.js:121
<a name="LargeObjectManager+unlink"></a>

### largeObjectManager.unlink(oid) ⇒ <code>Promise&lt;void&gt;</code>
Delete a large object and its cache file.

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  

| Param | Type | Description |
| --- | --- | --- |
| oid | <code>number</code> | Object id to remove. |

src: src/lom.ts:176  
dist: dist/lom.js:147
<a name="LargeObjectManager+sizeOf"></a>

### largeObjectManager.sizeOf(oid) ⇒ <code>Promise&lt;number&gt;</code>
Get byte size of an existing large object.
Uses cache `stat` if available, otherwise queries DB via `LargeObject.size()`.

**Kind**: instance method of [<code>LargeObjectManager</code>](#LargeObjectManager)  
**Returns**: <code>Promise&lt;number&gt;</code> - Byte length, or `null` if unavailable (no rows).  

| Param | Type | Description |
| --- | --- | --- |
| oid | <code>number</code> | Object id. |

src: src/lom.ts:189  
dist: dist/lom.js:159
<a name="INV_WRITE"></a>

## INV\_WRITE
Flag for `lo_open` — write. Matches PostgreSQL `INV_WRITE`.

**Kind**: global constant  
src: src/lom.ts:10  
dist: dist/lom.js:7
<a name="INV_READ"></a>

## INV\_READ
Flag for `lo_open` — read. Matches PostgreSQL `INV_READ`.

**Kind**: global constant  
src: src/lom.ts:12  
dist: dist/lom.js:9
