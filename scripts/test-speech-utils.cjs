const assert=require('node:assert/strict');
const SpeechUtils=require('../speech-utils.js');

const zh=SpeechUtils.buildSpeechChunks('大家好，今天談練習。你準備好了嗎？\n\n我們開始吧！',{language:'zh-TW',rate:1});
assert.deepEqual(zh.map(item=>item.text),['大家好，','今天談練習。','你準備好了嗎？','我們開始吧！'],'Chinese punctuation should produce natural clauses and sentences');
assert.equal(zh[0].pauseMs,125,'Chinese comma pause');
assert.equal(zh[2].pauseMs,525,'paragraph-ending question pause');

const en=SpeechUtils.buildSpeechChunks('Dr. Lee opened the talk, then paused. Are you ready?',{language:'en-US',rate:1});
assert.deepEqual(en.map(item=>item.text),['Dr. Lee opened the talk,','then paused.','Are you ready?'],'English abbreviations should not split sentences');
assert.equal(en[2].question,true,'English question detection');

assert.equal(SpeechUtils.detectTextLanguage('これは日本語です。','zh-TW'),'ja-JP','kana must be detected as Japanese');
assert.equal(SpeechUtils.detectTextLanguage('日本語の文章','ja-JP'),'ja-JP','Japanese preference keeps kanji-only text Japanese');

const mixed=SpeechUtils.buildSpeechChunks('今天我們 practice English。',{language:'zh-TW',rate:.9});
assert.deepEqual(mixed.map(item=>item.language),['zh-TW','en-US'],'mixed Chinese-English runs use matching languages');

const paragraphs=SpeechUtils.buildSpeechChunks('First paragraph.\n\nSecond paragraph.',{language:'en-US',rate:1});
assert.equal(paragraphs[0].pauseMs,525,'paragraph pause');
assert.equal(paragraphs[0].paragraphEnd,true,'paragraph boundary marker');
assert.equal(paragraphs[1].pauseMs,525,'final paragraph pause');

const voices=[{voiceURI:'zh-hk',lang:'zh-HK'},{voiceURI:'zh-tw',lang:'zh-TW'},{voiceURI:'en',lang:'en-US'}];
assert.equal(SpeechUtils.selectVoice(voices,'zh-TW','en').voiceURI,'zh-tw','incompatible manual voice safely falls back to exact language');
assert.equal(SpeechUtils.selectVoice(voices,'zh-TW','zh-hk').voiceURI,'zh-hk','compatible manual voice remains selected');
assert.equal(SpeechUtils.selectVoice(voices,'ja-JP','en'),null,'missing language safely falls back to browser default');

const active={...SpeechUtils.createQueueState(7),index:3,timeoutId:42};
const stopped=SpeechUtils.resetQueueState(active);
assert.deepEqual(stopped,{id:8,index:0,stopped:true,paused:false,timeoutId:null},'Stop/reset invalidates callbacks and clears queue progress');

assert.equal(SpeechUtils.normalizeSpeechText('In 2026, 25% need 1–2 U.S. examples.','en-US'),'In 2026, 25 percent need 1 to 2 U.S. examples.','safe number, percent, range, and abbreviation normalization');

console.log('speech utility tests passed');
