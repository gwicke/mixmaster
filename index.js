'use strict';

// Node entry point.

// Polyfill ReadableStream, if needed.
if (global && !global.ReadableStream) {
    global.ReadableStream = require("web-streams-polyfill").ReadableStream;
}

module.exports = require('./lib/index.js');
