<a name="createPgLo"></a>

## createPgLo(options) ⇒ <code>LargeObjectManager</code>
Create a [LargeObjectManager](LargeObjectManager) bound to a `pg` client.

**Kind**: global function  
**Returns**: <code>LargeObjectManager</code> - Manager instance for large-object operations.  

| Param | Description |
| --- | --- |
| options | Configuration (client, tmpDir, cleanup). |

**Example**  
```ts
import { Client } from "pg";
import { createPgLo } from "./index.js";

const client = new Client({ connectionString: "postgres://postgres:postgres@localhost:5432/db" });
await client.connect();
const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo", deleteTmpDirOnExit: true });

// All lo_* calls must be inside a transaction:
await client.query("BEGIN");
const oid = await lom.createFromStream(Readable.from(Buffer.from("hello")));
await client.query("COMMIT");
console.log("stored oid", oid);
```
src: src/index.ts:40  
dist: dist/index.js:26
