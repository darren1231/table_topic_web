# 實作計畫：打卡、連續天數與代幣

- 日期：2026-11-12
- 決策：[ADR 0002](../adr/0002-signed-usage-records-and-token-ledger.md)
- 名詞：[GLOSSARY.md](../../GLOSSARY.md)「打卡與代幣」
- 分工：Claude 規劃與 review，Codex 實作
- 費用影響：兌換會增加 OpenAI 支出（估計 100 位每天練習的使用者每月約多 3 美元）。由網站擁有者負擔；若改由區或分會經費支應，需經正式會議通過（**未拍板**）。

## 規則（已由網站擁有者確定）

| 項目 | 規則 |
| --- | --- |
| 誰能參加 | 登入 Google 的使用者 |
| 一天 | `Asia/Taipei` 的日期 |
| 打卡 | 當天有一次成功的 AI 分析回饋（`ai_usage.kind = 'analysis'` 且 `status = 'success'`，且紀錄有有效的伺服器簽章）。由資料庫在寫入該筆紀錄時自動打卡，一天最多一次 |
| 每日獎勵 | 連續第 1、2、3、4、5 天：10、20、30、50、80 枚；第 6 天起每天 100 枚 |
| 漏簽 | 每漏一天扣 50 枚，扣到 0 為止（不會變負數）。漏簽後下一次打卡從連續第 1 天開始 |
| 補簽 | 只能補「昨天」，花 200 枚，餘額不足不能補。補簽那天沒有獎勵、不扣漏簽的 50 枚，連續天數接回 |
| 兌換 | 每 1000 枚換 0.01 美元的 AI 額度，以 1000 枚為單位。比例由環境變數設定 |
| 開始計算 | 上線當天。之前的練習不補發 |

### 規則的邊界情況

- **漏簽什麼時候扣**：在下一次寫入帳本時（打卡、補簽、兌換）一次補算。畫面顯示的餘額與狀態，要包含「尚未寫入但已確定」的扣點，讓使用者看到正確數字。
- **從未打卡過的使用者**：沒有「漏簽」。第一次打卡之前的日子不扣。
- **補簽與今天的打卡先後**：
  - 先補簽昨天、再打卡：今天的獎勵依接回後的連續天數計算。
  - 今天已經打卡（以連續第 1 天獲得 10 枚）後才補簽昨天：允許。帳本新增三筆：補簽 −200、退回昨天的漏簽扣點（若已扣）、今天獎勵差額（例如連續第 8 天應得 100，已得 10，補 90）。
- **扣點的 0 下限**：每一筆漏簽的扣點 = −min(50, 扣點前的餘額)。退回時退回當時實際扣掉的數字。
- **補簽昨天的前提**：昨天沒有打卡、也沒有補簽。即使前天以前也斷了，仍可以補昨天，連續天數會變成「從昨天開始」。

## 資料庫（新 migration：`supabase/migrations/0003_signed_usage_and_tokens.sql`）

### 簽章

- `create extension if not exists pgcrypto with schema extensions`（Supabase 預設在 `extensions` schema）。函式內使用完整名稱，例如 `extensions.hmac(...)`。
- `create schema if not exists private`，`revoke all on schema private from public, anon, authenticated`。
- `private.signing_keys (name text primary key, secret text not null)`，啟用 RLS、沒有 policy、`revoke all`。
- 網站擁有者在 SQL Editor 手動插入：`insert into private.signing_keys (name, secret) values ('usage', '<與 Vercel 相同的密碼>');`。migration 本身**不得**包含任何密碼。
- `ai_usage` 新增 `nonce uuid unique`、`issued_at timestamptz`。
- `record_ai_usage` 改為需要 `p_issued_at timestamptz`、`p_nonce uuid`、`p_signature text`：
  - 簽章內容是以 `|` 連接的固定欄位順序字串：`user_id|kind|status|model|input_tokens|output_tokens|estimated_cost|audio_seconds|issued_at|nonce`。數字與時間的字串格式必須在伺服器（JavaScript）與資料庫（SQL）兩端完全一致，請在計畫實作時定義並寫測試鎖定。
  - 簽章為 hex 編碼的 HMAC-SHA256。
  - 驗證失敗、`issued_at` 與資料庫時間差超過 5 分鐘、nonce 重複時拋錯（錯誤碼 `42501` 或 `22023`，請區分並寫在文件）。
  - 舊的、不含簽章的 `record_ai_usage` 簽名必須 `drop`，不能留下可繞過的版本。
