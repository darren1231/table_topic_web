const {test,expect}=require('./fixtures.cjs');
const {prepare,complete}=require('./flows.cjs');

async function mockSpeech(page){
  await page.addInitScript(()=>{
    const state={utterances:[],pauses:0,resumes:0};
    const synthesis={paused:false,getVoices:()=>[],addEventListener(){},removeEventListener(){},
      speak(utterance){state.utterances.push(utterance);},cancel(){this.paused=false;},
      pause(){this.paused=true;state.pauses++;},resume(){this.paused=false;state.resumes++;}};
    Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};window.__speechTest=state;
  });
}

test('speech plays pauses and stops without allowing stale callbacks to resume playback',async({guestPage:page})=>{
  await mockSpeech(page);await prepare(page);await complete(page);
  await page.locator('#coachReport .rewritten-speech').evaluate(node=>{node.textContent='First sentence. Second sentence.\n\nFinal paragraph.';});
  const play=page.locator('#coachReport [data-speech-play]'),stop=page.locator('#coachReport [data-speech-stop]');
  await play.click();await expect.poll(()=>page.evaluate(()=>window.__speechTest.utterances.length)).toBe(1);
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
