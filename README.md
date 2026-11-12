# Table Topic Practice

即興演講（Table Topics）與備稿演講的練習網站。輸入主題就能產生題目，錄音或打字作答後，由 AI 教練給予結構、內容與流暢度的回饋，並把需要加強的句子做成複習卡。

- **目前版本**：2.0.0（[版本紀錄](CHANGELOG.md)）
- **支援語言**：繁體中文、English、日本語、العربية
- **網站架構**：靜態前端（`public/`）＋ Vercel Functions（`api/`）＋ Supabase（登入、同步、AI 用量）

## 目錄

- [主要功能](#主要功能)
- [架構總覽](#架構總覽)
- [開發者快速開始](#開發者快速開始)
- [測試](#測試)
- [部署與設定（網站擁有者）](#部署與設定網站擁有者)
- [系統 AI 與額度](#系統-ai-與額度)
- [打卡與代幣](#打卡與代幣)
- [管理員後台](#管理員後台)
- [資料與隱私](#資料與隱私)
- [新增或修改語言](#新增或修改語言)
- [版本與變更紀錄](#版本與變更紀錄)
- [文件索引](#文件索引)
- [常見問題](#常見問題)

## 主要功能

**使用說明**
- 網站內使用說明書（四種語言）：在首頁標題上方開啟，依介面語言顯示操作步驟與常見問題；可分享 `#guide`、透過目錄跳到章節，或直接開始練習。

**練習**
- 即興問答：依主題產生題目，限時作答。
- 自由講稿：自訂演講標題，錄音或打字。

**語音**
- 瀏覽器即時語音辨識，或錄音後交給 AI 轉成文字。
- 在支援的瀏覽器上，錄音時螢幕保持開啟；使用 API 轉錄時，錄音被中斷會保留已錄內容，可以接著錄。
- 改進後的文章可以用瀏覽器語音朗讀。

**回饋與複習**
- AI 教練：評分、優點、逐句改善與英文文法解說。
- 內建教練：不需要登入、不呼叫 AI，提供基本回饋。
- 複習卡：依間隔重複排程；卡片庫可以搜尋、篩選與批次管理。

**紀錄**
- 練習日曆、連續打卡、成績趨勢與 API 費用明細。
- 完整資料匯出與匯入。
- 本機模式，或用 Google 登入跨裝置同步。

**AI 與管理**
- 登入 Google 後使用網站提供的系統 AI，不需要自備 API key。
- 每人 1 美元累計額度，用完自動改用內建教練。
- 登入後成功完成 AI 分析可自動打卡、累積代幣，並用代幣兌換額外 AI 額度。
- 管理員後台（`/admin`）查看每位使用者的用量、費用、代幣與連續天數。

## 架構總覽

```text
瀏覽器（public/）
  ├─ 靜態網頁、練習邏輯、語系檔 ──────────── Vercel 靜態網站
  ├─ /api/ai/respond、/transcribe、/balance ── Vercel Functions（api/）
  │                                              ├─ OpenAI（key 只在伺服器）
  │                                              └─ Supabase（以使用者本人的登入憑證呼叫）
  ├─ /api/tokens/status、/makeup、/exchange ── Vercel Functions ── Supabase
  └─ Google 登入、雲端同步、後台查詢 ────────── Supabase
```

| 目錄或檔案 | 內容 |
| --- | --- |
| `public/` | 網站本體，Vercel 只發布這個資料夾 |
| `public/app.js` | 主程式 |
| `public/*.js` | 從主程式拆出的模組：`practice-stats`、`practice-data`、`coach-parsing`、`builtin-coach`、`review-cards`、`html-utils`、`system-ai`、`token-ui`、`usage-stats`、`wake-lock`、`recording-session`、`speech-utils`、`coach-result-utils` |
| `public/cloud.js` | Google 登入與雲端同步 |
| `public/i18n.js`、`public/locales/` | 多語系 |
| `public/admin.html`、`public/admin.js` | 管理員後台 |
| `api/ai/` | 三個 Vercel Functions 入口 |
| `api/tokens/` | 代幣狀態、補簽與兌換入口 |
| `api/_lib/` | 伺服器共用邏輯：設定、計費、額度、輸入驗證、簽章、代幣與錯誤處理 |
| `supabase.sql` | 同步用資料表 `user_data` 與 RLS |
| `supabase/migrations/` | AI 用量、簽章驗證、代幣帳本、管理員名單與資料庫函式 |
| `test/` | 單元測試（`node:test`） |
| `e2e/` | 瀏覽器整合測試（Playwright） |
| `docs/` | 決策紀錄、實作計畫、版本管理 |

## 開發者快速開始

需要 **Node.js 20 以上**。

```bash
npm install
npm test        # 單元測試
npm run e2e     # 瀏覽器整合測試（第一次需先安裝瀏覽器，見「測試」）
```

**只看前端畫面**：語系檔透過 `fetch` 載入，不能用 `file://` 直接開啟。以 `public/` 為根目錄啟動本機伺服器：

```bash
python -m http.server 8000 --directory public
```

然後開啟 <http://localhost:8000>。這種方式**不能**執行 `/api/*`，所以系統 AI 無法使用。

**測試完整的系統 AI**：使用 Vercel 的 Preview 部署，或安裝 Vercel CLI 後執行 `vercel dev`。本機 `development` 環境使用 `CHATGPT_PREVIEW_KEY`。

**新增檔案時**：網站要用的檔案放進 `public/`，伺服器端函式放在 `api/`，不要放在儲存庫根目錄。

## 測試

每個 PR 與每次推送到 `main`，GitHub Actions 會平行執行兩個 job，**兩個都通過才合併**：

| Job | 指令 | 內容 | 時間 |
| --- | --- | --- | --- |
| `test` | `npm test` | 語系檢查與 `test/` 下的單元測試 | 約 15 秒 |
| `e2e` | `npm run e2e` | Chromium 與 WebKit（iPhone）實際操作網站 | 約 1 分鐘 |

### 單元測試

```bash
npm test
npm run coverage   # 涵蓋率報告
```

- 測試使用假的 `fetch` 與記憶體中的 PGlite 資料庫，不需要任何金鑰，也不會呼叫真正的 OpenAI 或 Supabase。
- 涵蓋率摘要會顯示在 GitHub Actions 每次執行的 Summary 頁面。不設門檻，數字低不會讓 CI 失敗。

### 瀏覽器整合測試

```bash
npx playwright install chromium webkit   # 第一次執行前安裝瀏覽器
npm run e2e
```

- Playwright 固定使用 `1.64.1`。CI 使用官方映像 `mcr.microsoft.com/playwright:v1.64.1-noble`，**升級 `@playwright/test` 時要同步更新** `.github/workflows/test.yml` 的映像版本。
- 測試會自動用 `scripts/serve-public.mjs` 在 `127.0.0.1:4173` 啟動網站。
- 所有對外請求都被攔截：Supabase 與 `/api/*` 由測試模擬，只允許從 jsDelivr 載入 Supabase SDK。其他未模擬的外部請求會讓測試失敗。
- 錄音測試只在 Chromium 使用假麥克風；WebKit 的兩項錄音測試會略過。
- CI 失敗時會上傳 `playwright-report`，保留 7 天。下載解壓縮後用 `npx playwright show-report playwright-report` 查看截圖與 trace。
- 既有問題記錄在 [e2e/KNOWN_ISSUES.md](e2e/KNOWN_ISSUES.md)。

### 自動化測不到、需要人工確認的部分

真實的 Google 登入、真實的 OpenAI 回覆、iPhone 實機錄音與螢幕鎖定，以及排版是否美觀。PR 有改動這些部分時，請在 Preview 網址人工確認。

## 部署與設定（網站擁有者）

`vercel.json` 設定只發布 `public/`，`api/` 由 Vercel Functions 執行。`main` 有新的合併時，Vercel 會自動部署正式網站；每個 PR 也會產生一個 Preview 網址。

### 首次部署檢查清單

依序完成以下步驟，詳細操作見後面各小節：

1. 建立 Supabase 專案（[Supabase 設定](#supabase-設定)第 1 步）。
2. 在 SQL Editor 依序執行：
   1. `supabase.sql`
   2. `supabase/migrations/0001_ai_usage.sql`
   3. `supabase/migrations/0002_fix_admin_email_type.sql`
   4. 先依[簽章密碼與部署順序](#簽章密碼與部署順序)設定 Vercel，再執行 `supabase/migrations/0003_signed_usage_and_tokens.sql` 並插入資料庫簽章密碼。
3. 把管理員 email 加入 `public.app_admins`（[管理員後台](#管理員後台)）。
4. 在 Google Cloud 建立 OAuth client，並在 Supabase 開啟 Google 登入。
5. 在 Supabase 的 URL Configuration 加入正式網址與 Preview 網址。
6. 把 Supabase 的公開 URL 與 publishable key 填入 `public/supabase-config.js`。
7. 在 Vercel 設定環境變數（[下一節](#vercel-環境變數)）。

升級既有部署時，請看 [CHANGELOG.md](CHANGELOG.md) 中每個版本的「升級注意事項」。

### Vercel 環境變數

在 Vercel 專案的 **Settings → Environment Variables** 設定。不要把私人金鑰寫進前端程式或儲存庫。

| 名稱 | 必填 | 預設值與用途 |
| --- | --- | --- |
| `CHATGPT_PREVIEW_KEY` | 必填 | Preview 與本機 Development 使用的 OpenAI key |
| `CHATGPT_PRODUCTION_KEY` | 必填 | Production 使用的 OpenAI key |
| `USAGE_SIGNING_SECRET` | 必填 | 至少 32 個字元的隨機簽章密碼；必須與資料庫相同。Preview 與 Production 共用同一個 Supabase 專案，兩邊必須設定相同值 |
| `TOKEN_EXCHANGE_USD_PER_1000` | 選填 | `0.01`，每 1000 枚代幣兌換的 AI 額度（美元） |
| `AI_MODEL` | 選填 | `gpt-5.6-luna`，出題與回饋的模型 |
| `AI_TRANSCRIBE_MODEL` | 選填 | `gpt-transcribe`，語音轉文字的模型 |
| `AI_INPUT_USD_PER_MTOK` | 選填 | `0.2`，文字模型每百萬輸入 token 的美元單價 |
| `AI_OUTPUT_USD_PER_MTOK` | 選填 | `1.2`，文字模型每百萬輸出 token 的美元單價 |
| `AI_TRANSCRIBE_USD_PER_MINUTE` | 選填 | `0.0045`，語音轉文字每分鐘的美元單價 |
| `AI_TRANSCRIBE_INPUT_USD_PER_MTOK` | 選填 | 無預設值。語音服務改以 token 計費時才需要 |
| `AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK` | 選填 | 無預設值。語音服務改以 token 計費時才需要 |
| `AI_USER_CREDIT_USD` | 選填 | `1`，每位使用者的累計額度（美元） |
| `SUPABASE_URL` | 選填 | 預設與 `public/supabase-config.js` 相同 |
| `SUPABASE_PUBLISHABLE_KEY` | 選填 | 預設與 `public/supabase-config.js` 相同 |

- 目前環境的 OpenAI key 沒有設定時，AI 請求會回 503，不會借用另一個環境的 key。
- 簽章密碼缺少或不合法時，AI 與代幣端點會回 503；它是本專案的 HMAC 密碼，**不是** Supabase 的 service role 或 secret API key。
- 數字設定必須是有限、非負的數值，否則視為設定錯誤。
- 語音的預設單價取自 [OpenAI 官方價格頁](https://developers.openai.com/api/docs/pricing)（2026-11-08 查詢）。
- **不需要、也不可以設定 Supabase 的 service role 或 secret key。** 伺服器以使用者本人的登入憑證呼叫資料庫函式，決策原因見 [ADR 0001](docs/adr/0001-system-ai-key-without-service-role.md)。
- 換用其他 Supabase 專案時，`public/supabase-config.js` 與 `api/_lib/supabase-defaults.js` 必須同步修改。測試會檢查兩者是否一致。

### 簽章密碼與部署順序

首次啟用打卡與代幣，或從未執行 `0003` 的版本升級時：

1. 產生至少 32 個字元的隨機密碼，例如用密碼管理員產生 64 個隨機字元；不要使用下方的示範假值。
2. 在 Vercel 的 Preview、Production 都設定 `USAGE_SIGNING_SECRET`，**共用同一個 Supabase 專案時，兩個環境必須完全相同**。需要本機連同一資料庫時，也使用相同值。設定好兌換比例與各環境的 OpenAI key。
3. 合併部署分支後，在 Supabase SQL Editor 依序確認 `supabase.sql`、`0001`、`0002` 已執行，再執行完整的 [`0003_signed_usage_and_tokens.sql`](supabase/migrations/0003_signed_usage_and_tokens.sql)。`0003` 只執行一次，不要為了更新密碼重跑整份 migration。
4. 緊接著用資料庫擁有者在 SQL Editor 執行以下 SQL，把假值換成第 1 步的同一組密碼：

   ```sql
   -- 明確的假值範例；正式部署必須換成自行產生的隨機密碼。
   insert into private.signing_keys (name, secret)
   values ('usage', 'FAKE-EXAMPLE-ONLY-REPLACE-WITH-YOUR-RANDOM-SECRET');
   ```

   密碼必須和 Vercel **逐字相同**，不要額外加空白。已有 `usage` 資料列時應更新該列，而不是重建資料表；更換密碼時，Vercel 與資料庫也要一起更新。不要對 `private` schema 開放使用者權限，也不要關閉 RLS。
5. 確認 Vercel 的新版部署已完成，且已套用環境變數；必要時重新部署。用 Google 登入、完成一次成功的系統 AI 分析，確認有使用紀錄與打卡，並用管理員後台檢查用量及代幣。

Vercel 部署**不會自動執行 migration**。切換期間，舊伺服器遇到新的簽章記帳函式時，可能仍回傳 AI 結果但無法記帳；新版伺服器若先於 `0003` 上線，會因舊版餘額回應缺少 `bonus_credit` 而暫時拒絕 AI 請求。請接續完成 SQL、密碼與新版部署三者。

### Supabase 設定

#### 1. 建立專案

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 選 **New project**，選擇離使用者較近的 region。
2. 記下 **Project Ref**。Google OAuth 的 callback URL 是：

   ```text
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```

#### 2. 建立資料表

在 **SQL Editor** 依序執行以下四個檔案，每次都貼上完整內容後按 **Run**：

1. [`supabase.sql`](supabase.sql)：同步用的 `user_data` 與 RLS。
2. [`supabase/migrations/0001_ai_usage.sql`](supabase/migrations/0001_ai_usage.sql)：AI 用量 `ai_usage`、管理員名單 `app_admins` 與資料庫函式。
3. [`supabase/migrations/0002_fix_admin_email_type.sql`](supabase/migrations/0002_fix_admin_email_type.sql)：後台查詢的型別修正，可以安全地重複執行。
4. [`supabase/migrations/0003_signed_usage_and_tokens.sql`](supabase/migrations/0003_signed_usage_and_tokens.sql)：簽章記帳、代幣帳本、打卡、補簽、兌換與管理員代幣查詢。執行後還要依[簽章密碼與部署順序](#簽章密碼與部署順序)插入簽章密碼。

部署網站**不會**自動執行這些 SQL。請勿關閉 RLS，也不要建立讓 `anon` 讀取全部資料的 policy。

#### 3. 在 Google Cloud 設定 OAuth

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 的 **Google Auth Platform** 完成 OAuth consent screen。測試期間要把登入用的帳號加入 **Test users**。
2. 建立 **OAuth client ID**，類型選 **Web application**。
3. **Authorized JavaScript origins**：加入網站 origin，不含路徑與結尾的 `/`，例如 `http://localhost:8000`、`https://你的正式網域`。
4. **Authorized redirect URIs**：加入第 1 步的 Supabase callback URL。
5. Client secret 只填入 Supabase，不可放進本專案。

#### 4. 在 Supabase 開啟 Google 登入

**Authentication → Providers → Google**：開啟並貼上 Client ID 與 Client secret。

#### 5. 設定登入後返回的網址

**Authentication → URL Configuration**：

- **Site URL**：正式網站首頁。
- **Redirect URLs**：加入所有會使用的網址，包含 Preview 的萬用字元，例如：

  ```text
  http://localhost:8000/**
  https://你的正式網域/**
  https://*-darrendarren1232-1921s-projects.vercel.app/**
  ```

登入時會以目前頁面的網址作為返回網址；不在清單中的網址會被導回 Site URL。

#### 6. 前端公開金鑰

從 **Project Settings → API Keys** 複製 Project URL 與 publishable key，填入 [`public/supabase-config.js`](public/supabase-config.js)。**絕對不可**填入 service role 或 secret key，前端程式碼所有訪客都看得到。

### 正式上線檢查

- Google Cloud 的 origins 與 redirect URI 都已加入正式網址。
- Supabase 的 Redirect URLs 已加入正式網址與 Preview 萬用字元。
- `public/supabase-config.js` 使用的是 publishable key。
- `user_data` 的 RLS 仍為啟用狀態。
- 四個 SQL 檔都已執行，`app_admins` 中有管理員；已部署過 `0001`／`0002` 的資料庫仍須執行 `0003`。
- Vercel 的 Preview 與 Production 都已設定對應的 OpenAI key。
- Vercel 的兩個環境與 `private.signing_keys` 的 `usage` 密碼完全相同。
- Google OAuth 若仍為 Testing，正式開放前要完成 publishing。

## 系統 AI 與額度

- **誰可以用**：用 Google 登入的使用者。沒有登入時使用內建教練。是否能用 AI 只看有沒有登入，與是否開啟雲端同步無關。
- **額度**：每人預設 **1 美元，累計使用、不會重置**。用完後顯示「AI 額度已用完，請聯絡管理員」，回饋改由內建教練完成。
- **用量顯示**：登入後、打開「API 費用」畫面時，以及每次呼叫 AI 之後，會更新「已用 / 額度」。數字以伺服器紀錄為準，清除本機紀錄不會重置額度。
- **額外額度**：代幣兌換的金額會加在基本額度上；兌換成功後，「API 費用」與 AI 使用資格會一起更新。
- **錄音上限**：AI 轉錄的單段音檔上限 4 MB。錄音品質固定為 32 kbps，大約可以錄 17 分鐘；被中斷的錄音會分段保留，每段各自計算上限。
- **自備金鑰（BYOK）**：目前隱藏（`public/app.js` 的 `ENABLE_BYOK = false`）。舊的設定仍保留在使用者的裝置上，但不會被使用。

## 打卡與代幣

- 用 Google 登入後，頁首會顯示帳號的代幣餘額與連續天數，點選可打開面板；與本機／雲端同步模式無關。
- 一天以 **Asia/Taipei** 計算。當天有一次成功且通過伺服器簽章驗證的系統 AI **分析回饋**就自動打卡，一天最多一次；出題、潤稿、語音轉文字及內建教練不算。
- 連續第 1–5 天各得 **10、20、30、50、80 枚**，第 6 天起每天 **100 枚**。
- 每漏一天扣最多 **50 枚**，最低扣到 0；下一次打卡重新從第 1 天開始。扣點在下一次帳本寫入時補記，但畫面餘額已包含確定會扣的數字。從未打卡前不會被扣點。
- 只能花 **200 枚補簽昨天**，並退回昨天實際被扣的代幣；可否補簽以退款後餘額判斷。補簽本身沒有獎勵；今天已打卡才補簽時，會補上接回連續天數後的今日獎勵差額。
- 每 **1000 枚為一單位**兌換 AI 額度，預設每單位 **0.01 美元**，以面板顯示的伺服器比例為準。補簽與兌換都會先要求確認。
- 未打卡時顯示「今天完成 AI 分析可得 X 枚」；已打卡時顯示「明天繼續可得 Y 枚」。
- 從新版與 `0003` 啟用後的新紀錄開始計算，之前的練習不補發。代幣保存在資料庫帳本中，清除本機資料不會重置。

## 管理員後台

部署後開啟 **`/admin`**，用 Google 登入。主網站上沒有後台的連結。

**新增管理員**：在 Supabase SQL Editor 執行，把 email 換成管理員登入 Google 用的帳號：

```sql
insert into public.app_admins (email) values ('admin@example.invalid');
```

**移除管理員**：

```sql
delete from public.app_admins where lower(email) = lower('admin@example.invalid');
```

**權限**：
- 登入的帳號必須在名單上，而且 email 已驗證；比對不分大小寫。
- 畫面會顯示「請先登入」、「沒有權限」或「載入失敗」。變更名單後請重新整理後台。

**可以看到的內容**：依期間（本月、最近 7 天、最近 30 天、全部）、用途、使用者篩選，查看呼叫次數、輸入與輸出 token、音訊秒數、費用；以及每位使用者的累計已用金額與最後使用時間。

代幣表格另顯示每位使用者的 email、有效餘額、連續天數及最後打卡日（成功 AI 分析打卡的日期）。有效餘額包含尚未寫入的漏簽扣點；沒有打卡紀錄的人也會列出，最後打卡日顯示「—」。此表只依使用者篩選，不受用量的期間與用途篩選影響。

**後台只能查看，不能修改**使用紀錄、額度或代幣。`admin_list_tokens` 與用量查詢使用相同的資料庫管理員判斷；非管理員看不到兩種資料。

## 資料與隱私

| 資料 | 存放位置 |
| --- | --- |
| 練習紀錄、講稿、複習卡 | 使用者的瀏覽器；開啟雲端同步時，也會存一份在 Supabase 中該使用者自己的資料列 |
| 語言、朗讀等裝置偏好 | 只存在使用者的瀏覽器 |
| AI 使用紀錄（時間、用途、模型、token、音訊秒數、費用） | Supabase `ai_usage`，使用者只能讀取自己的紀錄 |
| 打卡、代幣增減與兌換 | Supabase `token_ledger`，只能透過固定函式新增；使用者只能讀取自己的帳本，管理員可唯讀查看摘要 |
| OpenAI API key | 只在 Vercel 環境變數 |
| 使用紀錄與兌換的簽章密碼 | Vercel 的 `USAGE_SIGNING_SECRET` 與資料庫 `private.signing_keys`，不傳給瀏覽器 |
| 錄音檔 | 只暫存在瀏覽器記憶體，轉成文字後即丟棄；伺服器與資料庫都不保存 |

- 呼叫 OpenAI 時設定 `store: false`，不讓 OpenAI 保存內容。
- 後台不顯示講稿或回饋內容，只顯示用量與費用。

**雲端同步的行為**：
- 帳號在雲端已有資料時，登入後會以雲端資料載入目前裝置。
- 帳號在雲端還沒有資料時，會把目前裝置的資料作為第一份雲端資料。
- 隨時可以切回「僅限這台裝置」停止同步，先前的雲端資料不會被刪除。

## 新增或修改語言

所有介面文字、placeholder、內建主題與題目模板都在 `public/locales/`。`zh-TW.json` 是預設與備援語系，每個語系檔使用相同的 key。

1. 複製 `public/locales/zh-TW.json`，以 BCP 47 語言標籤命名，例如 `fr-FR.json`。
2. 保留所有 key 與題目模板中的 `{topic}`，只翻譯內容。
3. 在 `public/i18n.js` 的 `supportedLocales` 與 `public/index.html` 的語言選單加入新語系。
4. 在 `public/app.js` 的 `CONFIG.languages` 加入新語系。
5. 執行 `npm test`，其中的語系檢查會確認每個語系的 key 都齊全。

## 版本與變更紀錄

- [CHANGELOG.md](CHANGELOG.md)：每個版本的使用者變更、技術變更與升級注意事項。
- [docs/versioning.md](docs/versioning.md)：版本號規則、平常怎麼記錄、發布步驟。
- 每個版本都有 Git 標籤（例如 `v2.0.0`），可以在 GitHub 的 **Tags** 頁面查看當時的程式碼。
- 網站內的「設定 → 版本紀錄」顯示精簡的使用者說明。

## 文件索引

| 文件 | 內容 |
| --- | --- |
| [GLOSSARY.md](GLOSSARY.md) | 名詞表：使用者、管理員、額度、使用紀錄等 |
| [docs/adr/](docs/adr/) | 重要決策紀錄 |
| [docs/plans/](docs/plans/) | 各階段的實作計畫 |
| [docs/versioning.md](docs/versioning.md) | 版本管理與發布流程 |
| [e2e/KNOWN_ISSUES.md](e2e/KNOWN_ISSUES.md) | 瀏覽器測試發現、尚未修正的問題 |

## 常見問題

| 狀況 | 優先檢查 |
| --- | --- |
| 畫面顯示「尚未設定 Supabase」 | `public/supabase-config.js` 的 URL 與 key 是否填寫；瀏覽器是否成功載入該檔案 |
| Google 顯示 `redirect_uri_mismatch` | Google Cloud 的 redirect URI 是否為完整的 Supabase `/auth/v1/callback` |
| 登入後回到錯誤的網址 | Supabase 的 Site URL 與 Redirect URLs 是否包含目前的網址（Preview 需要萬用字元） |
| 有多個 Google 帳號，想換另一個 | 先在網站登出，再登入一次，會出現選擇帳號的畫面 |
| 顯示 `Invalid API key` | 是否複製到其他專案的 key，或誤用 secret key |
| 同步出現 `row-level security` 錯誤 | 是否已執行 `supabase.sql`；登入是否已過期 |
| 第二台裝置沒有資料 | 是否登入同一個帳號；第一台是否顯示「已同步」；第二台是否開啟雲端模式 |
| 顯示「系統 AI 尚未就緒」 | Vercel 是否設定了目前環境（Preview 或 Production）的 OpenAI key |
| AI 回應正常但沒有記帳／沒有打卡 | 檢查 Vercel 的 `USAGE_SIGNING_SECRET` 與資料庫 `private.signing_keys` 中 `name = 'usage'` 的密碼是否完全一致，並確認 `0003` 已執行；只有成功的系統 AI 分析會打卡 |
| 後台一直顯示「沒有權限」 | email 是否在 `app_admins`；是否已執行 `0002` migration |
| 顯示「音檔超過 4 MB」 | 單段錄音太長。改用瀏覽器語音辨識，或分段錄製 |
| Google 測試帳號無法登入 | OAuth consent screen 是否仍為 Testing，帳號是否在 Test users |