- 找不到密碼時，所有記帳都失敗（fail closed）。

#### S1 簽章格式與錯誤碼

- 內容以 UTF-8 編碼，不加換行；固定順序為 `user_id|kind|status|model|input_tokens|output_tokens|estimated_cost|audio_seconds|issued_at|nonce`。
- UUID 一律小寫；kind、status、model 使用原文字，model 不得包含分隔符號 `|`。token 數為非負整數；金額與秒數為非負、有限十進位字串，不使用指數、不保留多餘的小數尾零，零一律為 `0`。JavaScript 以 JSON 會傳出的數值表示展開指數，SQL 使用 `trim_scale(numeric)::text`，不另行四捨五入。
- 時間固定為 UTC 的 `YYYY-MM-DDTHH:mm:ss.SSSZ`，恰有三位毫秒，例如 `2026-11-12T04:05:06.007Z`。HMAC-SHA256 結果為 64 個小寫 hex 字元。密碼至少 32 個字元且不可全為空白，以原始 UTF-8 字節使用，不自動 trim。
- 範例內容：`00000000-0000-0000-0000-000000000001|analysis|success|fake-model|100|50|0.0000001|60.5|2026-11-12T04:05:06.007Z|aaaaaaaa-0000-0000-0000-000000000001`（僅為測試資料）。
- SQL `42501`：未登入、簽章缺漏／格式錯誤／不符、資料庫密碼缺漏或不合法，以及沒有函式或私密資料存取權限。
- SQL `22023`：不合法的記帳欄位或簽章 metadata、簽發時間與資料庫 `now()` 相差超過 5 分鐘（過去與未來皆檢查）、nonce 已使用。剛好相差 5 分鐘仍接受；nonce 的唯一限制同時處理並行重送。
- 舊的不含簽章函式已移除，呼叫舊簽名得到 PostgreSQL `42883`（PostgREST 對不存在的 RPC 簽名可能回自己的找不到函式錯誤）。
- 伺服器缺少／不合法的密碼：三個 `/api/ai/*` 端點皆回 HTTP `503`、`configuration_error`，且不呼叫外部服務；既有方法與 Bearer 格式檢查仍先執行。記帳失敗仍沿用既有行為：保留已產生的 AI 結果、balance 回 null，只記錄清理後的錯誤。
- 使用者 ID 在同一枚 JWT 通過 `get_my_ai_balance` 的 PostgREST 驗證後，才從其 `sub` 取出；JWT 解碼本身不視為驗證，不增加 `/auth/v1/user` 呼叫。資料庫仍以 `auth.uid()` 重建簽章內容，不接受呼叫者指定 user_id。
- PGlite 測試透過共用 helper 以 `new PGlite({ extensions: { pgcrypto } })` 建立，再在 SQL 中安裝真正的 pgcrypto；不以假的 HMAC 函式替代。

### 代幣帳本

- `public.token_ledger`：`id uuid pk`、`user_id uuid not null references auth.users on delete cascade`、`created_at timestamptz default now()`、`day date not null`（這筆紀錄所屬的台灣日期）、`kind text`、`amount integer not null`、`streak integer`（打卡時的連續天數）、`detail jsonb`（例如兌換的額度與比例、對應的 ai_usage id）。
- `kind` 限定：`check_in`、`miss_penalty`、`makeup`、`penalty_refund`、`check_in_adjust`、`exchange`。
- 唯一性：同一使用者同一天的 `check_in`、`makeup`、`miss_penalty`、`penalty_refund` 各最多一筆。
- RLS：使用者只能 `select` 自己的資料；`revoke insert, update, delete` from `anon`、`authenticated`。
- 所有寫入只能經由 `security definer` 函式。

### 函式

