---
status: accepted
---

# JumpJet compiler 自舉階段規劃

這份文件記錄自舉階段的設計訪談，分開記錄決策、程式碼事實與曾考慮的方案。
四輪共十項範圍決策已回答。使用者於 2026-10-16 確認整體計畫、介面設計與 M0 至 M6 的順序。
完整契約見 [自舉規格](../specs/0005-self-hosting-compiler.md)。訪談已結束，實作尚未開始。

## 已確定的目標與既有決策

- 目標是完整 compiler 自舉，包含 tokenize、parse、analyze 與 emit，不能只驗收 emitter。
- JavaScript 是來源語言與實作語言，第一個執行目標是 JumpJet bytecode。
- 完整 ECMAScript 相容性是另一個目標，不是自舉的先決條件。
- 初期優先考慮清楚、正確、可測試的端到端流程。

以上依據 [既有 ADR](../adr/0001-language-and-execution-model.md) 與 [README](../../README.md)。
詞彙定義記錄於 [CONTEXT.md](../../CONTEXT.md)。

本次訪談已確定以下階段範圍：

- 允許等價改寫同一套 compiler，縮小自舉所需的 JS 子集。
- 驗收包含多代 compiler 產物穩定、合法程式結果與錯誤 diagnostics 的對照。
- 新增自舉入口先交付 Node.js，維持現有 Studio 可用。
- 四個編譯階段在 VM 執行。VM、verifier、I/O 與有限的基礎操作可由宿主提供。
- Compiler 使用頂層具名函式、一般呼叫與遞迴，狀態以 context 明確傳入。
- Closure、函式當參數與 callback 延後。
- 固定 compiler 來源集合靜態打包為單一入口，執行期 ES module loader 延後。
- Host compiler 與 VM compiler 的 diagnostics 必須逐項符合 stage、message、start、end。
- B1、B2、B3 的完整可執行內容必須相同，並另做行為對照。
- 延後 guest 的 throw、try、catch 與 new Error，使用 diagnostics 與明確 runtime trap。
- 允許 bytecode 升版，本階段不承諾執行 version-1 產物。

架構範圍與取捨記錄於 [自舉範圍 ADR](../adr/0002-self-hosting-bootstrap-scope.md)。

## 程式碼盤點與基準

基準 commit 為 `af64083`。本次訪談開始時，既有程式碼有以下行為。

| 事實 | 證據 | 對自舉的影響 |
|---|---|---|
| compile 依序呼叫 tokenize、parse、analyze、emit | [index.js](../../src/index.js) | compiler 目標包含四個階段與編譯入口。 |
| compiler 的語意依賴分布於 index、lexer、parser、analyzer、compiler、bytecode | [index.js](../../src/index.js)、[compiler.js](../../src/compiler.js) | 需要明確定義納入自舉的來源集合。 |
| index 同時匯入 VM，但 compile 本身不呼叫 VM | [index.js](../../src/index.js) | 現有模組匯入閉包與 compiler 語意依賴不是同一集合。 |
| constants 只接受 number 與 boolean | [verifier.js](../../src/verifier.js) | 尚不能在 guest 程式中表示來源字串、AST 與輸出物件。 |
| VM 只有單一 operand stack、slots 與 instruction pointer | [vm.js](../../src/vm.js) | 需要設計函式呼叫、區域變數與返回的執行狀態。 |
| Return 結束整次 execute | [vm.js](../../src/vm.js) | 目前的 Return 不是一般函式呼叫的返回機制。 |
| VM 已可執行 backward Jump，但 parser 尚不支援迴圈 | [vm.js](../../src/vm.js)、[parser.js](../../src/parser.js) | 迴圈缺口包含來源語法，不能概括為 VM 沒有跳轉能力。 |
| compiler 使用 nested functions、closure、遞迴、陣列與物件 | [parser.js](../../src/parser.js)、[compiler.js](../../src/compiler.js) | 原樣支援與等價改寫會形成不同的語言需求。 |
| compiler 使用 Map、字串方法、callback 與其他內建操作 | [analyzer.js](../../src/analyzer.js)、[lexer.js](../../src/lexer.js)、[bytecode.js](../../src/bytecode.js) | 必須決定受控子集與 runtime 基礎操作。 |
| 頂層程式必須以 expression statement 結尾 | [analyzer.js](../../src/analyzer.js) | 需要設計 compiler 模組入口與呼叫契約。 |
| verifier 在 execute 入口執行，不在 compile 流程中 | [vm.js](../../src/vm.js)、[index.js](../../src/index.js) | compiler 自舉不必同時把 verifier 或 VM 納入。 |

已執行的基準檢查：

- `npm test`：94 個測試通過，沒有失敗。
- `npm run check`：通過。
- 六份 compiler 語意依賴來源逐檔交給現有 compile，全部在 lexer 階段失敗。這只能證明目前無法處理這些來源，不代表第一個字元錯誤就是全部缺口。

## 第一輪：已決定

| 編號 | 決策 | 建議 | 狀態 |
|---|---|---|---|
| Q1 | 是否允許等價改寫現有 compiler，以縮小自舉所需的 JS 子集？ | 允許等價改寫，維持同一套完整 compiler。 | 已採用 |
| Q2 | 階段終點是可重現的多代自舉與差異驗證，還是先交付自舉示範？ | 多代自舉與合法、錯誤程式的差異驗證。 | 已採用 |
| Q3 | 新增自舉入口先交付 Node.js，還是同階段加入瀏覽器操作流程？ | 先交付 Node.js 入口，維持現有 Studio 可用。 | 已採用 |

