# Table Topic Practice

一個支援中文與英文的表達能力練習網站，可在「問題練習」與「自由講稿」之間切換。

## 主要功能

- 依照主題由 AI 產生即興題目
- 自由講稿錄音或文字輸入
- 瀏覽器即時語音辨識或 API Audio-to-Text
- AI 表達回饋、逐句改善及英文文法解說
- 練習日曆、連續打卡與複習資料庫
- 自訂 OpenAI、Claude 或 OpenAI 相容 API
- 完整資料匯出與匯入

## 本機執行

這是純前端網站，可直接開啟 `index.html`，或在專案目錄執行：

```powershell
python -m http.server 8000
```

然後開啟 <http://localhost:8000>。

## 部署

專案包含 `vercel.json`，可直接匯入 Vercel 並從儲存庫根目錄部署。

## 資料與 API Key

練習資料與使用者自行設定的 API Key 儲存在瀏覽器 `localStorage`。請勿在共用裝置儲存正式 API Key，也不要把任何金鑰提交到 GitHub。
