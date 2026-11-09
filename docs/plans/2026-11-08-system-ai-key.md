# 實作計畫：系統 AI key、額度與管理員後台

- 日期：2026-11-08
- 決策依據：[ADR 0001](../adr/0001-system-ai-key-without-service-role.md)
- 名詞：[GLOSSARY.md](../../GLOSSARY.md)
- 分工：Claude 負責規劃與 review，Codex 負責實作。

## 工作規則（Codex 必讀）

1. 在分支 `feat/system-ai-key` 上工作，分支從最新的 `origin/main` 開出。
2. **一次只做一個步驟。** 每步完成後停下來，回報「STEP N DONE」，等 Claude review 通過才做下一步。
3. 每一步都用 TDD：先寫測試 → 執行並確認**失敗** → 寫實作 → 執行並確認**通過** → `npm test` 全部通過 → commit。
4. 每步一個 commit。commit message 用英文，最後加一行 `Co-Authored-By: Codex <noreply@openai.com>`。
5. **不准 `git push`**，不准修改 Vercel 或 Supabase 的線上設定，不准執行任何會呼叫真實 OpenAI 或 Supabase 的指令。測試一律使用假的 fetch。
6. 不要把任何 API key、token 或真實 email 寫進程式碼、測試或 commit。
7. 只修改該步驟列出的範圍。發現範圍外的問題，回報給 Claude，不要自行修改。
8. 不要 commit `CODEX_REVIEW.md` 或 `docs/code-review/`。

## 固定規格

### Vercel 環境變數

