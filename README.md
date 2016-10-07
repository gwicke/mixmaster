# Web-stream-util

Utilities for working with [web streams](https://streams.spec.whatwg.org/),
including utilities for light-weight stream transforms modeled on the `Reader`
interface.

With [`ReadableStream` now available in
ServiceWorkers](https://jakearchibald.com/2016/streams-ftw/), streaming
transformation & composition of HTML has become an attractive option for
server-side and client-side low-latency page composition. To this end, this
project provides utilities for working with streams and `Reader` objects.

A `Reader` [as defined in the stream
spec](https://streams.spec.whatwg.org/#default-reader-class) has mainly two
methods: 

- `read(): Promise<ResultObject>`, with `ResultObject` an object with a `done`
    boolean & value mixed property. If `done` is false, value is undefined.
    Once `done` is true, value is undefined & the stream is exhausted.
- `cancel(reason)`: Cancel the stream.

These are the main methods, but there are also `releaseLock()` and a `closed`
getter.

## Reader transforms

This library defines some utilities for working with transforms modeled on
this `Reader` interface. One such transform for HTML is
[web-html-stream](https://github.com/wikimedia/web-html-stream), a streaming
HTML element match & transform exposing a `Reader` interface. Its
`HTMLTransformReader` constructor is passed an input `ReadableStream`,
`Reader`, or an Array that can be adapted to a stream:

```javascript
return fetch('http://example.com')
.then(response => {
    // Transform the incoming HTML
    const htmlReader = new HTMLTransformReader(response.body, transformOptions);
    // Convert Reader to a ReadableStream using Web-stream-util's toStream()
    return webStreamUtil.toStream(htmlReader);
});
```

Since each transform implements a `Reader` interface & takes a `Reader` as
input, it is fairly easy to build up transform chains. See [this demo
ServiceWorker](https://github.com/gwicke/streaming-serviceworker-playground/blob/master/lib/sw.js)
for an example of more interesting transform chains.


## API

### `toReader(input: Reader|ReadableStream|Array|String|Buffer): Reader`

Adapts a variety of input types to a `Reader`.

### `toStream(input: toReader-able): ReadableStream`

Adapts a variety of `Reader`-convertible types to a `ReadableStream`. The
`ReadableStream` constructor is expected to be available in the global
environment.

### `readToArray(input: toReader-able): Promise<Array>`

Drains anything that can be adapted to a `Reader` to an Array.


### `readToString(input: toReader-able): Promise<String>`

Drains anything that can be adapted to a `Reader` to a string. Converts
`Buffer` or `ArrayBuffer`s to String using a `TextDecoder` instance.

### `new TextDecodeReader(input: toReader-able): Reader<String>`

Decodes a stream of `Buffer` or `ArrayBuffer`s to a string stream, using
a `TextDecoder`.

### `new TextEncodeReader(input: toReader-able): Reader<Buffer|ArrayBuffer>`

Encodes a stream of `String`s into a stream of `Buffer`s (node) or
`ArrayBuffer`s (browser).

### `new FlatStreamReader(input: toReader-able, ctx): Reader`

Flattens / evaluates a stream of complex objects into plain values like Strings
and Buffers. Evaluation rules:

- `function f`: Call `f(ctx)`, evaluate result.
- `Promise`: Wait for Promise to resolve, evaluate result.
- `Reader`: Splice in / read sub-reader, and evaluate each returned value.
- `ReadableStream`: Splice in / read sub-stream, and evaluate each returned
    value.
- `String`, `Buffer`, `Number` etc: Pass through.

In a typical streaming composition pipeline, this transform is placed at the
end of the pipeline, producing a single, flattened stream of values. An
especially interesting use is the pre-compilation of templates into arrays of
strings and functions, which can then be efficiently evaluated with
FlatStreamReader at runtime.


## See also

- [web-html-stream](https://github.com/wikimedia/web-html-stream): Streaming
    HTML transformation, targeting elements with CSS selectors.
- [streaming-serviceworker-playground](https://github.com/gwicke/streaming-serviceworker-playground), a demo ServiceWorker using this library & web-html-stream for streaming HTML composition.
- [node-serviceworker](https://github.com/gwicke/node-serviceworker) and
    [node-serviceworker-proxy](https://github.com/gwicke/node-serviceworker-proxy), a server-side (node) ServiceWorker execution environment and -proxy with streaming support, executing ServiceWorker code on behalf of clients without ServiceWorker support.
- https://github.com/whatwg/streams/issues/461: Light weight TransformStream
    discussion in the stream spec project.
