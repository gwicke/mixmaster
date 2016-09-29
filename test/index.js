'use strict';

const streamUtil = require('../index.js');
const EleMatch = require('elematch');

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
const matcher = new EleMatch([
    { selector: 'test-element[foo="bar"]', handler },
    { selector: 'foo-bar', handler },
]);
const testDoc = ["<html><body><div>"
    + "<test-element foo='bar'>foo</test-element>"
    + "</div></body>"];


function evalTemplate(tpl) {
    // Set up the stream transforms & get the reader.
    const reader = new streamUtil.FlatReader(tpl, {});
    return streamUtil.readToString(reader);
}

// Pre-compile the test doc into a template (array of chunks). Our handler
// returns functions for dynamic elements, so that we can re-evaluate the
// template at runtime.
streamUtil.readToArray(new EleMatch(streamUtil.toReader(testDoc), matcher))
    .then((tpl) => {
        var startTime = Date.now();
        var n = 100000;
        function iter(i) {
            return evalTemplate(tpl)
                .then(() => i ? iter(i - 1) : null);
        }
        return iter(n).then(() => {
            console.log((Date.now() - startTime) / n, 'ms per iteration');
        });
    });
