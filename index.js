'use strict';

// Node entry point.

const StringDecoder = require('string_decoder').StringDecoder;

// Polyfill ReadableStream, if needed.
if (global && !global.ReadableStream) {
    global.ReadableStream = require("web-streams-polyfill").ReadableStream;
}

class TextDecoder {
    constructor() {
        this._decoder = new StringDecoder();
    }
    decode(input, options) {
        // TODO: support options
        if (Buffer.isBuffer(input)) {
            return this._decoder.write(input);
        } else {
            throw new Error("Expected Buffer input!");
        }
    }
}
if (global && !global.TextDecoder) {
    global.TextDecoder = TextDecoder;
}

class TextEncoder {
    encode(input) {
        return new Buffer(input);
    }
}
if (global && !global.TextEncoder) {
    global.TextEncoder = TextEncoder;
}

module.exports = require('./lib/index.js');
