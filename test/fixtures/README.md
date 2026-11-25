# 備份相容 fixture

`legacy-coach-results.json` 為歷史程式的輸出快照，不含真實使用者資料。

- 以 `git log --all --follow` 查閱 coach-parsing／builtin-coach 的抽離紀錄，再用 `git show` 查抽離前的 app.js。
- 前兩筆由 `d1ec565:app.js` 的 parseScore、baseScoreForCategory、normalizeCoachResult 執行代表性模型輸入產生。
- 當時會保留字串陣列 improvements，並接受 overallScore、scores、grammar_corrections 等別名；不是每份舊 metrics 都有相同顯示欄位。
- 第三筆直接執行 `0027975:public/builtin-coach.js` 的 createLocalProvider.analyze，取得英文內建教練結果。
- `1d6a246` 抽離 coach-parsing 時保留了這些相容輸入；目前模組仍需讀取它們。
- 相容測試另經 app 實際產生 history、scripts、reviewEvents 與 apiUsage，再驗證 buildBackup → parseBackup。
- `legacy-coach-results.json:135` 的字串行超過 200 字元，屬 M10 長字串例外：保留歷史輸出的原始文字以檢查資料往返，避免改寫 fixture 來遷就排版。

## 驗證入口的差別

- **本機啟動**使用 `validateStartupPractice`：只隔離損壞 JSON、非物件根、非陣列的頂層集合、危險鍵及無法正規化的非物件紀錄。
- 啟動保留重複 ID，不擅自改寫來源關聯；缺少 dueAt 的舊卡補成目前時間，原有有效排程不變。缺少集合、標籤、段落版本與分析使用既有預設值。
- 缺少或無效的歷史日期由正規化補齊；已提供但需修正的原值留在 `_startupOriginals`，不因此隔離整份 practice。
- **檔案匯入／遠端還原**仍以 `practiceIssue` 嚴格檢查 ID、操作用陣列、排程日期等關鍵結構，失敗不覆蓋本機。啟動放寬不代表外部輸入自動可信。
- 三個入口皆拒絕危險鍵；教練顯示欄位與用量顯示數字皆可正規化，原值留在 `_displayOriginals`，再次匯出仍保留。
- 雲端上傳須先成功讀取遠端；無資料也須經讀取確認。套用遠端並等待重載時繼續封鎖 push，避免舊記憶體的空白預設值回寫。
