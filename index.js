'use strict';

// Benchmarking option & what we'd use server-side.
// global.Promise = require('bluebird');

if (!global.ReadableStream) {
    global.ReadableStream = require("web-streams-polyfill").ReadableStream;
}

function readReturn(value, done) {
    return {
        value: value,
        done: done,
    };
}

/**
 * ReadableStream wrapping an array.
 *
 * @param {Array} arr, the array to wrap into a stream.
 * @return {ReadableStream}
 */
function arrayToStream(arr) {
    return new ReadableStream({
        start(controller) {
            for (var i = 0; i < arr.length; i++) {
                controller.enqueue(arr[i]);
            }
            controller.close();
        }
    });
}

/**
 * @param {ReadableStream or Reader} stream, the stream or reader to convert
 * to an array
 * @return {Promise<Array>}, array containing chunks of the stream.
 */
function streamToArray(stream) {
    let reader;
    if (stream && stream._readableStreamController) {
        reader = stream.getReader();
    } else if (stream && stream.read) {
        reader = stream;
    } else {
        throw new TypeError("A stream is required.");
    }

    let accum = [];
    function pump() {
        return reader.read()
            .then(res => {
                if (res.done) { return accum; }
                accum.push(res.value);
                return pump();
            });
    }
    return pump();
}


/**
 * Apply several "remix" transforms to a stream, and return a
 * ReadableStream.
 *
 * @param {ReadableStream|Array} input
 * @param {Array} transforms, array of functions taking a Reader & returning a
 * Reader interface.
 * @param {object} options, options passed to the ReadableStream constructor.
 * @return {ReadableStream}
 */
function transformStream(input, transforms, options) {
    // Questions
    // - matcher: handle partial matches internally vs. external
    //   - internal more flexible
    //   - still need signal completion

    if (Array.isArray(input)) {
        input = arrayToStream(input);
    }
    let reader = input.getReader();

    if (!Array.isArray(transforms)) {
        throw new Error("Transforms array expected.");
    }

    // Set up the pipeline
    transforms.forEach(function(makeReader) {
        reader = makeReader(reader);
    });

    // Pipe the last element of our pipeline to the outStream.
    return new ReadableStream(readerToUnderlyingSource(reader), options);
}

/**
 * Wrap a synchronous string match function returning matches & remainder
 * properties in a Reader transform.
 *
 * @param {object} matcher, an object exposing the following interface:
 *   match(chunk: mixed) -> { values: [Array<mixed>], done: boolean }
 *   reset(), optional; resets internal state in case of incomplete matches.
 * @return {function(Reader) -> Reader}
 */
function matchTransform(matcher) {
    return function makeReader(reader) {
        let curMatch = {
            values: [],
            done: false,
        };
        return {
            // No start() handler.
            read: function read() {
                if (curMatch.values.length) {
                    let chunk = curMatch.values.shift();
                    if (typeof chunk === 'string') {
                        // Coalesce string chunks for efficiency
                        while (curMatch.values.length
                                && (typeof curMatch.values[0]) === 'string') {
                            chunk += curMatch.values.shift();
                        }
                    }
                    return Promise.resolve(readReturn(chunk, false));
                } else {
                    return reader.read()
                        .then(res => {
                            if (res.done) {
                                if (!curMatch.done) {
                                    if (matcher.reset) {
                                        matcher.reset();
                                    }
                                    throw new Error("MatchTransform: No full match, but input stream terminated!");
                                }
                                // Prepare for next match
                                curMatch.done = true;
                                return readReturn(undefined, true);
                            }
                            curMatch = matcher.match(res.value);
                            return read();
                        });
                }
            },
            cancel: function cancel(reason) { return reader.cancel && reader.cancel(); }
        };
    };
}

/**
 * Chunk evaluation transform:
 * - functions are called with ctx parameter,
 * - Promises are resolved to a value,
 * - ReadableStreams are spliced into the main string, and
 * - all other types are passed through unchanged.
 *
 * @param {object} ctx, a context object passed to function chunks.
 * @return {function(Reader) -> Reader}
 */
function evalTransform(ctx) {
    return function makeReader(reader) {
        let activeStreamReader = null;
        return {
            // No start() handler.
            read: function read() {
                if (activeStreamReader) {
                    // Do not double-eval sub-streams.
                    return activeStreamReader.read()
                        .then(res => {
                            if (res.done) {
                                activeStreamReader = null;
                                return read();
                            }
                            return res;
                        });
                }
                return reader.read()
                    .then(res => {
                        if (res.done) {
                            return res;
                        }
                        let chunk = res.value;
                        if (typeof chunk === 'function') {
                            chunk = chunk(ctx);
                        }

                        if (chunk) {
                            if (chunk._readableStreamController) {
                                // Is a ReadableStream. Test based on
                                // IsReadableStream in reference
                                // implementation.
                                activeStreamReader = chunk.getReader();
                                return read();
                            } else if (chunk.then && typeof chunk.then === 'function') {
                                // Looks like a Promise.
                                return chunk.then(val => readReturn(val, false));
                            }
                        }
                        return readReturn(chunk, false);
                    });
            },
            cancel: function cancel(reason) {
                if (activeStreamReader) {
                    activeStreamReader.cancel();
                }
                return reader.cancel && reader.cancel();
            }
        };
    };
}

/**
 * Adapt a Reader to an UnderlyingSource, for wrapping into a ReadableStream.
 *
 * @param {Reader} reader
 * @return {UnderlyingSource} to be used with ReadableStream constructor.
 */
function readerToUnderlyingSource(reader) {
    return {
        pull: controller => {
            return reader.read()
                .then(res => {
                    if (res.done) {
                        controller.close();
                    } else {
                        controller.enqueue(res.value);
                    }
                });
        },
        cancel: reason => reader.cancel(reason)
    };
}

module.exports = {
    transformStream: transformStream,
    matchTransform: matchTransform,
    evalTransform: evalTransform,
    arrayToStream: arrayToStream,
    streamToArray: streamToArray,
};

