const assert=require('node:assert/strict');
const SpeechUtils=require('../public/speech-utils.js');
const { test } = require('node:test');

test('speech utilities preserve chunking, language, voices, and queue behavior', () => {
  const zh=SpeechUtils.buildSpeechChunks('大家好，今天談練習。你準備好了嗎？\n\n我們開始吧！',{language:'zh-TW',rate:1});
  assert.deepEqual(zh.map(item=>item.text),['大家好，今天談練習。','你準備好了嗎？','我們開始吧！'],'ordinary sentences stay intact');
  assert.equal(zh[0].pauseMs,0,'the speech engine handles sentence punctuation');
  assert.equal(zh[1].pauseMs,400,'only a boundary before another paragraph adds 400ms');

  const en=SpeechUtils.buildSpeechChunks('Dr. Lee opened the talk, then paused. Are you ready?',{language:'en-US',rate:1});
  assert.deepEqual(en.map(item=>item.text),['Dr. Lee opened the talk, then paused.','Are you ready?'],'English abbreviations should not split sentences');
  assert.equal(en[1].question,true,'English question detection');

  assert.equal(SpeechUtils.detectTextLanguage('これは日本語です。','zh-TW'),'ja-JP','kana must be detected as Japanese');
  assert.equal(SpeechUtils.detectTextLanguage('日本語の文章','ja-JP'),'ja-JP','Japanese preference keeps kanji-only text Japanese');

  const mixed=SpeechUtils.buildSpeechChunks('今天我們 practice English。',{language:'zh-TW',rate:.9});
  assert.deepEqual(mixed.map(item=>item.language),['zh-TW','en-US'],'mixed Chinese-English runs use matching languages');

  const paragraphs=SpeechUtils.buildSpeechChunks('First paragraph.\n\nSecond paragraph.',{language:'en-US',rate:1});
  assert.equal(paragraphs[0].pauseMs,400,'paragraph pause');
  assert.equal(paragraphs[0].paragraphEnd,true,'paragraph boundary marker');
  assert.equal(paragraphs[1].pauseMs,0,'no pause after the final paragraph');

  const voices=[{voiceURI:'zh-hk',lang:'zh-HK'},{voiceURI:'zh-tw',lang:'zh-TW'},{voiceURI:'en',lang:'en-US'}];
  assert.equal(SpeechUtils.selectVoice(voices,'zh-TW','en').voiceURI,'zh-tw','incompatible manual voice safely falls back to exact language');
  assert.equal(SpeechUtils.selectVoice(voices,'zh-TW','zh-hk').voiceURI,'zh-hk','compatible manual voice remains selected');
  assert.equal(SpeechUtils.selectVoice(voices,'ja-JP','en'),null,'missing language safely falls back to browser default');

  const active={...SpeechUtils.createQueueState(7),index:3,timeoutId:42};
  const stopped=SpeechUtils.resetQueueState(active);
  assert.deepEqual(stopped,{id:8,index:0,stopped:true,paused:false,timeoutId:null},'Stop/reset invalidates callbacks and clears queue progress');

  assert.equal(SpeechUtils.normalizeSpeechText('In 2026, 25% need 1–2 U.S. examples.','en-US'),'In 2026, 25 percent need 1 to 2 U.S. examples.','safe number, percent, range, and abbreviation normalization');
});

test('only the final language run before another paragraph receives the 400ms pause', () => {
  const chunks=SpeechUtils.buildSpeechChunks('今天 practice English。再分享，繼續說。\n\n最後一段。',{language:'zh-TW'});
  assert.deepEqual(chunks.map(item=>item.pauseMs),[0,0,400,0]);
  assert.deepEqual(chunks.map(item=>item.paragraphEnd),[false,false,true,true]);
  assert.deepEqual(SpeechUtils.buildSpeechChunks('字'.repeat(59)+'，'+'字'.repeat(60)+'。',{language:'zh-TW'}).map(item=>item.pauseMs),[0,0]);
});

test('ordinary sentences keep commas and same-language runs intact without losing content', () => {
  const source='今天談練習，先想一想，再開口。Now, keep one English sentence intact.今天 practice English, every day，再分享心得。';
  const chunks=SpeechUtils.buildSpeechChunks(source,{language:'zh-TW'});
  assert.deepEqual(chunks.map(item=>item.text),['今天談練習，先想一想，再開口。','Now, keep one English sentence intact.','今天','practice English, every day，','再分享心得。']);
  assert.equal(chunks.map(item=>item.text).join('').replace(/\s/g,''),source.replace(/\s/g,''));
  assert.deepEqual(chunks.map(item=>item.language),['zh-TW','en-US','zh-TW','en-US','zh-TW']);
});

