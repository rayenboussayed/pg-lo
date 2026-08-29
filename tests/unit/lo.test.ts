import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { LargeObject, SeekWhence } from "../../src/lo.js";
import type { Client } from "pg";

/**
 * Unit tests for LargeObject — mocked pg Client.
 * Verifies SQL calls, buffer handling, stream plumbing.
 */
describe("LargeObject", () => {
  let client: Client & { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = { query: vi.fn() } as unknown as Client & { query: ReturnType<typeof vi.fn> };
  });

  describe("read", () => {
    it("should return buffer from loread", async () => {
      // Given
      const lo = new LargeObject(client, 123);
      const expected = Buffer.from("hello");
      client.query.mockResolvedValue({ rows: [{ data: expected }] });

      // When
      const result = await lo.read(5);

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT loread($1::int4, $2::int4) AS data", [123, 5]);
      expect(result.equals(expected)).toBe(true);
    });

    it("should return null when no rows", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockResolvedValue({ rows: [] });

      // When
      const result = await lo.read(10);

      // Then
      expect(result).toBeNull();
    });

    it("should convert non-buffer data via Buffer.from", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockResolvedValue({ rows: [{ data: "abc" }] });

      // When
      const result = await lo.read(3);

      // Then
      expect(result.toString()).toBe("abc");
    });
  });

  describe("write", () => {
    it("should call lowrite with buffer", async () => {
      // Given
      const lo = new LargeObject(client, 42);
      client.query.mockResolvedValue({ rows: [] });
      const buf = Buffer.from("data");

      // When
      await lo.write(buf);

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lowrite($1::int4, $2::bytea)", [42, buf]);
    });
  });

  describe("seek / tell / size", () => {
    it("should call lo_lseek64 and parse result", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockResolvedValue({ rows: [{ pos: "100" }] });

      // When
      const pos = await lo.seek(100, SeekWhence.SET);

      // Then
      expect(pos).toBe(100);
      expect(client.query).toHaveBeenCalledWith("SELECT lo_lseek64($1, $2, $3) AS pos", [1, 100, 0]);
    });

    it("should return null when seek returns no rows", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockResolvedValue({ rows: [] });

      // When
      const pos = await lo.seek(0);

      // Then
      expect(pos).toBeNull();
    });

    it("should call lo_tell64", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockResolvedValue({ rows: [{ pos: "42" }] });

      // When
      const pos = await lo.tell();

      // Then
      expect(pos).toBe(42);
    });

    it("should compute size by saving cursor, seeking to END, restoring", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      // tell -> 10, seek END -> 100, seek SET -> 10
      client.query
        .mockResolvedValueOnce({ rows: [{ pos: "10" }] }) // tell
        .mockResolvedValueOnce({ rows: [{ pos: "100" }] }) // seek END
        .mockResolvedValueOnce({ rows: [{ pos: "10" }] }); // seek SET

      // When
      const size = await lo.size();

      // Then
      expect(size).toBe(100);
      expect(client.query).toHaveBeenCalledTimes(3);
    });
  });

  describe("close", () => {
    it("should call lo_close", async () => {
      // Given
      const lo = new LargeObject(client, 7);
      client.query.mockResolvedValue({ rows: [] });

      // When
      await lo.close();

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lo_close($1)", [7]);
    });
  });

  describe("getReadableStream", () => {
    it("should push data and close on EOF", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      // first loread returns data, second returns empty -> EOF
      client.query
        .mockResolvedValueOnce({ rows: [{ data: Buffer.from("chunk1") }] })
        .mockResolvedValueOnce({ rows: [{ data: Buffer.alloc(0) }] })
        .mockResolvedValueOnce({ rows: [] }); // lo_close
      const stream = lo.getReadableStream(16384);

      // When
      const chunks = await collectStream(stream);

      // Then
      expect(Buffer.concat(chunks).toString()).toBe("chunk1");
      expect(client.query).toHaveBeenCalledWith("SELECT lo_close($1)", [1]);
    });

    it("should destroy on read error", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockRejectedValue(new Error("read fail"));
      const stream = lo.getReadableStream();

      // When / Then
      await expect(collectStream(stream)).rejects.toThrow("read fail");
    });
  });

  describe("getWritableStream", () => {
    it("should write chunks via lowrite and close on final", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockResolvedValue({ rows: [] });
      const writable = lo.getWritableStream();

      // When
      await new Promise<void>((resolve, reject) => {
        writable.on("finish", resolve);
        writable.on("error", reject);
        writable.write(Buffer.from("hello "));
        writable.write(Buffer.from("world"));
        writable.end();
      });

      // Then
      expect(client.query).toHaveBeenCalledWith("SELECT lowrite($1::int4, $2::bytea)", [1, Buffer.from("hello ")]);
      expect(client.query).toHaveBeenCalledWith("SELECT lowrite($1::int4, $2::bytea)", [1, Buffer.from("world")]);
      expect(client.query).toHaveBeenCalledWith("SELECT lo_close($1)", [1]);
    });

    it("should callback error when lowrite fails", async () => {
      // Given
      const lo = new LargeObject(client, 1);
      client.query.mockRejectedValue(new Error("write fail"));
      const writable = lo.getWritableStream();

      // When / Then
      await expect(
        new Promise<void>((resolve, reject) => {
          writable.on("finish", resolve);
          writable.on("error", reject);
          writable.write(Buffer.from("x"), (err) => (err ? reject(err) : resolve()));
        }),
      ).rejects.toThrow("write fail");
      writable.destroy();
    });
  });
});

function collectStream(stream: Readable): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const bufs: Buffer[] = [];
    stream.on("data", (c) => bufs.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(bufs));
    stream.on("error", reject);
  });
}
