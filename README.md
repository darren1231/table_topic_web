# Table Topic Practice

一個支援中文與英文的表達能力練習網站，可在「問題練習」與「自由講稿」之間切換。

## 主要功能

- 依照主題由 AI 產生即興題目
- 自由講稿錄音或文字輸入
- 瀏覽器即時語音辨識或 API Audio-to-Text
- AI 表達回饋、逐句改善及英文文法解說
- 「演說健檢」：時間、中文總字數／英文總詞數、語速、可跳轉贅詞、停頓／快語片段、三段式結構與單一改善目標
- 練習日曆、連續打卡與複習資料庫
- 自訂 OpenAI、Claude 或 OpenAI 相容 API
- 完整資料匯出與匯入
- 可選擇純本機模式，或使用 Google 登入與 Supabase 跨裝置同步

## 本機執行

這是純前端網站，可直接開啟 `index.html`，或在專案目錄執行：

```powershell
python -m http.server 8000
```

然後開啟 <http://localhost:8000>。

演說健檢的純計算邏輯可以使用 Node.js 驗證：

```bash
node tests/evaluation.test.js
```

## 部署

專案包含 `vercel.json`，可直接匯入 Vercel 並從儲存庫根目錄部署。

## 資料與 API Key

練習資料與使用者自行設定的 API Key 儲存在瀏覽器 `localStorage`。請勿在共用裝置儲存正式 API Key，也不要把任何金鑰提交到 GitHub。

## 設定 Google 登入與 Supabase 同步

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
2. 編輯 [`supabase-config.js`](supabase-config.js)：

   ```js
   window.SUPABASE_CONFIG = {
     url: 'https://<PROJECT_REF>.supabase.co',
     anonKey: '你的公開 anon 或 publishable key'
   };
   ```

3. **絕對不可**在此填入 `service_role` 或 secret key。前端原始碼對所有訪客可見；真正的資料隔離由登入 JWT 與 RLS policy 負責。
4. 若這是公開 repository，建議在部署流程產生正式的 `supabase-config.js`，不要把正式 key 直接提交。Supabase 的 anon / publishable key 本來就是前端可公開的，但分開管理仍可避免誤放 secret key。

### 7. 本機測試完整流程

1. 在專案根目錄啟動網站；不要直接使用 `file://` 開啟：

   ```bash
   python -m http.server 8000
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