## 第二輪：已決定

| 編號 | 決策 | 採用方案 | 狀態 |
|---|---|---|---|
| Q4 | 宿主能提供哪些能力？ | VM、verifier、I/O 與列明契約的有限基礎操作。四個編譯階段在 guest 執行。 | 已採用 |
| Q5 | 第一階段的函式能力到哪裡？ | 頂層具名函式、一般呼叫與遞迴，明確傳入 context。Closure 與 callback 延後。 | 已採用 |
| Q6 | 多個來源模組如何進入 VM？ | 可重現的固定來源靜態打包。執行期模組載入延後。 | 已採用 |
| Q7 | Diagnostics 哪些欄位必須相同？ | 同一份來源的 stage、message、start、end 全部相同。 | 已採用 |

## 第三輪與第四輪：已決定

| 編號 | 決策 | 採用方案 | 狀態 |
|---|---|---|---|
| Q8 | 多代產物如何比較？ | B1、B2、B3 的完整可執行內容相同，另外驗證行為。 | 已採用 |
| Q9 | 是否先做完整 guest 例外？ | 延後 throw、try、catch、new Error。來源錯誤回傳 diagnostics，內部錯誤使用 runtime trap。 | 已採用 |
| Q10 | 是否保證 version-1 產物相容？ | 允許格式升版，不增加舊版執行層，保留來源程式及 compile、run 用法。 | 已採用 |

## Q1 的兩種架構候選

### 已採用 A：同一套 compiler，允許等價改寫

保留 tokenize、parse、analyze、emit 的責任分工。
依盤點結果，將部分便利用法改成較小 JS 子集內的等價寫法。
同一份 compiler 來源同時接受宿主執行與 JumpJet 執行的驗證。

改寫以顯式 context 取代 closure，以迴圈或直接呼叫取代 callback。
正規表示式、Map 與其他便利用法的替代方式仍須列出語意與驗證案例。
字串、集合資料與函式呼叫等需求仍須有明確實作。

風險是 compiler 可能為了避開能力缺口而變得難讀，或在改寫時改變語意。
不能另做一套僅供示範的小 compiler，卻宣稱既有 compiler 已完成自舉。

### 未採用 B：盡量原樣支援現有 compiler

保留現有 compiler 的主要寫法，擴充 JumpJet 語言與 runtime，使其能執行這份來源。
需求會包含目前使用的 closure、Map、正規表示式、spread、destructuring 與其他便利用法。

風險是引擎的第一階段範圍大幅擴張。
哪些能力必須原生支援、哪些可以由明確的來源轉換提供，仍須另行決定。

## 後續訪談的決策樹

已回答的問題約束後續設計，不能在實作時默默擴大範圍。

```text
Q1 等價改寫 compiler【已定】
  → Q5 明確傳入 context，延後 closure【已定】
  → Q6 固定來源靜態打包【已定】
  → 凍結自舉來源集合與受控 JS 子集

Q4 有限宿主基礎操作【已定】
  → Q9 diagnostics 與 runtime trap，延後完整例外【已定】
  → 基礎操作、引數與 call frames 的設計提案見自舉規格

Q2 多代產物與程式對照【已定】
  → Q7 diagnostics 四欄位完全相同【已定】
  → Q8 B1、B2、B3 可執行內容完全相同【已定】
  → Q10 允許格式升版，沒有舊版執行層【已定】
  → 對照集合、預算與失敗證據的提案見自舉規格

Q3 Node.js 自舉入口【已定】
  → 定義呼叫入口與產物保存方式
```

## 階段與技術設計

[自舉規格](../specs/0005-self-hosting-compiler.md) 統一定義已確認的階段、呼叫介面、runtime 邊界、資料格式與驗收。
訪談決策不等於已實作能力。現有 run API 尚無 guest 函式引數與返回物件的契約。

## 盤點發現的相容性注意事項

- 新語法會讓某些原本不合法的輸入變成合法。不能要求新引擎對所有輸入都回報與舊 scalar 引擎相同的錯誤。
- 來源位置與字串操作使用 UTF-16 code unit，不能改成 Unicode code point。
- 移除正規表示式不能順便把 whitespace 縮減為 ASCII。
- 名稱表必須保留 constructor、toString 與 __proto__ 的正確行為。
- Guest call frame 深度與來源 syntax depth 是不同限制。
- 一般 JSON 序列化會損失 Infinity、NaN、-0 與 undefined，不能直接拿來定義完整 artifact encoding。
- 現有 tokenize 對部分輸出使用 Object.freeze。不得因測試未涵蓋就默默改變宿主公開 phase API 的凍結行為。

## 決策紀錄狀態

已新增 [ADR 0002](../adr/0002-self-hosting-bootstrap-scope.md)，記錄十項回答形成的自舉範圍。
使用者已確認整體規格與階段順序，無待回答的訪談問題。M0 負責將能力集合展開為精確 grammar、runtime 操作表與 bytecode schema。
影響長期架構且確實經過取捨的決定，會另存於 `docs/adr/`。
可逆的實作細節留在階段規格，避免每項選擇都變成 ADR。
