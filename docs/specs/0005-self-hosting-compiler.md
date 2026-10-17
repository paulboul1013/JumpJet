---
status: implemented
---

# Spec: self-hosting compiler 階段

JumpJet 使用同一套 compiler 的受控 JavaScript 子集版本完成自舉。宿主先產生 compiler bytecode，再由 VM 內的 compiler 連續編譯自身，驗證三代產物與編譯行為。

使用者於 2026-10-16 確認本規格的範圍、介面設計與階段順序。M0 負責將能力集合展開為精確 grammar、runtime 操作表與 bytecode schema。M0 至 M6 已實作，實際 grammar、ABI 與 schema 見 [Bootstrap 契約](0005-bootstrap-contract.md)。可用 `npm run verify:self-hosting` 重建與驗收。

依據：[範圍 ADR](../adr/0002-self-hosting-bootstrap-scope.md)、[訪談與程式碼盤點](../plans/self-hosting-compiler.md)、[詞彙表](../../CONTEXT.md)。

## 成果與範圍

固定完整 compiler 的來源集合，打包成來源字串 S。
宿主執行與 guest 執行必須使用同一套編譯邏輯，不能維護兩套不同 compiler。

```text
宿主執行同一套 compiler：compile(S) → B1
VM 執行 B1：compile(S) → B2
VM 執行 B2：compile(S) → B3

B1、B2、B3 的完整可執行內容相同
宿主與各代 compiler 對測試來源的結果、diagnostics 相同
```

Tokenize、parse、analyze、emit 全部在 guest 執行。
VM、verifier、Node.js 的 I/O、產物比對與有限的 runtime 基礎操作可以留在宿主。

交付 Node.js 自舉入口，維持現有 Studio 與來源層級 compile、run 用法。
不要求第一階段在瀏覽器操作自舉，也不要求 VM 本體自舉。
不實作 closure、callback、執行期 ES module loader 或完整 guest 例外機制。
允許 bytecode 升版，不提供 version-1 產物相容執行層。

## 呼叫端與介面設計

現有公開呼叫方式保持可用：

```js
const result = compile("let answer = 1 + 2 * 3; answer;");
if (result.ok) {
	run(result.program);
}
```

新增 guest 具名入口呼叫能力，支援傳入來源字串、取回資料結果。
目前公開介面如下：

```text
compile(source: string) → CompileResult
run(program: BytecodeProgram, options?) → GuestValue
invoke(program: BytecodeProgram, entryName: string, args: GuestValue[], options?) → GuestValue
```

`invoke` 只能呼叫產物中存在的頂層具名函式或明確公開的入口。
每次呼叫建立乾淨的執行狀態，執行必要的頂層初始化，再呼叫指定入口。
不以拼接待編譯來源的方式傳入編譯輸入，也不使用宿主 eval 執行 guest 程式。

Compiler 入口的資料契約：

```text
CompileResult = { ok: true, program: BytecodeProgram }
              | { ok: false, diagnostics: Diagnostic[] }

Diagnostic = { stage, message, start, end }
```

Guest 來源錯誤正常回傳 CompileResult。Runtime trap 與無效宿主引數走獨立的宿主錯誤路徑，不偽裝為來源 diagnostic。

## Compiler 來源與打包

來源集合包含完整編譯入口、lexer、parser、analyzer、emitter 與 bytecode 定義。
現有 index 同時匯入 VM，實作時先分離純 compiler 入口，避免將 VM 與 verifier 誤納入自舉來源閉包。
Node 公開 API 可用薄的邊界檢查呼叫相同 compiler 核心。

打包工具使用固定 manifest、固定模組順序與明確的匯入匯出處理規則。
若提升函式後出現名稱衝突，在來源內使用穩定名稱解決，不能依宿主物件遍歷順序臨時配置。
打包只處理來源組合與模組外層，不能代為執行四個編譯階段，也不能默默轉譯未支援的語言能力。

同一 manifest 與來源必須產生相同 S。S、manifest 與來源摘要保存到驗收產物。
目前的最後一個 expression statement 規則保留給一般程式。Compiler bundle 可由明確的結尾 expression 滿足此規則，具名 compiler 函式則由 invoke 呼叫。

## Bootstrap 子集

