(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./practice-stats.js'));
  else root.ReviewCards=factory(root.PracticeStats);
})(typeof globalThis!=='undefined'?globalThis:this,function(PracticeStats){
  const { localDateKey } = PracticeStats;
  function dailyLimit(value) { return Number.isInteger(value)&&value>=0&&value<=200?value:10; }
  function matchesLanguage(card,language) { return !language||language==='all'||card.language===language; }
  function byCreated(a,b) { return new Date(a.createdAt)-new Date(b.createdAt)||String(a.id).localeCompare(String(b.id)); }
  function todaysNewCards(cards,{now=Date.now(),newCardsPerDay=10,language='all',reviewEvents=[]}={}) {
    const first = new Map();
    for(const event of reviewEvents){const time=new Date(event.reviewedAt).getTime();if(Number.isFinite(time)&&(!first.has(event.cardId)||time<first.get(event.cardId)))first.set(event.cardId,time);}
    const today=localDateKey(now);
    const used=cards.filter(card=>card.status!=='trashed'&&first.has(card.id)&&localDateKey(first.get(card.id))===today).length;
    return cards.filter(card=>card.status==='active'&&card.introducedAt===null&&matchesLanguage(card,language)).sort(byCreated).slice(0,Math.max(0,dailyLimit(newCardsPerDay)-used));
  }
  function markIntroduced(card,now) { if(card.introducedAt===null)card.introducedAt=new Date(now).toISOString(); }
  function dueIntroduced(cards,{now=Date.now(),language='all'}={}) {
    return cards.filter(card=>card.status==='active'&&card.introducedAt!==null&&card.dueAt!=null&&new Date(card.dueAt).getTime()<=new Date(now).getTime()&&matchesLanguage(card,language))
      .sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt)||byCreated(a,b));
  }
  function buildReviewQueue(cards,options={}) {
    const due=dueIntroduced(cards,options),relearning=due.filter(card=>card.lastRating==='again'),reviews=due.filter(card=>card.lastRating!=='again'),fresh=todaysNewCards(cards,options);
    const queue=[...relearning];let position=0;
    for(let i=0;i<fresh.length;i++){const target=Math.floor((i+1)*reviews.length/fresh.length);while(position<target)queue.push(reviews[position++]);queue.push(fresh[i]);}
    queue.push(...reviews.slice(position));return queue;
  }
  function reviewCounts(cards,options={}) {
    const due=dueIntroduced(cards,options),relearning=due.filter(card=>card.lastRating==='again').length;
    return {relearning,review:due.length-relearning,newToday:todaysNewCards(cards,options).length,
      queued:cards.filter(card=>card.status==='active'&&card.introducedAt===null&&matchesLanguage(card,options.language)).length};
  }
  function cardsFromAnalysis(result,history,now,existingCards=[]) {
    const timestamp=new Date(now).toISOString(),existing=new Set(existingCards.map(card=>card.id));
    const base={sourceHistoryId:history.id,language:history.language,topic:history.topic||'',question:history.question||'',tags:[],createdAt:timestamp,updatedAt:timestamp,introducedAt:null,dueAt:null,intervalDays:0,easeFactor:2.3,repetitions:0,lapses:0,lastRating:null,lastReviewedAt:null,status:'active'};
    const comparisons=(result.comparisons||[]).map((pair,index)=>({...base,tags:[],id:`${history.id}:${index}`,comparisonIndex:index,label:pair.label||'',before:pair.before||'',after:pair.after||'',isGrammarCorrect:pair.isGrammarCorrect,grammarIssue:pair.grammarIssue||'',grammarExplanation:pair.grammarExplanation||'',grammarRule:pair.grammarRule||'',grammarExample:pair.grammarExample||''}));
    const grammar=(result.grammarCorrections||[]).flatMap((pair,index)=>pair.isCorrect===true?[]:[{...base,tags:[],id:`${history.id}:grammar:${index}`,grammarIndex:index,language:'en-US',label:pair.rule||'Grammar correction',before:pair.original||'',after:pair.corrected||'',grammarExplanation:pair.explanation||'',grammarRule:pair.rule||''}]);
    return [...comparisons,...grammar].filter(card=>!existing.has(card.id));
  }
  function dueCards(reviewCards,reviewLanguage,getNow){const now=getNow();return reviewCards.filter(c=>c.status==='active'&&new Date(c.dueAt).getTime()<=now&&(reviewLanguage==='all'||c.language===reviewLanguage)).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));}
  function cardMastery(card){return Math.max(0,Math.min(100,Math.round(Math.min(1,(card.repetitions||0)/6)*70+Math.min(1,(card.intervalDays||0)/30)*30)));}
  function filteredLibraryCards(reviewCards,state){const query=state.librarySearch.trim().toLowerCase(),from=state.libraryDateFrom,to=state.libraryDateTo;const cards=reviewCards.filter(card=>{if(state.reviewLanguage!=='all'&&card.language!==state.reviewLanguage)return false;if(state.libraryStatus!=='all'&&card.status!==state.libraryStatus)return false;if(query){const haystack=[card.label,card.topic,card.question,card.before,card.after,card.grammarIssue,card.grammarExplanation,card.grammarRule,card.grammarExample,...(card.tags||[])].join(' ').toLowerCase();if(!haystack.includes(query))return false;}if(from||to){const value=card[state.libraryDateType];if(!value)return false;const key=localDateKey(value);if(from&&key<from)return false;if(to&&key>to)return false;}return true;});const time=value=>{const n=new Date(value||0).getTime();return Number.isFinite(n)?n:0;};cards.sort((a,b)=>state.librarySort==='dueDesc'?time(b.dueAt)-time(a.dueAt):state.librarySort==='createdDesc'?time(b.createdAt)-time(a.createdAt):state.librarySort==='createdAsc'?time(a.createdAt)-time(b.createdAt):state.librarySort==='reviewedDesc'?time(b.lastReviewedAt)-time(a.lastReviewedAt):state.librarySort==='masteryDesc'?cardMastery(b)-cardMastery(a):time(a.dueAt)-time(b.dueAt));return cards;}
  function reviewStatusLabel(status,ui){return status==='archived'?ui('已封存','Archived'):status==='trashed'?ui('垃圾桶','Trash'):ui('啟用中','Active');}
  function rateReview(card,rating,getNow){const before=card.intervalDays||0;let days=0;if(rating==='again'){card.intervalDays=0;card.repetitions=0;card.lapses=(card.lapses||0)+1;card.easeFactor=Math.max(1.3,(card.easeFactor||2.3)-.2);card.dueAt=new Date(getNow()+10*60000).toISOString();}else{card.repetitions=(card.repetitions||0)+1;if(rating==='hard'){days=Math.max(1,Math.round(Math.max(1,before)*1.2));card.easeFactor=Math.max(1.3,(card.easeFactor||2.3)-.1);}if(rating==='good'){days=card.repetitions===1?1:card.repetitions===2?3:Math.max(4,Math.round(before*2.3));}if(rating==='easy'){days=card.repetitions===1?4:Math.max(7,Math.round(Math.max(1,before)*3.2));card.easeFactor=Math.min(3,(card.easeFactor||2.3)+.15);}card.intervalDays=days;card.dueAt=new Date(getNow()+days*86400000).toISOString();}card.lastRating=rating;card.lastReviewedAt=new Date(getNow()).toISOString();card.updatedAt=card.lastReviewedAt;return before;}
  function bulkSetStatus(reviewCards,ids,status,getNow){const cards=reviewCards.filter(card=>ids.includes(card.id));cards.forEach(card=>{card.status=status;delete card.deletedAt;delete card.previousStatus;card.updatedAt=new Date(getNow()).toISOString();});}
  function bulkSetDueDate(reviewCards,selectedIds,value,getNow){const due=new Date(`${value}T09:00:00`);reviewCards.filter(card=>selectedIds.has(card.id)&&card.status!=='trashed').forEach(card=>{const now=getNow();markIntroduced(card,now);card.dueAt=due.toISOString();card.updatedAt=new Date(now).toISOString();});}
  return { dueCards, cardMastery, filteredLibraryCards, reviewStatusLabel, rateReview, bulkSetStatus, bulkSetDueDate, todaysNewCards, markIntroduced, buildReviewQueue, reviewCounts, cardsFromAnalysis };
});
