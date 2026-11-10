# Table Topic Practice

一個支援中文與英文的表達能力練習網站，可在「問題練習」與「自由講稿」之間切換。

## 主要功能

- 依照主題由 AI 產生即興題目
- 自由講稿錄音或文字輸入
- 瀏覽器即時語音辨識或 API Audio-to-Text
- AI 表達回饋、逐句改善及英文文法解說
- 練習日曆、連續打卡與複習資料庫
- Google 登入後即可使用系統 AI，不需要自備金鑰
- 完整資料匯出與匯入
- 可選擇純本機模式，或使用 Google 登入與 Supabase 跨裝置同步

## 本機執行

網站的靜態前端放在 `public/`，系統 AI 與額度端點放在 `api/`，需要 Vercel Functions 執行。由於語系 JSON 透過 `fetch` 載入，靜態預覽請以 `public/` 為根目錄啟動本機伺服器（不要用 `file://` 直接開啟）：

```powershell
python -m http.server 8000 --directory public
```

然後開啟 <http://localhost:8000>。

`python http.server` 只能測前端，不能執行 `/api/ai/respond`、`/api/ai/transcribe` 或 `/api/ai/balance`。需要測試完整系統 AI 流程時，請使用具備 Vercel Functions 的部署，或在安裝並設定 Vercel CLI 後使用 `vercel dev`；本機 `development` 環境使用 `CHATGPT_PREVIEW_KEY`。

開發與自動化測試需要 Node.js 20 以上版本。在儲存庫根目錄安裝依賴並執行測試：

```bash
npm install
npm test
npm run coverage
```

`npm test` 先執行語系檢查，再以 `node:test` 執行 `test/` 下的所有測試（包含教練與語音工具測試）。測試以假的 fetch 與本機記憶體中的 PGlite 資料庫驗證功能，不需要正式金鑰，也不會呼叫真實 OpenAI 或 Supabase API。

`npm run coverage` 使用 Node.js 內建的 `--experimental-test-coverage`，輸出行、分支與函式涵蓋率。測試 helper 在透過 `vm.runInContext` 載入 `public/app.js` 時指定實際檔名，因此也能將它納入報告；未指定檔名的匿名 VM 程式碼不會列為該檔案的涵蓋率。報告只反映測試載入的程式，不能視為整個網站的完整涵蓋率。

PR 會由 GitHub Actions 自動執行 `npm test`，再執行 coverage 並將涵蓋率摘要寫入工作流程摘要；不設涵蓋率門檻，coverage 步驟失敗不會讓 CI 失敗。

## 新增或修改語言

所有可翻譯的靜態介面文字、placeholder、內建主題與題目模板都集中在 `public/locales/`。`zh-TW.json` 是預設及 fallback 語系；每個語系檔案使用相同的 message key，因此新增語言時不需要修改畫面中的判斷邏輯。

1. 複製 `public/locales/zh-TW.json`，以 BCP 47 language tag 命名（例如 `fr-FR.json`）。
2. 保留所有 JSON key 與題目模板中的 `{topic}`，只翻譯 value。
3. 在 `public/i18n.js` 的 `supportedLocales` 與 `public/index.html` 的語言選單加入新語系。
4. 在 `public/app.js` 的 `CONFIG.languages` 加入語系；topics 會直接由 JSON catalog 取得。
5. 執行語系完整性檢查：

   ```bash
   node scripts/check-i18n.mjs
   ```

尚未翻譯的 message 可以暫時省略，介面會安全地回退至繁體中文；正式發布前建議補齊全部 key。

## 部署

專案包含 `vercel.json`，設定靜態輸出目錄 `outputDirectory` 為 `public`。`api/ai/` 下的入口由 Vercel Functions 提供 `/api/ai/*` 端點；`docs/`、`scripts/`、`supabase.sql` 等開發用檔案不會作為靜態網站內容發布。

