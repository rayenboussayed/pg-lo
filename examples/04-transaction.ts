/**
 * Transaction example — correct handling of pg Large Objects.
 *
 * Large objects **must** be used inside a transaction. This example shows
 * the recommended pattern: `BEGIN` before `create`/`open`, `COMMIT` after,
 * `ROLLBACK` on error. Also shows low-level `LargeObject` API.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/04-transaction.ts
 */
import { Readable } from "node:stream";
import { Client } from "pg";
import { createPgLo } from "../src/index.js";
import { SeekWhence } from "../src/lo.js";

async function withTransaction<T>(
  client: Client,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream)
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function main() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/db",
  });
  await client.connect();
  const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });

  // 1. High-level API — createFromStream / openReadableStream
  console.log("— high-level API —");
  const oid = await withTransaction(client, async () => {
    const original = Buffer.from("transactional hello");
    return lom.createFromStream(Readable.from(original));
  });
  console.log("created oid (high-level):", oid);

  const stored = await withTransaction(client, async () => {
    const rs = await lom.openReadableStream(oid);
    return streamToBuffer(rs);
  });
  console.log(
    "read back:",
    stored.toString(),
    stored.equals(Buffer.from("transactional hello")) ? "✅" : "❌",
  );

  // 2. Low-level API — manual LargeObject operations
  console.log("— low-level API —");
  const oid2 = await withTransaction(client, async () => {
    const o = await lom.create();
    const lo = await lom.open(o, "w");
    await lo.write(Buffer.from("low-level write"));
    await lo.close();
    return o;
  });
  console.log("created oid (low-level):", oid2);

  await withTransaction(client, async () => {
    const lo = await lom.open(oid2, "r");
    console.log("tell at open:", await lo.tell());
    const data = await lo.read(1024);
    console.log("read:", data?.toString());
    console.log("size:", await lo.size());
    await lo.seek(0, SeekWhence.SET);
    console.log("after seek SET 0, tell:", await lo.tell());
    await lo.close();
  });

  // Cleanup
  await withTransaction(client, () => lom.unlink(oid));
  await withTransaction(client, () => lom.unlink(oid2));
  console.log("cleaned up");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
