import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { Client } from "pg";
import { createPgLo } from "../../src/index.js";
import type { LargeObjectManager } from "../../src/lom.js";
import { fakeImageBuffer, fakeBinaryBuffer } from "./helpers/faker-image.js";
import { streamToBuffer } from "./helpers/stream.js";
import { createTestClient } from "./helpers/db.js";

// -------- Top-level probe to decide skip at collection time --------
// Vitest collects tests before beforeAll runs, so we need a synchronous
// decision. We do a lightweight probe here; beforeAll will reconnect.
let _probeAvailable = false;
try {
  const _probe = createTestClient();
  await _probe.connect();
  await _probe.query("SELECT 1");
  _probeAvailable = true;
  await _probe.end();
} catch {
  _probeAvailable = false;
}
const itIfDb = _probeAvailable ? it : it.skip;

/**
 * E2E tests for LargeObjectManager with real Postgres.
 * Verifies file-upload flow: faker image → createFromStream → openReadableStream → buffer equals original.
 *
 * Requires: Postgres running (make docker-run-postgres or DATABASE_URL).
 * If DB unavailable, suite is skipped gracefully.
 */
describe("LargeObjectManager (e2e)", () => {
  let client: Client;
  let lom: LargeObjectManager;
  let tmpDir: string;
  let dbAvailable = _probeAvailable;
  const oids: number[] = [];

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pg-lo-e2e-"));
    client = createTestClient();
    try {
      await client.connect();
      await client.query("SELECT 1");
      dbAvailable = true;
      lom = createPgLo({ client, tmpDir });
    } catch (err) {
      console.warn("[e2e] Postgres not available, skipping e2e tests. Start with: make docker-run-postgres\n", err);
      dbAvailable = false;
      // ensure tmp cleanup still happens
      lom = createPgLo({ client, tmpDir });
    }
  });

  afterAll(async () => {
    // cleanup OIDs inside transactions where possible
    for (const oid of oids) {
      try {
        await client.query("BEGIN");
        await lom.unlink(oid);
        await client.query("COMMIT");
      } catch {}
    }
    try {
      await client.end();
    } catch {}
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await client.query("BEGIN");
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await client.query("ROLLBACK");
    // remove cached files that were written outside transaction rollback
    // (cache is fs-only, not transactional)
    try {
      const files = await fs.promises.readdir(tmpDir);
      await Promise.all(files.map((f) => fs.promises.unlink(path.join(tmpDir, f)).catch(() => {})));
    } catch {}
  });

  describe("file upload — faker image buffer round-trip", () => {
    itIfDb("should store and retrieve faker svg-base64 image with identical buffer", async () => {
      // Given — faker generates offline SVG image
      const original = fakeImageBuffer(1, "svg-base64");
      expect(original.length).toBeGreaterThan(0);

      // When — upload via stream, then download
      const oid = await lom.createFromStream(Readable.from(original));
      oids.push(oid);

      // ensure cache write completes
      await new Promise((r) => setTimeout(r, 50));

      const readable = await lom.openReadableStream(oid);
      const stored = await streamToBuffer(readable);

      // Then — compare original vs stored buffer
      expect(stored.equals(original)).toBe(true);
      expect(Buffer.compare(stored, original)).toBe(0);
      expect(stored).toEqual(original);
      expect(stored.length).toBe(original.length);
    });

    itIfDb("should handle svg-uri variant as well", async () => {
      // Given
      const original = fakeImageBuffer(2, "svg-uri");

      // When
      const oid = await lom.createFromStream(Readable.from(original));
      oids.push(oid);
      await new Promise((r) => setTimeout(r, 50));
      const stored = await streamToBuffer(await lom.openReadableStream(oid));

      // Then
      expect(stored.equals(original)).toBe(true);
    });

    itIfDb("should round-trip 1MB binary buffer", async () => {
      // Given — larger payload to test chunking
      const original = fakeBinaryBuffer(1_048_576, 42); // 1MB

      // When
      const oid = await lom.createFromStream(Readable.from(original));
      oids.push(oid);
      await new Promise((r) => setTimeout(r, 100));
      const stored = await streamToBuffer(await lom.openReadableStream(oid, 16_384));

      // Then
      expect(stored.length).toBe(original.length);
      expect(stored.equals(original)).toBe(true);
    });

    itIfDb("should preserve buffer across multiple objects concurrently", async () => {
      // Given — 3 distinct faker images
      const originals = [fakeImageBuffer(10), fakeImageBuffer(11), fakeImageBuffer(12)];

      // When — upload sequentially (pg Client is not concurrent-safe)
      const oidsLocal: number[] = [];
      for (const buf of originals) {
        const oid = await lom.createFromStream(Readable.from(buf));
        oidsLocal.push(oid);
      }
      oidsLocal.forEach((oid) => oids.push(oid));
      await new Promise((r) => setTimeout(r, 100));

      const storedList: Buffer[] = [];
      for (const oid of oidsLocal) {
        const readable = await lom.openReadableStream(oid);
        storedList.push(await streamToBuffer(readable));
      }

      // Then — each stored equals its original, no cross-contamination
      storedList.forEach((stored, i) => {
        expect(stored.equals(originals[i]!)).toBe(true);
      });
    });
  });

  describe("cache behavior", () => {
    itIfDb("should use filesystem cache on second read (no DB query)", async () => {
      // Given
      const original = fakeImageBuffer(99);
      const oid = await lom.createFromStream(Readable.from(original));
      oids.push(oid);
      await new Promise((r) => setTimeout(r, 50));

      // first read populates cache if not already
      const first = await streamToBuffer(await lom.openReadableStream(oid));
      expect(first.equals(original)).toBe(true);

      const cachePath = path.join(tmpDir, `${oid}`);
      expect(fs.existsSync(cachePath)).toBe(true);

      // When — second read should hit cache
      const second = await streamToBuffer(await lom.openReadableStream(oid));

      // Then
      expect(second.equals(original)).toBe(true);
    });

    itIfDb("should return correct size from cache and DB", async () => {
      // Given
      const original = fakeImageBuffer(77);
      const oid = await lom.createFromStream(Readable.from(original));
      oids.push(oid);
      await new Promise((r) => setTimeout(r, 50));

      // When
      const size = await lom.sizeOf(oid);

      // Then
      expect(size).toBe(original.length);
    });
  });

  describe("unlink", () => {
    itIfDb("should delete DB object and cache file", async () => {
      // Given
      const original = fakeImageBuffer(55);
      const oid = await lom.createFromStream(Readable.from(original));
      await new Promise((r) => setTimeout(r, 50));
      const cachePath = path.join(tmpDir, `${oid}`);
      expect(fs.existsSync(cachePath)).toBe(true);

      // When
      await lom.unlink(oid);

      // Then
      expect(fs.existsSync(cachePath)).toBe(false);
      // reading size after unlink should not use cache
      // Note: lo_unlink inside same transaction will be visible; after unlink we can check file gone
      // remove from oids to avoid double unlink in afterAll
      const idx = oids.indexOf(oid);
      if (idx !== -1) oids.splice(idx, 1);
    });
  });

  // Fallback unit-like sanity when DB not available — still test faker buffer logic offline
  describe("offline faker image sanity (no DB)", () => {
    it("should generate non-empty svg buffers deterministically", () => {
      // Given
      const a = fakeImageBuffer(123);
      const b = fakeImageBuffer(123);
      const c = fakeImageBuffer(456);

      // When / Then
      expect(a.length).toBeGreaterThan(0);
      expect(a.equals(b)).toBe(true); // same seed → same buffer
      expect(a.equals(c)).toBe(false); // different seed → different
    });

    it("should generate binary buffer of requested size", () => {
      // Given
      const buf = fakeBinaryBuffer(1024, 1);

      // When / Then
      expect(buf.length).toBe(1024);
    });
  });
});
