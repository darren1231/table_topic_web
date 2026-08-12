const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./speech-analysis');

test('120 seconds and 300 English words is 150 words/min',()=>assert.equal(A.analyzeSpeech({transcript:Array(300).fill('word').join(' '),durationSeconds:120}).speechRate,150));
test('120 seconds and 500 Chinese characters is 250 字/min',()=>assert.equal(A.analyzeSpeech({transcript:'我'.repeat(500),durationSeconds:120}).speechRate,250));
test('so does not match some',()=>assert.equal(A.matchFillers('someone brought some ideas').length,0));
test('you know is counted as one phrase',()=>{const x=A.matchFillers('You know, this matters.');assert.equal(x.length,1);assert.equal(x[0].term,'you know');});
test('overlapping Chinese phrases are counted once',()=>assert.equal(A.matchFillers('基本上').length,1));
test('zero duration is safe',()=>assert.equal(A.analyzeSpeech({transcript:'hello',durationSeconds:0}).speechRate,0));
test('no fillers provides encouragement',()=>assert.match(A.analyzeSpeech({transcript:'A clear concise speech',durationSeconds:10}).feedback[0],/No vocal fillers/));
test('contractions and numbers are single tokens',()=>assert.equal(A.countEnglishWords("I don't have 12 options"),5));
