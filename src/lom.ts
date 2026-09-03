import { LargeObject, SeekWhence, type LargeObjectOpenMode } from "./lo.js";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
import { tee } from "./utils.js";
import path from "node:path";
import type { PgLoClient } from "./types.js";

/** Flag for `lo_open` — write. Matches PostgreSQL `INV_WRITE`. */
const INV_WRITE = 0x00020000;
/** Flag for `lo_open` — read. Matches PostgreSQL `INV_READ`. */
const INV_READ = 0x00040000;

/**
 * Manages PostgreSQL large objects (`pg_largeobject`) with filesystem caching.
 *
 * Each large object is identified by an `oid`. This manager:
 * - creates / opens / unlinks objects via `lo_*` SQL,
 * - streams data via `LargeObject`,
 * - caches payloads under `tmpDir/<oid>` to avoid repeated DB reads.
 *
 * All `lo_*` calls must run inside a transaction. The caller is
 * responsible for `BEGIN`/`COMMIT`/`ROLLBACK`.
 *
 * @example
 * ```ts
 * import { Client } from "pg";
 * import { createPgLo } from "./index.js";
 *
 * const client = new Client({ connectionString: process.env.DATABASE_URL });
 * await client.connect();
 * const lom = createPgLo({ client, tmpDir: "./tmp/pg-lo" });
 *
 * await client.query("BEGIN");
 * const oid = await lom.createFromStream(Readable.from(Buffer.from("hello")));
 * await client.query("COMMIT");
 * ```
 */
export class LargeObjectManager {
  constructor(
    private readonly client: PgLoClient,
    private readonly tmpDir: string,
  ) {}

  /** Build cache file path for an oid. */
  private createCachePath(oid: number) {
    return path.join(this.tmpDir, `${oid}`);
  }

  /**
   * Create a new empty large object.
   * @returns The new `oid`.
   */
  async create() {
    const res = await this.client.query<{ oid: number }>(
      "SELECT lo_create(0) AS oid",
    );
    return res.rows[0]!.oid;
  }

  /**
   * Open an existing large object.
   * @param oid - Object id.
   * @param mode - Open mode: `r` (read), `w` (write), `rw` (both). Default `r`.
   * @returns `LargeObject` handle (caller must `close()` or use stream auto-close).
   */
  async open(oid: number, mode: LargeObjectOpenMode = "r") {
    let m = 0;
    if (mode.includes("r")) m |= INV_READ;
    if (mode.includes("w")) m |= INV_WRITE;
    const res = await this.client.query<{ fd: number }>(
      "SELECT lo_open($1, $2) AS fd",
      [oid, m],
    );
    return new LargeObject(this.client, res.rows[0]!.fd);
  }

  /**
   * Create a new large object from a `Readable`.
   *
   * Streams data into Postgres (`lowrite`) and concurrently caches to
   * `tmpDir/<oid>` via `tee`. Resolves with the new `oid` when the
   * DB write finishes. Cache write happens asynchronously via `setImmediate`.
   *
   * Must be called inside a transaction.
   *
   * @param readable - Source stream.
   * @param signal - Optional abort signal.
   * @returns The new `oid`.
   */
  async createFromStream(readable: Readable, signal?: AbortSignal) {
    const oid = await this.create();
    const lo = await this.open(oid, "w");

    const [tee1, tee2] = tee(readable, signal);

    const cachePath = this.createCachePath(oid);

    // let the pg start storing first then cache it
    setImmediate(() => {
      pipeline(
        tee1,
        fs.createWriteStream(cachePath, {
          highWaterMark: readable.readableHighWaterMark,
          signal,
        }),
        {
          signal,
        },
      ).catch(() => {
        fs.promises.unlink(cachePath).catch(() => {});
      });
    });

    const writable = lo.getWritableStream(signal);
    return new Promise<number>((resolve, reject) => {
      tee2.once("error", reject);
      writable.once("error", reject);
      writable.once("finish", () => resolve(oid));
      pipeline(tee2, writable, { signal }).catch(reject);
    });
  }

  /**
   * Open a readable stream for an existing large object.
   *
   * If a cache file exists at `tmpDir/<oid>`, returns a fast
   * `fs.createReadStream`. Otherwise streams from Postgres and
   * populates the cache in the background (via `tee` + `setImmediate`).
   *
   * Must be called inside a transaction when reading from DB (cache
   * hits avoid DB).
   *
   * @param oid - Object id.
   * @param chunkSize - Bytes per `loread` (default 16384).
   * @param signal - Optional abort signal.
   * @returns Readable emitting `Buffer` chunks.
   */
  async openReadableStream(
    oid: number,
    chunkSize = 16384,
    signal?: AbortSignal,
  ) {
    const cachePath = this.createCachePath(oid);
    if (fs.existsSync(cachePath)) {
      return fs.createReadStream(cachePath, { signal }) as Readable;
    }
    const lo = await this.open(oid, "r");
    await lo.seek(0, SeekWhence.SET);
    const readable = lo.getReadableStream(chunkSize, signal);

    const [tee1, tee2] = tee(readable, signal);
    // let the consumer consume first then cache it
    setImmediate(() => {
      pipeline(
        tee1,
        fs.createWriteStream(cachePath, {
          highWaterMark: readable.readableHighWaterMark,
          signal,
        }),
        {
          signal,
        },
      ).catch(() => {
        fs.promises.unlink(cachePath).catch(() => {});
      });
    });

    return tee2 as Readable;
  }

  /**
   * Delete a large object and its cache file.
   * @param oid - Object id to remove.
   */
  async unlink(oid: number) {
    await Promise.all([
      this.client.query("SELECT lo_unlink($1)", [oid]),
      fs.promises.unlink(this.createCachePath(oid)).catch(() => {}),
    ]);
  }

  /**
   * Get byte size of an existing large object.
   * Uses cache `stat` if available, otherwise queries DB via `LargeObject.size()`.
   * @param oid - Object id.
   * @returns Byte length, or `null` if unavailable (no rows).
   */
  async sizeOf(oid: number) {
    const cachePath = this.createCachePath(oid);
    if (fs.existsSync(cachePath)) {
      return fs.promises.stat(cachePath).then((stats) => stats.size);
    }
    const lo = await this.open(oid, "r");
    const size = await lo.size();
    await lo.close();
    return size;
  }
}
