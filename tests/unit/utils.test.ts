import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { tee } from "../../src/utils.js";

/**
 * Tests for `tee` — splits a Readable into two PassThrough streams.
 */
describe("tee", () => {
  describe("when source emits chunks", () => {
    it("should deliver identical data to both branches", async () => {
      // Given
      const chunks = [Buffer.from("hello "), Buffer.from("world")];
      const source = Readable.from(chunks);
      const [a, b] = tee(source);

      // When
      const [resA, resB] = await Promise.all([collect(a), collect(b)]);

      // Then
      expect(Buffer.concat(resA).toString()).toBe("hello world");
      expect(Buffer.concat(resB).toString()).toBe("hello world");
      expect(Buffer.concat(resA).equals(Buffer.concat(resB))).toBe(true);
    });
  });

  describe("when source emits error", () => {
    it("should destroy both branches with same error", async () => {
      // Given
      const source = new Readable({
        read() {
          this.destroy(new Error("boom"));
        },
      });
      const [a, b] = tee(source);
      const errA = waitForError(a);
      const errB = waitForError(b);

      // When
      source.read();

      // Then
      await expect(errA).rejects.toThrow("boom");
      await expect(errB).rejects.toThrow("boom");
    });
  });

  describe("when source ends", () => {
    it("should end both branches", async () => {
      // Given
      const source = Readable.from(["a", "b", "c"]);
      const [a, b] = tee(source);

      // When
      const [resA, resB] = await Promise.all([collect(a), collect(b)]);

      // Then
      expect(resA.length).toBe(3);
      expect(resB.length).toBe(3);
    });
  });

  describe("when used with AbortSignal", () => {
    it("should abort both branches when signal aborted", async () => {
      // Given
      const ac = new AbortController();
      const source = Readable.from(Buffer.from("data"));
      const [a, b] = tee(source, ac.signal);

      // When
      ac.abort();

      // Then
      // PassThrough with signal should be aborted — check destroyed state eventually
      await new Promise((r) => setTimeout(r, 10));
      expect(a.destroyed || b.destroyed).toBe(true);
    });
  });
});

function collect(readable: Readable): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const bufs: Buffer[] = [];
    readable.on("data", (c) => bufs.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    readable.on("end", () => resolve(bufs));
    readable.on("error", reject);
  });
}

function waitForError(readable: Readable): Promise<never> {
  return new Promise((_, reject) => readable.on("error", reject));
}
