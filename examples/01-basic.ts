/**
 * Basic example — upload a Buffer and download it, verifying equality.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/01-basic.ts
 * Prereq: Postgres running (`make docker-run-postgres`)
 */
import { Readable } from "node:stream";
import { Client } from "pg";
import { createPgLo } from "../src/index.js";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/db",
  });
  await client.connect();
  console.log("connected");

  const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });

  const original = Buffer.from("hello pg-lo 👋");
  console.log("original:", original.toString(), `(${original.length} bytes)`);

  // Large objects require a transaction
  await client.query("BEGIN");
  const oid = await lom.createFromStream(Readable.from(original));
  await client.query("COMMIT");
  console.log("stored oid:", oid);

  // Read back — also inside a transaction (unless cache hit)
  await client.query("BEGIN");
  const readable = await lom.openReadableStream(oid);
  const stored = await streamToBuffer(readable);
  await client.query("COMMIT");

  console.log("stored  :", stored.toString(), `(${stored.length} bytes)`);
  console.log("equal?  ", stored.equals(original) ? "✅" : "❌");

  // sizeOf — cache hit avoids DB transaction, but we show transaction-safe call
  // Wait a tick for background cache write, then query inside a transaction
  await new Promise((r) => setTimeout(r, 50));
  await client.query("BEGIN");
  console.log("sizeOf  :", await lom.sizeOf(oid), "bytes (uses cache if available)");
  await client.query("COMMIT");

  // Cleanup
  await client.query("BEGIN");
  await lom.unlink(oid);
  await client.query("COMMIT");
  console.log("unlinked oid", oid);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
