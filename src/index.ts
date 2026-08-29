import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { LargeObjectManager } from "./lom.js";

/** Options for {@link createPgLo}. */
export type PgLoOptions = {
  /** Connected `pg` client. Must remain open for the manager's lifetime. */
  client: Client;
  /** Directory for filesystem cache. Defaults to `<cwd>/tmp/pg-lo`. Created on demand. */
  tmpDir?: string;
  /** If true, remove `tmpDir` on `beforeExit`. */
  deleteTmpDirOnExit?: boolean;
};

type Options = PgLoOptions;

 /**
  * Create a {@link LargeObjectManager} bound to a `pg` client.
  *
  * @param options - Configuration (client, tmpDir, cleanup).
  * @returns Manager instance for large-object operations.
  *
  * @example
  * ```ts
  * import { Client } from "pg";
  * import { createPgLo } from "./index.js";
  *
  * const client = new Client({ connectionString: "postgres://postgres:postgres@localhost:5432/db" });
  * await client.connect();
  * const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo", deleteTmpDirOnExit: true });
  *
  * // All lo_* calls must be inside a transaction:
  * await client.query("BEGIN");
  * const oid = await lom.createFromStream(Readable.from(Buffer.from("hello")));
  * await client.query("COMMIT");
  * console.log("stored oid", oid);
  * ```
  */
export function createPgLo({
  client,
  tmpDir = path.join(process.cwd(), "tmp/pg-lo"),
  deleteTmpDirOnExit,
}: Options) {
  if (deleteTmpDirOnExit) {
    process.once("beforeExit", () => {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    });
  }
  return new LargeObjectManager(client, tmpDir);
}
