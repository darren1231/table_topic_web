# 版本紀錄

本檔案是 Table Topic Practice 的正式版本紀錄，記錄每個版本對使用者的影響，以及對應的程式改動。

- 版本號採用[語意化版本](https://semver.org/lang/zh-TW/)：`主版號.次版號.修訂號`。規則與發布流程見 [docs/versioning.md](docs/versioning.md)。
- 每個版本都有對應的 Git 標籤（例如 `v2.0.0`），可以在 GitHub 的 Tags 頁面找到當時的完整程式碼。
- 網站內「設定 → 版本紀錄」只顯示精簡的使用者說明；完整內容以本檔案為準。

每個版本分成三個部分：

- **使用者看得到的變更**：給使用者與分會幹部閱讀。
- **技術變更**：給維護者閱讀，列出對應的 Pull Request。
- **升級注意事項**：部署這個版本前，網站管理者必須完成的設定（沒有就省略）。

## 尚未發布

（目前沒有尚未發布的變更。）

---

## 2.0.0 — 2026-11-10

標籤：`v2.0.0`

這是一次主要版本更新：AI 功能從「使用者自備金鑰」改成「登入後使用網站提供的 AI」，並且大幅強化手機錄音、安全性與自動化測試。舊版的 1.4.0 未曾在網站內公告，也沒有發布標籤，內容已併入本版本。

### 使用者看得到的變更

#### 新增

- **系統 AI**：用 Google 帳號登入後，就能使用網站提供的 AI 出題、分析與語音轉文字，不再需要自己申請 API key。
- **AI 額度**：每位使用者有 1 美元的累計額度，不會定期重置。登入後，或打開「API 費用」畫面時，可以看到「已用 / 額度」。額度用完後會自動改用內建教練。
- **管理員後台**（`/admin`）：管理員可以查看每位使用者的 AI 使用次數、費用與音訊秒數，並依期間、用途、使用者篩選。只能查看，不能修改。
- **手機錄音中斷保留**：錄音時螢幕會保持開啟，不會自動鎖定。如果螢幕關閉或切換到其他 App 導致錄音中斷，已錄的內容會保留；回到網頁後按「繼續錄製」就能接著錄，最後的文字會依順序接起來。
- **阿拉伯語**：新增阿拉伯語練習語言與介面翻譯。

#### 調整

- 自備 API key 的設定已經隱藏。舊的設定仍保留在原本的裝置上，但不會被使用。
- 未登入時仍可使用內建教練，畫面會提示登入後可使用 AI 回饋。
- 語音轉文字改用 OpenAI 的 `gpt-transcribe` 模型，依音訊長度計費。
- 錄音品質固定為 32 kbps，單段錄音大約可以錄 17 分鐘。
- 使用 Google 登入時，一律會出現「選擇帳號」畫面，方便同時有多個 Google 帳號的使用者。
- 系統 AI 的回應速度改善：每次呼叫向資料庫查詢的次數從 4 次減少為 2 次。

#### 修正

- 修正管理員帳號正確設定後，後台仍然顯示「沒有權限」的問題。
- 後台現在會分別顯示「請先登入」、「沒有權限」與「載入失敗」，方便判斷原因。

#### 安全性

- 加強網頁顯示內容的安全處理：AI 回覆、備份檔與雲端資料中的特殊字元一律經過跳脫，網址只允許 `http`、`https`。
- OpenAI 的 API key 只存放在伺服器的環境變數中，不再存放在使用者的瀏覽器。
- AI 使用紀錄只能由伺服器透過受限的資料庫函式寫入，使用者無法修改或刪除自己的紀錄。
- 呼叫 OpenAI 時設定不保存內容（`store: false`），並限制單次輸出長度與等待時間。

### 技術變更

| PR | 內容 |
| --- | --- |
| [#31](https://github.com/darren1231/table_topic_web/pull/31) | 新增阿拉伯語練習語言與語系檔 |
| [#33](https://github.com/darren1231/table_topic_web/pull/33) | 網站檔案移到 `public/`，Vercel 只發布這個資料夾 |
| [#34](https://github.com/darren1231/table_topic_web/pull/34) | Vercel Functions（`/api/ai/respond`、`/api/ai/transcribe`、`/api/ai/balance`）、Supabase migration（`ai_usage`、`app_admins` 與 `security definer` 函式）、管理員後台、隱藏 BYOK；另含選擇帳號、32 kbps 錄音、後台 email 型別修正（`0002` migration）、減少資料庫往返與 `Server-Timing` |
| [#35](https://github.com/darren1231/table_topic_web/pull/35) | Screen Wake Lock（`wake-lock.js`）、錄音分段狀態機（`recording-session.js`） |
| [#36](https://github.com/darren1231/table_topic_web/pull/36) | GitHub Actions：每個 PR 自動執行 `npm test` |
| [#37](https://github.com/darren1231/table_topic_web/pull/37) | 主要練習流程的現況測試 |
| [#38](https://github.com/darren1231/table_topic_web/pull/38) | 從 `app.js` 拆出 `practice-stats.js`、`practice-data.js`、`coach-parsing.js` 並補測試 |
| [#39](https://github.com/darren1231/table_topic_web/pull/39) | `i18n.js` 與 `cloud.js` 的測試 |
| [#40](https://github.com/darren1231/table_topic_web/pull/40) | 舊測試改為 `node:test`、`npm run coverage`、CI 涵蓋率摘要、資料庫回傳型別測試 |
| [#41](https://github.com/darren1231/table_topic_web/pull/41) | 從 `app.js` 拆出 `builtin-coach.js`、`review-cards.js` 並補測試 |
| [#42](https://github.com/darren1231/table_topic_web/pull/42) | `html-utils.js`（`escapeHtml`、`safeUrl`），`app.js` 所有 HTML 輸出改為安全處理 |
| [#43](https://github.com/darren1231/table_topic_web/pull/43) | Playwright 瀏覽器整合測試（Chromium、WebKit iPhone）與 CI `e2e` job |
| 本版本 | 版本號 2.0.0、正式版本紀錄、版本管理文件、README 改版 |

測試從原本 3 支需要手動執行的腳本，增加到 263 項單元測試與 30 項瀏覽器整合測試，每個 PR 都由 GitHub Actions 自動執行。

### 升級注意事項

從 1.3.0 升級時，網站管理者必須完成以下設定（詳細步驟見 README）：

1. 在 Supabase SQL Editor 依序執行 `supabase/migrations/0001_ai_usage.sql` 與 `0002_fix_admin_email_type.sql`。
2. 在 `public.app_admins` 加入管理員的 email。
3. 在 Vercel 設定 `CHATGPT_PREVIEW_KEY`（Preview）與 `CHATGPT_PRODUCTION_KEY`（Production）。
4. 在 Supabase 的 Redirect URLs 加入 Preview 網址的萬用字元。

不需要、也不可以設定 Supabase 的 service role 或 secret key。

### 已知問題

以下問題已確認，將在之後的版本修正：

- 切換阿拉伯語時，主網站的版面沒有改成由右到左。
- 阿拉伯語的朗讀會使用英文語音。
- 日文與阿拉伯語的部分畫面文字與內建教練回饋，會顯示英文或中文。
- 內建教練的「改善稿」是固定範文，與使用者的回答無關。
- 切換語言時，背景會出現不影響使用的錯誤訊息；少數按鈕會套用到意思相近但不正確的翻譯。
- 跨裝置同時使用時，雲端同步可能以較新的一方覆蓋另一方的變更。

---

## 1.3.0 — 2026-08-17

標籤：`v1.3.0`

### 使用者看得到的變更

#### 優化

- 瀏覽器朗讀不再一次送出整篇文章，改為依逗號、句尾、換行、段落及連續語言片段建立播放佇列。
- 逗號、一般句尾及段落之間加入不同長度的自然停頓；開場、問句和段落末句只套用輕微降速。
- 優先使用目前練習語言，正確支援繁體中文、英文和日文；中英混合句會為連續片段選擇相符語音。
- 切換語音或速度、停止及重新播放都會使舊佇列失效，避免上一段結束後意外繼續播放。
- 朗讀前只進行安全的空白、百分比與數字範圍正規化，不改動畫面上的文章內容。

### 技術變更

- [#30](https://github.com/darren1231/table_topic_web/pull/30)：新增 `speech-utils.js` 與測試。1.2.0、1.2.1、1.3.0 在同一次合併中發布，三個標籤指向同一個 commit。

## 1.2.1 — 2026-08-17

標籤：`v1.2.1`

### 使用者看得到的變更

#### 優化

- 文章朗讀新增裝置語音與速度選擇，使用者可選擇較自然的增強語音，偏好會保存在目前瀏覽器。
- 英文與中文文章只顯示相符語系的可用語音，降低選錯朗讀語言的機會。

### 技術變更

- [#30](https://github.com/darren1231/table_topic_web/pull/30)（與 1.2.0、1.3.0 一起發布）。

## 1.2.0 — 2026-08-17

標籤：`v1.2.0`

### 使用者看得到的變更

#### 新增

- 改進後的完整文章可直接使用瀏覽器內建語音朗讀，支援播放、暫停、繼續與停止，不會呼叫 AI 或付費 API。

### 技術變更

- [#30](https://github.com/darren1231/table_topic_web/pull/30)（與 1.2.1、1.3.0 一起發布）。

## 1.1.0 — 2026-08-16

標籤：`v1.1.0`

### 使用者看得到的變更

#### 新增

- 自由講稿現在可以輸入自訂演講標題，標題會保存在練習紀錄、日曆與詳細報告中，方便日後辨識及搜尋。
- 設定選單新增「版本紀錄」，可直接在網站內查看每次更新內容。
- 新增本 `CHANGELOG.md`，作為往後版本更新的單一完整紀錄。

#### 優化

- 舊的自由講稿紀錄仍會保留並以「自由講稿」顯示，不影響既有資料。

### 技術變更

- [#27](https://github.com/darren1231/table_topic_web/pull/27)。

## 1.0.0 — 2026-08-15

標籤：`v1.0.0`（指向 1.1.0 合併前的狀態；本版本的紀錄是在 1.1.0 時補記的）

### 既有功能基線

- 即興問題與自由講稿練習、錄音及語音轉文字。
- AI 表達分析、逐句改善、英文文法解說與複習卡。
- 練習日曆、連續打卡、成績趨勢及 API 費用紀錄。
- 講稿工作區、段落版本、完整講稿分析與資料備份。
- 本機資料模式，以及 Google 登入搭配 Supabase 跨裝置同步。
