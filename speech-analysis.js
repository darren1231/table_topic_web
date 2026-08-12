(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpeechAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS = Object.freeze({
    comfortableEnglishWpm: [120, 160], comfortableChineseCpm: [220, 300],
    comfortableMixedRate: [150, 240], highFillersPerMinute: 3
  });
  const VOCAL = { en: ['ah', 'um', 'uh', 'er', 'erm'], zh: ['嗯', '呃', '額', '痾', '啊'] };
  const CRUTCH = { en: ['you know', 'i mean', 'kind of', 'sort of', 'actually', 'basically', 'so', 'well', 'like'], zh: ['基本上', '你知道', '我覺得', '怎麼說', '那個', '就是', '然後', '其實'] };

  function normalizeTranscript(text) { return String(text || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim(); }
  function englishTokens(text) { return normalizeTranscript(text).match(/[A-Za-z]+(?:'[A-Za-z]+)*|\d+(?:[.,]\d+)*/g) || []; }
  function countEnglishWords(text) { return englishTokens(text).length; }
  function countChineseCharacters(text) { return (normalizeTranscript(text).match(/[\u3400-\u9FFF]/g) || []).length; }
  function countMixedLanguage(text) {
    const english = countEnglishWords(text), chinese = countChineseCharacters(text);
    const languageType = english && chinese ? 'mixed' : chinese ? 'chinese' : 'english';
    return { english, chinese, total: english + chinese, languageType };
  }
  function speechRate(count, durationSeconds) { return durationSeconds > 0 ? Math.round((Number(count) || 0) / (durationSeconds / 60)) : 0; }
  function removeOverlappingMatches(matches) {
    return [...matches].sort((a,b) => a.start-b.start || (b.end-b.start)-(a.end-a.start)).reduce((kept,item) => {
      if (!kept.some(x => item.start < x.end && item.end > x.start)) kept.push(item);
      return kept;
    }, []).sort((a,b) => a.start-b.start);
  }
  function contextAt(text, start, end) { return text.slice(Math.max(0,start-30), Math.min(text.length,end+30)).trim(); }
  function phraseMatches(text, phrases, category, language) {
    const found=[];
    for (const phrase of [...phrases].sort((a,b)=>b.length-a.length)) {
      if (language === 'en') {
        const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
        const re=new RegExp(`\\b${escaped}\\b`,'gi'); let match;
        while ((match=re.exec(text))) found.push({start:match.index,end:match.index+match[0].length,term:phrase,original:match[0],category});
      } else { let from=0,index; while((index=text.indexOf(phrase,from))>=0){found.push({start:index,end:index+phrase.length,term:phrase,original:text.slice(index,index+phrase.length),category});from=index+phrase.length;} }
    }
    return found;
  }
  function repeatedMatches(text) {
    const found=[]; let m;
    const en=/\b([A-Za-z]+(?:'[A-Za-z]+)*)\s*(?:[—–-]\s*)?\1\b/gi;
    while((m=en.exec(text))) found.push({start:m.index,end:m.index+m[0].length,term:m[1],original:m[0],category:'repeated'});
    const zh=/([\u3400-\u9FFF]{1,4})\1/g;
    while((m=zh.exec(text))) found.push({start:m.index,end:m.index+m[0].length,term:m[1],original:m[0],category:'repeated'});
    return found;
  }
  function matchFillers(transcript, durationSeconds=0) {
    const text=normalizeTranscript(transcript);
    const matches=removeOverlappingMatches([
      ...phraseMatches(text,VOCAL.en,'vocal','en'), ...phraseMatches(text,VOCAL.zh,'vocal','zh'),
      ...phraseMatches(text,CRUTCH.en,'crutch','en'), ...phraseMatches(text,CRUTCH.zh,'crutch','zh'), ...repeatedMatches(text)
    ]);
    return matches.map(item=>({...item,context:contextAt(text,item.start,item.end),timestampSeconds:text.length&&durationSeconds>0?item.start/text.length*durationSeconds:0}));
  }
  function group(items, category) { const out={}; items.filter(x=>x.category===category).forEach(x=>out[x.term]=(out[x.term]||0)+1); return out; }
  function generateFeedback(result) {
    const zh=result.languageType!=='english', unit=result.speechRateUnit;
    if (!result.totalFillerCount) return zh
      ? [`這段演講沒有偵測到語助音或慣用贅詞，清楚的停頓習慣值得保持。`,`目前語速為 ${result.speechRate} ${unit}，可以搭配錄音確認節奏是否自然。`]
      : [`No vocal fillers or possible crutch words were detected—keep using clear, comfortable pauses.`,`Your pace is ${result.speechRate} ${unit}; listen back once to confirm it feels natural.`];
    const perMin=result.durationSeconds>0?(result.totalFillerCount/(result.durationSeconds/60)).toFixed(1):'0.0';
    const top=Object.entries({...result.vocalFillers,...result.possibleCrutchWords}).sort((a,b)=>b[1]-a[1])[0];
    return zh ? [
      `這段演講共偵測到 ${result.totalFillerCount} 次 filler，平均每分鐘 ${perMin} 次。`,
      top?`最常出現的是「${top[0]}」，共 ${top[1]} 次；下次可以試著用一秒鐘的安靜停頓代替。`:'',
      `目前語速為 ${result.speechRate} ${unit}；部分贅詞可能具有正常語意，建議點選時間標記重新聆聽。`
    ].filter(Boolean) : [
      `This speech contains ${result.totalFillerCount} detected fillers, averaging ${perMin} per minute.`,
      top?`“${top[0]}” appears most often (${top[1]} times); try replacing it with a one-second silent pause.`:'',
      `Your pace is ${result.speechRate} ${unit}. Some crutch words may be meaningful in context, so review the marked moments.`
    ].filter(Boolean);
  }
  function analyzeSpeech({transcript,durationSeconds=0}) {
    const normalized=normalizeTranscript(transcript), counts=countMixedLanguage(normalized);
    const unit=counts.languageType==='english'?'words/min':counts.languageType==='chinese'?'字/min':'字詞/min';
    const occurrences=matchFillers(normalized,durationSeconds);
    const result={durationSeconds,transcript:normalized,languageType:counts.languageType,wordCount:counts.total,speechRate:speechRate(counts.total,durationSeconds),speechRateUnit:unit,vocalFillers:group(occurrences,'vocal'),possibleCrutchWords:group(occurrences,'crutch'),repeatedWords:group(occurrences,'repeated'),totalFillerCount:occurrences.length,occurrences};
    result.feedback=generateFeedback(result); return result;
  }
  function formatDuration(seconds) { const s=Math.max(0,Math.floor(Number(seconds)||0)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60; return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`; }
  return {SETTINGS,normalizeTranscript,countEnglishWords,countChineseCharacters,countMixedLanguage,speechRate,matchFillers,removeOverlappingMatches,generateFeedback,analyzeSpeech,formatDuration};
});
