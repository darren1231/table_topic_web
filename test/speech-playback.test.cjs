const assert = require('node:assert/strict');
const { test } = require('node:test');
const { app, Element } = require('./helpers/frontend.cjs');

function fixture(text='First sentence. Second sentence.\n\nLast paragraph.',options={}) {
  const b=app({signedIn:false,...options,storageEntries:[['tableTopicsLanguage.v1','en-US'],...(options.storageEntries||[])]}),nodes={play:new Element(),stop:new Element(),voice:new Element(),rate:new Element(),article:new Element(),controls:new Element(),container:new Element()};
  nodes.article.textContent=text;nodes.rate.value='1';
  nodes.controls.querySelector=selector=>({'[data-speech-play]':nodes.play,'[data-speech-stop]':nodes.stop})[selector];
  nodes.container.querySelector=selector=>({'.speech-actions':nodes.controls,'[data-speech-voice]':nodes.voice,'[data-speech-rate]':nodes.rate,'.rewritten-speech':nodes.article})[selector];
  const utterances=[],timers=[];
  let voices=options.voices||[];const listeners=new Map();
  const synthesis={paused:false,getVoices:()=>voices,addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);},speak:utterance=>utterances.push(utterance),cancel(){},pause(){this.paused=true;},resume(){this.paused=false;}};
  b.window.speechSynthesis=synthesis;b.window.SpeechSynthesisUtterance=b.context.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  b.context.setTimeout=(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;};
  b.context.clearTimeout=timer=>{timer.canceled=true;};
  b.window.speechTestContainer=nodes.container;b.run('bindSpeechControls(window.speechTestContainer);');
  return {...b,nodes,utterances,timers,synthesis,setVoices(next){voices=next;listeners.get('voiceschanged')?.();}};
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

test('the selected control speed is passed unchanged into speech utterances', () => {
  const f=fixture('A question? Another sentence.');f.nodes.rate.value='1.2';f.nodes.rate.onchange();f.nodes.play.click();
  assert.equal(f.utterances[0].rate,1.2);f.utterances[0].onend();assert.equal(f.utterances[1].rate,1.2);
});

const voices=[{voiceURI:'basic',name:'Basic English',lang:'en-US',localService:true},{voiceURI:'natural',name:'Natural English',lang:'en-US',localService:false}];
test('automatic speech uses and labels the recommended voice without turning it into a manual preference',()=>{
  const f=fixture('Hello.',{voices});assert.equal(f.nodes.voice.value,'natural');
  assert.ok(f.nodes.voice.children.find(option=>option.value==='natural').textContent.includes('Recommended'));
  f.nodes.play.click();assert.equal(f.utterances[0].voice.voiceURI,'natural');f.nodes.stop.click();
  const newer={voiceURI:'enhanced',name:'Enhanced English',lang:'en-US',localService:true};
  f.setVoices([newer,...voices]);assert.equal(f.nodes.voice.value,'enhanced');
});

test('manual legacy voices and explicit device-default selection survive repeated voice list changes',()=>{
  const f=fixture('Hello.',{voices,storageEntries:[['tableTopicsSpeechSettings.v1',JSON.stringify({voiceURI:'basic',rate:1})]]});
  assert.equal(f.nodes.voice.value,'basic');f.nodes.play.click();assert.equal(f.utterances[0].voice.voiceURI,'basic');
  f.setVoices([...voices].reverse());assert.equal(f.nodes.voice.value,'basic');
  f.nodes.voice.value='';f.nodes.voice.onchange();f.setVoices([...voices]);assert.equal(f.nodes.voice.value,'');
  f.nodes.play.click();assert.equal(f.utterances.at(-1).voice,undefined);
  const stored=JSON.parse(f.storage.get('tableTopicsSpeechSettings.v1'));assert.equal(stored.voiceSelected,true);assert.equal(stored.voiceURI,'');
});

test('voices arriving after an empty list become available without inventing any voice',()=>{
  const f=fixture('Hello.');assert.equal(f.nodes.voice.children.length,1);
  f.setVoices(voices);assert.equal(f.nodes.voice.value,'natural');
  f.setVoices([voices[0]]);assert.equal(f.nodes.voice.value,'basic');
});