- `record_ai_usage(...)`：驗證簽章並寫入 `ai_usage` 後，若為成功的 `analysis`，在同一個交易中執行打卡（先補算漏簽，再新增 `check_in`）。回傳值加入打卡結果：是否本次打卡、獎勵、連續天數、新餘額。
- `get_my_token_status()`：回傳餘額（含尚未寫入的漏簽扣點）、連續天數、今天是否已打卡、昨天是否可以補簽、補簽費用、今天打卡可得的獎勵。只讀，不寫入。
- `makeup_yesterday()`：依規則補簽昨天。餘額不足或不符合條件時拋出可辨識的錯誤。由使用者本人呼叫即可（只會讓自己花代幣，不需要簽章）。
- `exchange_tokens(p_units integer, p_rate_usd numeric, p_issued_at, p_nonce, p_signature)`：必須有伺服器簽章（因為比例來自伺服器設定）。扣 `p_units × 1000` 枚，`detail` 記錄換到的額度。
- `get_my_ai_balance()`：除了 `spent`，再回傳 `bonus_credit`（所有兌換的額度總和）。伺服器的額度 = `AI_USER_CREDIT_USD + bonus_credit`。
- `admin_list_tokens()`：管理員查看每位使用者的 email、餘額、連續天數、最後打卡日。權限檢查與 `admin_list_ai_usage` 相同。
- 所有函式：`security definer`、`set search_path = ''`、`revoke execute from public, anon`、只 `grant` 給 `authenticated`。
- **時間**：函式以 `now()` 計算台灣日期，使用者無法影響。測試需要控制日期時，在 PGlite 測試中用其他方式模擬（例如在測試資料庫中替換一個只在測試存在的時間函式），**不得**在正式 migration 中留下可由使用者設定的時間覆寫。

## 伺服器（Vercel Functions）

- 新環境變數：
  - `USAGE_SIGNING_SECRET`：必填，至少 32 個字元。缺少時所有 AI 端點回 503。
  - `TOKEN_EXCHANGE_USD_PER_1000`：選填，預設 `0.01`。
- `api/_lib/signing.js`：產生簽章內容字串與 HMAC。
- `respond`、`transcribe` 記帳時一律附簽章；`respond` 的回應加入打卡結果（`checkIn: { checkedIn, reward, streak, balance }`）。
- 新端點：
  - `GET /api/tokens/status`：代為呼叫 `get_my_token_status`。
  - `POST /api/tokens/makeup`：代為呼叫 `makeup_yesterday`。
  - `POST /api/tokens/exchange`：body `{ units }`，伺服器以環境變數比例簽章後呼叫 `exchange_tokens`。
- 沿用既有的驗證、錯誤處理與 `Server-Timing` 寫法。

## 前端

- 頁首顯示代幣餘額與連續天數（例如 🪙 1,240　🔥 8 天）。未登入時顯示「登入即可開始累積代幣」。
- AI 分析完成且本次打卡時，顯示提示，例如「連續 6 天！獲得 100 枚」。
- 代幣面板（點頁首數字打開）：
  - 目前餘額、連續天數、今天是否已打卡、明天打卡可得多少。
  - 「補簽昨天（200 枚）」按鈕：只有可以補簽時才顯示，按下前確認。
  - 「兌換 AI 額度」：顯示可兌換的單位數與換到的金額，按下前確認。
  - 規則說明。
- 「API 費用」畫面的「已用 / 額度」包含兌換來的額度。
- 管理員後台新增代幣表格（email、餘額、連續天數、最後打卡日）。
- 所有新文字使用 `t(key)`，加入四個語系檔；輸出使用 `textContent` 或 `escapeHtml`。
- 使用說明書新增一節「打卡與代幣」，並在常見問題加入「額度用完時怎麼打卡？」→「用代幣兌換額度後，再用 AI 回饋練習」。

## 步驟

一次做一步，每步一個 commit，每步完成後 `npm test` 與 `npm run e2e` 都要通過，回報「S? DONE」後停下來等 review。遇到計畫沒寫到的設計決定，停下來回報。

### S1：伺服器簽章