新增公開靜態檔案時放進 `public/`，伺服器端函式則放在 `api/`。

## 資料與 API Key

練習資料保存在瀏覽器 `localStorage`，並可選擇雲端同步。系統 AI 的 OpenAI key 只設定在伺服器環境變數，不會交給前端。舊的自備金鑰專案仍保留在裝置上，但目前不能啟用；不要把任何私人金鑰提交到 GitHub。

## 系統 AI 與額度

使用者必須先登入 Google，才能使用系統 AI 產生題目、分析回饋與語音轉文字；訪客仍可使用內建教練。登入資格與雲端同步模式分開判斷，登入後即使選擇本機模式，也能使用系統 AI。

每位使用者的額度預設為 **1 美元，累計使用、不會重置**。額度用完時會顯示「AI 額度已用完，請聯絡管理員」，回饋改由內建教練完成。瀏覽器語音辨識仍可使用；系統 AI 轉錄音檔上限為 4 MB（4 × 1024 × 1024 bytes），超過時請改用瀏覽器語音辨識。

登入後、開啟 API 費用視窗時，以及系統 AI 呼叫完成後，都會更新「已用 / 額度」。數字以伺服器紀錄為準，清除本機費用紀錄不會重置額度。

目前 `public/app.js` 的 `ENABLE_BYOK = false`，因此自備金鑰的 provider、端點、金鑰、模型、價格及測試連線欄位均已隱藏；舊專案資料保留，但不能選為使用中的專案。

### Vercel 環境變數

由網站擁有者在 Vercel 對應的 Preview／Production 環境設定以下變數，不要把私人金鑰寫進前端或儲存庫。

| 名稱 | 必填／選填 | 預設值與用途 |
| --- | --- | --- |
| `CHATGPT_PREVIEW_KEY` | 必填 | 非 `production` 環境使用的 OpenAI key，包含 Preview 與本機 Development；無預設值。 |
| `CHATGPT_PRODUCTION_KEY` | 必填 | `VERCEL_ENV=production` 時使用的 OpenAI key；無預設值。 |
| `AI_MODEL` | 選填 | `gpt-5.6-luna`，文字回饋與出題模型。 |
| `AI_TRANSCRIBE_MODEL` | 選填 | `gpt-transcribe`，語音轉文字模型。 |
| `AI_INPUT_USD_PER_MTOK` | 選填 | `0.2`，文字模型每百萬輸入 token 的美元單價。 |
| `AI_OUTPUT_USD_PER_MTOK` | 選填 | `1.2`，文字模型每百萬輸出 token 的美元單價。 |
| `AI_TRANSCRIBE_USD_PER_MINUTE` | 選填 | `0.0045`，語音 duration usage 的每分鐘美元單價。 |
| `AI_TRANSCRIBE_INPUT_USD_PER_MTOK` | 選填 | 無預設值；語音回傳 tokens usage 時，必須設定每百萬輸入 token 的美元單價。 |
| `AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK` | 選填 | 無預設值；語音回傳 tokens usage 時，必須設定每百萬輸出 token 的美元單價。 |
| `AI_USER_CREDIT_USD` | 選填 | `1`，每位使用者的累計美元額度。 |
| `SUPABASE_URL` | 選填 | 預設使用 `api/_lib/supabase-defaults.js` 的 `url`，與 `public/supabase-config.js` 一致。 |
| `SUPABASE_PUBLISHABLE_KEY` | 選填 | 預設使用 `api/_lib/supabase-defaults.js` 的 `anonKey`，與前端的公開 publishable key 一致。 |

在 Preview 與 Production 分別配置對應的 OpenAI key；目前環境的 key 缺少時，AI 請求回 503，不會借用另一個環境的 key。唯讀額度端點不需要 OpenAI key。