下表是依現有來源需求與改寫方向確認的能力集合。
M0 必須將它整理為精確語法與語意契約；不能將表格視為完整 ECMAScript 支援承諾。

| 類別 | 第一階段能力 | 改寫或延後 |
|---|---|---|
| 值 | number、boolean、string、null、undefined | Symbol、BigInt 延後。 |
| 資料 | Dense array、固定欄位 record、index 與 field 讀寫、length | 一般 prototype 系統、class、accessor 與反射延後。 |
| 運算 | 既有算術與比較、字串串接與比較 | 複合賦值改為一般賦值；便利用法不自動列入子集。 |
| 宣告 | let、const、block、頂層具名 function、一般參數 | Destructuring、default/rest 參數改寫。 |
| 控制 | if/else、while、return | for/for-of 改 while，switch 改分支；break/continue 可由條件與分支改寫。 |
| 呼叫 | 直接具名呼叫、遞迴、前向呼叫、互相遞迴 | Nested function、closure、函式當值與 callback 延後。 |
| 字面值 | 字串與必要 escape、array 與 record literal、來源註解 | Template literal 改串接，spread 與 computed record keys 改寫。 |
| 模組與錯誤 | 固定來源靜態打包、diagnostics、runtime trap | 執行期 import/export、throw/try/catch/new Error 延後。 |

`&&` 與 `||` 可先由 if 改寫。若後續決定保留，必須實作短路，不能預先求值兩側。
`typeof` 等 type query 只在來源盤點證明必要時加入語法或有限 runtime 操作。
函式沒有顯式回傳時得到 undefined。Compiler 核心盡量使用明確回傳，頂層 return 仍屬來源錯誤。

## Runtime 基礎操作

Guest 自己執行編譯演算法。宿主只提供下列類型的有限操作，具體 symbol、引數與錯誤條件在 M0 規格中列出：

| 操作範圍 | 必要語意 |
|---|---|
| 字串 | UTF-16 length、取單位字串或 code unit、slice、number conversion。 |
| 字元分類 | 完整保留現有 JavaScript whitespace 判定；可用固定 JS 表實作，不需要正規表示式引擎。 |
| 陣列 | 建立、length、index read/write、受控 append/pop 或等價 resize 操作。 |
| Record | 建立、固定欄位 read/write；不把宿主 prototype 屬性當成 guest 資料。 |
| 邊界檢查 | 必要的型別查詢、資料結果轉出，以及不可恢復錯誤的 trap。 |
| 公開 phase 結果 | 保留既有宿主 API 可觀察的 freeze 行為，可由明確 runtime 操作或宿主 adapter 提供。 |

所有操作都有固定可列舉的 symbol 或 ID，不開放任意宿主函式呼叫。
Lexer 的 token 決策、parser 的語法決策、analyzer 的 binding 決策與 emitter 的指令選擇都不能成為宿主 intrinsic。
Map 可改為 names/bindings 陣列與線性搜尋。Object.values 的 AST 遍歷可改為依 node kind 列出子節點。

## 狀態、函式與 ownership

| 狀態或規則 | Owner |
|---|---|
| Tokens、原始來源 offset 與 lexical diagnostic | Lexer 與每次呼叫的新 context。 |
| Token position、syntax depth、AST 與 parser diagnostic | Parser 與每次呼叫的新 context。 |
| Scope、binding、TDZ、const、function signature 與 slot 配置 | Analyzer。 |
| 指令選擇、常數池、跳轉修補與 function body 產生 | Emitter。 |
| Opcode 編碼、function table 與 bytecode version | Bytecode 定義。 |
| 完整指令、function/slot/constant 參照與私有快照 | Verifier。 |
| Operand stack、call frames、函式參數、返回值與執行預算 | VM。 |
| Manifest、bundle S、世代執行、比對與報告 | Node.js 自舉執行入口。 |

每個 call frame 持有自己的 local slots、初始化狀態、返回位置與 stack 邊界。
遞迴呼叫不能共用同一組 locals。頂層 binding 與函式區域 slot 必須分開處理。
Analyzer 先收集頂層函式名稱與參數契約，才解析函式本體中的前向呼叫與互相遞迴。
自訂函式、builtin 與變數的名稱衝突規則必須明訂，不允許 fallback 到任意宿主屬性。