- migration 的簽章部分與 `record_ai_usage` 的新版本；`api/_lib/signing.js`；`respond`、`transcribe` 改為簽章記帳。
- 測試：
  - PGlite 載入 `pgcrypto`。
  - 正確簽章可以寫入；錯誤簽章、過期、未來時間、nonce 重複、缺少密碼都失敗。
  - 舊的不含簽章版本已不存在。
  - JavaScript 與 SQL 對同一筆資料產生的簽章內容字串與 HMAC 完全一致。

### S2：代幣帳本與自動打卡

- `token_ledger`、打卡、漏簽補算、`get_my_token_status`。
- S2 回傳格式：`record_ai_usage` 回傳 JSON `{ id, checkIn: { checkedIn, reward, streak, balance } }`；`checkedIn` 表示「這一次是否新增打卡」，非成功 analysis 或同日重複分析時為 false，reward 為 0。respond 只轉送這四個打卡欄位，不自行計算代幣；記帳失敗時 checkIn 與 AI balance 均為 null，保留既有的 AI 結果與清理後的錯誤紀錄。
- `get_my_token_status()` 回傳 JSON `{ balance, streak, checkedIn, canMakeup, makeupCost, reward }`。這裡 checkedIn 表示今天是否已打卡；reward 是今天尚可獲得的獎勵（已打卡則為 0）；canMakeup 同時檢查昨天沒有打卡／補簽，且退回昨天實際扣點後的有效餘額至少 200 枚（包含尚未寫入的昨天扣點）。最後打卡是昨天時保留連續天數，早於昨天則顯示 0。
- 查詢餘額會先扣除尚未寫入的漏簽扣點，不寫入帳本；成功 analysis 寫帳時才按日期由早至晚補記每一筆扣點，包含扣到 0 後的零金額紀錄。重複查詢與重複分析都不會重扣。
- 同一使用者的帳本寫入以交易層 `pg_advisory_xact_lock(hashtextextended(user_id::text, 0))` 序列化，不對 Supabase 管理的 auth.users 取得列鎖；使用紀錄、漏簽與打卡都在同一個交易中提交或回滾。
- 正式日期函式 `private.token_today()` 固定讀取 `(now() at time zone 'Asia/Taipei')::date`，不讀取可由使用者設定的時鐘。測試僅由測試資料庫擁有者替換此函式，簽章時間窗仍使用真正的資料庫 now()。
- 測試（用可控制的日期）：
  - 連續 1–7 天的獎勵依序為 10、20、30、50、80、100、100。
  - 同一天第二次分析不會再打卡；`questions`、`transcription`、`polish` 不會打卡；失敗的分析不會打卡。
  - 漏 1 天扣 50；漏 3 天扣 150；餘額 70 時漏 3 天只扣到 0（−50、−20、0）；漏簽後打卡從第 1 天開始。
  - 從未打卡過的使用者沒有漏簽扣點。
  - `get_my_token_status` 顯示的餘額包含尚未寫入的扣點，且不寫入任何資料。
  - 使用者無法直接新增、修改、刪除帳本，也讀不到別人的帳本。

### S3：補簽與兌換

