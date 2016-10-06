'use strict';

const streamUtil = require('../index.js');
const HTMLTransformReader = require('web-html-stream').HTMLTransformReader;

/**
 * General setup
 */
const handler = function(node) {
    // Simplistic runtime handler, which lets us reuse match structures
    // between renders. For parallel & once-only content processing, we
    // could just do whatever we need to do & return a Promise directly.
    return function() {
        return node.outerHTML;
    };
};
const testDoc = "<html><body><div>"
    + "<test-element foo='bar'>foo</test-element>"
    + "</div></body>";

const precompiledTemplate = new HTMLTransformReader(testDoc, {
    transforms: [
        { selector: 'test-element[foo="bar"]', handler },
        { selector: 'foo-bar', handler },
    ]
}).drainSync();

function evalTemplate(tpl) {
    // Set up the stream transforms & get the reader.
    const reader = new streamUtil.FlatStreamReader(tpl, {});
    return streamUtil.readToArray(reader);
}

// Pre-compile the test doc into a template (array of chunks). Our handler
// returns functions for dynamic elements, so that we can re-evaluate the
// template at runtime.
function bench(msg) {
    var startTime = Date.now();
    var n = 500000;
    function iter(i) {
        return evalTemplate(precompiledTemplate)
            .then(() => i ? iter(i - 1) : null);
    }
    return iter(n).then(() => {
        console.log(msg, (Date.now() - startTime) / n, 'ms per iteration');
    });
}
bench('Native Promise:')
.then(() => {
    global.Promise = require('bluebird');
    return bench('Bluebird:');
});
