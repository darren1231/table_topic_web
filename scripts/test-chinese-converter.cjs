const assert = require('node:assert/strict');
const ChineseConverter = require('../chinese-converter.js');

assert.equal(
  ChineseConverter.toTraditional('我发现这里的软件和网络质量很好。'),
  '我發現這裡的軟體和網路品質很好。'
);
assert.equal(ChineseConverter.toTraditional('她的头发很漂亮，准备出发。'), '她的頭髮很漂亮，準備出發。');
assert.equal(ChineseConverter.toTraditional('繁體中文與 English 123'), '繁體中文與 English 123');
assert.equal(ChineseConverter.toTraditional(''), '');

console.log('Chinese converter tests passed');
