# mixmaster

With [`ReadableStream` available in
ServiceWorkers](https://jakearchibald.com/2016/streams-ftw/), streaming
transformation & composition of HTML & other content is becoming a hot topic.
This project aims to provide a streaming composition layer with support for
matching both HTML elements (via
[elematch](https://github.com/wikimedia/elematch)), as well as template syntax
like Mustache.

The [whatwg streams team](https://streams.spec.whatwg.org/) is currently
developing a `TransformStream` abstraction, which is meant to provide a
standardized interface for stream transformations. There is also a [reference
implementation](https://github.com/whatwg/streams), but after perusing the
code for a bit I got the sinking feeling that there are way too many moving
parts, and overheads for each transform are going to be high. Some of those
issues might be specific to the reference implementation, but the conceptual
complexity is still very high. Basic functionality like propagating
backpressure through transforms requires rather complex logic, involving
several callbacks & reading of buffer states.

Another short-term issue with TransforStream & WritableStream is that it is
not actually standardized yet, and not available in any browser. Polyfilling
is possible, but given the complexity & performance issues this looks less
desirable for light-weight transforms. 

Looking for a simpler solution that still integrates well with the streams
framework, I realized that the `Reader` interface exposed by ReadableStream is
really pretty much all we need for stream transformation & composition:

```javascript
const reader = readableStream.getReader();

// Read one chunk. Repeat until done.
reader.read()
    .then(res => {
        if (res.done) { 
            /* stream is done */ 
        } else {
           console.log('next chunk:', res.value);
        }
    });

// Cancel the stream before it is done.
reader.cancel();
```

This is a basic Promise pull interface, which implicitly maintains
backpressure, propagates failures, and lets us minimize the number of Promise
instances allocated by passing them through transforms.

Using the `Reader` interface, composition of transforms is fairly easy:
```javascript
const firstTransformReader = makeFirstTransform(inputStreamReader);
const secondTransformReader = makeSecondTransform(firstTransformReader);
```

Optionally, we can wrap the final `Reader` into a `ReadableStream` by adapting
it to the `UnderlyingSource` expected:
```javascript
const outStream = new ReadableStream(readerToUnderlyingSource(secondTransformReader));
```

## Performance

Results for a simple string eval loop benchmark, with [minor performance
tweaks in the stream reference
implementation](https://github.com/whatwg/streams/compare/master...gwicke:performance_improvements):

```
node 4.4, native promise: 0.060 ms/iteration
node 4.4, bluebird:       0.022 ms/iteration
node 6.3, native promise: 0.061 ms/iteration
node 6.3, bluebird:       0.014 ms/iteration
```

v8's Promises are still very slow compared to bluebird. While [the v5.3
announcement mentions "20-40%" better Promise
performance](http://v8project.blogspot.com/2016/07/v8-release-53.html), it
will still have some catching up to do. In practice, this is not much of an
issue, as we can continue to use bluebird on the server. It would however be
nice to eventually get decent performance without having to pull in a third
party library.

Apart from Promise implementations, profiles show that the final
ReadableStream is a bottleneck. When cutting that out & using the returned
Reader interface directly, timings drop by about 2/3:

```
node 4.4., bluebird     : 0.00687 ms/iteration
node 6.3, bluebird      : 0.00457 ms/iteration
```

Considering that each `TransformStream` stage in a pipeline currently involves
passing the chunk through a `WritableStream` *and* `ReadableStream`, it is not
surprising that the performance using the reference implementation is less
than ideal. While aggressive optimizations could potentially be applied at the
level of `stream.pipeThrough(new TransformStream({ transform() {..}, flush()
{..} }))`, the need to support concurrent `enqueue` calls and thus buffering
between stages will very likely add a performance tax over simpler
one-call-at-a-time pull interfaces, even in highly optimized implementations.

## Musings on a push/pull mode for streams

Currently, `ReadableStream` mixes push & pull interfaces in its
`UnderlyingSource` interface. I do wonder if it would be cleaner to separate
the two, and focusing only on the `Reader` and [WritableStream
interfaces](https://streams.spec.whatwg.org/#ws-prototype). The benefit of
such a change would be that `write`, in contrast to `enqueue`, returns a
Promise, which makes it significantly more straightforward to handle
back pressure correctly. It would also reduce the number of overlapping
interfaces in the streams ecosystem, making it easier to use.

In this alternate scheme, a hypothetical `PushPullStream` would be able to
operate in two distinct modes: Either `pull` or `push`. When constructed
without an underlying source (`new PushPullStream()`), it would start out in
"push" mode, with the [writable
interface](https://streams.spec.whatwg.org/#ws-prototype) active. For pull
mode and piping, the stream could either be constructed with an underlying
Stream or Reader (`new PushPullStream(stream_or_reader)`), or a pull source
could be dynamically assigned with `stream.pullFrom(stream_or_reader|null)`.
Switching to pull mode would implicitly disable the push interface, and
indicate this via the `state` getter (part of the writable interface).
Attempts to use `write()` et al while in `pull` mode would throw. The
implementation of `pipeTo` would amount to roughly
`pipeTo(otherStream) { otherStream.pullFrom(this); return otherStream;
}`. The separate `pipeThrough` method would no longer be needed.

Such a `PushPullStream` interface would only be exposed by consumers. Pure
producers would continue to expose only the `Reader`
interface.

## See also

- https://github.com/whatwg/streams/issues/461: Light weight transformations
