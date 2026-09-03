import { Readable, Writable } from "node:stream";
import type { PgLoClient } from "./types.js";

/** Open mode for a large object. `r` = read, `w` = write, `rw` = read+write. */
export type LargeObjectOpenMode = "r" | "w" | "rw";

/** Whence for `lo_lseek64` — mirrors POSIX `SEEK_SET/CUR/END`. */
export enum SeekWhence {
  /** Seek from start of file. */
  SET = 0,
  /** Seek from current position. */
  CUR = 1,
  /** Seek from end of file. */
  END = 2,
}

/**
 * Handle to an open PostgreSQL large object.
 *
 * Wraps `loread`/`lowrite`/`lo_lseek64`/`lo_tell64`/`lo_close`.
 * Each instance corresponds to one `fd` from `lo_open`. All operations
 * must happen inside an open transaction.
 *
 * @example
 * ```ts
 * const lo = await manager.open(oid, "r");
 * await lo.seek(0, SeekWhence.SET);
 * const stream = lo.getReadableStream(16384);
 * // ... consume stream (auto-closes on EOF)
 * ```
 */
export class LargeObject {
  /** Underlying `pg` client (must be inside a transaction). */
  readonly client: PgLoClient;
  /** File descriptor returned by `lo_open`. */
  readonly fd: number;

  constructor(client: PgLoClient, fd: number) {
    this.client = client;
    this.fd = fd;
  }

  /**
   * Read up to `length` bytes from the current position.
   * @param length - Max bytes to read.
   * @returns Buffer with data; empty buffer on EOF, `null` if query returned no rows (e.g. invalid fd).
   */
  async read(length: number) {
    const res = await this.client.query<{ data: Buffer }>(
      "SELECT loread($1::int4, $2::int4) AS data",
      [this.fd, length],
    );
    if (res.rows.length === 0) return null;

    const data = res.rows[0]!.data;
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  /**
   * Write a buffer at the current position.
   * @param buffer - Bytes to write.
   */
  async write(buffer: Buffer) {
    await this.client.query("SELECT lowrite($1::int4, $2::bytea)", [
      this.fd,
      buffer,
    ]);
  }

  /**
   * Seek to `offset` relative to `whence`.
   * @param offset - Byte offset.
   * @param whence - Reference point (SET/CUR/END).
   * @returns New absolute position, or `null` if query returned no rows.
   */
  async seek(offset: number, whence: SeekWhence = SeekWhence.SET) {
    const res = await this.client.query<{ pos: string }>(
      "SELECT lo_lseek64($1, $2, $3) AS pos",
      [this.fd, offset, whence],
    );
    if (res.rows.length === 0) return null;
    return Number.parseInt(res.rows[0]!.pos);
  }

  /**
   * Get current position (bytes from start).
   * @returns Current offset, or `null` if unavailable (no rows).
   */
  async tell() {
    const res = await this.client.query<{ pos: string }>(
      "SELECT lo_tell64($1) AS pos",
      [this.fd],
    );
    if (res.rows.length === 0) return null;
    return Number.parseInt(res.rows[0]!.pos);
  }

  /**
   * Get total size of the large object without changing position.
   * Saves current offset, seeks to END, restores.
   * If `tell` returns `null`, restores to 0.
   * @returns Byte length of the object, or `null` if size could not be determined.
   */
  async size() {
    const cur = await this.tell();
    const end = await this.seek(0, SeekWhence.END);
    if (end === null) return null;
    // `tell` returns null when unavailable — avoid seeking to null
    const restorePos = cur === null ? 0 : cur;
    await this.seek(restorePos, SeekWhence.SET);
    return end;
  }

  /** Close the descriptor (`lo_close`). Call once done; streams auto-close on EOF. */
  async close() {
    await this.client.query("SELECT lo_close($1)", [this.fd]);
  }

  /**
   * Create a `Readable` that streams the object via `loread`.
   * Auto-closes the descriptor on EOF or error.
   *
   * @param chunkSize - Bytes per `loread` call (default 16384).
   * @param signal - Optional abort signal.
   * @returns Node `Readable` emitting `Buffer` chunks.
   */
  getReadableStream(chunkSize = 16384, signal?: AbortSignal) {
    const lo = this;
    let closed = false;
    return new Readable({
      signal,
      async read() {
        try {
          const data = await lo.read(chunkSize);
          if (!data || data.length === 0) {
            if (!closed) {
              closed = true;
              await lo.close();
            }
            this.push(null);
          } else {
            this.push(data);
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      },
    });
  }

  /**
   * Create a `Writable` that streams into the object via `lowrite`.
   * Auto-closes the descriptor on `final`.
   *
   * @param signal - Optional abort signal.
   * @returns Node `Writable` accepting `Buffer` chunks.
   */
  getWritableStream(signal?: AbortSignal) {
    const lo = this;
    return new Writable({
      signal,
      async write(chunk: Buffer, _encoding, callback) {
        try {
          await lo.write(chunk);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
      async final(callback) {
        try {
          await lo.close();
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });
  }
}
