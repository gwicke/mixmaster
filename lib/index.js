'use strict';

// Helper to make returns monomorphic.
function readerReturn(value, done) {
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

class ArrayReader {
    constructor(arr) {
        this._arr = arr;
        this._offset = arr.length - 1;
    }
    read() {
        if (this._offset >= 0) {
            return Promise.resolve(readerReturn(this._arr[this._offset--], false));
        } else {
            return Promise.resolve(readerReturn(undefined, true));
        }
    }
    cancel() {
        this._offset = -1;
    }
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
class FlatStreamReader {
    constructor(input, ctx) {
        this._reader = toReader(input);
        this._ctx = ctx;
        this._subStreamReader = null;
    }

    _handleReadRes(res) {
        if (res.done) {
            return res;
        }

        let chunk = res.value;
        // Fast path
        if (typeof chunk === 'string') {
            return res;
        }
        if (typeof chunk === 'function') {
            chunk = chunk(this._ctx);
        }
        if (chunk) {
            if (Array.isArray(chunk)) {
                this._subStreamReader = new ArrayReader(chunk);
                return this.read();
            }
            if (typeof chunk.then === 'function') {
                // Looks like a Promise.
                return chunk.then(val => {
                    res.value = val;
                    return this._handleReadRes(res);
                });
            }
            if (typeof chunk.getReader === 'function') {
                // Is a ReadableStream. Test based on
                // IsReadableStream in reference
                // implementation.
                this._subStreamReader = chunk.getReader();
                return this.read();
            }
        }
        res.value = chunk;
        return res;
    }

    read() {
        let readPromise;
        if (this._subStreamReader) {
            return this._subStreamReader.read()
            .then(res => {
                if (res.done) {
                    this._subStreamReader = null;
                    return this.read();
                }
                return this._handleReadRes(res);
            });
        } else {
            return this._reader.read().then(res => this._handleReadRes(res));
        }
    }

    cancel(reason) {
        if (this._subStreamReader) {
            this._subStreamReader.cancel(reason);
        }
        return this._reader.cancel && this._reader.cancel(reason);
    }
}

/**
 * Adapt a Reader to an UnderlyingSource, for wrapping into a ReadableStream.
 *
 * @param {Reader} reader
 * @return {ReadableStream}
 */
function readerToStream(reader) {
    return new ReadableStream({
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
    });
}

function toReader(s) {
    if (s) {
        if (typeof s.read === 'function') {
            // Looks like a Reader.
            return s;
        }
        if (typeof s.getReader === 'function') {
            // ReadableStream
            return s.getReader();
        }
        if (Array.isArray(s)) {
            return new ArrayReader(s);
        }
    }
    return new ArrayReader([s]);
}

function toStream(s) {
    if (s) {
        if (typeof s.getReader === 'function') {
            // Already a ReadableStream
            return s;
        }
        if (Array.isArray(s)) {
            return arrayToStream(s);
        }
        if (typeof s.read === 'function') {
            // Reader
            return readerToStream(s);
        }
    }
    return arrayToStream([s]);
}

function readToArray(s) {
    const reader = toReader(s);
    const accum = [];
    function pump() {
        return reader.read()
        .then(res => {
            if (res.done) {
                return accum;
            }
            accum.push(res.value);
            return pump();
        });
    }
    return pump();
}

function readToString(s) {
    const reader = toReader(s);
    let accum = '';
    function pump() {
        return reader.read()
        .then(res => {
            if (res.done) {
                return accum;
            }
            accum += res.value;
            return pump();
        });
    }
    return pump();
}

module.exports = {
    // Utilities
    toReader: toReader,
    toStream: toStream,
    readToArray: readToArray,
    readToString: readToString,
    // Chunk evaluation
    FlatStreamReader: FlatStreamReader,
};