| 名稱 | 用途 | 缺少時 |
| --- | --- | --- |
| `CHATGPT_PREVIEW_KEY` | `VERCEL_ENV=preview` 時使用的 OpenAI key | 回 503 |
| `CHATGPT_PRODUCTION_KEY` | `VERCEL_ENV=production` 時使用的 OpenAI key | 回 503 |
| `AI_MODEL` | 文字模型，預設 `gpt-5.6-luna` | 用預設值 |
| `AI_TRANSCRIBE_MODEL` | 語音轉文字模型，預設 `gpt-transcribe` | 用預設值 |
| `AI_INPUT_USD_PER_MTOK` / `AI_OUTPUT_USD_PER_MTOK` | 文字模型單價（每百萬 token），預設 `0.2` / `1.2` | 用預設值 |
| `AI_TRANSCRIBE_USD_PER_MINUTE` | 語音模型每分鐘單價，預設 `0.0045`（[官方價格](https://developers.openai.com/api/docs/pricing)，2026-11-08 查詢） | 用預設值；無效設定回 503 |
| `AI_TRANSCRIBE_INPUT_USD_PER_MTOK` / `AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK` | 語音模型 tokens 計費單價，**沒有預設值** | duration usage 不需要；tokens usage 缺少任一單價時記錄失敗、回 502，不回傳轉錄結果 |
| `AI_USER_CREDIT_USD` | 每人額度，預設 `1` | 用預設值 |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | 預設取 `api/_lib/supabase-defaults.js` 的值，與 `public/supabase-config.js` 一致；測試以文字比對，不執行前端設定檔 | 用預設值 |

`VERCEL_ENV` 不是 `preview` 或 `production`（例如本機的 `development`）時，使用 `CHATGPT_PREVIEW_KEY`。

**不得使用 Supabase service role 或 secret key。**

所有數字環境變數都必須是有限且非負的數值，無效設定回 503。語音服務有每分鐘單價即可使用：
`usage.type` 為 `duration` 或含有 `usage.seconds` 時，以 `seconds / 60 * AI_TRANSCRIBE_USD_PER_MINUTE` 計費；
否則必須有完整的 input/output token usage 與兩個 token 單價。沒有 usage、秒數／token 不合法，或缺少 token 單價時，
一律記錄失敗並回 502，不得當成免費成功結果回傳。

### API 端點

三個端點都要求 `Authorization: Bearer <使用者的 Supabase access token>`。入口使用 CommonJS 的具名 `POST(request)`／`GET(request)` Web handler，核心 `handleRespond`、`handleTranscribe`、`handleBalance` 接受可注入的 `request`、`env`、`fetch`，回傳 `Response`。

1. `POST /api/ai/respond`：body `{ instructions: string, input: string, kind: string }`，回傳 `{ text, usage, cost, balance }`。
2. `POST /api/ai/transcribe`：multipart，欄位 `file`、`prompt`、`kind`，回傳 `{ text, usage, cost, balance }`。
3. `GET /api/ai/balance`：驗證身分後呼叫 `get_my_ai_balance()`，回傳 `{ spent, credit, balance, exhausted }`。只讀取 Supabase 與額度設定，不需要 OpenAI key、不呼叫 OpenAI，也不新增使用紀錄。額度用完仍回 200，並以 `exhausted: true` 表示。

兩個 POST 請求的處理順序：

1. 只接受 `POST`。
2. 用 `GET {SUPABASE_URL}/auth/v1/user` 驗證身分。失敗回 401；此請求與後續 RPC 都帶公開 `apikey` 與使用者本人的 `Authorization`。
3. 以 `POST {SUPABASE_URL}/rest/v1/rpc/get_my_ai_balance` 取得本人 `spent`，額度取自伺服器 `AI_USER_CREDIT_USD`。已用金額 ≥ 額度時回 402，body `{ error: 'credit_exhausted' }`，**不呼叫 OpenAI**。餘額查詢失敗或資料不合法時回 503，不放行 AI 請求。
4. 驗證輸入：文字 `instructions` + `input` 合計上限 60,000 個 Unicode 字元；音檔上限 4 MB（4 × 1024 × 1024 bytes，Vercel 請求上限 4.5 MB），轉錄 `prompt` 上限 2,000 字元。Respond 的 `kind` 限 `agent`、`analysis`、`questions`、`polish`；transcribe 只接受 `transcription`。不合格回 400。
5. 呼叫 OpenAI，兩者都使用 `AbortSignal.timeout(60000)`。文字端點為 `/v1/responses`，body 含伺服器指定的 `model`、`instructions`、`input`、`store: false`、`max_output_tokens: 8000`；轉錄端點為 `/v1/audio/transcriptions`，multipart 含 `file`、伺服器指定的 `model`、`prompt`、`response_format: json`。**忽略**使用者送來的任何 model 欄位。逾時或上游回應不合法時，走失敗記帳流程並回 502。
6. 依單價計算費用，呼叫 `record_ai_usage(...)` 記帳，成功或失敗的呼叫都要記。
7. 記帳使用 `POST {SUPABASE_URL}/rest/v1/rpc/record_ai_usage`。成功後重新查詢餘額，回傳結果與最新 `balance` 物件（`spent`、`credit`、`balance`、`exhausted`）。記帳失敗時仍保留已取得的 AI 結果，伺服器日誌僅記錄已清理的錯誤；最後餘額查詢失敗時 `balance` 回 `null`。錯誤訊息不得包含 API key 或 OpenAI 的原始錯誤 body。

GET 額度端點只接受 GET，身分驗證與 RPC 使用相同憑證規則；非 GET 回 405、身分無效回 401、額度設定或查詢異常回 503。

### 資料庫（檔案：`supabase/migrations/0001_ai_usage.sql`）

- `public.ai_usage`：`id uuid pk default gen_random_uuid()`、`user_id uuid not null references auth.users on delete cascade default auth.uid()`、`created_at timestamptz default now()`，以及沿用前端 `recordApiUsage` 的欄位：`provider`、`model`、`kind`、`status`、`error`（上限 500 字元）、`input_tokens`、`output_tokens`、`input_rate`、`output_rate`、`estimated_cost`（`check >= 0`）、`duration_ms`，另加 `audio_seconds numeric not null default 0`（有限且非負）。Duration 計費時將秒數寫入 `audio_seconds`，tokens 與 rates 記 0；tokens 計費時 `audio_seconds` 記 0。
- `public.app_admins`：`email text primary key`。
- 兩張表都 `enable row level security`。`ai_usage` 只有「select 自己的資料」一條 policy；`app_admins` **沒有任何 policy**。兩張表都 `revoke insert, update, delete` from `anon`、`authenticated`。
- 函式一律 `security definer`、`set search_path = ''`，內文使用完整名稱（`public.ai_usage`）：
  - `record_ai_usage(..., p_audio_seconds numeric default 0)`：寫入一筆，`user_id` 固定為 `auth.uid()`。`auth.uid()` 為 null 時拋錯。金額、token 數不得為負，秒數須有限且非負，文字欄位限制長度。只能新增，不能修改或刪除。
  - `get_my_ai_balance()`：只回傳 `spent numeric`，也就是呼叫者本人所有紀錄的 `estimated_cost` 總和。額度比較由伺服器用 `AI_USER_CREDIT_USD` 進行。
  - `admin_list_ai_usage(p_since timestamptz default null)`：以 `auth.uid()` 到 `auth.users` 查出呼叫者的 `email`，且 `email_confirmed_at is not null`，再比對 `app_admins`（比對時不分大小寫）。**不要**信任 JWT 裡的 email 欄位。不符合時拋錯。通過後回傳所有紀錄（含 `audio_seconds`），並附上使用者 email。
- `revoke execute ... from public, anon`，只 `grant execute` 給 `authenticated`。
- `supabase.sql` 末尾已註明需另外執行 migration；README 說明初次設定時依序執行兩份檔案一次，部署不會自動執行。

### 前端

- 新增 provider `system`（顯示名稱「系統 AI」）。登入時預設使用 `system`；未登入時使用 `builtin`。
- 系統 AI 資格只看是否登入，與雲端同步模式無關。`window.tableTopicsCloud.getAccessToken()` 每次透過 `client.auth.getSession()` 取得最新 token，未登入回 `null`。
- 新增常數 `ENABLE_BYOK = false`。為 `false` 時，隱藏設定中 provider、endpoint、API key、模型、價格、測試連線等自備金鑰欄位。localStorage 中舊的自備金鑰專案保留不刪，但不能被選為使用中。
- `callAgent` 與兩個轉錄函式遇到 `system` 時改呼叫上述 API，token 取自 Supabase session。不得在前端出現 OpenAI key。
- `callAgent` 的 kind 由呼叫端傳入 `questions`、`analysis`、`polish`，其餘預設為 `agent`。轉錄使用 `transcription`，超過 4 MB 時先在前端阻擋並提示改用瀏覽器語音辨識。
- 收到 402 時，顯示「AI 額度已用完，請聯絡管理員」，並改用內建教練完成這次回饋。
- 收到 401 時，提示重新登入。
- 登入與開啟 API 費用視窗時呼叫 `GET /api/ai/balance`，顯示「已用 $x / 額度 $y」，exhausted 時直接改用內建教練。AI 成功後也以回傳的 balance 更新顯示，不能用本機紀錄推算額度。
- 系統 AI 呼叫成功後，以回傳的 cost 與 usage 寫入 provider 為 `system` 的本機使用紀錄；伺服器紀錄才是額度的依據。清除本機紀錄不會重置額度。
- `public/system-ai.js` 採 UMD，提供 provider 選擇、API 錯誤分類、音檔大小檢查及可注入 fetch 的 client；在 `app.js` 之前載入並有測試。
- 所有新增的畫面文字必須加入四個語系檔（`public/locales/*.json`），`node scripts/check-i18n.mjs` 必須通過。
- 新增文字使用 `t(key)`，新增畫面以 `textContent`／DOM API 呈現，不新增中文／英文雙參數 `ui()` 寫法。

### 管理員後台

- 新頁面 `public/admin.html`（部署網址 `/admin`），以 `SUPABASE_CONFIG` 自行建立獨立 Supabase client，提供 Google 登入／登出，透過 `client.rpc('admin_list_ai_usage')` 取資料，**不經過 Vercel Function**。不載入 `cloud.js` 或 `app.js`，主網站不放後台連結。
- 畫面與統計沿用現有的 API 使用紀錄介面（期間、用途篩選、總計、明細），再加上「使用者」欄位與篩選，以及每位使用者的已用金額。
- `public/usage-stats.js` 採 UMD，前後台共用期間／用途／使用者篩選、呼叫次數、輸入輸出 token、總費用、音訊秒數統計及依使用者彙總，並有單元測試。前台同時支援本機 camelCase 紀錄與資料庫 snake_case 欄位。
- 後台每位使用者的已用金額表顯示全部期間的 email、呼叫次數、已用金額與最後使用時間；期間與用途篩選套用於總計及明細，使用者篩選也套用於使用者表。
- 所有來自資料庫的文字一律用 `textContent` 或完整的 HTML 跳脫（包含 `"` 與 `'`）輸出，不得直接塞進 `innerHTML`。
- 非管理員開啟時只顯示「沒有權限」。
- RPC 失敗時同樣只顯示「沒有權限」並清空資料；登出後不允許先前查詢回填。後台只能查看使用紀錄，管理員名單由擁有者在 SQL Editor 新增／移除。

## 步驟

### STEP 1：測試環境

- 新增 `package.json`（`"private": true`，`"type": "commonjs"`，`"engines": {"node": ">=20"}`），`"test"` 依序執行既有三支腳本與 `node --test test/`。
- 允許的 devDependency 只有 `@electric-sql/pglite`（STEP 2 用來在測試中執行 SQL）。不得新增其他套件。
- 加入 `package-lock.json`；`.gitignore` 已忽略 `node_modules/`。
- 驗收：`npm test` 通過，既有三支腳本照常執行。

### STEP 2：資料庫 migration

- 以 PGlite 建立假的 `auth` schema：`auth.users`、`auth.uid()`、`auth.jwt()`，從 `request.jwt.claims` 設定讀取，模擬 Supabase；再建立 `anon`、`authenticated` 角色。
- 先寫測試，再寫 `supabase/migrations/0001_ai_usage.sql`。至少涵蓋：
  - 使用者只能新增自己的紀錄；嘗試指定別人的 `user_id` 無效。
  - 負數金額、負數 token 被拒絕。
  - 使用者不能 update、delete `ai_usage`，也不能讀別人的紀錄。
  - 使用者讀不到 `app_admins`。
  - `get_my_ai_balance` 只計算本人的紀錄。
  - 非管理員呼叫 `admin_list_ai_usage` 會失敗；管理員可以讀到所有人的紀錄。
  - `anon` 無法執行任何函式。

### STEP 3：伺服器共用邏輯（純函式）

- `api/_lib/` 下實作並測試：環境選 key、費用計算、額度判斷、輸入驗證、錯誤訊息清理（移除任何疑似 key 的字串）。

### STEP 4：`/api/ai/respond`

- handler 接受可注入的 `fetch` 與 `env`，測試用假的 Supabase 與 OpenAI 回應。
- 涵蓋：非 POST → 405、沒有或無效的 token → 401、額度用完 → 402 且未呼叫 OpenAI、輸入過大 → 400、缺少 key → 503、成功 → 記帳且回傳餘額、OpenAI 失敗 → 也記帳且不洩漏原始錯誤、使用者送來的 model 被忽略。
- 後續核准修正包含：`store: false`、8,000 token 輸出上限、60 秒逾時，以及記帳失敗仍回傳 AI 結果且日誌不含 key 的測試。

### STEP 5：`/api/ai/transcribe`

- 同 STEP 4，另外涵蓋：音檔超過 4 MB → 400；prompt 超過 2,000 字元 → 400；每分鐘單價設定無效 → 503 且未呼叫 OpenAI；duration／tokens 兩種 usage 的計費與記帳；缺少 usage 或 tokens 單價 → 記錄失敗、回 502，不回傳轉錄結果。

### STEP 6：前端改用系統 AI

- 依上方「前端」規格修改 `public/app.js`、`public/index.html` 與語系檔。
- 能抽成純函式的邏輯（例如選擇 provider、解讀 API 錯誤）先寫測試。
- 後續核准補充：新增並測試 `GET /api/ai/balance`，登入與開啟費用視窗時先更新伺服器額度。

### STEP 7：管理員後台

- 依上方「管理員後台」規格實作，先寫 `usage-stats.js` 的測試。

### STEP 8：文件

- README：新增「系統 AI 與額度」與「管理員後台」章節，說明需要設定的 Vercel 環境變數、如何執行 migration、如何把 email 加入 `app_admins`。
- CHANGELOG：新增版本紀錄。
- 此步只修改文件，不修改程式；以文件對照實作、既有 `npm test` 全部通過及差異僅含文件作為驗收。

## 上線前由網站擁有者手動完成（不屬於 Codex 的工作）

1. 在 Supabase SQL Editor 執行 migration。
2. 執行 `insert into public.app_admins (email) values ('<管理員 email>');`。
3. 確認語音每分鐘單價（預設 `0.0045`）；若模型回傳 tokens usage，另外設定兩個 token 單價環境變數。
4. 在 preview 網址測試後再合併。

## 已知限制（接受）

- 同一位使用者同時送出多個請求，可能略微超過額度。
- 每個 Google 帳號各有額度。
- 管理員名單變更需在 Supabase 執行 SQL。
