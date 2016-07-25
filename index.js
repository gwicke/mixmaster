'use strict';

const ReadableStream = require("web-streams-polyfill").ReadableStream;

// Duck-typed ReadableStream wrapping an array.
function makeArrayStream(arr) {
    let i = 0;
    return {
        getReader: function getReader() {
            return {
                read: () => {
                    if (i < arr.length) {
                        let j = i;
                        i++;
                        return Promise.resolve({
                            value: arr[j],
                            done: false,
                        });
                    } else {
                        return Promise.resolve({
                            value: undefined,
                            done: true,
                        });
                    }
                }
            };
        }
    };
}

/**
 * Apply several "remix" transforms to a stream, and return a
 * ReadableStream.
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
                    return Promise.resolve({
                        value: curMatch.matches.shift(),
                        done: false,
                    });
                } else {
                    return reader.read()
                        .then(res => {
                            if (res.done) {
                                if (curMatch.remainder) {
                                    curMatch.matches.push(curMatch.remainder);
                                    curMatch.remainder = '';
                                    return read();
                                }
                                return {
                                    value: undefined,
                                    done: true,
                                };
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

                        if (chunk instanceof ReadableStream) {
                            activeStreamReader = chunk.getReader();
                            return read();
                        } else if (chunk.then) {
                            // Duck typed Promise
                            return chunk.then(val => {
                                return {
                                    value: val,
                                    done: false,
                                };
                            });
                        } else {
                            return {
                                value: chunk,
                                done: false,
                            };
                        }
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

function readerToUnderlyingSource(reader, controller) {
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
};

