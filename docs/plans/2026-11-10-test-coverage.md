# 實作計畫：補齊單元測試（邊拆邊測）

- 日期：2026-11-10
- 分工：Claude 負責規劃與 review，Codex 負責實作
- 範圍：只補測試與「搬移程式碼以便測試」。**不修任何已知 bug、不做速度改善、不改變使用者看到的行為。**

## 現況

- `api/`：程式行涵蓋率 100%。
- 新的前端模組（`system-ai.js`、`usage-stats.js`、`wake-lock.js`、`recording-session.js`）：96–99%。
- `public/app.js`：約 170 個函式，只有系統 AI 與錄音流程有測試。
- `public/cloud.js`：沒有測試。
- `public/i18n.js`：只有語系檔完整性檢查。
- `scripts/` 下的舊測試不在 `node --test` 內，沒有納入涵蓋率統計。

## 工作規則（Codex 必讀）

1. 在分支 `test/coverage-series` 上工作。**一次只做一個步驟**，完成後回報「T? DONE」並停下來，等 Claude review。
2. 每一步一個 commit。commit message 用英文，最後加一行 `Co-Authored-By: Codex <noreply@openai.com>`。不要 push。
3. **不改變行為。** 把函式從 `app.js` 搬到新檔案時，邏輯要一模一樣，只改成從新模組呼叫。
4. **發現 bug 時不要修。** 先寫測試記錄「目前的行為」，在測試旁註解 `// KNOWN ISSUE: <審查編號或說明>`，並在回報中列出。審查報告已知的問題：F01（HTML 跳脫）、F02/F03（同步覆蓋）、F05/F06（匯入）、F09（內建教練固定範文）。
5. 新模組使用 UMD 寫法（參考 `public/speech-utils.js`），在 `index.html` 的 `app.js` 之前載入；`admin.html` 有用到時也要載入。
6. 只搬移該步驟列出的函式；不要重新排版其他既有的長行。
7. 測試不得呼叫真實的 OpenAI、Supabase 或任何網路服務。測試中不得出現真實的 email、key 或 token。
8. 每一步結束時 `npm test` 必須全部通過，GitHub Actions 也會自動執行。

## 步驟

### T1：記錄現況的流程測試（不搬移程式）

使用 `test/helpers/frontend.cjs` 載入 `app.js`，以內建教練（未登入）跑完整流程，並記錄目前的結果：

- 產生題目 → 顯示第一題。
- 輸入回答 → 分析 → 練習紀錄新增一筆，欄位正確（id、date、topic、question、score、metrics）。
- 練習紀錄寫入 localStorage，重新載入後仍存在。
- 歷史清單、日曆、連續天數顯示更新。
- 分析產生的複習卡寫入 `saved.reviewCards`。

如果 helper 的假 DOM 不夠用，可以擴充 helper，但不要修改 `app.js`。

### T2：日期與統計

搬到 `public/practice-stats.js`：`localDateKey`、`todayKey`、`inferLanguage`、`calculateStreaks`、`trendEntries`、`filteredHistory`。

測試重點：
- 台灣時區（Asia/Taipei）午夜前後的日期歸屬。
- 連續天數：今天沒練、昨天有練；中間斷一天；同一天練多次。
- `inferLanguage`：中文、英文、日文、阿拉伯文、空字串（記錄目前行為，F11 已知問題）。
- 篩選：期間、語言。

### T3：資料格式與備份

搬到 `public/practice-data.js`：`ensureDataSchema`、`buildBackup`、`backupFilename`，以及 `importBackupFile` 中「驗證與解析」的部分（讀檔與 UI 留在 `app.js`）。

測試重點：
- 舊版資料（缺少 `reviewCards`、`scripts`、`apiUsage`、`version`）升級後的結構。
- `buildBackup()` 預設把所有 API key 清空；`includeApiKeys: true` 時保留。
- 匯入驗證：格式字串錯誤、`history` 不是陣列、`projects` 為空、`history` 含 `null`（記錄目前行為，F06 已知問題）。

### T4：解讀 AI 回傳內容

搬到 `public/coach-parsing.js`：`extractJson`、`normalizeApiUsage`、`parseScore`、`baseScoreForCategory`、`normalizeCoachResult`。

