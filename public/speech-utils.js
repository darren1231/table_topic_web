(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SpeechUtils=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SUPPORTED_LANGUAGES=['zh-TW','en-US','ja-JP'];
  const languageBase=language=>String(language||'').toLowerCase().split('-')[0];
  const normalizeLanguage=language=>SUPPORTED_LANGUAGES.includes(language)?language:'en-US';

  function normalizeSpeechText(text,language='en-US'){
    const lang=normalizeLanguage(language);
    let value=String(text||'').replace(/\r\n?/g,'\n').replace(/[ \t\f\v]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    value=value.replace(/\n+/g,breaks=>breaks.length===1?' ':'\n\n');
    value=value.replace(/(\d+)\s*[–—]\s*(\d+)/g,(_,from,to)=>lang==='zh-TW'?`${from} 到 ${to}`:lang==='ja-JP'?`${from}から${to}`:`${from} to ${to}`);
    value=value.replace(/(\d+(?:\.\d+)?)%/g,(_,number)=>lang==='zh-TW'?`百分之 ${number}`:lang==='ja-JP'?`${number}パーセント`:`${number} percent`);
    return value;
  }

  function detectTextLanguage(text,preferred='en-US'){
    const fallback=normalizeLanguage(preferred),value=String(text||'');
    if(/[\u3040-\u30ff]/.test(value))return 'ja-JP';
    const latin=(value.match(/[A-Za-z]/g)||[]).length,han=(value.match(/[\u3400-\u9fff]/g)||[]).length;
    if(latin>han)return 'en-US';
    if(han)return fallback==='ja-JP'?'ja-JP':'zh-TW';
    return fallback;
  }

  function splitLanguageRuns(text,preferred='en-US'){
    const fallback=normalizeLanguage(preferred),runs=[];let current='';let currentLanguage='';
    const scriptLanguage=character=>/[A-Za-z]/.test(character)?'en-US':/[\u3040-\u30ff]/.test(character)?'ja-JP':/[\u3400-\u9fff]/.test(character)?(fallback==='ja-JP'?'ja-JP':'zh-TW'):'';
    for(const character of String(text||'')){
      const language=scriptLanguage(character);
      if(language&&currentLanguage&&language!==currentLanguage){if(current.trim())runs.push({text:current.trim(),language:currentLanguage});current='';}
      current+=character;if(language)currentLanguage=language;
    }
    if(current.trim())runs.push({text:current.trim(),language:currentLanguage||detectTextLanguage(current,fallback)});
    return runs;
  }

  function splitSentences(paragraph){
    const text=String(paragraph||''),protectedDots=new Set(),sentences=[];
    // Protect positions rather than replacing content with collision-prone placeholders.
    for(const match of text.matchAll(/\b(?:[A-Za-z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|e\.g|i\.e)\./gi)){
      for(let i=0;i<match[0].length;i++)if(match[0][i]==='.')protectedDots.add(match.index+i);
    }
    for(let i=1;i<text.length-1;i++)if(text[i]==='.'&&/\d/.test(text[i-1])&&/\d/.test(text[i+1]))protectedDots.add(i);
    let start=0;
    for(let i=0;i<text.length;i++){
      if(!/[。！？.!?]/.test(text[i])||protectedDots.has(i))continue;
      let end=i+1;
      while(end<text.length&&/[。！？.!?]/.test(text[end])&&!protectedDots.has(end))end++;
      while(end<text.length&&/["'”’」』）)\]]/.test(text[end]))end++;
      const sentence=text.slice(start,end).trim();if(sentence)sentences.push(sentence);
      start=end;i=end-1;
    }
    const tail=text.slice(start).trim();if(tail)sentences.push(tail);
    return sentences;
  }

  function splitLongSentence(sentence){
    // Count Unicode characters, including punctuation: 120 for Han/kana, 200 otherwise.
    const limit=/[\u3040-\u30ff\u3400-\u9fff]/.test(sentence)?120:200,parts=[];
    let remaining=Array.from(sentence);
    while(remaining.length>limit){
      const prefix=remaining.slice(0,limit);
      let cut=prefix.findLastIndex(character=>/[，,、；;：:]/.test(character))+1;
      if(!cut)cut=prefix.findLastIndex(character=>/\s/.test(character))+1;
      if(!cut)cut=/^[。！？.!?]+$/.test(remaining.slice(limit).join(''))?limit-1:limit;
      const part=remaining.slice(0,cut).join('').trim();if(part)parts.push(part);
      remaining=remaining.slice(cut);
    }
    const last=remaining.join('').trim();if(last)parts.push(last);
    return parts;
  }

  function buildSpeechChunks(text,{language='en-US',rate=.9}={}){
    const preferred=normalizeLanguage(language),normalized=normalizeSpeechText(text,preferred),paragraphs=normalized.split(/\n{2,}/).map(value=>value.trim()).filter(Boolean),chunks=[];
    const speechRate=Number.isFinite(Number(rate))&&Number(rate)>0?Number(rate):.9;
    paragraphs.forEach((paragraph,paragraphIndex)=>{
      const sentences=splitSentences(paragraph);
      sentences.forEach((sentence,sentenceIndex)=>{
        const clauses=splitLongSentence(sentence),isParagraphLast=sentenceIndex===sentences.length-1,isQuestion=/[?？]\s*$/.test(sentence);
        clauses.forEach((clause,clauseIndex)=>{
          const isSentenceLast=clauseIndex===clauses.length-1,pauseMs=isSentenceLast&&isParagraphLast&&paragraphIndex<paragraphs.length-1?400:0;
          splitLanguageRuns(clause,preferred).forEach((run,runIndex,runs)=>chunks.push({text:run.text,language:run.language,rate:speechRate,pauseMs:runIndex===runs.length-1?pauseMs:0,paragraphEnd:isParagraphLast&&isSentenceLast&&runIndex===runs.length-1,question:isQuestion}));
        });
      });
    });
    return chunks;
  }

  function voiceSupportsLanguage(voice,language){return languageBase(voice?.lang)===languageBase(normalizeLanguage(language))||(normalizeLanguage(language)==='zh-TW'&&languageBase(voice?.lang)==='yue');}
  function continuationStart(text,charIndex){
    const value=String(text||''),characters=Array.from(value),offsets=[];let offset=0;
    for(const character of characters){offsets.push(offset);offset+=character.length;}
    const target=Number.isFinite(charIndex)?Math.max(0,Math.min(Math.floor(charIndex),value.length-1)):0;
    const position=Math.max(0,offsets.findLastIndex(index=>index<=target));
    for(let i=position-1;i>=Math.max(0,position-12);i--)if(/[\s，,。.!?！？；;：:、،؛؟]/u.test(characters[i]))return offsets[i]+characters[i].length;
    return offsets[Math.max(0,position-3)]||0;
  }
  function isCantoneseVoice(voice){return /^zh-HK(?:-|$)|^yue(?:-|$)/i.test(String(voice?.lang||''))||/cantonese|粵語|粤語/i.test(String(voice?.name||''));}
  function isRecommendedVoice(voice){return /natural|neural|online|google|premium|enhanced/i.test(String(voice?.name||''));}
  function sortVoices(voices,language){
    const target=normalizeLanguage(language).toLowerCase();
    return (Array.isArray(voices)?voices:[]).filter(voice=>voiceSupportsLanguage(voice,language)).sort((a,b)=>
      Number(String(b.lang).toLowerCase()===target)-Number(String(a.lang).toLowerCase()===target)||Number(isRecommendedVoice(b))-Number(isRecommendedVoice(a)));
  }
  function selectVoice(voices,language,preferredURI='',{manual=Boolean(preferredURI)}={}){
    if(manual&&!preferredURI)return null;
    const available=sortVoices(voices,language),preferred=manual&&available.find(voice=>voice.voiceURI===preferredURI);
    if(preferred)return preferred;
    return available.find(voice=>normalizeLanguage(language)!=='zh-TW'||!isCantoneseVoice(voice))||null;
  }

  function createQueueState(id=0){return {id,index:0,stopped:false,paused:false,timeoutId:null};}
  function resetQueueState(queue){return {id:(queue?.id||0)+1,index:0,stopped:true,paused:false,timeoutId:null};}

  return {normalizeSpeechText,detectTextLanguage,splitLanguageRuns,splitSentences,buildSpeechChunks,voiceSupportsLanguage,continuationStart,isRecommendedVoice,sortVoices,selectVoice,createQueueState,resetQueueState};
});
