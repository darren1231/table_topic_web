(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BuiltinCoach=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function shuffle(items,random=Math.random) { return [...items].sort(() => random() - .5); }
  function basicEnglishGrammarReview(text){
    return (text.match(/[^.!?]+[.!?]?/g)||[text]).map(part=>part.trim()).filter(Boolean).map(original=>{let corrected=original;const issues=[];const replace=(pattern,value,rule)=>{const next=corrected.replace(pattern,value);if(next!==corrected){corrected=next;issues.push(rule);}};replace(/\bi\b/g,'I','The pronoun “I” is always capitalized.');replace(/\bI am agree\b/gi,'I agree','“Agree” is a verb, so it does not take “am.”');replace(/\bpeople is\b/gi,'people are','“People” is plural and takes “are.”');replace(/\b(did not|didn’t|didn't) went\b/gi,'$1 go','After “did,” use the base form of the verb.');replace(/\bmore better\b/gi,'better','Do not use “more” with the comparative form “better.”');return {original,corrected,isCorrect:issues.length===0,issue:issues.length?issues.join(' '):'No obvious grammar error was detected by the built-in check.',explanation:issues.length?'The corrected sentence follows the standard form shown above.':'The sentence is grammatically acceptable. An AI Agent can provide a deeper, context-aware explanation.',rule:issues[0]||'Keep the subject, verb tense, and sentence structure consistent.',example:corrected};});
  }
  function createLocalProvider({questionTemplates,getLanguage,random}){
    const localProvider = {
      async generateQuestions(topic, language, count = 3) {
        const templates = shuffle(questionTemplates[language] || questionTemplates['zh-TW'],random);
        return Array.from({ length: count }, (_, i) => templates[i % templates.length](topic));
      },
      async analyze(text) {
        const length = text.replace(/\s/g, '').length;
        const sentences = text.split(/[。！？!?\.]+/).filter(Boolean).length;
        const connectors = (text.match(/因為|所以|但是|首先|接著|最後|例如|比如|therefore|because|however|first|finally/gi) || []).length;
        const details = (text.match(/例如|比如|當時|記得|有一次|數字|because|for example|when I/gi) || []).length;
        const filler = (text.match(/呃|嗯|然後|就是|那個|um|uh/gi) || []).length;
        const structure = Math.min(96, 52 + sentences * 4 + connectors * 5);
        const detail = Math.min(96, 48 + Math.min(length, 280) / 7 + details * 6);
        const fluency = Math.max(45, Math.min(96, 65 + Math.min(length, 220) / 10 - filler * 3));
        const overall = Math.round((structure + detail + fluency) / 3);
        const isEnglish=getLanguage()==='en-US';
        const base = {
          overall, structure: Math.round(structure), detail: Math.round(detail), fluency: Math.round(fluency),
          strength: isEnglish?(length>120?'You developed your point with enough detail and substance.':'You moved into the topic quickly and made your main idea easy to identify.'):(length > 120 ? '回答有足夠篇幅，也願意展開自己的觀點。' : '你很快進入主題，核心意思容易掌握。'),
          improve: isEnglish?(connectors<2?'Use signposts such as “first,” “for example,” and “finally” to guide your listener.':details<1?'Add a specific person, scene, or event to make your point memorable.':'End by returning to your opening idea in one strong sentence.'):(connectors < 2 ? '加入「首先、例如、最後」等路標，讓聽眾更容易跟上你的思路。' : details < 1 ? '補上一個具體人物、場景或事件，會讓觀點更有記憶點。' : '結尾再用一句話扣回最初的觀點，整體會更完整有力。')
        };
        if(isEnglish){const grammarCorrections=basicEnglishGrammarReview(text);return {...base,summary:'Your answer addresses the topic and communicates a clear personal point. Stronger organization, concrete evidence, and a memorable closing line would make it more persuasive.',improvements:[{title:'State your position first',detail:'Answer the question directly in the opening sentence so listeners immediately know your direction.'},{title:'Make the reasoning concrete',detail:'Support each main reason with one person, scene, number, or personal experience.'},{title:'Finish with impact',detail:'Return to the opening point in a short, vivid closing sentence.'}],comparisons:grammarCorrections.map((item,index)=>({label:`Sentence ${index+1}`,before:item.original,after:item.corrected,grammarIssue:item.issue,grammarExplanation:item.explanation,grammarRule:item.rule,grammarExample:item.example,isGrammarCorrect:item.isCorrect})),grammarCorrections:[],rewritten:'In my view, this question needs to be understood from two different perspectives.\n\nFirst, we should recognize the possible risks. Any powerful technology can create serious consequences when it is not managed responsibly. Progress therefore needs to be matched by safety and accountability.\n\nAt the same time, it can also create valuable opportunities. Used wisely, it may solve existing problems and give society more choices for the future.\n\nUltimately, the question is not simply whether it represents hope or danger. The real challenge is learning to pursue its benefits while managing its risks responsibly.',scoreDetails:[{name:'Clarity of position',before:Math.max(55,base.structure-5),after:92},{name:'Grammar accuracy',before:Math.max(55,base.fluency-8),after:94},{name:'Word choice',before:Math.max(55,base.detail-8),after:90},{name:'Structure',before:base.structure,after:93},{name:'Closing impact',before:Math.max(55,base.structure-4),after:94}],improvedOverall:92};}
        return {...base,
          summary:`你的回答已經抓住題目核心，也清楚表達了主要立場。接下來若能補強論證層次、具體例子與結尾的力度，會更有說服力。`,
          improvements:[
            {title:'開場先亮出立場',detail:'第一句直接回答問題，再進入理由，聽眾會更快掌握方向。'},
            {title:'讓論點更具體',detail:'每個主要理由搭配一個人物、場景、數字或親身經驗，避免停留在抽象判斷。'},
            {title:'強化結尾收束',detail:'最後用一句精煉、有畫面的話重新呼應開場，讓回答留下記憶點。'}
          ],
          comparisons:[
            {label:'開場',before:text.split(/[。！？!?]/)[0]||text.slice(0,40),after:'在我看來，這個問題的答案不是單一選擇，而是需要從兩個面向理解。'},
            {label:'論證',before:'原稿的理由較為概括。',after:'更好的方式是先提出理由，再用一個具體例子說明它如何影響真實生活。'},
            {label:'結尾',before:'原稿在說明觀點後直接結束。',after:'因此，真正重要的不是只選擇一方，而是理解它帶來的機會，同時謹慎管理風險。'}
          ],
          rewritten:`在我看來，這個問題的答案不是單一選擇，而是需要從兩個面向理解。\n\n首先，我們必須正視它可能帶來的風險。任何強大的技術，如果缺乏完善管理，都可能造成難以承受的後果。這提醒我們，在追求進步時，責任與安全同樣重要。\n\n但另一方面，它也可能帶來新的機會。只要運用得當，它能解決現有問題，並為未來提供更多選擇。\n\n因此，真正重要的不是只看見希望或危險，而是學會在兩者之間做出成熟、負責任的判斷。`,
          scoreDetails:[{name:'立場清晰度',before:Math.max(55,base.structure-5),after:92},{name:'用詞準確度',before:Math.max(55,base.detail-8),after:90},{name:'結構完整度',before:base.structure,after:93},{name:'情感感染力',before:Math.max(55,base.fluency-7),after:91},{name:'總結有力',before:Math.max(55,base.structure-4),after:94}],
          improvedOverall:92
        };
      }
    };
    return localProvider;
  }
  return { shuffle, basicEnglishGrammarReview, createLocalProvider };
});