所有數字設定必須是有限且非負的數值；空白、負數、NaN 或 Infinity 都視為設定錯誤。語音每分鐘預設單價依 [OpenAI 官方價格頁](https://developers.openai.com/api/docs/pricing)於 2026-11-08 的資料設定，可透過環境變數覆寫。Duration usage 以秒數除以 60 再乘單價計費；tokens usage 則需要兩個 token 單價。缺少 usage、usage 不合法，或 tokens usage 缺少任一單價時，會記錄失敗並回 502，不回傳轉錄結果。

**不需要也不可以設定 Supabase service role 或 secret key。** 使用公開 publishable key 搭配使用者本人的登入憑證即可；管理員名單放在資料庫，不放在 Vercel 環境變數。

若改用其他 Supabase 專案，前端 `public/supabase-config.js` 與伺服器設定必須指向同一個專案；使用內建伺服器預設值時，需同步更新 `api/_lib/supabase-defaults.js`。測試會確認兩份公開設定一致。

## 管理員後台

部署後直接開啟 **`/admin`**，以 Google 登入。主網站不提供後台連結。後台使用獨立的 Supabase client 查詢資料，不需載入主網站的同步或練習程式。

### 建立資料表與管理員名單

1. 網站擁有者開啟 Supabase 專案的 **SQL Editor**，建立新查詢。
2. 初次設定先執行根目錄的 [`supabase.sql`](supabase.sql)，建立練習資料同步所需資料表。
3. 再將 [`supabase/migrations/0001_ai_usage.sql`](supabase/migrations/0001_ai_usage.sql) 的完整內容貼入新查詢並執行一次，建立 `ai_usage`、`app_admins` 及相關函式。部署網站不會自動執行這個 migration。
4. 在 SQL Editor 新增管理員。下列為假 email，請在自己的 SQL Editor 替換為管理員實際登入 Google 的 email：

   ```sql
   insert into public.app_admins (email) values ('admin@example.invalid');
   ```

5. 要移除管理員資格時，在 SQL Editor 執行：

   ```sql
   delete from public.app_admins
   where lower(email) = lower('admin@example.invalid');
   ```

已執行過 `0001` 的資料庫，需再於 SQL Editor 執行 [`supabase/migrations/0002_fix_admin_email_type.sql`](supabase/migrations/0002_fix_admin_email_type.sql)；此修正可安全重複執行。

管理員必須已登入，且登入帳號的 email 已驗證；名單比對不分大小寫。未登入時顯示「請先登入」，非管理員顯示「沒有權限」，其他查詢錯誤顯示「載入失敗」。管理員資格變更後，請重新整理後台。

### 可查看的內容

後台可依本月、最近 7 天、最近 30 天或全部期間，以及用途、使用者篩選。總計與明細包含呼叫次數、輸入／輸出 token、音訊秒數與費用；另有每位使用者的全部期間已用金額與最後使用時間。期間與用途篩選套用於總計及明細，不會將每人的累計已用金額改成單月金額。

**後台只能查看，不能修改**使用紀錄或額度，也沒有新增或刪除使用紀錄的按鈕。新增／移除管理員由網站擁有者在 SQL Editor 操作。

## 設定 Google 登入與 Supabase 同步

資料庫初次設定請先執行根目錄的 `supabase.sql`，再另外執行
[`supabase/migrations/0001_ai_usage.sql`](supabase/migrations/0001_ai_usage.sql) 一次。
後者建立 AI 使用紀錄、管理員名單及受權限保護的資料庫函式，不會自動執行，
也不需要 service role key。migration 由網站擁有者在 SQL Editor 手動執行。

以下設定需要同時操作 **Supabase Dashboard**、**Google Cloud Console** 與本專案。建議先用本機網址完成測試，再加入正式網址。

### 1. 建立 Supabase 專案

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)，選擇 **New project**。
2. 選擇 organization、輸入專案名稱與資料庫密碼，並選擇離主要使用者較近的 region。
3. 等待專案建立完成，記下網址列或 Project Settings 中的 **Project Ref**，例如 `abcdefghijklm`。
4. 此專案的 Google OAuth callback URL 會是：

   ```text
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```

   後續在 Google Cloud 設定 redirect URI 時，必須使用這個 Supabase callback，而不是網站首頁。

