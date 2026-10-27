// Real renderer availability policy keeps stale measurements coloured.
const assert = require('node:assert/strict');
const unavailable = require('../desktop/ui/availability.js');
const reading = used => ({ used });
assert.equal(unavailable({ windows:[reading(.4)], status:'stale' }), false);
assert.equal(unavailable({ windows:[reading(.4)], status:'error', blocked:true }), false);
assert.equal(unavailable({ windows:[] }), true);
assert.equal(unavailable({ windows:[reading(NaN)] }), true);
assert.equal(unavailable({ windows:[reading(1)], blocked:true }), true);
assert.equal(unavailable({ windows:[reading(1)], blocked:true, hasCredits:true }), false);
assert.equal(unavailable({ windows:[reading(1),reading(.2)], blocked:false }), false);
console.log('PASS stale/refresh/no-reading/blocked/credits/model-availability policy');
