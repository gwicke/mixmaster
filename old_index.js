'use strict';

var EleMatch = require('elematch');
const ReadableStream = require("web-streams-polyfill").ReadableStream;

/**
 * MixMaster: Mix & transform streams, and return a merged ReadableStream.
 *
 * TODO:
 * - Hook up real ReadableStream
 * - Tests
 * elematch & mustachio to expose:
 *   makeTransform(options) -> transform(chunk, enqueueInReadableCb, transformDoneCb)
 * streams standard:
 *   new TransformStream(transform) -> { writable, readable }
 * WritableStream not yet available, so provide:
 * mixmaster.pipeThroughTransform(input, transform) -> ReadableStream
 *   equivalent to: input.pipeThrough(new TransformStream(transform))
 *      alternative: polyfill pipeTo and pipeThrough
 *
 */



function pipeToCb(stream, cb) {
    var reader = stream.getReader();
    return reader.read()
        .then(function pump(res) {
            if (res.done) {
                return;
            }
            cb(res.value);
            return reader.read()
                .then(pump);
        });
}

function zipMatches(matches, cb, ctx, offset) {
    offset = offset || 0;
    var bit = matches[offset];
    var bitType = typeof bit;
    var ret;
    if (bitType === 'string') {
        ret = bit;
    } else if (bitType === 'function') {
        ret = bit(ctx);
    } else if (bit instanceof ReadableStream) {
        // Pipe to controller
        ret = pipeToCb(bit, cb);
    } else if (bit.then) {
        // Duck typed Promise
        ret = bit;
    }
    return Promise.resolve(ret)
        .then(cb)
        .then(() => {
            if (offset < matches.length - 1) {
                return zipMatches(matches, cb, ctx, offset + 1);
            } else {
                return;
            }
        });
}

function makePageZipper(inStream, matcher, ctx) {
    var stream = new ReadableStream({
        start(controller) {
            var remainder = '';
            // Get a lock on the stream
            var reader = inStream.getReader();
            return reader.read()
                .then(function process(result) {
                    if (result.done) {
                        if (remainder) {
                            throw new Error('Still have content to process, '
                                    + 'but input stream ended!');
                        }
                        controller.close();
                        return;
                    }

                    var match = matcher.matchAll(remainder + result.value,
                            { ctx: ctx });
                    remainder = match.remainder || '';

                    return zipMatches(match.matches,
                            controller.enqueue.bind(controller), ctx)
                        .then(process);
                });
        }
    });
    return stream;
}

// Strawman
function test() {
    var handler = function(node) { return function() { return node; } };
    var matcher = new EleMatch({
        'test-element[foo="bar"]': handler,
        'foo-bar': handler,
    });
    var testDoc = "<html><body><div>"
        + "<test-element foo='bar'>foo</test-element>"
        + "</div></body>";
    var inStream = {
        getReader() {
            var isDone = false;
            return {
                read() {
                    if (isDone) {
                        return Promise.resolve({ done: true });
                    } else {
                        isDone = true;
                        return Promise.resolve({
                            value: testDoc,
                            done: false,
                        });
                    }
                }
            };
        }
    };
    var zipper = makePageZipper(inStream, matcher);
    var zipReader = zipper.getReader();
    // Consume the stream.
    zipReader.read()
    .then(function print(res) {
        if (res.done) {
            return;
        }
        console.log(res.value);
        return zipReader.read().then(print);
    });
}

test();