- `makeup_yesterday`、`exchange_tokens`、`get_my_ai_balance` 的 `bonus_credit`、三個 `/api/tokens/*` 端點、伺服器額度加上兌換額度。
- 補簽先補算漏簽，判斷「餘額 + 昨天實際扣點退款」是否至少 200；不符合時整筆交易回滾。補簽不給獎勵；若昨天有 miss_penalty（包含 0），新增等額 penalty_refund。若今天已打卡，新增 check_in_adjust 記錄接回後應得獎勵與已得獎勵的差額，原紀錄一律保留。補簽回傳與 get_my_token_status 相同的 JSON。
- 兌換簽章內容固定為 `exchange|user_id|units|rate_usd|issued_at|nonce`，以 UTF-8、不加換行，沿用 S1 的 UUID、數字、UTC 毫秒及 64 字元小寫 hex HMAC-SHA256 格式。`exchange` 前綴區隔使用紀錄與兌換的簽章用途。範例：`exchange|00000000-0000-0000-0000-000000000001|2|0.01|2026-11-12T04:05:06.007Z|aaaaaaaa-0000-0000-0000-000000000001`（僅測試資料）。
- units 是 1–2147483 的整數，以確保 units × 1000 可放進帳本 integer 金額。兌換比例為有限非負數，TOKEN_EXCHANGE_USD_PER_1000 預設 0.01；客戶端提供的比例、user_id 與簽章均不採用。SQL 驗證 auth.uid()、密碼、簽章及前後五分鐘時間窗後，才取得相同的交易層 advisory lock、補算漏簽並扣點。
- 兌換事件 detail 保存 `{ units, rate_usd, credit_usd, nonce, issued_at }`；exchange 的 nonce 以獨立唯一索引防止跨使用者重送，與 ai_usage 的 nonce 分屬不同簽章用途。SQL 回傳 `{ units, tokensSpent, creditAdded, rateUsd, status }`，status 為更新後的代幣狀態；HTTP 僅回傳這些公開欄位。
- GET /api/tokens/status 直接呼叫 get_my_token_status（1 次 RPC）；POST /api/tokens/makeup 直接呼叫無參數的 makeup_yesterday（1 次 RPC，不接受補簽日期）；POST /api/tokens/exchange 先用 get_my_token_status 驗證同一枚 JWT，再讀 sub、驗證 `{ units }` 並簽章呼叫 exchange_tokens（共 2 次 RPC）。端點不需要 OpenAI key，也不呼叫 OpenAI。
- HTTP 錯誤：驗證失敗 401 unauthorized；非法 units／JSON 或一般 SQL 22023 為 400 invalid_input；SQL 22023 的白名單訊息 insufficient_tokens、makeup_unavailable 回 400 同名 error；設定錯誤為 503 configuration_error，其餘 RPC／回應格式錯誤為 503 tokens_unavailable。不轉送其他 SQL 訊息或原始錯誤內容。Server-Timing 分別為 status／makeup／status+exchange，並皆有 total。
- get_my_ai_balance 現在回傳 spent、bonus_credit 兩個 numeric 欄位，bonus_credit 只加總本人的 exchange.detail.credit_usd。三個 AI 端點都驗證這兩個值，額度使用 AI_USER_CREDIT_USD + bonus_credit；respond／transcribe 記帳後保留同一份加總額度。缺少 bonus_credit 或數值不合法時拒絕，不默認為零。
- 測試：
  - 先補簽再打卡：連續天數接回，今天獎勵正確。
  - 先打卡再補簽：新增補簽、退回漏簽、獎勵差額三筆，結果與「先補簽再打卡」相同。
  - 餘額不足 200 不能補簽；昨天已打卡不能補簽；只能補昨天。
  - 兌換：餘額不足不能兌換；以 1000 為單位；額度正確增加；簽章錯誤不能兌換；比例取自環境變數並記在 `detail`。

### S4：前端與使用說明書

- 頁首、提示、代幣面板、費用畫面、四語、使用說明書新段落。
- e2e（以 fixture 模擬 `/api/tokens/*` 與 `respond` 的打卡結果）：分析後顯示打卡提示；面板顯示正確數字；補簽與兌換的確認流程；未登入時的提示；四種語言沒有顯示 key。

### S5：管理員後台與文件

- 後台代幣表格與 e2e。
- README：新環境變數、`0003` migration、在 `private.signing_keys` 插入密碼的步驟、密碼必須與 Vercel 一致、部署順序。
- CHANGELOG「尚未發布」：使用者變更、技術變更、升級注意事項。
- `docs/versioning.md` 不需修改。

## 上線步驟（網站擁有者，寫進 README 與 CHANGELOG）

1. 產生一組隨機密碼（至少 32 個字元）。
2. 在 Vercel 的 Preview 與 Production 設定 `USAGE_SIGNING_SECRET`（可以兩個環境用不同密碼，但資料庫只能存一組；若 Preview 與 Production 共用同一個 Supabase 專案，兩邊必須用同一組）。
3. 合併 PR 後，在 Supabase SQL Editor 執行 `0003` migration，再插入同一組密碼。
4. 確認 Vercel 已部署新版本。
