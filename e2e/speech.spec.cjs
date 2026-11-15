const {test,expect}=require('./fixtures.cjs');
const {prepare,complete}=require('./flows.cjs');

async function mockSpeech(page,voices=[],nativeResume=false){
  await page.addInitScript(({initialVoices,nativeResume})=>{
    const state={utterances:[],pauses:0,resumes:0,cancels:0,voices:initialVoices};
    const synthesis={paused:false,speaking:false,getVoices:()=>state.voices,addEventListener(){},removeEventListener(){},
      speak(utterance){this.speaking=true;state.utterances.push(utterance);},cancel(){this.speaking=false;state.cancels++;const old=state.utterances.at(-1);old?.onend();old?.onerror({error:'interrupted'});},
      pause(){this.paused=true;state.pauses++;},resume(){this.paused=false;state.resumes++;if(nativeResume)state.utterances.at(-1)?.onresume?.();}};
    Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};window.__speechTest=state;
  },{initialVoices:voices,nativeResume});
}

test('speech completes every chunk despite ineffective native resume and stale cancellation callbacks',async({guestPage:page})=>{
  await mockSpeech(page);await prepare(page);await complete(page);
  await page.locator('#coachReport .rewritten-speech').evaluate(node=>{node.textContent='First sentence. Second sentence.\n\nFinal paragraph.';});
  const play=page.locator('#coachReport [data-speech-play]'),stop=page.locator('#coachReport [data-speech-stop]');
  await page.locator('#coachReport [data-speech-rate]').selectOption('1');
  await play.click();await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(1);
  expect(await page.evaluate(()=>window.__speechTest.utterances[0].rate)).toBe(1);
  const cancels=await page.evaluate(()=>window.__speechTest.cancels);
  await play.click();expect(await page.evaluate(()=>window.__speechTest.cancels)).toBe(cancels);
  await expect(play).toContainText('Resume');
  await play.click();
  await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(2);
  expect(await page.evaluate(()=>window.__speechTest.utterances.map(u=>u.text))).toEqual(['First sentence.','First sentence.']);
  await page.evaluate(()=>{window.__speechTest.utterances[0].onend();window.__speechTest.utterances[0].onerror({error:'synthesis-failed'});});
  expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(2);
  await page.evaluate(()=>window.__speechTest.utterances[1].onend());
  expect(await page.evaluate(()=>window.__speechTest.utterances[2].text)).toBe('Second sentence.');
  await page.evaluate(()=>window.__speechTest.utterances[2].onend());
  await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(4);
  expect(await page.evaluate(()=>window.__speechTest.utterances[3].text)).toBe('Final paragraph.');
  await page.evaluate(()=>window.__speechTest.utterances[3].onend());await expect(stop).toBeDisabled();
  expect(await page.evaluate(()=>window.__speechTest.pauses)).toBe(1);
  expect(await page.evaluate(()=>window.__speechTest.resumes)).toBeGreaterThanOrEqual(1);
  await play.click();await play.click();
  await stop.click();await expect(stop).toBeDisabled();
  await page.evaluate(()=>window.__speechTest.utterances[4].onend());
  await page.waitForTimeout(550);expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(5);
  await play.click();await page.evaluate(()=>window.__speechTest.utterances[4].onend());
  await page.waitForTimeout(550);expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(6);
  await stop.click();
});

test('failed resume with boundary data continues nearby and then advances to the next chunk',async({guestPage:page})=>{
  await mockSpeech(page);await prepare(page);await complete(page);
  await page.locator('#coachReport .rewritten-speech').evaluate(node=>{node.textContent='One two three four five six. Next sentence.';});
  const play=page.locator('#coachReport [data-speech-play]');await play.click();
  await page.evaluate(()=>window.__speechTest.utterances[0].onboundary({charIndex:10,name:'word'}));
  await play.click();await page.evaluate(()=>window.__speechTest.utterances[0].onboundary({charIndex:22,name:'word'}));await play.click();
  await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(2);
  expect(await page.evaluate(()=>window.__speechTest.utterances[1].text)).toBe('three four five six.');
  await page.evaluate(()=>{window.__speechTest.utterances[0].onend();window.__speechTest.utterances[0].onresume();window.__speechTest.utterances[1].onend();});
  expect(await page.evaluate(()=>window.__speechTest.utterances.map(u=>u.text))).toEqual(['One two three four five six.','three four five six.','Next sentence.']);
  await page.evaluate(()=>window.__speechTest.utterances[2].onend());await expect(page.locator('#coachReport [data-speech-stop]')).toBeDisabled();
});

test('successful native resume keeps the same utterance and never triggers watchdog cancellation',async({guestPage:page})=>{
  await mockSpeech(page,[],true);await prepare(page);await complete(page);
  const play=page.locator('#coachReport [data-speech-play]');await play.click();
  await page.evaluate(()=>window.__speechTest.utterances[0].onboundary({charIndex:10,name:'word'}));
  const cancels=await page.evaluate(()=>window.__speechTest.cancels);await play.click();await play.click();await page.waitForTimeout(950);
  expect(await page.evaluate(()=>({count:window.__speechTest.utterances.length,cancels:window.__speechTest.cancels,paused:speechSynthesis.paused}))).toEqual({count:1,cancels,paused:false});
  await page.locator('#coachReport [data-speech-stop]').click();
});

const voices=[{voiceURI:'basic',name:'Basic English',lang:'en-US',localService:true},{voiceURI:'natural',name:'Natural English',lang:'en-US',localService:false}];
test('recommended voices are automatic while manual and device-default choices survive playback and reload',async({guestPage:page})=>{
  await mockSpeech(page,voices);await prepare(page);await complete(page);
  const voice=page.locator('#coachReport [data-speech-voice]'),play=page.locator('#coachReport [data-speech-play]');
  await expect(voice).toHaveValue('natural');
  expect(await voice.locator('option').nth(1).getAttribute('value')).toBe('natural');
  await voice.selectOption('basic');await play.click();
  expect(await page.evaluate(()=>window.__speechTest.utterances[0].voice.voiceURI)).toBe('basic');
  await voice.selectOption('natural');await play.click();
  await page.evaluate(()=>window.__speechTest.utterances[0].onend());
  expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(2);
  await voice.selectOption('');await play.click();
  expect(await page.evaluate(()=>window.__speechTest.utterances[2].voice)).toBeUndefined();
  await page.locator('#coachReport [data-speech-stop]').click();
  await page.goto('/');await complete(page);
  await expect(page.locator('#coachReport [data-speech-voice]')).toHaveValue('');
});

test('recommendation labels follow all four interface languages',async({guestPage:page})=>{
  await mockSpeech(page,voices);await prepare(page);await complete(page);
  for(const [locale,label] of [['zh-TW','推薦'],['en-US','Recommended'],['ja-JP','おすすめ'],['ar','موصى به']]){
    await page.locator('#languageSelect').selectOption(locale);
    await expect(page.locator('#coachReport [data-speech-voice] option[value="natural"]')).toContainText(label);
  }
});
