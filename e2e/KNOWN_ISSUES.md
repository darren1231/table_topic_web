# 瀏覽器測試發現的既有問題

本工作只新增測試，不修改 `public/`。以下問題保留給後續修正。

## I18N-01：翻譯已移除的文字節點

- 切換語言或重新繪製動態區塊後，`public/i18n.js` 的 MutationObserver
  可能將已移除節點的 `parentElement`（null）傳給 `apply()`。
- Chromium 回報 `Failed to execute 'createTreeWalker' on 'Document': parameter 1 is not of type 'Node'.`。
- WebKit 回報 `Argument 1 ('root') to Document.createTreeWalker must be an instance of Node`。
- fixture 僅排除此特定錯誤；其他 console error 與 pageerror 仍使測試失敗。

## I18N-02：相同中文來源對應多個翻譯

- 「產生題目」同時對應一般按鈕與管理員用途詞條。自動翻譯會顯示
  `Question generation`，而非一般按鈕詞條的 `Generate questions`。
- 語言測試確認目前的實際標題、按鈕內容；不修正詞條或翻譯策略。

## I18N-03：主網站阿拉伯語未切換 RTL

- 主網站選取阿拉伯語後未設定 RTL 排版；計畫已明列此問題。
- 本次驗證文字切換，不以此為理由略過其他阿拉伯語斷言。