### 2. 建立資料表與存取規則

1. 在 Supabase 左側選擇 **SQL Editor**，按 **New query**。
2. 複製 [`supabase.sql`](supabase.sql) 的完整內容、貼上後按 **Run**。
3. 執行成功後到 **Table Editor**，確認已有 `public.user_data`，欄位包含 `user_id`、`payload`、`updated_at`。
4. 到 **Authentication > Policies**（或 Table Editor 的 policies 頁籤），確認 `user_data` 已啟用 RLS，且有 select、insert、update 三條 policy。

這些 policy 都以 `auth.uid() = user_id` 限制資料，因此登入者只能操作自己的資料列。請勿關閉 RLS，也不要另外建立允許 `anon` 讀取全部資料的 policy。

### 3. 在 Google Cloud 設定 OAuth

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)，建立或選擇一個 project。
2. 進入 **Google Auth Platform**。如果是第一次使用，先完成 Branding / OAuth consent screen：
   - 填入 App name、User support email 與 Developer contact information。
   - Audience 通常選 **External**；若只限同一 Google Workspace 組織才選 Internal。
   - 測試期間若 publishing status 是 Testing，請把實際要登入的 Google 帳號加入 **Test users**。
3. 進入 **Clients**（舊版介面可能位於 **APIs & Services > Credentials**），建立 **OAuth client ID**。
4. Application type 選 **Web application**。
5. 在 **Authorized JavaScript origins** 加入網站 origin，不要包含路徑或結尾 `/`：

   ```text
   http://localhost:8000
   https://你的正式網域.example
   ```

6. 在 **Authorized redirect URIs** 加入第 1 步取得的 Supabase callback URL：

   ```text
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```

7. 儲存後，複製 Google 提供的 **Client ID** 與 **Client secret**。Client secret 只填入 Supabase，不可放進本專案或提交到 Git。

### 4. 在 Supabase 開啟 Google Provider

1. 回到 Supabase，進入 **Authentication > Providers > Google**。
2. 開啟 **Enable Sign in with Google**。
3. 將上一節取得的 Google Client ID 與 Client secret 貼入對應欄位並儲存。
4. 若頁面有顯示 Callback URL，確認它與 Google Cloud 的 Authorized redirect URI 完全一致。

### 5. 設定允許返回的網站網址

在 Supabase 進入 **Authentication > URL Configuration**：

1. **Site URL**：正式環境填正式首頁，例如 `https://table-topic.example.com`。還沒部署時可暫填 `http://localhost:8000`。
2. **Redirect URLs**：把所有會測試或部署的網址加入 allow list，例如：

   ```text
   http://localhost:8000/**
   https://table-topic.example.com/**
   https://你的-vercel-preview-domain.vercel.app/**
   ```

3. 本專案登入時會以目前頁面的 `origin + pathname` 作為 `redirectTo`；該網址不在 allow list 時，Supabase 可能改回 Site URL，造成登入後回到錯誤頁面。

### 6. 將 Supabase 公開金鑰接到前端

1. 在 Supabase 的 **Project Settings > API**（新版介面可能顯示 **API Keys**）複製：
   - Project URL，例如 `https://<PROJECT_REF>.supabase.co`
   - 公開的 `anon` key；若專案只顯示新版 key，使用可公開於瀏覽器的 publishable key。
2. 編輯 [`public/supabase-config.js`](public/supabase-config.js)：

   ```js
   window.SUPABASE_CONFIG = {
     url: 'https://<PROJECT_REF>.supabase.co',
     anonKey: '你的公開 anon 或 publishable key'
   };
   ```

