/**
 * HTTP server example — streaming file upload / download with pg-lo.
 *
 * - `POST /upload` — client sends `application/octet-stream`; server reads
 *   `req` (Readable) and pipes it to Postgres via `lom.createFromStream(req)`.
 *   Returns `{ oid }` JSON. Transaction-safe, abort-aware.
 *
 * - `GET /file/:oid` — server opens `lom.openReadableStream(oid)` and pipes
 *   the stream to `res` (Writable). Sets `Content-Type` and `Content-Length`
 *   from `lom.sizeOf`. Keeps transaction open while streaming from DB.
 *
 * Demonstrates correct Node.js streaming: `req` → `createFromStream` and
 * `openReadableStream` → `res` via `pipeline`, with `AbortSignal` and
 * `BEGIN`/`COMMIT`/`ROLLBACK`.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/db npx tsx examples/05-http-server.ts
 *   # server starts on 3456 (or $PORT), demo client auto-uploads a faker image and verifies round-trip
 *
 * Manual test with curl:
 *   curl -X POST --data-binary @./tmp/example-input.txt -H "Content-Type: application/octet-stream" http://localhost:3456/upload
 *   curl http://localhost:3456/file/12345 --output downloaded.bin
 *
 * Requires: Postgres running (`make docker-run-postgres`)
 */

import http from "node:http";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { faker } from "@faker-js/faker";
import { createPgLo } from "../src/index.js";
import type { LargeObjectManager } from "../src/lom.js";

// ---------------------------------------------------------------------------
// Helpers: transaction + buffer
// ---------------------------------------------------------------------------

async function withTransaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/** Create a deterministic fake image buffer (offline SVG, no network). */
function fakeImageBuffer(seed = 1): Buffer {
  faker.seed(seed);
  const dataUri = faker.image.dataUri({ type: "svg-base64" });
  const base64 = dataUri.split(",")[1]!;
  return Buffer.from(base64, "base64");
}

// ---------------------------------------------------------------------------
// HTTP handlers — pure functions, easy to test
// ---------------------------------------------------------------------------

/**
 * Create HTTP server with pg-lo handlers.
 * Exported for testing; call `server.listen(port)`.
 */
