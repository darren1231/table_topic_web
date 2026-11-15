const {test,expect}=require('./fixtures.cjs');
const {prepare,complete}=require('./flows.cjs');

async function mockSpeech(page,voices=[]){
  await page.addInitScript(initialVoices=>{
    const state={utterances:[],pauses:0,resumes:0,cancels:0,voices:initialVoices};
    const synthesis={paused:false,getVoices:()=>state.voices,addEventListener(){},removeEventListener(){},
      speak(utterance){state.utterances.push(utterance);},cancel(){state.cancels++;const old=state.utterances.at(-1);old?.onend();old?.onerror({error:'interrupted'});},
      pause(){this.paused=true;state.pauses++;},resume(){state.resumes++;}};
    Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};window.__speechTest=state;
  },voices);
}

test('speech completes every chunk despite ineffective native resume and stale cancellation callbacks',async({guestPage:page})=>{
  await mockSpeech(page);await prepare(page);await complete(page);
  await page.locator('#coachReport .rewritten-speech').evaluate(node=>{node.textContent='First sentence. Second sentence.\n\nFinal paragraph.';});
  const play=page.locator('#coachReport [data-speech-play]'),stop=page.locator('#coachReport [data-speech-stop]');
  await page.locator('#coachReport [data-speech-rate]').selectOption('1');
  await play.click();await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(1);
  expect(await page.evaluate(()=>window.__speechTest.utterances[0].rate)).toBe(1);
  const cancels=await page.evaluate(()=>window.__speechTest.cancels);
  await play.click();expect(await page.evaluate(()=>window.__speechTest.cancels)).toBe(cancels+1);
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
  expect(await page.evaluate(()=>({pauses:window.__speechTest.pauses,resumes:window.__speechTest.resumes}))).toEqual({pauses:0,resumes:0});
  await play.click();await play.click();
  await stop.click();await expect(stop).toBeDisabled();
  await page.evaluate(()=>window.__speechTest.utterances[4].onend());
  await page.waitForTimeout(550);expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(5);
  await play.click();await page.evaluate(()=>window.__speechTest.utterances[4].onend());
  await page.waitForTimeout(550);expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(6);
  await stop.click();
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
