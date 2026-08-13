const assert = require('node:assert/strict');
const {isNumericScore, partitionComparisons} = require('../coach-result-utils.js');

assert.equal(isNumericScore(60), true);
assert.equal(isNumericScore('85/100'), true);
assert.equal(isNumericScore('我準備了 60 分鐘'), false);

const result = partitionComparisons([
  {label: '結構', before: 60, after: 85, beforeNote: '結構不清', afterNote: '結構清楚'},
  {label: '開場', before: '我參加了比賽。', after: '今年，我鼓起勇氣參加了比賽。'},
  null,
  {label: '空白', before: '', after: ''}
]);

assert.deepEqual(result.text, [
  {label: '開場', before: '我參加了比賽。', after: '今年，我鼓起勇氣參加了比賽。'}
]);
assert.deepEqual(result.scoreOnly, [
  {label: '結構', before: 60, after: 85, beforeNote: '結構不清', afterNote: '結構清楚'}
]);

console.log('coach result normalization tests passed');