test('long sentence thresholds are 120 Unicode characters with Han/kana and 200 otherwise', () => {
  const zhAt='字'.repeat(59)+'，'+'字'.repeat(59)+'。';
  const zhOver='字'.repeat(59)+'，'+'字'.repeat(60)+'。';
  const enAt='a'.repeat(99)+', '+'b'.repeat(98)+'.';
  const enOver='a'.repeat(99)+', '+'b'.repeat(99)+'.';
  assert.equal(SpeechUtils.buildSpeechChunks(zhAt,{language:'zh-TW'}).length,1);
  assert.deepEqual(SpeechUtils.buildSpeechChunks(zhOver,{language:'zh-TW'}).map(item=>item.text),['字'.repeat(59)+'，','字'.repeat(60)+'。']);
  assert.equal(SpeechUtils.buildSpeechChunks(enAt).length,1);
  assert.deepEqual(SpeechUtils.buildSpeechChunks(enOver).map(item=>item.text),['a'.repeat(99)+',','b'.repeat(99)+'.']);
  for(const [source,limit] of [[zhOver,120],[enOver,200],['字'.repeat(120)+'。',120],['😀'.repeat(199)+'a.',200]]){
    const chunks=SpeechUtils.buildSpeechChunks(source,{language:'zh-TW'});
    assert.ok(chunks.every(item=>Array.from(item.text).length<=limit));
    assert.equal(chunks.map(item=>item.text).join('').replace(/\s/g,''),source.replace(/\s/g,''));
    assert.ok(chunks.every(item=>!/^\p{P}+$/u.test(item.text)),'no punctuation-only tail');
  }
});

test('every sentence and language run uses the selected speed without a second slowdown', () => {
  for(const rate of [0.25,0.8,0.9,1,1.2]){
    const chunks=SpeechUtils.buildSpeechChunks('今天 practice English。真的嗎？\n\n再試一次。',{language:'zh-TW',rate});
    assert.ok(chunks.every(item=>item.rate===rate),`selected rate ${rate}`);
  }
  for(const rate of [0,-1,Infinity,NaN,'bad'])assert.equal(SpeechUtils.buildSpeechChunks('Hello.',{rate})[0].rate,0.9);
});

test('single newlines join the sentence while two or more newlines delimit paragraphs', () => {
  assert.equal(SpeechUtils.normalizeSpeechText(' First line,\r\ncontinues here.\n\n\nNext paragraph. '),'First line, continues here.\n\nNext paragraph.');
  const chunks=SpeechUtils.buildSpeechChunks('First line,\ncontinues here.\n\nNext paragraph.');
  assert.deepEqual(chunks.map(item=>item.text),['First line, continues here.','Next paragraph.']);
  assert.deepEqual(chunks.map(item=>item.pauseMs),[400,0]);
  assert.deepEqual(SpeechUtils.buildSpeechChunks('第一行，\n繼續說。',{language:'zh-TW'}).map(item=>item.text),['第一行， 繼續說。']);
});

test('decimals abbreviations and literal placeholder-like text are preserved during sentence splitting', () => {
  const source='Dr. Lin paid 3.14 dollars, e.g. in the U.S. office. Mr. Lee agreed!';
  assert.deepEqual(SpeechUtils.splitSentences(source),['Dr. Lin paid 3.14 dollars, e.g. in the U.S. office.','Mr. Lee agreed!']);
  assert.deepEqual(SpeechUtils.buildSpeechChunks(source).map(item=>item.text),['Dr. Lin paid 3.14 dollars, e.g. in the U.S. office.','Mr. Lee agreed!']);
  assert.deepEqual(SpeechUtils.splitSentences('§0§ is literal. Dr. Lin left.'),['§0§ is literal.','Dr. Lin left.']);
  assert.deepEqual(SpeechUtils.splitSentences('他說「圓周率是 3.14。」真的嗎？'),['他說「圓周率是 3.14。」','真的嗎？']);
  const joined=SpeechUtils.buildSpeechChunks('他說「圓周率是 3.14。」真的嗎？',{language:'zh-TW'}).map(item=>item.text).join('');
  assert.equal(joined,'他說「圓周率是 3.14。」真的嗎？');
});
