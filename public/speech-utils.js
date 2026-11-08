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
    const protectedValues=[];
    const protectedText=String(paragraph||'').replace(/\b(?:[A-Za-z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|e\.g|i\.e)\./gi,value=>{protectedValues.push(value);return `§${protectedValues.length-1}§`;});
    return protectedText.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/g)?.map(value=>value.replace(/§(\d+)§/g,(_,index)=>protectedValues[Number(index)]).trim()).filter(Boolean)||[];
  }

  function splitClauses(sentence){
    return String(sentence||'').match(/[^，,、；;：:]+[，,、；;：:]|[^，,、；;：:]+$/g)?.map(value=>value.trim()).filter(Boolean)||[];
  }

  function buildSpeechChunks(text,{language='en-US',rate=.9}={}){
    const preferred=normalizeLanguage(language),normalized=normalizeSpeechText(text,preferred),paragraphs=normalized.split(/\n+/).map(value=>value.trim()).filter(Boolean),chunks=[];
    paragraphs.forEach((paragraph,paragraphIndex)=>{
      const sentences=splitSentences(paragraph);
      sentences.forEach((sentence,sentenceIndex)=>{
        const clauses=splitClauses(sentence),isParagraphLast=sentenceIndex===sentences.length-1,isQuestion=/[?？]\s*$/.test(sentence);
        clauses.forEach((clause,clauseIndex)=>{
          const isSentenceLast=clauseIndex===clauses.length-1,pauseMs=!isSentenceLast?125:isParagraphLast?525:300;
          const slow=(paragraphIndex===0&&sentenceIndex===0)||isParagraphLast||isQuestion;
          splitLanguageRuns(clause,preferred).forEach((run,runIndex,runs)=>chunks.push({text:run.text,language:run.language,rate:Math.max(.5,Number(rate)||.9)*(slow ? 0.95 : 1),pauseMs:runIndex===runs.length-1?pauseMs:0,paragraphEnd:isParagraphLast&&isSentenceLast,question:isQuestion}));
        });
      });
    });
    return chunks;
  }

  function voiceSupportsLanguage(voice,language){return languageBase(voice?.lang)===languageBase(normalizeLanguage(language));}
  function selectVoice(voices,language,preferredURI=''){
    const available=Array.isArray(voices)?voices:[],target=normalizeLanguage(language),preferred=available.find(voice=>voice.voiceURI===preferredURI&&voiceSupportsLanguage(voice,target));
    if(preferred)return preferred;
    return available.find(voice=>String(voice.lang).toLowerCase()===target.toLowerCase())||available.find(voice=>voiceSupportsLanguage(voice,target))||null;
  }

  function createQueueState(id=0){return {id,index:0,stopped:false,paused:false,timeoutId:null};}
  function resetQueueState(queue){return {id:(queue?.id||0)+1,index:0,stopped:true,paused:false,timeoutId:null};}

  return {normalizeSpeechText,detectTextLanguage,splitLanguageRuns,splitSentences,buildSpeechChunks,voiceSupportsLanguage,selectVoice,createQueueState,resetQueueState};
});
