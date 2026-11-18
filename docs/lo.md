## Classes

<dl>
<dt><a href="#LargeObject">LargeObject</a></dt>
<dd><p>Handle to an open PostgreSQL large object.</p>
<p>Wraps <code>loread</code>/<code>lowrite</code>/<code>lo_lseek64</code>/<code>lo_tell64</code>/<code>lo_close</code>.
Each instance corresponds to one <code>fd</code> from <code>lo_open</code>. All operations
must happen inside an open transaction.</p>
</dd>
</dl>

## Members

<dl>
<dt><a href="#SeekWhence">SeekWhence</a></dt>
<dd><p>Whence for <code>lo_lseek64</code> — mirrors POSIX <code>SEEK_SET/CUR/END</code>.</p>
</dd>
<dt><a href="#SeekWhence[undefined]">SeekWhence[undefined]</a></dt>
<dd><p>Seek from start of file.</p>
</dd>
<dt><a href="#SeekWhence[undefined]">SeekWhence[undefined]</a></dt>
<dd><p>Seek from current position.</p>
</dd>
<dt><a href="#SeekWhence[undefined]">SeekWhence[undefined]</a></dt>
<dd><p>Seek from end of file.</p>
</dd>
</dl>

<a name="LargeObject"></a>

## LargeObject
Handle to an open PostgreSQL large object.

Wraps `loread`/`lowrite`/`lo_lseek64`/`lo_tell64`/`lo_close`.
Each instance corresponds to one `fd` from `lo_open`. All operations
must happen inside an open transaction.

**Kind**: global class  
src: src/lo.ts:32  
dist: dist/lo.js:27

