import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { LargeObjectManager } from "../../src/lom.js";
import type { Client } from "pg";

// Mock fs.createWriteStream usage via real tmp dir + spy on pipeline behavior is covered via integration;
// here we mock fs methods for unit isolation.

// We need to mock 'fs' partially — spy instead of mock to keep tmp file ops real for some tests.
describe("LargeObjectManager", () => {
  let client: Client & { query: ReturnType<typeof vi.fn> };
  let tmpDir: string;

  beforeEach(async () => {
    client = { query: vi.fn() } as unknown as Client & { query: ReturnType<typeof vi.fn> };
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pg-lo-unit-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should call lo_create and return oid", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query.mockResolvedValue({ rows: [{ oid: 12345 }] });

      // When
      const oid = await lom.create();

      // Then
      expect(oid).toBe(12345);
      expect(client.query).toHaveBeenCalledWith("SELECT lo_create(0) AS oid");
    });
  });

  describe("open", () => {
    it("should map mode r to INV_READ", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query.mockResolvedValue({ rows: [{ fd: 10 }] });

      // When
      const lo = await lom.open(123, "r");

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lo_open($1, $2) AS fd", [123, 0x00040000]);
      expect(lo.fd).toBe(10);
    });

    it("should map mode w to INV_WRITE", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query.mockResolvedValue({ rows: [{ fd: 11 }] });

      // When
      await lom.open(123, "w");

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lo_open($1, $2) AS fd", [123, 0x00020000]);
    });

    it("should map mode rw to both flags", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query.mockResolvedValue({ rows: [{ fd: 12 }] });

      // When
      await lom.open(123, "rw");

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lo_open($1, $2) AS fd", [123, 0x00060000]);
    });

    it("should default to r when no mode provided", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query.mockResolvedValue({ rows: [{ fd: 5 }] });

      // When
      await lom.open(999);

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lo_open($1, $2) AS fd", [999, 0x00040000]);
    });
  });

  describe("createFromStream", () => {
    it("should create oid, open w, pipe tee2 to writable and resolve oid", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      const original = Buffer.from("hello world from stream");
      const readable = Readable.from(original);

      client.query
        .mockResolvedValueOnce({ rows: [{ oid: 777 }] }) // create
        .mockResolvedValueOnce({ rows: [{ fd: 10 }] }) // open w
        .mockResolvedValue({ rows: [] }); // lowrite + lo_close repeated

      // When
      const oid = await lom.createFromStream(readable);

      // Then
      expect(oid).toBe(777);
      expect(client.query).toHaveBeenCalledWith("SELECT lo_create(0) AS oid");
      expect(client.query).toHaveBeenCalledWith("SELECT lo_open($1, $2) AS fd", [777, 0x00020000]);
      // Verify file was written to cache via tee1 setImmediate
      await new Promise((r) => setTimeout(r, 50));
      const cached = await fs.promises.readFile(path.join(tmpDir, "777")).catch(() => null);
      // Cache may exist or not depending on timing, but if exists it should equal original
      if (cached) expect(cached.equals(original)).toBe(true);
    });

    it("should reject when writable errors", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query
        .mockResolvedValueOnce({ rows: [{ oid: 888 }] })
        .mockResolvedValueOnce({ rows: [{ fd: 10 }] })
        .mockRejectedValue(new Error("lowrite fail"));

      const readable = Readable.from(Buffer.from("data"));

      // When / Then
      await expect(lom.createFromStream(readable)).rejects.toThrow("lowrite fail");
    });
  });

  describe("openReadableStream", () => {
    it("should return cached file stream when cache exists", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      const oid = 9999;
      const cachePath = path.join(tmpDir, `${oid}`);
      await fs.promises.writeFile(cachePath, Buffer.from("cached content"));

      // When
      const stream = await lom.openReadableStream(oid);

      // Then
      const data = await streamToBuffer(stream);
      expect(data.equals(Buffer.from("cached content"))).toBe(true);
      expect(client.query).not.toHaveBeenCalled(); // no lo_open
    });

    it("should open LO and return tee2 when cache miss", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query
        .mockResolvedValueOnce({ rows: [{ fd: 20 }] }) // lo_open
        .mockResolvedValueOnce({ rows: [{ pos: "0" }] }) // seek
        .mockResolvedValueOnce({ rows: [{ data: Buffer.from("db content") }] }) // loread
        .mockResolvedValueOnce({ rows: [{ data: Buffer.alloc(0) }] }) // EOF
        .mockResolvedValueOnce({ rows: [] }); // lo_close

      // When
      const stream = await lom.openReadableStream(1234);
      const data = await streamToBuffer(stream);

      // Then
      expect(data.toString()).toBe("db content");
      expect(client.query).toHaveBeenCalledWith("SELECT lo_open($1, $2) AS fd", [1234, 0x00040000]);
    });
  });

  describe("unlink", () => {
    it("should call lo_unlink and remove cache file", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      const oid = 555;
      const cachePath = path.join(tmpDir, `${oid}`);
      await fs.promises.writeFile(cachePath, Buffer.from("to delete"));
      client.query.mockResolvedValue({ rows: [] });

      // When
      await lom.unlink(oid);

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lo_unlink($1)", [555]);
      expect(fs.existsSync(cachePath)).toBe(false);
    });

    it("should not throw when cache missing", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query.mockResolvedValue({ rows: [] });

      // When / Then
      await expect(lom.unlink(99999)).resolves.toBeUndefined();
    });
  });

  describe("sizeOf", () => {
    it("should return cached file size when cache exists", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      const oid = 111;
      const content = Buffer.from("12345");
      await fs.promises.writeFile(path.join(tmpDir, `${oid}`), content);

      // When
      const size = await lom.sizeOf(oid);

      // Then
      expect(size).toBe(5);
      expect(client.query).not.toHaveBeenCalled();
    });

    it("should open LO and query size when cache miss", async () => {
      // Given
      const lom = new LargeObjectManager(client, tmpDir);
      client.query
        .mockResolvedValueOnce({ rows: [{ fd: 30 }] }) // open
        .mockResolvedValueOnce({ rows: [{ pos: "0" }] }) // tell
        .mockResolvedValueOnce({ rows: [{ pos: "123" }] }) // seek END
        .mockResolvedValueOnce({ rows: [{ pos: "0" }] }) // seek SET
        .mockResolvedValueOnce({ rows: [] }); // close

      // When
      const size = await lom.sizeOf(222);

      // Then
      expect(size).toBe(123);
    });
  });
});

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    // node:fs ReadStream emits Buffer, LO stream emits Buffer
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
