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
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | 預設取 `public/supabase-config.js` 的值 | 用預設值 |

`VERCEL_ENV` 不是 `preview` 或 `production`（例如本機的 `development`）時，使用 `CHATGPT_PREVIEW_KEY`。

**不得使用 Supabase service role 或 secret key。**

所有數字環境變數都必須是有限且非負的數值，無效設定回 503。語音服務有每分鐘單價即可使用：
`usage.type` 為 `duration` 或含有 `usage.seconds` 時，以 `seconds / 60 * AI_TRANSCRIBE_USD_PER_MINUTE` 計費；
否則必須有完整的 input/output token usage 與兩個 token 單價。沒有 usage、秒數／token 不合法，或缺少 token 單價時，
一律記錄失敗並回 502，不得當成免費成功結果回傳。

### API 端點

兩個端點都要求 `Authorization: Bearer <使用者的 Supabase access token>`。

1. `POST /api/ai/respond`：body `{ instructions: string, input: string, kind: string }`，回傳 `{ text, usage, cost, balance }`。
2. `POST /api/ai/transcribe`：multipart，欄位 `file`、`prompt`、`kind`，回傳 `{ text, usage, cost, balance }`。

每個請求的處理順序：

1. 只接受 `POST`。
2. 用 `GET {SUPABASE_URL}/auth/v1/user`（帶 `apikey` 與使用者的 token）驗證身分。失敗回 401。
3. 呼叫 `get_my_ai_balance()` 取得已用金額與額度。已用金額 ≥ 額度時回 402，body `{ error: 'credit_exhausted' }`，**不呼叫 OpenAI**。
4. 驗證輸入：`instructions` + `input` 合計上限 60,000 字元；音檔上限 4 MB（Vercel 請求上限 4.5 MB）；`kind` 只能是 `agent`、`analysis`、`questions`、`transcription`、`polish`。不合格回 400。
5. 呼叫 OpenAI。模型由伺服器決定，**忽略**使用者送來的任何 model 欄位。
6. 依單價計算費用，呼叫 `record_ai_usage(...)` 記帳，成功或失敗的呼叫都要記。
7. 回傳結果與最新餘額。錯誤訊息不得包含 API key 或 OpenAI 的原始錯誤 body。

### 資料庫（檔案：`supabase/migrations/0001_ai_usage.sql`）

- `public.ai_usage`：`id uuid pk default gen_random_uuid()`、`user_id uuid not null references auth.users on delete cascade default auth.uid()`、`created_at timestamptz default now()`，以及沿用前端 `recordApiUsage` 的欄位：`provider`、`model`、`kind`、`status`、`error`（上限 500 字元）、`input_tokens`、`output_tokens`、`input_rate`、`output_rate`、`estimated_cost`（`check >= 0`）、`duration_ms`，另加 `audio_seconds numeric not null default 0`（有限且非負）。Duration 計費時將秒數寫入 `audio_seconds`，tokens 與 rates 記 0；tokens 計費時 `audio_seconds` 記 0。
- `public.app_admins`：`email text primary key`。
- 兩張表都 `enable row level security`。`ai_usage` 只有「select 自己的資料」一條 policy；`app_admins` **沒有任何 policy**。兩張表都 `revoke insert, update, delete` from `anon`、`authenticated`。
- 函式一律 `security definer`、`set search_path = ''`，內文使用完整名稱（`public.ai_usage`）：
  - `record_ai_usage(..., p_audio_seconds numeric default 0)`：寫入一筆，`user_id` 固定為 `auth.uid()`。`auth.uid()` 為 null 時拋錯。金額、token 數不得為負，秒數須有限且非負，文字欄位限制長度。只能新增，不能修改或刪除。
  - `get_my_ai_balance()`：只回傳 `spent numeric`，也就是呼叫者本人所有紀錄的 `estimated_cost` 總和。額度比較由伺服器用 `AI_USER_CREDIT_USD` 進行。
  - `admin_list_ai_usage(p_since timestamptz default null)`：以 `auth.uid()` 到 `auth.users` 查出呼叫者的 `email`，且 `email_confirmed_at is not null`，再比對 `app_admins`（比對時不分大小寫）。**不要**信任 JWT 裡的 email 欄位。不符合時拋錯。通過後回傳所有紀錄（含 `audio_seconds`），並附上使用者 email。
