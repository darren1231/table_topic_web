const {test,expect}=require('./fixtures.cjs');
const {prepare,complete}=require('./flows.cjs');

async function mockSpeech(page,voices=[]){
  await page.addInitScript(initialVoices=>{
    const state={utterances:[],pauses:0,resumes:0,voices:initialVoices};
    const synthesis={paused:false,getVoices:()=>state.voices,addEventListener(){},removeEventListener(){},
      speak(utterance){state.utterances.push(utterance);},cancel(){this.paused=false;},
      pause(){this.paused=true;state.pauses++;},resume(){this.paused=false;state.resumes++;}};
    Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};window.__speechTest=state;
  },voices);
}

test('speech plays pauses and stops without allowing stale callbacks to resume playback',async({guestPage:page})=>{
  await mockSpeech(page);await prepare(page);await complete(page);
  await page.locator('#coachReport .rewritten-speech').evaluate(node=>{node.textContent='First sentence. Second sentence.\n\nFinal paragraph.';});
  const play=page.locator('#coachReport [data-speech-play]'),stop=page.locator('#coachReport [data-speech-stop]');
  await page.locator('#coachReport [data-speech-rate]').selectOption('1');
  await play.click();await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(1);
  expect(await page.evaluate(()=>window.__speechTest.utterances[0].rate)).toBe(1);
  await play.click();expect(await page.evaluate(()=>speechSynthesis.paused)).toBe(true);
  await play.click();expect(await page.evaluate(()=>window.__speechTest.resumes)).toBe(1);
  await page.evaluate(()=>window.__speechTest.utterances[0].onend());
  await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(2);
  await page.evaluate(()=>window.__speechTest.utterances[1].onend());
  await stop.click();await expect(stop).toBeDisabled();
  await page.evaluate(()=>window.__speechTest.utterances[1].onend());
  await page.waitForTimeout(550);expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(2);
  await play.click();await page.evaluate(()=>window.__speechTest.utterances[1].onend());
  await page.waitForTimeout(550);expect(await page.evaluate(()=>window.__speechTest.utterances.length)).toBe(3);
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
