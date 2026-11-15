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
  const synthesis={paused:false,speaking:false,cancels:0,pauses:0,resumes:0,getVoices:()=>voices,addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);},speak(utterance){this.speaking=true;utterances.push(utterance);},cancel(){this.cancels++;this.speaking=false;if(options.cancelCallbacks){utterances.at(-1)?.onend();utterances.at(-1)?.onerror({error:'synthesis-failed'});}},pause(){this.paused=true;this.pauses++;},resume(){this.resumes++;if(options.nativeResume){this.paused=false;utterances.at(-1)?.onresume?.();}}};
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

test('700ms resume watchdog continues at the frozen boundary and ignores cancel callbacks and stale signals', () => {
  const f=fixture('One two three four five six. Next sentence.',{cancelCallbacks:true});f.nodes.play.click();const old=f.utterances[0];
  old.onboundary({charIndex:10,name:'word'});
  f.nodes.play.click();assert.equal(f.run('state.speechQueue.index'),0);assert.equal(f.run('state.speechQueue.paused'),true);
  old.onboundary({charIndex:20,name:'word'});
  assert.equal(f.run('state.speechQueue.index'),0);assert.equal(f.utterances.length,1);
  f.nodes.play.click();assert.equal(f.utterances.length,1);assert.equal(f.timers.at(-1).ms,700);
  f.timers.at(-1).fn();assert.equal(f.utterances.length,2);assert.equal(f.utterances[1].text,'three four five six.');
  old.onend();old.onerror({error:'synthesis-failed'});old.onboundary({charIndex:25});old.onresume();
  assert.equal(f.run('state.speechQueue.index'),0);assert.equal(f.utterances.length,2);
  f.utterances[1].onboundary({charIndex:11});f.nodes.play.click();f.nodes.play.click();f.timers.at(-1).fn();
  assert.equal(f.utterances[2].text,'five six.','a second fallback uses the absolute offset in the original chunk');
  f.utterances[2].onend();assert.equal(f.utterances[3].text,'Next sentence.');
});

test('native resume or progress cancels the watchdog, but speaking alone or an inactive resume signal does not',()=>{
  for(const signal of ['resume','boundary','end']){
    const f=fixture(undefined,{nativeResume:signal==='resume'});f.nodes.play.click();const u=f.utterances[0];
    f.nodes.play.click();f.nodes.play.click();const timer=f.timers.find(t=>t.ms===700);
    if(signal==='boundary'){f.synthesis.paused=false;u.onboundary({charIndex:4});}
    if(signal==='end')u.onend();
    assert.equal(timer.canceled,true,signal);timer.fn();assert.equal(f.utterances.length,signal==='end'?2:1);
  }
  for(const boundary of [null,0]){
    const f=fixture();f.nodes.play.click();if(boundary!==null)f.utterances[0].onboundary({charIndex:boundary});
    f.nodes.play.click();f.nodes.play.click();f.synthesis.paused=false;f.synthesis.speaking=false;f.utterances[0].onresume();
    f.timers.at(-1).fn();assert.equal(f.utterances[1].text,'First sentence.');
  }
});

test('repeated fallback without a new boundary retains the last known position instead of restarting the original chunk',()=>{
  const f=fixture('One two three four five six.');f.nodes.play.click();f.utterances[0].onboundary({charIndex:10});
  for(let attempt=0;attempt<2;attempt++){
    f.nodes.play.click();f.nodes.play.click();f.timers.at(-1).fn();assert.equal(f.utterances.at(-1).text,'three four five six.');
  }
});

test('a resume signal that precedes native flag updates is rechecked at the watchdog deadline',()=>{
  const f=fixture();f.nodes.play.click();f.nodes.play.click();f.nodes.play.click();
  f.synthesis.speaking=false;f.utterances[0].onresume();f.synthesis.speaking=true;f.synthesis.paused=false;
  f.timers.at(-1).fn();assert.equal(f.utterances.length,1);
});

test('stop or settings changes while paused or waiting for resume clear every pending watchdog',()=>{
  for(const pending of [false,true])for(const action of ['stop','voice','rate']){
    const f=fixture();f.nodes.play.click();const old=f.utterances[0];old.onboundary({charIndex:6});f.nodes.play.click();if(pending)f.nodes.play.click();
    if(action==='stop')f.nodes.stop.click();else f.nodes[action].onchange();
    f.timers.forEach(timer=>timer.fn());old.onboundary({charIndex:8});old.onresume();old.onend();
    assert.equal(f.run('state.speechChunks.length'),0);assert.equal(f.run('state.speechQueue.stopped'),true);assert.equal(f.utterances.length,1);
  }
});

test('pause during paragraph delay and stop while paused invalidate timers callbacks and all queue content',()=>{
  const f=fixture();f.nodes.play.click();f.utterances[0].onend();f.utterances[1].onend();const timer=f.timers[0];
  f.nodes.play.click();assert.equal(timer.canceled,true);assert.equal(f.run('state.speechQueue.index'),2);
  timer.fn();assert.equal(f.utterances.length,2);
  f.nodes.play.click();assert.equal(f.utterances[2].text,'Last paragraph.');
  f.nodes.play.click();f.nodes.stop.click();assert.equal(f.run('state.speechChunks.length'),0);assert.equal(f.run('state.speechQueue.stopped'),true);
  f.utterances[2].onend();timer.fn();assert.equal(f.utterances.length,3);
  f.nodes.play.click();assert.equal(f.utterances[3].text,'First sentence.');
  f.utterances[2].onend();f.utterances[2].onerror({error:'synthesis-failed'});timer.fn();assert.equal(f.utterances.length,4);
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
