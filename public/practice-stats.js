(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PracticeStats=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function localDateKey(date = new Date()) { const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function todayKey(date = new Date()) { return localDateKey(date); }
  function inferLanguage(entry){const text=`${entry.question||''} ${entry.answer||''}`;const latin=(text.match(/[A-Za-z]/g)||[]).length;const cjk=(text.match(/[\u3400-\u9fff]/g)||[]).length;return latin>cjk*1.5?'en-US':cjk?'zh-TW':'unknown';}
  function calculateStreaks(history){const days=[...new Set(history.map(x=>x.date))].sort();let longest=0,run=0,prev=null;for(const key of days){const d=new Date(`${key}T12:00:00`);if(prev&&Math.round((d-prev)/86400000)===1)run++;else run=1;longest=Math.max(longest,run);prev=d;}let current=0,d=new Date();const set=new Set(days);if(!set.has(localDateKey(d))){d.setDate(d.getDate()-1);}while(set.has(localDateKey(d))){current++;d.setDate(d.getDate()-1);}return{current,longest};}
  function trendEntries(history,trendLanguage,trendPeriod){const items=history.filter(x=>trendLanguage==='all'||x.language===trendLanguage).slice().reverse();return trendPeriod==='all'?items:items.slice(-Number(trendPeriod));}
  function filteredHistory(history,language){return history.filter(x=>language==='all'||x.language===language);}
  return { localDateKey, todayKey, inferLanguage, calculateStreaks, trendEntries, filteredHistory };
});
