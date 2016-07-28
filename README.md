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

Another strike against TransforStream & its cousin WritableStream is that it
is not actually standardized yet, and not available in any browser.
Polyfilling is possible, but given the complexity & performance issues this
seemed to be less than desirable. 

Looking for a simpler solution, I realized that the `Reader` interface exposed
by ReadableStream is really pretty much all we need for stream transformation
& composition:

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

Results for a simple string eval loop benchmark, with minor performance tweaks
in the stream reference implementation:

```
node 4.4, native promise: 0.060 ms/iteration
node 4.4, bluebird:       0.022 ms/iteration
node 6.3, native promise: 0.061 ms/iteration
node 6.3, bluebird:       0.014 ms/iteration
```

Sadly, v8's Promises are still very slow compared to bluebird. While [v5.3
promises "20-40%" better Promise
performance](http://v8project.blogspot.com/2016/07/v8-release-53.html), it
will still have some catching up to do. Fortunately, on the server we can
happily continue to use bluebird, which saw a decent performance boost in Node
6.

Apart from Promise implementations, profiles show that the final
ReadableStream is a bottleneck. When cutting that out & using the returned
Reader interface directly, timings drop by about 2/3:

```
node 4.4., bluebird     : 0.00687 ms/iteration
node 6.3, bluebird      : 0.00457 ms/iteration
```

Considering that each `TransformStream` currently involves passing the chunk
through a) a `WritableStream`, and b) a `ReadableStream`, I think it's clear
that performance of `TransformStream` is not going to be something to write
home about, especially with the reference implementation.

## See also

- https://github.com/whatwg/streams/issues/461: Light weight transformations
