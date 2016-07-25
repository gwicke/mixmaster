'use strict';

const mm = require('../index.js');
const EleMatch = require('elematch');

// Strawman
function test() {
    const handler = function(node) { return function() { return node.outerHTML; }; };
    const matcher = new EleMatch({
        'test-element[foo="bar"]': handler,
        'foo-bar': handler,
    });
    const matchFn = matcher.matchAll.bind(matcher);
    const testDoc = "<html><body><div>"
        + "<test-element foo='bar'>foo</test-element>"
        + "</div></body>";
    const inStream = mm.makeArrayStream([testDoc]);
    const transformedStream = mm.transformStream(inStream, [
            mm.matchTransform(matchFn),
            mm.evalTransform({})
    ]);
    const reader = transformedStream.getReader();
    // Consume the stream.
    function readChunk() {
        return reader.read()
        .then(res => {
            if (res.done) {
                return;
            }
            console.log(res.value);
            return readChunk();
        })
        .catch(e => console.log(e.stack));
    }
    readChunk();
}

test();
