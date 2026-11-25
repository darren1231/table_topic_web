# 備份相容 fixture

`legacy-coach-results.json` 為歷史程式的輸出快照，不含真實使用者資料。

- 以 `git log --all --follow` 查閱 coach-parsing／builtin-coach 的抽離紀錄，再用 `git show` 查抽離前的 app.js。
- 前兩筆由 `d1ec565:app.js` 的 parseScore、baseScoreForCategory、normalizeCoachResult 執行代表性模型輸入產生。
- 當時會保留字串陣列 improvements，並接受 overallScore、scores、grammar_corrections 等別名；不是每份舊 metrics 都有相同顯示欄位。
- 第三筆直接執行 `0027975:public/builtin-coach.js` 的 createLocalProvider.analyze，取得英文內建教練結果。
- `1d6a246` 抽離 coach-parsing 時保留了這些相容輸入；目前模組仍需讀取它們。
- 相容測試另經 app 實際產生 history、scripts、reviewEvents 與 apiUsage，再驗證 buildBackup → parseBackup。
- `legacy-coach-results.json:135` 的字串行超過 200 字元，屬 M10 長字串例外：保留歷史輸出的原始文字以檢查資料往返，避免改寫 fixture 來遷就排版。

驗證政策：id、頂層集合、段落／版本等操作用陣列、排程與危險鍵維持嚴格驗證；
教練顯示欄位與用量顯示數字可正規化。修正前的值留在 `_displayOriginals`，再次匯出仍保留。
