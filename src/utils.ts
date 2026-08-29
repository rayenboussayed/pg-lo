import { PassThrough, type Readable } from "node:stream";

/**
 * Split a `Readable` into two identical `PassThrough` streams.
 *
 * Both branches receive the same chunks in order. Backpressure is
 * respected — the source pauses if either branch's buffer fills and
 * resumes when both drain. Errors and `end` are forwarded to both.
 *
 * @param source - Source readable to tee.
 * @param signal - Optional `AbortSignal` to abort both branches.
 * @returns Tuple `[branch1, branch2]` — read from either independently.
 *
 * @example
 * ```ts
 * import { Readable } from "node:stream";
 * import { tee } from "./utils.js";
 *
 * const source = Readable.from(Buffer.from("hello world"));
 * const [a, b] = tee(source);
 * // a and b each emit "hello world"
 * ```
 */
export function tee(source: Readable, signal?: AbortSignal) {
  const pt1 = new PassThrough({
    signal,
    readableObjectMode: source.readableObjectMode,
    readableHighWaterMark: source.readableHighWaterMark,
    autoDestroy: true,
  });
  const pt2 = new PassThrough({
    signal,
    readableObjectMode: source.readableObjectMode,
    readableHighWaterMark: source.readableHighWaterMark,
    autoDestroy: true,
  });

  source.on("data", (chunk) => {
    const ok1 = pt1.write(chunk);
    const ok2 = pt2.write(chunk);
    if (!ok1 || !ok2) {
      source.pause();
    }
  });

  pt1.on("drain", () => {
    if (!pt2.writableNeedDrain) {
      source.resume();
    }
  });

  pt2.on("drain", () => {
    if (!pt1.writableNeedDrain) {
      source.resume();
    }
  });

  source.on("end", () => {
    if (!pt1.closed) pt1.end();
    if (!pt2.closed) pt2.end();
  });

  source.on("error", (error) => {
    if (!pt1.destroyed) pt1.destroy(error);
    if (!pt2.destroyed) pt2.destroy(error);
  });

  pt1.on("close", () => {
    if (!pt2.destroyed && !source.destroyed) {
      source.unpipe(pt1);
    }
  });

  pt2.on("close", () => {
    if (!pt1.destroyed && !source.destroyed) {
      source.unpipe(pt2);
    }
  });

  return [pt1, pt2] as const;
}