- `revoke execute ... from public, anon`，只 `grant execute` 給 `authenticated`。
- 在 `supabase.sql` 末尾註明需另外執行 migration，或把 migration 內容合併進去，二選一並在 README 說明。

### 前端

- 新增 provider `system`（顯示名稱「系統 AI」）。登入時預設使用 `system`；未登入時使用 `builtin`。
- 新增常數 `ENABLE_BYOK = false`。為 `false` 時，隱藏設定中 provider、endpoint、API key、模型、價格、測試連線等自備金鑰欄位。localStorage 中舊的自備金鑰專案保留不刪，但不能被選為使用中。
- `callAgent` 與兩個轉錄函式遇到 `system` 時改呼叫上述 API，token 取自 Supabase session。不得在前端出現 OpenAI key。
- 收到 402 時，顯示「AI 額度已用完，請聯絡管理員」，並改用內建教練完成這次回饋。
- 收到 401 時，提示重新登入。
- 在 API 使用紀錄畫面顯示「已用 $x / 額度 $y」。前端本機的使用紀錄維持現狀，伺服器紀錄才是額度的依據。
- 所有新增的畫面文字必須加入四個語系檔（`public/locales/*.json`），`node scripts/check-i18n.mjs` 必須通過。

### 管理員後台

- 新頁面 `public/admin.html`，使用同一個 Supabase client 登入，透過 `client.rpc('admin_list_ai_usage')` 取資料，**不經過 Vercel Function**。
- 畫面與統計沿用現有的 API 使用紀錄介面（期間、用途篩選、總計、明細），再加上「使用者」欄位與篩選，以及每位使用者的已用金額。
- 抽出共用的統計函式（例如 `public/usage-stats.js`，UMD 寫法同 `speech-utils.js`），前台與後台共用，並有單元測試。
- 所有來自資料庫的文字一律用 `textContent` 或完整的 HTML 跳脫（包含 `"` 與 `'`）輸出，不得直接塞進 `innerHTML`。
- 非管理員開啟時只顯示「沒有權限」。

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

### STEP 5：`/api/ai/transcribe`

- 同 STEP 4，另外涵蓋：音檔超過 4 MB → 400；prompt 超過 2,000 字元 → 400；每分鐘單價設定無效 → 503 且未呼叫 OpenAI；duration／tokens 兩種 usage 的計費與記帳；缺少 usage 或 tokens 單價 → 記錄失敗、回 502，不回傳轉錄結果。

### STEP 6：前端改用系統 AI

- 依上方「前端」規格修改 `public/app.js`、`public/index.html` 與語系檔。
- 能抽成純函式的邏輯（例如選擇 provider、解讀 API 錯誤）先寫測試。

### STEP 7：管理員後台

- 依上方「管理員後台」規格實作，先寫 `usage-stats.js` 的測試。

### STEP 8：文件

- README：新增「系統 AI 與額度」與「管理員後台」章節，說明需要設定的 Vercel 環境變數、如何執行 migration、如何把 email 加入 `app_admins`。
- CHANGELOG：新增版本紀錄。

## 上線前由網站擁有者手動完成（不屬於 Codex 的工作）

1. 在 Supabase SQL Editor 執行 migration。
2. 執行 `insert into public.app_admins (email) values ('<管理員 email>');`。
3. 確認語音每分鐘單價（預設 `0.0045`）；若模型回傳 tokens usage，另外設定兩個 token 單價環境變數。
4. 在 preview 網址測試後再合併。

## 已知限制（接受）

- 同一位使用者同時送出多個請求，可能略微超過額度。
- 每個 Google 帳號各有額度。
- 管理員名單變更需在 Supabase 執行 SQL。
