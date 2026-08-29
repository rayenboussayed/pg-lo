/**
 * Faker image example — generate a fake image, upload as stream,
 * download and compare the original buffer with the stored buffer.
 *
 * This mirrors the e2e test requirement: use `@faker-js/faker` image
 * and verify `original.equals(stored)` — useful for testing file uploads
 * without real files or network.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/02-faker-image.ts
 */
import { Readable } from "node:stream";
import { Client } from "pg";
import { faker } from "@faker-js/faker";
import { createPgLo } from "../src/index.js";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Generate a deterministic fake image buffer from faker.
 * Uses offline SVG data-URI (no network). Matches helper in tests/e2e/helpers/faker-image.ts.
 */
function fakeImageBuffer(seed = 1): Buffer {
  faker.seed(seed);
  // `dataUri` returns `data:image/svg+xml;base64,...` or `data:image/svg+xml;charset=UTF-8,...`
  const dataUri = faker.image.dataUri({ type: "svg-base64" });
  const base64 = dataUri.split(",")[1]!;
  return Buffer.from(base64, "base64");
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/db",
  });
  await client.connect();
  console.log("connected");

  const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });

  // Given — faker generates an SVG image buffer (offline, deterministic)
  const original = fakeImageBuffer(42);
  console.log(`original faker image: ${original.length} bytes, starts with:`, original.subarray(0, 60).toString());

  // When — upload via stream (file-upload simulation)
  await client.query("BEGIN");
  const oid = await lom.createFromStream(Readable.from(original));
  await client.query("COMMIT");
  console.log("stored oid:", oid);

  // Optional: wait a tick for background cache write (tee → fs)
  await new Promise((r) => setTimeout(r, 50));

  // Then — download and compare
  await client.query("BEGIN");
  const readable = await lom.openReadableStream(oid);
  const stored = await streamToBuffer(readable);
  await client.query("COMMIT");

  console.log(`stored buffer: ${stored.length} bytes`);

  // Compare original vs stored — the core assertion for file uploads
  const equal = stored.equals(original);
  const compare = Buffer.compare(stored, original); // 0 means equal
  console.log("Buffer.equals?  ", equal ? "✅ identical" : "❌ mismatch");
  console.log("Buffer.compare? ", compare === 0 ? "0 (equal)" : String(compare));
  console.log("Deep strict equal?", stored.toString() === original.toString());

  if (!equal) {
    throw new Error("stored buffer differs from original!");
  }

  // Also verify via sizeOf (cache-aware)
  await client.query("BEGIN");
  const size = await lom.sizeOf(oid);
  await client.query("COMMIT");
  console.log(`sizeOf: ${size} (expected ${original.length})`);

  // Cleanup
  await client.query("BEGIN");
  await lom.unlink(oid);
  await client.query("COMMIT");
  await client.end();
  console.log("done — buffers matched ✅");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