3. **絕對不可**在此填入 `service_role` 或 secret key。前端原始碼對所有訪客可見；真正的資料隔離由登入 JWT 與 RLS policy 負責。
4. 若這是公開 repository，建議在部署流程產生正式的 `supabase-config.js`，不要把正式 key 直接提交。Supabase 的 anon / publishable key 本來就是前端可公開的，但分開管理仍可避免誤放 secret key。

### 7. 本機測試前端與同步

以下使用靜態伺服器驗證前端與 Google／Supabase 同步；系統 AI 的 `/api` 流程需要 Vercel Functions，請另依「本機執行」段落的說明測試。

1. 以 `public/` 為根目錄啟動網站；不要直接使用 `file://` 開啟：

   ```bash
   python -m http.server 8000 --directory public
   ```

2. 開啟 <http://localhost:8000>，按右上角 **本機資料 / 資料模式**。
3. 確認預設是「僅限這台裝置」，且畫面顯示目前未上傳資料。
4. 按 **使用 Google 登入**，完成 Google 授權後應回到網站，右上角顯示帳號名稱或 email。
5. 新增一筆練習或講稿，等待狀態顯示「已同步」。
6. 回到 Supabase **Table Editor > user_data**，應看到一筆以登入者 UUID 為 `user_id` 的資料。
7. 用無痕視窗或另一台裝置登入同一 Google 帳號，應自動載入同一份資料。
8. 再用另一個 Google 帳號登入，確認看不到第一個帳號的資料，以驗證 RLS。
9. 切換成 **使用本機模式** 後新增資料，確認它只留在目前瀏覽器且不再更新 Supabase。

### 8. 正式部署檢查清單

- Google Cloud 的 Authorized JavaScript origins 已加入正式 origin。
- Supabase URL Configuration 已加入正式網址與必要的 preview URLs。
- Supabase Google provider 已啟用，Google Client ID / secret 沒有填反。
- `supabase-config.js` 使用公開 anon / publishable key，而非 `service_role` / secret key。
- `user_data` 的 RLS 仍為啟用狀態。
- 若 Google 應用仍為 Testing，實際登入帳號已列在 Test users；要提供給所有人使用時，依 Google 要求完成 publishing / verification。

### 同步範圍與行為

登入後，練習紀錄、講稿、複習卡等 `tableTopicsPractice.v1` 資料會同步到該使用者自己的資料列。AI API Key 與語言等裝置偏好刻意保留在本機，不會上傳。

- 該帳號雲端已有資料時，登入後會以雲端資料載入目前裝置。
- 該帳號尚無雲端資料時，會把目前裝置資料作為第一份雲端資料。
- 使用者可隨時切回「僅限這台裝置」，停止後續同步；這不會刪除先前的雲端資料。

### 常見問題

| 狀況 | 優先檢查 |
| --- | --- |
| 畫面顯示「尚未設定 Supabase」 | `supabase-config.js` 的 URL 與公開 key 是否仍為空字串；瀏覽器是否成功載入該檔案。 |
| Google 顯示 `redirect_uri_mismatch` | Google Cloud 的 Authorized redirect URI 是否為完整的 Supabase `/auth/v1/callback`，包含正確 Project Ref 且沒有多餘 `/`。 |
| 登入成功卻回到錯誤網址 | Supabase Site URL 與 Redirect URLs 是否包含目前實際網址。 |
| 顯示 `Invalid API key` | 是否複製到其他專案的 key、漏字，或誤用非瀏覽器用的 secret key。 |
| 同步出現 `row-level security` 錯誤 | 是否已執行 `supabase.sql`、RLS policies 是否存在、目前 session 是否仍登入。 |
| 第二台裝置沒有資料 | 是否登入同一個 Google 帳號、第一台是否顯示「已同步」、第二台是否選擇雲端模式。 |
| Google 測試帳號無法登入 | OAuth consent screen 是否仍為 Testing，以及該 email 是否已加入 Test users。 |
