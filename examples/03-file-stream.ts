/**
 * File stream example — upload a file from disk and download it back.
 *
 * Demonstrates `createFromStream` with `fs.createReadStream` and
 * `openReadableStream` piped to `fs.createWriteStream`.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/03-file-stream.ts
 *   # or: node --loader ts-node/esm examples/03-file-stream.ts
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { createPgLo } from "../src/index.js";

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/db",
  });
  await client.connect();
  console.log("connected");

  const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });

  // Prepare a sample file if none exists
  const srcPath = path.join("tmp", "example-input.txt");
  const dstPath = path.join("tmp", "example-output.txt");
  await fs.promises.mkdir("tmp", { recursive: true });
  if (!fs.existsSync(srcPath)) {
    await fs.promises.writeFile(srcPath, `Sample file written at ${new Date().toISOString()}\n`.repeat(1000));
  }
  const srcStat = await fs.promises.stat(srcPath);
  console.log(`source: ${srcPath} (${srcStat.size} bytes)`);

  // Upload — stream file into Postgres
  await client.query("BEGIN");
  const oid = await lom.createFromStream(fs.createReadStream(srcPath));
  await client.query("COMMIT");
  console.log("stored oid:", oid);

  // Wait for cache
  await new Promise((r) => setTimeout(r, 50));

  // Download — stream back to disk
  await client.query("BEGIN");
  const readable = await lom.openReadableStream(oid);
  await pipeline(readable, fs.createWriteStream(dstPath));
  await client.query("COMMIT");

  const dstStat = await fs.promises.stat(dstPath);
  console.log(`downloaded: ${dstPath} (${dstStat.size} bytes)`);

  // Verify equality (compare buffers, as requested for file uploads)
  const [original, stored] = await Promise.all([
    fs.promises.readFile(srcPath),
    fs.promises.readFile(dstPath),
  ]);
  console.log("file equals?", original.equals(stored) ? "✅" : "❌");

  // Cleanup
  await client.query("BEGIN");
  await lom.unlink(oid);
  await client.query("COMMIT");
  await client.end();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
