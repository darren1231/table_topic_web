const assert = require('node:assert/strict');
const { test } = require('node:test');
const { app, Element } = require('./helpers/frontend.cjs');

function fixture(text='First sentence. Second sentence.\n\nLast paragraph.') {
  const b=app({signedIn:false}),nodes={play:new Element(),stop:new Element(),voice:new Element(),rate:new Element(),article:new Element(),controls:new Element(),container:new Element()};
  nodes.article.textContent=text;nodes.rate.value='1';
  nodes.controls.querySelector=selector=>({'[data-speech-play]':nodes.play,'[data-speech-stop]':nodes.stop})[selector];
  nodes.container.querySelector=selector=>({'.speech-actions':nodes.controls,'[data-speech-voice]':nodes.voice,'[data-speech-rate]':nodes.rate,'.rewritten-speech':nodes.article})[selector];
  const utterances=[],timers=[];
  const synthesis={paused:false,getVoices:()=>[],addEventListener(){},speak:utterance=>utterances.push(utterance),cancel(){},pause(){this.paused=true;},resume(){this.paused=false;}};
  b.window.speechSynthesis=synthesis;b.window.SpeechSynthesisUtterance=b.context.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  b.context.setTimeout=(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;};
  b.context.clearTimeout=timer=>{timer.canceled=true;};
  b.window.speechTestContainer=nodes.container;b.run('bindSpeechControls(window.speechTestContainer);');
  return {...b,nodes,utterances,timers,synthesis};
}

test('speech advances sentences immediately and schedules only the 400ms paragraph boundary', () => {
  const f=fixture();f.nodes.play.click();
  assert.equal(f.utterances[0].text,'First sentence.');f.utterances[0].onend();
  assert.equal(f.utterances.length,2);assert.equal(f.timers.length,0);
  f.utterances[1].onend();assert.deepEqual(f.timers.map(timer=>timer.ms),[400]);
  f.timers[0].fn();assert.equal(f.utterances[2].text,'Last paragraph.');
  f.utterances[2].onend();assert.equal(f.timers.length,1);assert.equal(f.nodes.stop.disabled,true);
});

test('pause resumes without replay and stop invalidates delayed timers and stale utterance callbacks', () => {
  const f=fixture();f.nodes.play.click();f.nodes.play.click();assert.equal(f.synthesis.paused,true);
  f.nodes.play.click();assert.equal(f.synthesis.paused,false);assert.equal(f.utterances.length,1);
  f.utterances[0].onend();f.utterances[1].onend();const timer=f.timers[0];
  f.nodes.stop.click();timer.fn();f.utterances[1].onend();assert.equal(f.utterances.length,2);
  f.nodes.play.click();assert.equal(f.utterances.length,3);timer.fn();f.utterances[1].onend();assert.equal(f.utterances.length,3);
});
