import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPgLo } from "../../src/index.js";
import type { Client } from "pg";

/**
 * Tests for createPgLo factory.
 */
describe("createPgLo", () => {
  let tmpDir: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pg-lo-index-"));
    client = { query: vi.fn() } as unknown as Client;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should create LargeObjectManager with given client and tmpDir", async () => {
    // Given
    const manager = createPgLo({ client, tmpDir });

    // When / Then
    expect(manager).toBeDefined();
    // verify manager uses same tmpDir by checking create creates file in that dir via real integration
    // For unit we check property via private field access
    expect((manager as unknown as { tmpDir: string }).tmpDir).toBe(tmpDir);
  });

  it("should default tmpDir to <cwd>/tmp/pg-lo", async () => {
    // Given
    const manager = createPgLo({ client });

    // When / Then
    expect((manager as unknown as { tmpDir: string }).tmpDir).toBe(path.join(process.cwd(), "tmp/pg-lo"));
  });

  it("should register beforeExit cleanup when deleteTmpDirOnExit true", async () => {
    // Given
    const onceSpy = vi.spyOn(process, "once");
    const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined as unknown as void);
    const dir = path.join(tmpDir, "to-delete");

    await fs.promises.mkdir(dir, { recursive: true });

    // When
    createPgLo({ client, tmpDir: dir, deleteTmpDirOnExit: true });

    // Then
    expect(onceSpy).toHaveBeenCalledWith("beforeExit", expect.any(Function));
    // simulate beforeExit
    const cb = onceSpy.mock.calls.find((c) => c[0] === "beforeExit")?.[1] as () => void;
    cb();
    expect(rmSpy).toHaveBeenCalledWith(dir, { force: true, recursive: true });
  });

  it("should not register beforeExit when deleteTmpDirOnExit false", async () => {
    // Given
    const onceSpy = vi.spyOn(process, "once");

    // When
    createPgLo({ client, tmpDir, deleteTmpDirOnExit: false });

    // Then
    expect(onceSpy).not.toHaveBeenCalled();
  });
});
