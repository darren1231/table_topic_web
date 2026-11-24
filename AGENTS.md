# 專案架構與協作規範

## 適用範圍與模式

適用於 `public/` 前端與 `api/` 伺服器端，以及相關測試與文件。
採用功能模組＋明確資料擁有者＋小型依賴注入；必要時才用策略與狀態機；不用框架與建置工具；目前維持 UMD／CommonJS。

本文件定義新增與遷移程式的目標形狀，不表示既有程式已全部符合。
只檢查本次觸及的責任；未觸及的既有違規列為後續工作，不要求每次 PR 重寫全站。

## 分層與依賴方向

組裝 → 功能流程 → I/O adapter／領域邏輯。

- 組裝層建立依賴、初始化功能、連接跨功能公開介面；`public/app.js` 逐步成為此入口。
- 功能流程協調使用者操作、領域動作與外部能力；畫面控制器管理 DOM 與事件。
- I/O adapter 封裝 HTTP、瀏覽器能力或儲存協定，不處理 DOM；畫面呈現由控制器負責。
- 領域邏輯接受資料並回傳結果，不依賴 DOM、網路或儲存。
- 功能流程可同時使用 adapter 與領域邏輯，不必經過所有層；下層不反向引用組裝層或功能控制器。
- 跨功能互動由組裝層連接公開介面，不透過彼此私有狀態。

## 可檢查規則

### 必須

- M1：app.js 新增的可執行程式只建立依賴、初始化或連接公開介面；資料處理、DOM 渲染與網路流程置於所屬模組。
- M2：新增可變狀態位於工廠 closure 或 request scope；跨模組共享狀態須由組裝層建立並傳入，不新增 window／globalThis 可變狀態容器。
- M3：純邏輯不存取 DOM、網路或儲存，也不修改呼叫端輸入；I/O adapter 不操作 DOM。
- M4：新模組明列所需依賴，不接收整份全域 state／services；跨功能呼叫僅使用公開介面，不讀寫對方內部資料。
- M5：新功能透過所屬資料管理員的領域動作寫入持久資料；舊程式相容寫入入口須明列範圍，且不得與新入口各持一份可變真相。
- M6：資料管理員的讀取結果不可修改內部資料；寫入失敗不得發布提交成功，並以失敗測試驗證記憶體與儲存的一致性。
- M7：有事件、timer、媒體資源或訂閱的控制器提供 dispose；測試重複 initialize 不重複綁定、dispose 後不再觸發及資源釋放。
- M8：更動非同步狀態流程時，列出狀態、事件與合法轉換，並測試取消／重設後的舊結果；可並行的工作分開記錄狀態。
- M9：外部資料寫入前先驗證；匯入變更附無效輸入零寫入、本機部分失敗、雲端失敗及重試的行為測試。
- M10：新增／修改後的程式碼行不超過 200 字元；必要長字串／網址例外須於變更說明列出檔案、行號與理由。
- M11：維持既有 UMD／CommonJS 載入格式；變更格式、框架或建置工具須獨立提出並驗證相關頁面與測試入口；所有變更附適用檢查結果。

### 建議

- S1：需要狀態或生命週期的功能採附錄工廠骨架；未採用時，在變更說明指出沿用的既有模式與理由。
- S2：新增策略或 subscribe 時，列出至少兩個實際實作或獨立訂閱者；不足時說明目前非抽象不可的具體需求。
- S3：純邏輯用 node:test 驗證公開輸入／輸出；DOM、網路與媒體流程補相關整合驗證；未採用時列出替代驗證方式與理由。

- review 判定方式：M 項檢查是否符合；不適用時標示 N/A 並給原因。S 項檢查「已採用，或已有具體理由／替代方式」是否成立。不能以符合建議項目抵銷必須項目失敗。
- 適用範圍：檢查本次新增或改動責任；未觸及的既有違規列為後續工作，不要求每次 PR 重寫全站。api 套用 M2–M6、M8–M11 等適用項目，無須套 DOM 控制器形狀；Error 子類可保留。
- api/_lib/feedback-issue.js 重用 public/feedback-issue-draft.js 的純驗證為既有明列例外；它不授權新增後端對 UI 模組的依賴。

## 模式的使用時機