* [LargeObject](#LargeObject)
    * [new LargeObject()](#new_LargeObject_new)
    * [.client](#LargeObject+client)
    * [.fd](#LargeObject+fd)
    * [.read(length)](#LargeObject+read) ⇒ <code>Promise&lt;void&gt;</code>
    * [.write(buffer)](#LargeObject+write) ⇒ <code>Promise&lt;void&gt;</code>
    * [.seek(offset, whence)](#LargeObject+seek) ⇒ <code>Promise&lt;number&gt;</code>
    * [.tell()](#LargeObject+tell) ⇒ <code>Promise&lt;number&gt;</code>
    * [.size()](#LargeObject+size) ⇒ <code>Promise&lt;number&gt;</code>
    * [.close()](#LargeObject+close) ⇒ <code>Promise&lt;void&gt;</code>
    * [.getReadableStream(chunkSize, signal)](#LargeObject+getReadableStream) ⇒ <code>Readable</code>
    * [.getWritableStream(signal)](#LargeObject+getWritableStream) ⇒ <code>Writable</code>

<a name="new_LargeObject_new"></a>

### new LargeObject()
**Example**  
```ts
const lo = await manager.open(oid, "r");
await lo.seek(0, SeekWhence.SET);
const stream = lo.getReadableStream(16384);
// ... consume stream (auto-closes on EOF)
```
<a name="LargeObject+client"></a>

### largeObject.client
Underlying `pg` client (must be inside a transaction).

**Kind**: instance property of [<code>LargeObject</code>](#LargeObject)  
src: src/lo.ts:34  
dist: dist/lo.js:29
<a name="LargeObject+fd"></a>

### largeObject.fd
File descriptor returned by `lo_open`.

**Kind**: instance property of [<code>LargeObject</code>](#LargeObject)  
src: src/lo.ts:36  
dist: dist/lo.js:31
<a name="LargeObject+read"></a>

### largeObject.read(length) ⇒ <code>Promise&lt;void&gt;</code>
Read up to `length` bytes from the current position.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
**Returns**: <code>Promise&lt;void&gt;</code> - Buffer with data; empty buffer on EOF, `null` if query returned no rows (e.g. invalid fd).  

| Param | Description |
| --- | --- |
| length | Max bytes to read. |

src: src/lo.ts:48  
dist: dist/lo.js:41
<a name="LargeObject+write"></a>

### largeObject.write(buffer) ⇒ <code>Promise&lt;void&gt;</code>
Write a buffer at the current position.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  

| Param | Description |
| --- | --- |
| buffer | Bytes to write. |

src: src/lo.ts:63  
dist: dist/lo.js:52
<a name="LargeObject+seek"></a>

### largeObject.seek(offset, whence) ⇒ <code>Promise&lt;number&gt;</code>
Seek to `offset` relative to `whence`.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
**Returns**: <code>Promise&lt;number&gt;</code> - New absolute position, or `null` if query returned no rows.  

| Param | Type | Description |
| --- | --- | --- |
| offset | <code>number</code> | Byte offset. |
| whence | [<code>SeekWhence</code>](#SeekWhence) | Reference point (SET/CUR/END). |

src: src/lo.ts:76  
dist: dist/lo.js:64
<a name="LargeObject+tell"></a>

### largeObject.tell() ⇒ <code>Promise&lt;number&gt;</code>
Get current position (bytes from start).

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
**Returns**: <code>Promise&lt;number&gt;</code> - Current offset, or `null` if unavailable (no rows).  
src: src/lo.ts:89  
dist: dist/lo.js:74
<a name="LargeObject+size"></a>

### largeObject.size() ⇒ <code>Promise&lt;number&gt;</code>
Get total size of the large object without changing position.
Saves current offset, seeks to END, restores.
If `tell` returns `null`, restores to 0.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
**Returns**: <code>Promise&lt;number&gt;</code> - Byte length of the object, or `null` if size could not be determined.  
src: src/lo.ts:104  
dist: dist/lo.js:86
<a name="LargeObject+close"></a>

### largeObject.close() ⇒ <code>Promise&lt;void&gt;</code>
Close the descriptor (`lo_close`). Call once done; streams auto-close on EOF.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
src: src/lo.ts:115  
dist: dist/lo.js:97
<a name="LargeObject+getReadableStream"></a>

### largeObject.getReadableStream(chunkSize, signal) ⇒ <code>Readable</code>
Create a `Readable` that streams the object via `loread`.
Auto-closes the descriptor on EOF or error.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
**Returns**: <code>Readable</code> - Node `Readable` emitting `Buffer` chunks.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| chunkSize | <code>number</code> | <code>16384</code> | Bytes per `loread` call (default 16384). |
| signal | <code>AbortSignal</code> |  | Optional abort signal. |

src: src/lo.ts:127  
dist: dist/lo.js:108
<a name="LargeObject+getWritableStream"></a>

### largeObject.getWritableStream(signal) ⇒ <code>Writable</code>
Create a `Writable` that streams into the object via `lowrite`.
Auto-closes the descriptor on `final`.

**Kind**: instance method of [<code>LargeObject</code>](#LargeObject)  
**Returns**: <code>Writable</code> - Node `Writable` accepting `Buffer` chunks.  

| Param | Type | Description |
| --- | --- | --- |
| signal | <code>AbortSignal</code> | Optional abort signal. |

src: src/lo.ts:158  
dist: dist/lo.js:140
<a name="SeekWhence"></a>

## SeekWhence
Whence for `lo_lseek64` — mirrors POSIX `SEEK_SET/CUR/END`.

**Kind**: global variable  
src: src/lo.ts:8  
dist: dist/lo.js:3
<a name="SeekWhence[undefined]"></a>

## SeekWhence[undefined]
Seek from start of file.

**Kind**: global variable  
src: src/lo.ts:10  
dist: dist/lo.js:6
<a name="SeekWhence[undefined]"></a>

## SeekWhence[undefined]
Seek from current position.

**Kind**: global variable  
src: src/lo.ts:12  
dist: dist/lo.js:8
<a name="SeekWhence[undefined]"></a>

## SeekWhence[undefined]
Seek from end of file.

**Kind**: global variable  
src: src/lo.ts:14  
dist: dist/lo.js:10
