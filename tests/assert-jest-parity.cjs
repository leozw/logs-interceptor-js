const strict = require('node:assert/strict');

// Preserve only the two original matcher contracts requiring more than strict.
const numberLike = value => typeof value === 'number' || typeof value === 'bigint';
function rejectedToThrow(reason) {
  const tag = Object.prototype.toString.call(reason);
  if (['[object Error]', '[object Exception]', '[object DOMException]'].includes(tag) || reason instanceof Error) return true;
  if (typeof reason !== 'function') return false;
  try { reason(); } catch { return true; }
  return false;
}
module.exports = {
  ...strict,
  greaterThanOrEqual(actual, expected) {
    strict.ok(numberLike(actual) && numberLike(expected) && actual >= expected);
  },
  rejectsToThrow(promise) { return strict.rejects(promise, rejectedToThrow); },
};