測試重點：
- AI 回傳包在 ```json 區塊、前後有說明文字、JSON 不完整、完全不是 JSON。
- 分數為數字、字串、`85/100`、超出 0–100、缺少。
- 不同供應商的 usage 欄位名稱（`input_tokens`、`prompt_tokens`、`inputTokens`）。

### T5：內建教練

搬到 `public/builtin-coach.js`：`localProvider`、`basicEnglishGrammarReview`、`shuffle`（讓測試可以注入固定的隨機函式）。

測試重點：
- 出題數量、主題代入、四種語言。
- 分析結果的欄位結構與分數範圍。
- 英文文法檢查的典型句子。
- 改善稿內容（記錄目前行為，F09 已知問題）。

### T6：複習卡

搬到 `public/review-cards.js`：`dueCards`、`cardMastery`、`filteredLibraryCards`、`reviewStatusLabel`，以及 `rateReview`、`bulkSetStatus`、`bulkSetDueDate` 中計算下次複習日期與狀態的部分（UI 留在 `app.js`）。

測試重點：
- 每種評分後的下次複習日期與狀態。
- 到期判斷（今天、過去、未來）。
- 篩選與搜尋。
- 移到垃圾桶與復原。

### T7：多語系（`public/i18n.js`）

不搬移，直接測試現有模組（用假的 `fetch` 與 DOM）：

- `translate`：變數代入、缺少 key 時回退到繁體中文、再回退到 key 本身。
- `setLocale`：`lang` 屬性；不支援的語系回退。
- `fromSource`、`keyForValue`。
- `apply`：文字節點、placeholder、`title`、`aria-label`；使用者輸入的內容剛好與介面文字相同時會被翻譯（記錄目前行為，已知問題）。
- 任一語系檔載入失敗時 `ready` 的結果（記錄目前行為）。

### T8：雲端同步（`public/cloud.js`）

不搬移，用假的 Supabase client 與 localStorage 測試：

- `readLocalPayload`：正常、壞掉的 JSON。
- `remoteSignature`。
- 登入後啟用雲端：雲端有資料時覆蓋本機；雲端沒有資料時上傳本機。
- `scheduleSync` 的延遲上傳；同步中再次觸發時排隊。
- 輪詢拉到不同的雲端資料時覆蓋本機並重新載入（記錄目前行為，F02/F03 已知問題）。
- 登出、切換本機模式。

### T9：統一測試與涵蓋率

- 把 `scripts/test-coach-result-utils.cjs`、`scripts/test-speech-utils.cjs` 改寫成 `test/` 下的 `node:test` 測試，內容不變；`scripts/check-i18n.mjs` 保留。
- `package.json` 新增 `npm run coverage`（`node --test --experimental-test-coverage`）。
- 調查 `app.js` 透過 `vm` 載入時能否納入涵蓋率；不行的話在 README 註明。
- GitHub Actions 在測試後輸出涵蓋率摘要（不設門檻，不讓 CI 因涵蓋率失敗）。

### T10：資料庫測試與真實 Supabase 一致

- 測試用的假 `auth.users` 欄位型別與 Supabase 一致（例如 `email varchar(255)`、`email_confirmed_at timestamptz`），並在測試檔註明來源。
- 新增一個測試，依序套用 `0001`、`0002` 後，確認三個函式的回傳型別與宣告一致。

## PR 分組

| PR | 步驟 | 內容 |
| --- | --- | --- |
| 1 | T1 | 記錄現況的流程測試 |
| 2 | T2–T4 | 日期統計、資料備份、AI 回傳解析 |
| 3 | T5–T6 | 內建教練、複習卡 |
| 4 | T7–T8 | 多語系、雲端同步 |
| 5 | T9–T10 | 測試統一、涵蓋率、資料庫一致性 |

每個 PR 合併前都要通過 GitHub Actions，並在 preview 網址做一次基本操作檢查（練習一題、看歷史、切換語言）。

## 完成後

- 已知問題都有測試記錄「目前行為」。之後修 F01、F02/F03、F05/F06、F09 時，把對應的 `KNOWN ISSUE` 測試改成正確的預期行為（TDD 的紅燈），再修程式。
