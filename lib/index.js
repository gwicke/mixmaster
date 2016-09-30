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
        this._index = 0;
    }
    read() {
        if (this._index < this._arr.length) {
            return Promise.resolve(readerReturn(this._arr[this._index++], false));
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
        this._subStreamReaderStack = [];
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
                this._subStreamReaderStack.push(new ArrayReader(chunk));
                return this.read();
            }
            if (typeof chunk.then === 'function') {
                // Looks like a Promise.
                return chunk.then(val => {
                    res.value = val;
                    return this._handleReadRes(res);
                });
            }
            if (typeof chunk.read === 'function') {
                // Reader.
                this._subStreamReaderStack.push(chunk);
                return this.read();
            }
            if (typeof chunk.getReader === 'function') {
                // ReadableStream.
                this._subStreamReaderStack.push(chunk.getReader());
                return this.read();
            }
        }
        res.value = chunk;
        return res;
    }

    read() {
        if (this._subStreamReaderStack.length) {
            return this._subStreamReaderStack[this._subStreamReaderStack.length - 1].read()
            .then(res => {
                if (res.done) {
                    this._subStreamReaderStack.pop();
                    return this.read();
                }
                return this._handleReadRes(res);
            });
        } else {
            return this._reader.read().then(res => this._handleReadRes(res));
        }
    }

    cancel(reason) {
        if (this._subStreamReaderStack.length) {
            this._subStreamReaderStack.map(reader => reader.cancel(reason));
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
        pull(controller) {
            return reader.read()
                .then(res => {
                    if (res.done) {
                        controller.close();
                    } else {
                        controller.enqueue(res.value);
                    }
                });
        },
        cancel(reason) { return reader.cancel(reason); }
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
    const decoder = new TextDecoder();
    let accum = '';
    function pump() {
        return reader.read()
        .then(res => {
            if (res.done) {
                // TODO: check decoder for completeness.
                return accum;
            }
            accum += decoder.decode(res.value, { stream: true });
            return pump();
        });
    }
    return pump();
}

class TextDecodeReader {
    constructor(reader) {
        this._reader = toReader(reader);
        this._decoder = new TextDecoder();
    }

    read() {
        return this._reader.read()
        .then(res => {
            if (res.done) {
                // TODO: Throw error if the decoder still holds onto some
                // undecoded bytes!
                return res;
            }
            res.value = this._decoder.decode(res.value, { stream: true });
            return res;
        });
    }
    cancel(reason) {
        this._reader.cancel(reason);
    }
}

class TextEncodeReader {
    constructor(reader) {
        this._reader = toReader(reader);
        this._encoder = new TextEncoder();
    }

    read() {
        return this._reader.read()
        .then(res => {
            if (res.done) {
                // TODO: Throw error if the decoder still holds onto some
                // undecoded bytes!
                return res;
            }
            res.value = this._encoder.encode(res.value);
            return res;
        });
    }
    cancel(reason) {
        this._reader.cancel(reason);
    }
}

module.exports = {
    // Utilities
    toReader: toReader,
    toStream: toStream,
    readToArray: readToArray,
    readToString: readToString,
    // Text encode / decode (to/from byte) stream conversions
    TextDecodeReader: TextDecodeReader,
    TextEncodeReader: TextEncodeReader,
    // Chunk evaluation
    FlatStreamReader: FlatStreamReader,
};