每次 compile 都建立新的 parser、analyzer、emitter context。
失敗後再次編譯合法來源，不能保留前次 diagnostic、slotCount、code 或 constants。

## Bytecode、資料傳遞與世代比對

函式結構與值模型改變時提高 bytecode version。新格式統一定義 main code、function bodies、參數與 local slots。
不以沿用 version 1 掩蓋 wire format 變更，不新增舊版 adapter。
既有回歸測試更新當期格式，繼續檢查 untaken branch、unreachable code、跳躍邊界、stack underflow、slot 初始化及快照規則。

Guest 與宿主之間傳遞的 compiler 結果是資料，不能包含宿主函式或任意宿主物件。
資料轉出保留值型別與陣列順序，並交給 verifier 檢查輸出的 program。

B1、B2、B3 比較完整可執行 schema，包括 version、常數池順序、指令、function table、入口與 slot 等資料。
只允許將外部報告的時間、檔案絕對路徑等與執行無關的欄位留在 artifact 之外。
不能重新排序常數池、忽略 function metadata，或只比對 hash 來掩蓋差異。

產物 encoding 必須保留 undefined、NaN、Infinity、-Infinity、-0 與一般數字的區別。
不能直接使用未加標記的 JSON.stringify。比對需顯示第一個不同欄位，hash 只供報告索引。

## 相容性與測試 oracle

比較對象分成三層，避免兩個 compiler 共有錯誤卻互相比對通過：

1. 既有語言的明確期望結果與固定 diagnostics，保留原本支援範圍的行為。
2. 新增子集能力的獨立期望結果、錯誤與邊界案例。
3. 同一套最終 compiler 在宿主、B1、B2、B3 執行時的結果對照。

新增語法原本可能被舊引擎拒絕，不能要求這些輸入永遠維持舊錯誤。
但最終宿主與各代 compiler 必須對同一份最終語言輸入得到一致的 CompileResult。
對合法程式，比較產物並在 VM 執行輸出，核對獨立期望值。
對非法程式，比較 diagnostic 數量、順序，以及每筆 stage、message、start、end。

必含的測試情境：

- 遞迴及互相遞迴的 locals 互不覆寫，回傳後 operand stack 正確。
- 同一 artifact 多次編譯、失敗後成功、不同輸入交錯執行，沒有 context 殘留。
- UTF-16 offset、非 BMP 輸入、NBSP、BOM、longest-match operator 與 EOF。
- constructor、toString、__proto__、shadowing、TDZ、const 寫入與未知識別字。
- 新 AST 節點的深度檢查，及超出限制時的診斷。
- B1、B2、B3 自編譯、合法 corpus、非法 corpus 與固定 compiler S。
- 產物 encoding 的特殊值保真，以及任何世代差異都會讓驗收命令失敗。

## 資源與失敗契約

一般 run 的預設執行預算保持既有行為。自舉入口顯式設定獨立的有限預算，不能用無限預算作為通過條件。
預算累計所有 guest frames 與 builtin 呼叫，不因遞迴或呼叫而重設。
會依輸入長度工作的宿主基礎操作須有輸入界線與成本記錄，不能假裝成本恆為一個 opcode。

來源 syntax nesting、AST depth、guest call depth 與自舉程序的 wall-clock deadline 分別管理。
Compiler S 本身也必須通過來源深度驗證，不能直接移除既有保護來通過自編譯。
實際 budget、deadline 與大輸入上限由首個可執行 bundle 的量測決定，再固定於自舉設定與報告。

任何超額、trap、verifier 錯誤、diagnostic 差異或產物差異都導致非零退出。
報告指出 stage、輸入案例、世代、差異欄位與已耗用資源，並保存重現輸入。

## 階段順序與可檢查的完成條件

