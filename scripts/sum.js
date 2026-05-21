const assert = require("assert");

function sum(a, b) {
  return a + b;
}

console.log(sum(2, 3));

assert.strictEqual(sum(2, 3), 5);
assert.strictEqual(sum(0, 0), 0);
assert.strictEqual(sum(-1, 1), 0);

console.log("All tests passed");
