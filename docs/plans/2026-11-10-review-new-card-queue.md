# 實作計畫：複習卡的新卡佇列與每日新卡數

- 日期：2026-11-10
- 目標版本：2.1.0
- 分工：Claude 負責規劃與 review，Codex 負責實作
- 背景：目前複習卡要在分析結果頁手動勾選才會建立，建立後立刻全部到期。因此不複習時，待複習數量不會增加，也沒有「每天固定複習量」。改成參考 Anki 的設計。
- 名詞：見 [GLOSSARY.md](../../GLOSSARY.md) 的「複習」段落。

## 已確定的設計

1. **自動加入新卡佇列**：每次分析完成並保存練習紀錄後，把結果中所有「改善比較句」與「文法修正」（`isCorrect !== true` 的項目）自動建立為卡片，放進新卡佇列。分析結果頁的勾選框預設為勾選；取消勾選就把卡片移出（沿用現有的移到垃圾桶流程）；再勾選就恢復。
2. **每日新卡數**：使用者可調整，整數 0–200，預設 10。存在練習資料 `saved.reviewSettings.newCardsPerDay`，會隨雲端同步。0 表示暫停引入新卡。
3. **不累積**：每天最多引入「每日新卡數」張。引入發生在使用者打開網站或複習頁面時；沒打開的日子不會補引入。佇列中的卡片不會消失。
4. **到期複習沒有上限**：所有到期的卡片都會出現。
5. **出現順序**：
   1. 重新學習中的卡片：剛按「再一次」、且已經到期的卡。
   2. 到期的複習卡：依到期時間由舊到新。
   3. 今天引入、還沒複習過的新卡：平均穿插在第 2 類之間。
   - 平均穿插的定義：設複習卡 R 張、新卡 N 張，新卡放在複習卡序列中大約每 `R / N` 張的位置；R 為 0 時新卡依序排列。結果必須是確定性的（同樣輸入得到同樣順序），方便測試。
6. **一天的界線**：使用者裝置的本地時間午夜（沿用 `PracticeStats.localDateKey`）。
7. **現有卡片**：資料升級時，所有已存在的卡片視為「已引入」，`introducedAt` 設為原本的 `createdAt`，到期狀態不變。
8. **計數一致**：首頁、選單徽章與複習頁面使用同一個函式計算。首頁與徽章計算所有語言；複習頁面依語言篩選時，同時顯示「目前語言」與「全部語言」的數量。
9. **修正「再一次」**：按「再一次」時把 `intervalDays` 設為 0（目前保留舊值，測試中已標記 KNOWN ISSUE）。

## 資料模型

在既有的卡片欄位上新增：

| 欄位 | 說明 |
| --- | --- |
| `introducedAt` | 從佇列引入的時間（ISO 字串）。`null` 代表還在新卡佇列中 |

規則：

- 佇列中的卡片：`status: 'active'`、`introducedAt: null`、`dueAt: null`。不會出現在任何到期計數中。
- 引入時：`introducedAt = now`、`dueAt = now`。
- 「今天已引入幾張」= `introducedAt` 的本地日期等於今天的卡片數（不含垃圾桶）。
- 佇列中的引入順序：`createdAt` 由舊到新，同時間依 `id`。
- `saved.reviewSettings = { newCardsPerDay: 10 }`，由 `PracticeData.ensureDataSchema` 補上預設值並驗證範圍；不合法的值回到 10。

## 實作位置

- 純邏輯放在 `public/review-cards.js`（已有模組），新增並匯出：
  - `introduceNewCards(cards, { now, newCardsPerDay })`：回傳本次引入的卡片，並修改卡片欄位。
  - `buildReviewQueue(cards, { now, language })`：回傳依規則排序的今日佇列。
  - `reviewCounts(cards, { now, language })`：回傳 `{ relearning, review, newToday, queued }`，首頁、徽章、複習頁面共用。
  - 修正 `rateReview` 的「再一次」。
- 自動建立卡片的邏輯抽成純函式（例如 `cardsFromAnalysis(result, history, now)`），放在 `review-cards.js` 並測試；`app.js` 只負責在保存分析後呼叫並 `persist()`。
- `ensureDataSchema` 的升級規則放在 `public/practice-data.js`。
- `app.js` 的 `dueCards`、`updateReviewBadge`、`renderReviewPage` 改用上述函式。
- 複習頁面上方加入「每日新卡數」數字輸入框與說明文字；顯示「今日新卡」「到期複習」「佇列中」三個數字。
- 新的畫面文字使用 `t(key)`，加入四個語系檔；輸出一律使用 `textContent` 或 `escapeHtml`。

## 測試（TDD）

單元測試（先寫、確認失敗再實作）：

- 引入：佇列 25 張、每日 10 張 → 今天引入 10 張；同一天再呼叫不會再引入；隔天再引入 10 張；中間空了 4 天，回來那天仍只引入 10 張。
- 每日新卡數為 0 時不引入；超出範圍或非整數時回到預設值。
- 佇列中的卡片不計入到期數量，也不會出現在 `buildReviewQueue`。
- 排序：重新學習 → 到期複習（舊到新）→ 新卡平均穿插。用 R=40、N=10 與 R=3、N=5、R=0、N=4 驗證位置。
- 計數：`reviewCounts` 的結果在首頁、徽章、複習頁面一致；語言篩選正確。
- 「再一次」把 `intervalDays` 設為 0，並把原本的 KNOWN ISSUE 測試改成正確的預期結果。
- 資料升級：舊卡片取得 `introducedAt = createdAt`；`reviewSettings` 補上預設值；舊資料可重複升級而不改變結果。
- 自動建卡：分析結果有 3 個比較句、2 個文法修正（其中 1 個 `isCorrect: true`）→ 建立 4 張佇列卡；同一筆分析再處理一次不會重複建立；取消勾選後的卡片不會被自動建回來。

瀏覽器整合測試（`e2e/`，兩個瀏覽器專案）：

- 用 `page.clock` 固定日期：練習一題 → 卡片進入佇列、複習頁顯示「佇列中」數量；打開複習頁後引入至多「每日新卡數」張。
- 把每日新卡數改成 2 → 重新整理後設定仍在，隔天只引入 2 張。
- 時間往後推 5 天 → 到期複習數量增加，新卡仍只引入設定的張數。
- 首頁徽章與複習頁面顯示的數量一致。

## 文件

- `CHANGELOG.md`「尚未發布」段落：依 `docs/versioning.md` 的寫法，加入使用者變更與技術變更。
- `README.md` 的「回饋與複習」描述更新。

## 工作規則

- 分支 `feat/review-new-card-queue`。分成三個 commit：
  1. 純邏輯與單元測試（`review-cards.js`、`practice-data.js`）。
  2. `app.js` 與畫面、語系檔、e2e 測試。
  3. CHANGELOG 與 README。
- 每個 commit 前 `npm test` 與 `npm run e2e` 都要通過。
- 不要 push。不要修改與本計畫無關的程式，不要重新排版既有長行。
- 全部完成後回報「REVIEW QUEUE DONE」，附三個 commit hash、新增測試清單與測試摘要，然後停下來。遇到計畫沒寫到、需要做設計決定的情況，停下來回報，不要自行決定。