| 階段 | 工作與產物 | 完成條件 |
|---|---|---|
| M0 凍結契約 | Bootstrap 子集語法、runtime 操作表、函式與 frame 契約、新 bytecode schema、打包 manifest、測試 corpus。 | 每項能力可追溯至實際 compiler 用法；來源、入口、型別、序列化與限制都有定義。 |
| M1 改寫同一套 compiler | 在 Node.js 下改為頂層函式與 context；移除 callback、Map、regexp 等選定便利用法，建立可重現 bundle。 | 既有語言結果與 diagnostics 相同，公開 phase 的既有行為保留；相同來源重建相同 S。 |
| M2 支援資料與迴圈 | 逐個端到端切片支援字串、array、record、欄位與 index、while，並同步 verifier。 | 真正 source → compiler → VM 操作資料與迴圈；範圍與 malformed bytecode 案例通過。 |
| M3 支援直接函式呼叫 | Function signatures、參數、獨立 locals、call frames、遞迴、return、具名入口與資料結果轉出。 | context/array/while 與遞迴整合程式在 VM 得到期望結果；locals 不覆寫，錯誤可中止。 |
| M4 分階段在 VM 執行 | 先執行 guest lexer/parser，再執行 analyzer/emitter，最後完整 compile。 | Token、AST、bound program 或 bytecode 的階段比對通過，完整 compile 四階段都有 guest 執行證據。 |
| M5 完成三代自編譯 | 從乾淨環境建立 S、B1、B2、B3，保存來源與所有產物。 | B1、B2、B3 完整可執行內容相同；B3 也能執行 compiler 入口並處理 corpus。 |
| M6 固定正式驗收 | Node.js 自舉命令、固定 corpus、完整比對、有限預算與失敗報告。 | 一個命令可重建並重跑全部證據，任何差異非零退出；既有測試、syntax check、demo 與 Studio 冒煙檢查通過。 |

M1 與 M2、M3 都會修改同一套 compiler，需用 corpus 防止後續改寫重新引入子集外能力。
新增能力必須逐個形成可執行切片，不先建立一整套尚無使用者的 VM 架構。
不依日曆估工。在 M1 與 M3 完成後，依來源規模、指令量與實測成本重新估計剩餘工作。

兩個中間驗收例子：

```js
let box = { values: [1, 2, 3] };
let i = 0;
let total = 0;
while (i < box.values.length) {
	total = total + box.values[i];
	i = i + 1;
}
total;
```

此程式驗證資料與迴圈切片，期望結果為 6。

```js
function sumTo(n) {
	if (n === 0) {
		return 0;
	}
	let saved = n;
	let rest = sumTo(n - 1);
	return saved + rest;
}
sumTo(5);
```

此程式驗證遞迴時 locals 隔離，期望結果為 15。
兩個例子均已納入固定 corpus，並由各代 compiler 編譯後在 VM 執行驗證。

## 模組與工具落點

既有 lexer、parser、analyzer、emitter、bytecode、verifier、VM 各自保留單一責任。
純 compiler 入口與 Node 公開邊界分離，避免循環依賴或把 VM 打包進 compiler。
工具與產物路徑如下：

```text
scripts/build-bootstrap.mjs      固定 manifest 產生 S 與來源摘要
scripts/check-bootstrap-source.mjs 檢查 compiler 未重新使用子集外能力
scripts/verify-self-hosting.mjs  建立世代、執行 corpus、比對與保存報告
tests/fixtures/self-hosting/     合法、非法與邊界來源及獨立期望值
output/self-hosting/verification/ 執行時產生的 S、B1/B2/B3 與報告
```

來源子集檢查與打包規則要可重跑，不能只靠人工記得「不要用 closure」。
驗收命令為 `npm run verify:self-hosting`。

## 完成檢核

下列項目均已由實作與驗收涵蓋。執行紀錄見 [實作與驗收紀錄](../plans/self-hosting-implementation.md)。

- 同一套 compiler 在宿主與 VM 執行，四階段沒有 host fallback。
- 三代可執行內容相同，各代 corpus 結果符合獨立期望值。
- Diagnostics 四欄位與來源範圍完全一致。
- Bundle 與產物可重建，數字與特殊值 encoding 不失真。
- 有限執行、frame 與程序限制能可靠中止錯誤。
- 舊來源用法與 Studio 維持可用，格式升版與不支援舊產物已記錄。

## 規劃期間的驗證

基準 commit：`af64083`。既有 `npm test` 94 個測試通過，`npm run check` 通過。
這些結果只代表開始規劃時的 scalar 引擎狀態，不能當作自舉已完成的證據。
以上為規劃時的歷史基準。後續實作已加入本規格的 API、指令與工具；現況請以驗收命令的報告為準。