- **工廠：** 需要可變狀態或生命週期才使用 `createXxxController`；只注入所需能力。純函式直接匯出，不必包工廠、空 `initialize` 或空 `render`。
- **資料擁有者：** 每個持久集合由唯一模組管理寫入；以 `addHistory`、`rateCard` 等領域動作提交，不提供任意路徑 setter 或要求外部先修改再 `save`。
- **最小 store：** 先管理 practice 的 history、reviewCards、reviewEvents、scripts、apiUsage；語言與 AI 設定由各自擁有者管理。錄音資源、timer、DOM、畫面篩選保留在功能內。
- **資料隔離：** 對外不可變、內部可局部修改；快照隔離內部參照。過渡期可先複製資料再呼叫會修改輸入的舊 helper，不需 immutable library 或全庫 deep-freeze。
- **通知：** 初期不做 `subscribe`，動作回傳結果後明確更新畫面。有獨立訂閱者時才加入，提供退訂；成功提交最多通知一次，失敗不通知，listener 錯誤不改變已提交結果，也不觸發再次持久化。
- **策略：** 同一能力有實際變體時才統一契約。AI 分成教練策略（出題／分析）與傳輸 adapter（respond／transcribe）；供應者選擇與額度降級由協調流程負責。
- **轉文字：** 瀏覽器辨識提供 interim／final 事件，API 接收音訊片段；可共享 session 操作與輸出事件，不硬套同一個 `transcribe(blob)`。
- **狀態機：** 多狀態非同步流程先列合法轉換與副作用，不必引入套件。錄音 capture 與 upload 分開建模以保留並行；朗讀保留佇列位置與 generation，取消或重設後拒收過期 callback。
- **簡單畫面：** 日曆月份、篩選排序、翻面、對話框開關使用一般函式與區域狀態；不因出現 boolean 就引入策略或狀態機。
- **Adapter：** 外部協定、請求格式、結果驗證與錯誤映射放在 adapter；不自行 toast、切換 provider 或修改畫面。只抽真正共用的流程，保留業務順序與失敗語意。
- **匯入提交：** 本機明確提交並更新記憶體；雲端失敗標記待同步且可重試。多鍵寫入部分失敗須還原或可恢復；遠端逾時不代表沒寫入，不宣稱提供跨本機／雲端原子交易。

目前不採用框架、建置工具、class 繼承式功能架構、抽象工廠、隱藏全域單例、萬用事件匯流排或預先建立的外掛系統。
`Error` 子類允許；組裝層明確建立並傳入單一實例也允許。
ES Modules 遷移另案處理，不與功能抽離混在同一變更。

## api/ 的適用方式

- 依賴方向為 request → handler／用例 → RPC、HTTP adapter／純邏輯；套用 M2–M6、M8–M11 等適用規則，不強制套前端 controller、store 或 subscribe 形狀。
- 每次請求的狀態留在 request scope，注入 `request`、`env`、`fetch`、`logger` 等所需能力；不得以可變全域保存使用者資料。
- 沿用 `api/_lib/` 的設定、計價、驗證、簽章、RPC 與計時責任；共用抽取保留驗證、記帳與錯誤處理順序，不建立充滿 callback 的萬用 handler。
- 修改受保護流程時，保留驗證與授權順序；公開錯誤與日誌不得洩漏憑證或上游敏感內容。
- **既有例外：** `api/_lib/feedback-issue.js` 可重用 `public/feedback-issue-draft.js` 的純驗證；這不授權新增後端對 DOM／UI 模組的依賴。

## Review 清單（8 項）

- **入口責任：** 逐段看 app.js 的新增行，是否只有建立依賴、initialize 與公開介面串接？有無把運算藏進組裝 callback？不以總行數減少判定通過。（M1）
- **狀態與依賴：** 是否新增頂層／window 可變狀態、整份 state／services 注入，或直接讀寫另一功能的內部資料？純邏輯是否仍有 I/O、輸入 mutation？既有例外是否被擴張？（M2–M4）
- **資料提交：** 搜尋本次新增的 localStorage 寫入及持久集合修改，是否經唯一擁有者？快照是否可反向修改內部？失敗測試是否證明無錯誤成功通知、無兩份真相？（M5–M6）
- **生命週期與競態：** initialize／dispose 的契約與測試是否齊全？listener、timer、stream、訂閱是否釋放？重設／換帳號後舊回應是否被忽略？錄音與上傳能否保持既有並行行為？（M7–M8）
- **外部輸入與錯誤：** 匯入／遠端結果是否在寫入前驗證？匯入失敗與重試案例是否齊全？API 修改是否維持驗證後才進入受保護流程，公開錯誤與日誌不洩漏憑證？（M9；API 契約）
- **可讀性與載入：** 新增／修改後的程式碼行是否超過 200 字元？例外是否逐項註明？是否混入 ESM、框架或建置遷移，且缺少獨立驗證？（M10–M11）
- **抽象是否有用途：** 工廠是否封裝實際狀態／資源？策略是否真有不同實作？subscribe 是否真有獨立訂閱者且有退訂？未符合建議時理由是否具體？（S1–S2）
- **驗證證據：** 測試是否經公開介面驗證行為與失敗情境？受影響的既有測試及頁面流程是否檢查？未跑項目是否明列原因與替代驗證？（M11、S3）

