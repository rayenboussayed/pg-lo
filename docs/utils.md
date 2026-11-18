<a name="tee"></a>

## tee(source, signal) ⇒ <code>readonly [PassThrough, PassThrough]</code>
Split a `Readable` into two identical `PassThrough` streams.

Both branches receive the same chunks in order. Backpressure is
respected — the source pauses if either branch's buffer fills and
resumes when both drain. Errors and `end` are forwarded to both.

**Kind**: global function  
**Returns**: <code>readonly [PassThrough, PassThrough]</code> - Tuple `[branch1, branch2]` — read from either independently.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Readable</code> | Source readable to tee. |
| signal | <code>AbortSignal</code> | Optional `AbortSignal` to abort both branches. |

**Example**  
```ts
import { Readable } from "node:stream";
import { tee } from "./utils.js";

const source = Readable.from(Buffer.from("hello world"));
const [a, b] = tee(source);
// a and b each emit "hello world"
```
src: src/utils.ts:24  
dist: dist/utils.js:23