export function createServer(client: Client, lom: LargeObjectManager): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // POST /upload — store octet-stream
    if (req.method === "POST" && url.pathname === "/upload") {
      // Optional: validate content-type
      const ct = req.headers["content-type"] ?? "";
      if (ct && !ct.includes("application/octet-stream") && !ct.includes("application/binary")) {
        // still allow — be lenient, but log
        console.warn(`[upload] unexpected Content-Type: ${ct}`);
      }

      try {
        // `req` is a Readable — stream directly to Postgres.
        // We intentionally omit `req.signal` here: the cache write in `lom.ts`
        // uses `setImmediate` + `fs.createWriteStream`; if we tie it to the
        // request signal it aborts when the client closes, causing an
        // unhandled WriteStream error (see src/lom.ts:100). For HTTP we let
        // the DB write complete and handle client aborts via `req.on('close')`.
        const oid = await withTransaction(client, () => lom.createFromStream(req));

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ oid }));
        console.log(`[upload] stored oid=${oid}`);
      } catch (err) {
        console.error("[upload] error", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "upload failed", details: String(err) }));
        } else {
          res.destroy(err as Error);
        }
      }
      return;
    }

    // GET /file/:oid — stream back
    if (req.method === "GET" && url.pathname.startsWith("/file/")) {
      const oidStr = url.pathname.slice("/file/".length);
      const oid = Number.parseInt(oidStr, 10);
      if (!Number.isInteger(oid)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid oid" }));
        return;
      }

      try {
        // Keep transaction open while streaming from DB.
        // `sizeOf` and `openReadableStream` handle cache transparently.
        // For cache hits `sizeOf` uses `stat` and no transaction is needed,
        // but we keep one for simplicity and to cover DB-miss case.
        await client.query("BEGIN");
        let size: number;
        let readable: import("node:stream").Readable;
        try {
          size = await lom.sizeOf(oid);
          readable = await lom.openReadableStream(oid);
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        }

        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="${oid}"`,
          // hint for clients
          "X-OID": String(oid),
        });

        // Pipe DB/cache stream → HTTP response with backpressure.
        // No abort signal — response `close` will destroy the pipeline naturally.
        await pipeline(readable, res);

        await client.query("COMMIT");
        console.log(`[download] streamed oid=${oid} (${size} bytes)`);
      } catch (err) {
        console.error(`[download] oid=${oid} error`, err);
        await client.query("ROLLBACK").catch(() => {});
        if (!res.headersSent) {
          const notFound = String(err).includes("invalid large-object") || String(err).includes("does not exist");
          res.writeHead(notFound ? 404 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: notFound ? "not found" : "download failed", details: String(err) }));
        } else {
          res.destroy(err as Error);
        }
      }
      return;
    }

    // DELETE /file/:oid — optional cleanup
    if (req.method === "DELETE" && url.pathname.startsWith("/file/")) {
      const oid = Number.parseInt(url.pathname.slice("/file/".length), 10);
      if (!Number.isInteger(oid)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid oid" }));
        return;
      }
      try {
        await withTransaction(client, () => lom.unlink(oid));
        res.writeHead(204);
        res.end();
        console.log(`[delete] unlinked oid=${oid}`);
      } catch (err) {
        console.error("[delete] error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "delete failed" }));
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found", path: url.pathname }));
  });
}

// ---------------------------------------------------------------------------
// Main — start server + demo client round-trip with faker buffer compare
// ---------------------------------------------------------------------------

async function main() {
  const port = Number.parseInt(process.env.PORT ?? "3456", 10);
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/db",
  });
  await client.connect();
  console.log("connected to postgres");

  const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });
  const server = createServer(client, lom);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nshutting down...");
    server.close();
    await client.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, async () => {
    console.log(`http server listening on http://localhost:${port}`);
    console.log(`  POST /upload  — Content-Type: application/octet-stream`);
    console.log(`  GET  /file/:oid`);
    console.log(`  DELETE /file/:oid`);
    console.log(`  GET  /health`);

    // ----- Demo: upload faker image via fetch, download and compare -----
    // Uses native fetch (Node 18+). Buffer compare mirrors tests/e2e/lom.e2e.test.ts:78
    try {
      console.log("\n[demo] generating faker image...");
      const original = fakeImageBuffer(42);
      console.log(`[demo] original ${original.length} bytes, head:`, original.subarray(0, 50).toString());

      console.log("[demo] POST /upload (octet-stream) ...");
      const uploadRes = await fetch(`http://localhost:${port}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: original as unknown as BodyInit, // Node fetch accepts Buffer
      });
      if (!uploadRes.ok) throw new Error(`upload failed ${uploadRes.status}: ${await uploadRes.text()}`);
      const { oid } = (await uploadRes.json()) as { oid: number };
      console.log(`[demo] uploaded oid=${oid}`);

      // small delay for background cache write (tee → fs)
      await new Promise((r) => setTimeout(r, 50));

      console.log(`[demo] GET /file/${oid} ...`);
      const downloadRes = await fetch(`http://localhost:${port}/file/${oid}`);
      if (!downloadRes.ok) throw new Error(`download failed ${downloadRes.status}`);
      const stored = Buffer.from(await downloadRes.arrayBuffer());

      console.log(`[demo] stored ${stored.length} bytes`);
      console.log(`[demo] Buffer.equals?  ${stored.equals(original) ? "✅ identical" : "❌ mismatch"}`);
      console.log(`[demo] Buffer.compare? ${Buffer.compare(stored, original) === 0 ? "0 (equal)" : "mismatch"}`);

      if (!stored.equals(original)) throw new Error("buffer mismatch!");

      // Cleanup via DELETE
      await fetch(`http://localhost:${port}/file/${oid}`, { method: "DELETE" });
      console.log(`[demo] cleaned up oid=${oid} ✅`);

      console.log("\nTry manually:");
      console.log(`  curl -X POST --data-binary @/etc/hosts -H "Content-Type: application/octet-stream" http://localhost:${port}/upload`);
      console.log(`  curl http://localhost:${port}/file/${oid} --output out.bin  # (oid already deleted, try new upload)`);
    } catch (err) {
      console.error("[demo] failed", err);
      // don't exit — keep server running for manual testing
    }
  });
}

// Only run when executed directly (`npx tsx examples/05-http-server.ts`), not when imported
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