- 清單用於定位風險；不可用「7／8 通過」直接合併。每個適用的必須項目均須處理，建議項目允許有理由的取捨。

## 附錄：最小功能與 node:test 骨架

以下 25 行為兩個檔案的示意，只放在文件中；不要求建立 `public/action-ui.js`。
組裝端傳入既有 button 與同步 `onActivate`，呼叫 `initialize`；移除功能時呼叫 `dispose`。
`initialize` 與 `dispose` 可重複呼叫，釋放後可重新初始化。

```js
// public/action-ui.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActionUI = factory();
})(globalThis, function () {
  function createActionController({ button, onActivate }) {
    let active = false;
    const click = () => onActivate();
    return {
      initialize() { if (active) return; button.addEventListener('click', click); active = true; },
      dispose() { button.removeEventListener('click', click); active = false; }
    };
  }
  return { createActionController };
});
// test/action-ui.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActionController } = require('../public/action-ui.js');
test('初始化不重複綁定；釋放後可重新初始化', () => {
  const button = new EventTarget(); let calls = 0;
  const c = createActionController({ button, onActivate: () => calls++ });
  c.initialize(); c.initialize(); button.dispatchEvent(new Event('click')); assert.equal(calls, 1);
  c.dispose(); c.dispose(); button.dispatchEvent(new Event('click')); assert.equal(calls, 1);
  c.initialize(); button.dispatchEvent(new Event('click')); assert.equal(calls, 2); c.dispose(); });
```

示例落地後以 `node --test test/action-ui.test.cjs` 執行。
`EventTarget` 驗證真實事件綁定／解除，不涵蓋版面、焦點或瀏覽器權限。
非同步功能另定義 pending、錯誤呈現與過期結果規則，不直接套用同步 callback 契約。
25 行限制只約束示意；正式實作與測試應展開排列，保持可讀性。

## 遷移路線：計畫，依序各自開 PR

以下是計畫，不是每次修改都要完成的前置工作；每步可獨立合併並驗證。

1. **F06 備份驗證：** 強化 `PracticeData.parseBackup` 與正規化，驗證非空 projects、可解析的 activeId、history 項目及已提供的 cards/scripts 結構；兼容合法舊格式。更新已知問題測試，加入無效匯入零寫入與舊版往返案例。
2. **F05 匯入流程：** 抽出協調流程與儲存 adapter，實作本機提交／待同步語意，同步更新記憶體與畫面。測本機各寫入點失敗、雲端拒絕／逾時、重試，以及同步排程不回寫舊資料；此步不引入全域 store。
3. **最小 practice store：** 先遷移新增／清除 history，提供隔離快照、本機持久化及雲端排程。其餘舊功能暫經明列的單一相容入口提交，維持一份權威資料；測新增／清空、儲存失敗、快照隔離與提交版本，先不做 subscribe。
4. **Token 控制器：** 抽出 DOM、busy、owner／revision 狀態，保留 `token-ui.js` 為網路 adapter，經 callback 連接餘額刷新。測換帳號後忽略舊回應、重複點擊只送一次、兌換刷新額度；跑既有整合測試與相關 e2e。
5. **錄音控制器：** 收納錄音資源、辨識、分段佇列，沿用 `RecordingSession`，分開 capture／upload 狀態並保留 generation。測頁面隱藏、等待授權時 reset、重複 onstop、舊結果與錄音／上傳並行；跑既有錄音測試及瀏覽器流程驗證。

後續再逐區遷移複習、講稿與 AI adapter；ESM 維持獨立議題。

## 工作流程

- 程式功能與 Bug 修正採 TDD：先透過公開介面寫出失敗測試，確認紅燈，再做最小實作使其通過，最後重構並重跑適用檢查。
- 文件修改以內容、連結及相關一致性檢查驗證，不為了 TDD 建立與行為無關的測試。
- 每個獨立工作項目一個 commit，提交前完成該項檢查；本架構文件、引用入口與 README 連結視為同一文件項目。
- 依 `package.json` 執行 `npm test`，並執行受影響的整合測試；涉及瀏覽器流程時補相關 e2e。回報已跑結果、未跑原因及替代驗證。
- 只用 `git add` 加入明確檔案路徑；提交前檢查 staged diff，保留與本項目無關的修改及未追蹤檔案。
