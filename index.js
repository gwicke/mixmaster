'use strict';

// Benchmarking option. Results of simple repeat eval loop, with minor
// performance tweaks in the stream reference implementation:
//
// node 4.4, native promise: 0.060 ms/iteration
// node 4.4, bluebird:       0.022 ms/iteration
// node 6.3, native promise: 0.061 ms/iteration
// node 6.3, bluebird:       0.014 ms/iteration
//
// global.Promise = require('bluebird');
const ReadableStream = require("web-streams-polyfill").ReadableStream;

function readReturn(value, done) {
    return {
        value: value,
        done: done,
    };
}

/**
 * Duck-typed ReadableStream wrapping an array.
 *
 * @param {Array} arr, the array to wrap into a stream.
 * @return {ReadableStream}
 */
function makeArrayStream(arr) {
    let i = 0;
    return {
        getReader: function getReader() {
            return {
                read: () => {
                    if (i < arr.length) {
                        let val = arr[i];
                        i++;
                        return Promise.resolve(readReturn(val, false));
                    } else {
                        return Promise.resolve(readReturn(undefined, true));
                    }
                }
            };
        }
    };
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
        input = makeArrayStream(input);
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
 * @param {function} matchFn, a function(chunk: string) ->
 *                   { matches: [Array<string>], remainder: string }
 * @return {function(Reader) -> Reader}
 */
function matchTransform(matchFn) {
    return function makeReader(reader) {
        let curMatch = {
            matches: [],
            remainder: '',
        };
        return {
            // No start() handler.
            read: function read() {
                if (curMatch.matches.length) {
                    let chunk = curMatch.matches.shift();
                    if (typeof chunk === 'string') {
                        // Coalesce string chunks for efficiency
                        while (curMatch.matches.length
                                && (typeof curMatch.matches[0]) === 'string') {
                            chunk += curMatch.matches.shift();
                        }
                    }
                    return Promise.resolve(readReturn(chunk, false));
                } else {
                    return reader.read()
                        .then(res => {
                            if (res.done) {
                                if (curMatch.remainder) {
                                    curMatch.matches.push(curMatch.remainder);
                                    curMatch.remainder = '';
                                    return read();
                                }
                                return readReturn(undefined, true);
                            }
                            curMatch = matchFn(curMatch.remainder + res.value);
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
    makeArrayStream: makeArrayStream,
    streamToArray: streamToArray,
};

