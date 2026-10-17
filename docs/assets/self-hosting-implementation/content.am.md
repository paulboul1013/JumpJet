---
template: doc
theme: blueprint
mode: light
title: JumpJet compiler 自舉：改了什麼，證明了什麼
subtitle: 模組變更、JavaScript 子集、SVG 執行示意與 bytecode engine 的影響
source: 本地程式碼與保存的驗收產物
baseline: af64083
snapshot: 2026-10-17 驗收紀錄
style: 80
---

JumpJet 現在能把完整 compiler 編成自己的 bytecode。
VM 執行這份 compiler 後，能再次編譯同一份來源。
這次也擴充了資料、迴圈與函式能力，讓引擎足以執行 compiler 本身。

## A 驗收結果：三代一致，但各種證據回答不同問題 {meta="保存的報告快照"}

```callout ok 核心成果
同一套 lexer、parser、analyzer、emitter 已能在 VM 執行。
B1、B2、B3 的完整可執行內容相同。
宿主與各代 compiler 也通過合法、非法及邊界 corpus。
```

```kv cols=3
三代比較: B1 = B2 = B3
自舉檢查: 643 項通過
保存報告耗時: 5.705 秒，僅自舉部分
回歸測試紀錄: 171 個通過
Syntax check 紀錄: 37 個檔案通過
Studio: 4 個案例通過，0 個瀏覽器錯誤
來源集合: 7 個模組，46,386 個 UTF-16 units
Compiler 產物: 49 個具名函式，2,153 個常數
來源與產物: 固定 manifest，加上帶型別的 encoding
```

| 證據 | 回答的問題 | 不能單獨推論的事 |
|---|---|---|
| B1、B2、B3 逐欄位一致 | 自舉是否在同一份 S 上穩定？ | 所有可能的來源都正確。 |
| 獨立期望值與固定 diagnostic | 指定的語言行為是否正確？ | 已符合完整 ECMAScript。 |
| 各階段資料對照 | 四個編譯階段能否在 VM 重現？ | VM 與 runtime 也已自舉。 |
| Verifier 與失敗測試 | 無效產物、超額與差異能否中止？ | 任意宿主 JavaScript 都可安全執行。 |
| Studio 冒煙 | 原有操作與新語法能否在瀏覽器使用？ | Studio 預設改由 guest compiler 編譯。 |

回歸與 syntax check 數字取自[實作驗收紀錄](plans/self-hosting-implementation.md)。
自舉檢查、資源與世代摘要取自[原始 report.json](../output/self-hosting/verification/report.json)。
這是保存的驗收快照，耗時不代表固定效能。

## B 三代自舉：固定來源 S，切換執行 compiler 的地方 {meta="SVG 01 · 世代時序"}

S 是固定 manifest 打包出的 compiler 原始碼字串。
B1、B2、B3 都是 JumpJet bytecode program。
世代數指 compiler 產物的來源鏈。

```sequence num
participants: Node工具, 宿主compiler, JumpJet VM, 完整比較
Node工具 -> 宿主compiler: compileCore(S)
宿主compiler --> Node工具: B1
Node工具 -> JumpJet VM: invoke(B1, compileCore, [S])
JumpJet VM --> Node工具: B2
Node工具 -> JumpJet VM: invoke(B2, compileCore, [S])
JumpJet VM --> Node工具: B3
Node工具 -> 完整比較: version、constants、main、functions
完整比較 --> Node工具: B1 = B2 = B3
Node工具 -> JumpJet VM: 各代編譯合法、非法與邊界 corpus
JumpJet VM --> Node工具: program、四階段資料、diagnostics
Node工具 -> JumpJet VM: B3 再次完整編譯 S
JumpJet VM --> Node工具: 與 B1 的 CompileResult 一致
```

宿主與 guest 共用同一套 compiler 邏輯。
打包只處理模組外層，不代替四個編譯階段。
VM 收到的是來源字串參數，不會把輸入拼接成另一份程式。

### S 的精確範圍

```tree list
compiler 來源 S
  runtime-symbols.js | 固定 intrinsic 的名稱與參數數量
  bytecode.js | version、opcode 與指令定義
  lexer.js | tokenize
  parser.js | parse 與 AST 子節點列舉
  analyzer.js | analyze 與 scope、binding
  compiler.js | emit 與跳躍修補
  compiler-core.js | compileCore，串接四階段
宿主保留
  vm.js 與 verifier.js | 解譯、驗證與執行限制
  runtime.js | 有限基礎操作的實作
  guest-data.js | 宿主與 guest 間的資料複製
  scripts | I/O、打包、世代比較與報告
```

每代 compiler 都有 49 個函式、2,153 個常數。
整份產物共有 11,630 個 code array 項目，包含 opcode 與 operand。
其中靜態 opcode 為 6,782 個。
報告的 `mainCode = 1,365` 只計頂層 code array。
它沒有包含 function bodies，不能當成完整產物大小。

[下載這張 SVG](assets/self-hosting-implementation/01-generations.svg)。
來源：[manifest](../scripts/bootstrap-manifest.json)、[世代驗收工具](../scripts/verify-self-hosting.mjs)。

## C 哪些模組改了，為什麼要改 {meta="SVG 02 · 四階段與資料轉換"}

四個編譯階段的責任仍然分開。
每次呼叫都建立新的 context，保存該次編譯的狀態。
原本的 closure、callback 與 Map 用法，改為子集可表達的資料與呼叫。

```flow TB
Lexer -> Parser: tokens 與 UTF-16 offsets
Parser -> Analyzer: AST 語法樹
Analyzer -> Emitter: BoundProgram 與 slots
Emitter -> Bytecode-v2: code、constants、functions
```

### Compiler 與公開入口

| 模組 | 實際變更 | 目的 |
|---|---|---|
| [index.js](../src/index.js) | 保留 `compile`、`run`，新增 `invoke`。入口檢查宿主引數。 | 維持原有用法，提供具名 guest 呼叫。 |
| [compiler-core.js](../src/compiler-core.js) | 新增純 compiler 入口 `compileCore`。只依賴四個編譯階段。 | 讓打包來源不依賴 VM。 |
| [lexer.js](../src/lexer.js) | 新增 string、註解、while、function、return 與資料符號。表格與迴圈取代 regexp、callback。 | 在 guest 內做 token 決策，保留 offsets 與 longest match。 |
| [parser.js](../src/parser.js) | 新增 array、record、member、call、while、function 與 return 節點。使用優先序解析與明確的 context。 | 表達 compiler 所需語法，保留兩種深度檢查。 |
| [analyzer.js](../src/analyzer.js) | 用 scope 陣列查找 binding。預收集函式簽章，分配 globals 與各函式 locals。 | 支援前向呼叫與互相遞迴，保留 TDZ、const 與名稱衝突規則。 |
| [compiler.js](../src/compiler.js) | emitter 產生資料、呼叫、global 與短路指令。各函式有獨立 body。 | 把新語意轉成可執行的 bytecode，修補跳躍位置。 |
| [bytecode.js](../src/bytecode.js) | 格式升到 v2。新增 8 個 opcode，明列指令 operand 與 stack effect。 | 讓 emitter、verifier、VM 共用同一份指令契約。 |

### VM、runtime 與資料邊界

| 模組 | 實際變更 | 目的 |
|---|---|---|
| [vm.js](../src/vm.js) | 新增 call frames、globals、資料操作、builtin dispatch 與具名入口。所有 frame 共用總預算。 | 執行完整 compiler，隔離遞迴 locals，讓超額可中止。 |
| [verifier.js](../src/verifier.js) | 檢查 main 與所有 function bodies。驗證函式、builtin、global、slot、constant 與 jump 參照。 | 無效指令即使不可達，也會被檢查。 |
| [runtime-symbols.js](../src/runtime-symbols.js) | 新增 12 個固定名稱、ID 與 arity 的契約。 | 讓 guest 只能呼叫列明的宿主操作。 |
| [runtime.js](../src/runtime.js) | 新增字串、陣列、型別、freeze 與 trap 的宿主實作。 | 提供基本值操作，讓編譯決策留在 guest。 |
| [guest-data.js](../src/guest-data.js) | 新增資料複製。保留 aliases、cycles 與特殊 scalar，拒絕函式與 accessor。 | 傳入來源與取回 program 時，不攜帶任意宿主物件能力。 |

### 工具與驗證

| 檔案或群組 | 工作 | 目的 |
|---|---|---|
| `bootstrap-manifest.json`、`build-bootstrap.mjs` | 固定來源順序、檢查 import、產生 S 與來源摘要。 | 讓來源組合可重建。 |
| `bootstrap-source.mjs`、`check-bootstrap-source.mjs` | 檢查來源子集，提供獨立 CLI。 | 阻止 closure、方法呼叫等能力重新混入。 |
| `artifact.mjs` | 帶型別 encoding、decode 與第一個差異路徑。 | 保留 undefined、NaN、infinities 與負零。 |
| `verify-self-hosting.mjs` | 建立世代、比對四階段與 corpus、保存失敗資料。 | 把自舉主張變成可重跑的驗收。 |
| `bootstrap-config.mjs` | 固定有限預算與 deadline。 | 讓通過條件與資源用量可檢查。 |
| `check-syntax.mjs` | 每個 JavaScript 檔案各自執行 syntax check。 | 避免 shell 展開後只檢查第一個檔案。 |
| `tests` 與固定 corpus | 明確期望值、固定 diagnostics、malformed bytecode、資源與資料邊界。 | 避免只靠 compiler 世代互相比對。 |
| `studio-smoke.mjs` | 真實瀏覽器執行控制流、diagnostic、迴圈與遞迴。 | 確認 Studio 的操作路徑仍可用。 |

Studio 沒有新增瀏覽器自舉操作流程。
本次主要變更在 engine 與 Node 工具。
README、契約與實作紀錄則補上新格式及驗收用法。

[下載這張 SVG](assets/self-hosting-implementation/02-compiler-pipeline.svg)。

## D 目前支援哪些 JavaScript 語法 {meta="受控子集，不是完整 ECMAScript"}

以下依目前 lexer、parser、analyzer 與 VM 的實作整理。
「可支援」仍須遵守這個子集的語意與限制。

| 類別 | 目前可支援 | 重要限制 |
|---|---|---|
| Scalar | number、boolean、string、null、undefined。 | Number 字面值為十進位整數或小數。 |
| 宣告 | `let x = 1;`、`const x = 1;`。 | 每次宣告一個 binding，且需要 initializer。沒有 `var`。 |
| 名稱與 scope | ASCII 識別字、`_`、`$`、block shadowing、TDZ、const 寫入檢查。 | 識別字不支援 Unicode 字母。不能覆蓋保留的 runtime 名稱。 |
| 一元運算 | `!`、一元 `+`、一元 `-`。 | 沒有 `typeof` 語法；型別查詢使用列明的 runtime 操作。 |
| 二元運算 | `+`、`-`、`*`、`/`、比較與嚴格相等。 | 沒有 `%`、`**`、bitwise、`==` 或 `!=`。 |
| 字串 | 單引號、雙引號、串接、比較、index read、length。 | UTF-16 語意；不提供一般字串方法呼叫。 |
| 短路 | `&&` 與 `\|\|` 依需要計算右側，並回傳 operand。 | 沒有 `??` 或三元條件式。 |
| 賦值 | `x = value`、鏈式賦值、field 與 index 賦值。 | 沒有 `+=`、`++`、destructuring。 |
| 控制流 | block、`if`、`else if`、`else`、`while`。 | 分支與迴圈本體必須使用大括號。 |
| 陣列 | Dense array literal、index read/write、length、巢狀資料。 | 可覆寫或在尾端加一項；不能製造 holes，length 不能寫入。 |
| Record | 固定 key 的 literal、dot 與 bracket 讀寫。 | key 使用名稱或字串；不能新增欄位，不能使用 getter、prototype。 |
| 函式 | 頂層具名 function、一般參數、直接具名呼叫、前向呼叫與遞迴。 | 引數數量必須完全符合 arity。函式不能當值傳遞。 |
| 回傳 | 函式內 `return expression;` 或 `return;`。 | 沒有顯式回傳時得到 undefined。頂層 return 是來源錯誤。 |
| 註解與空白 | `//`、`/* */`、JS whitespace、NBSP、BOM。 | Diagnostic offset 以 UTF-16 units 計算。 |

字串 escape 包含 `\\`、`\'`、`\"`、`\n`、`\r`、`\t`、`\b`、`\f`、`\v`、`\0` 與 `\uXXXX`。
NaN、Infinity 與負零可由運算產生，且可保存在產物內。
`NaN` 與 `Infinity` 不是預設的全域 binding。

### 已延後或不支援的用法

| 類別 | 目前狀態 | 對寫程式的影響 |
|---|---|---|
| Closure、nested function、arrow、callback | no 延後 | 把 helper 提升到頂層，以參數傳入 context。 |
| `for`、`for-of`、`switch`、`break`、`continue` | no 不支援 | 改用 while、條件與明確狀態。 |
| Default/rest parameters、spread、computed keys、shorthand | no 不支援 | 明列參數與 record 欄位。 |
| Template literal、regexp literal、class、`new` | no 不支援 | 使用字串串接及子集資料結構。 |
| `throw`、`try`、`catch` | no guest 例外機制未實作 | 來源錯誤回傳 diagnostic；runtime trap 中止呼叫。 |
| 執行期 `import`、`export` | no 不支援 | Compiler 只靠固定 manifest 靜態打包。 |
| Promise、async、await、generator | no 不支援 | Guest 只有同步執行流程。 |
| 一般標準函式庫與方法呼叫 | no 不支援 | 沒有任意 `Math`、`console`、Map 或 `a.push()`。 |
| Hex、exponent、BigInt、Symbol | no 不支援 | Number literal 只用目前的十進位形式。 |

陣列 append 使用 `rtPush(a, value)` 這類固定操作。
這些名稱屬於引擎 runtime ABI，不是標準 JavaScript API。
Record 缺少欄位時讀到 undefined，寫入新欄位則 trap。
`__proto__`、`constructor`、`toString` 都只代表 own data。

### 一般程式的結尾規則

Declaration 與 expression statement 都必須以分號結尾。
整份程式必須以 expression statement 結尾。
最後一個 expression 的值就是 `run` 的結果。
Compiler bundle 以明確的 `0;` 滿足這個規則。

```js
let box = { values: [1, 2, 3] };
let i = 0;
let total = 0;
while (i < box.values.length) {
    total = total + box.values[i];
    i = i + 1;
}
total; // VM 結果為 6
```

來源：[Bootstrap grammar 與語意](specs/0005-bootstrap-contract.md)、[合法與非法 corpus](../tests/fixtures/self-hosting/corpus.js)。

## E Bytecode 與 VM 怎麼改，遞迴為什麼不會覆寫 locals {meta="SVG 03 · 呼叫與返回"}

Bytecode 從 v1 升為 v2，新增 function table。
Main slots 作為 globals；每個 function call 另外建立 locals。
所有函式共用常數池，各自持有 code 與 slotCount。

```text
BytecodeProgram
  version: 2
  constants: scalar[]
  code: main opcode 與 operand 陣列
  slotCount: main 的 global slot 數量
  functions:
    name、arity、slotCount、code
```

| 新 opcode | 工作 | 為什麼 compiler 需要它 |
|---|---|---|
| `MakeArray` | 收集 stack 上的元素建立 dense array。 | 建立 tokens、AST 清單、scope 表與 code。 |
| `MakeRecord` | 收集 key/value pairs 建立 own-field record。 | 建立 token、node、binding、context 與 CompileResult。 |
| `GetProperty` | 讀取 field、index 或 length。 | 存取 compiler 的輸入與中間資料。 |
| `SetProperty` | 更新已有 field 或合法 array index，保留賦值結果。 | 推進 position、設定 binding、修補 jump。 |
| `Call` | 依 function index 與 arity 建立 frame。 | helper、遞迴與整體 compiler 入口。 |
| `Builtin` | 依固定 intrinsic ID 呼叫宿主基礎操作。 | 字串 slice、append、freeze 與 trap。 |
| `LoadGlobal` | 讀取 main slots，檢查初始化。 | 函式讀取共用 opcode 或 token 定義。 |
| `StoreGlobal` | 寫入 main slots。 | 讓函式更新合法的頂層 mutable binding。 |

原有的 21 個 opcode 保留編號，加上 8 個新指令，共 29 個。
`while` 以原有 Jump 與 JumpIfFalse 組成。
`&&` 與 `||` 也以跳躍保留短路，不會預先計算兩側。

### 以 sumTo(5) 看 frame 隔離

```js
function sumTo(n) {
    if (n === 0) { return 0; }
    let saved = n;
    let rest = sumTo(n - 1);
    return saved + rest;
}
sumTo(5); // VM 結果為 15
```

```sequence num
participants: main, frame-n5, frame-n4, frame-n3
main -> frame-n5: CALL sumTo(5)
note frame-n5: n=5，saved=5，rest 等待返回
frame-n5 -> frame-n4: CALL sumTo(4)
note frame-n4: n=4，saved=4，rest 等待返回
frame-n4 -> frame-n3: CALL sumTo(3)
note frame-n3: 後續 n=2、1、0 的呼叫在此省略
frame-n3 --> frame-n4: RETURN 6
frame-n4 --> frame-n5: RETURN 10
frame-n5 --> main: RETURN 15
```

每個 frame 保存自己的 code position、locals、初始化 Set 與 stack base。
Call 消耗參數，Return 留下一個值並還原呼叫端的 stack 邊界。
因此子函式不會消耗或覆寫呼叫端的 locals 與 operand。

| Frame | 參數 n | 自己的 saved | 遞迴回傳 rest | 返回值 |
|---|---|---|---|---|
| n=5 | 5 | 5 | 10 | 15 |
| n=4 | 4 | 4 | 6 | 10 |
| n=3 | 3 | 3 | 3 | 6 |
| n=2 | 2 | 2 | 1 | 3 |
| n=1 | 1 | 1 | 0 | 1 |
| n=0 | 0 | 未初始化 | 未初始化 | 0 |

Verifier 驗證所有 function bodies 與參照，即使分支不會執行。
Stack underflow 與 slot 初始化檢查則由 VM 執行時處理。
兩者分工不同，不能把 verifier 描述成完整靜態型別證明。

[下載這張 SVG](assets/self-hosting-implementation/03-call-frames.svg)。
來源：[bytecode 定義](../src/bytecode.js)、[VM](../src/vm.js)、[verifier](../src/verifier.js)。

## F Compiler 與宿主的邊界，以及三種公開 API {meta="SVG 04 · 執行責任"}

自舉搬動的是 compiler 演算法的執行位置。
VM、verifier、有限 runtime 與 Node 工具仍由宿主執行。
宿主 JavaScript 引擎仍管理底層物件與記憶體。

```flow TB
Node工具 -> VM與verifier: 載入 compiler bytecode
VM與verifier -> Guest四階段: 解譯指令
Guest四階段 -> 固定runtime-ABI: 直接呼叫列明的 symbol
固定runtime-ABI -> 宿主基礎操作: 12 個固定 ID
Guest四階段 -> CompileResult資料: program 或 diagnostics
 group 宿主執行: Node工具, VM與verifier, 固定runtime-ABI, 宿主基礎操作
 group VM內解譯: Guest四階段
```

### 宿主只提供有限的基礎操作

| 操作 | Symbols | 邊界 |
|---|---|---|
| 陣列 | `rtPush`、`rtPop` | 控制 dense array，不暴露一般方法查找。 |
| 字串與數字 | `rtSlice`、`rtNumber`、`rtCharCode`、`rtFromCharCode` | 操作 UTF-16 units，不決定 token 或 grammar。 |
| 空白分類 | `rtWhitespace` | 固定 JS whitespace 表；lexer 自己決定如何消耗來源。 |
| 型別與整數查詢 | `rtIsArray`、`rtType`、`rtIsSafeInteger` | 提供值查詢與公開邊界檢查。 |
| Freeze 與失敗 | `rtFreeze`、`rtTrap` | 保留 token freeze，遇到不可恢復錯誤時中止。 |

Builtin 返回基礎值，Guest 四階段繼續處理並產生 CompileResult。
Record 的讀寫由 VM 的 property 指令處理。
Lexer 的 token 決策、parser 的語法決策、binding 與指令選擇都在 guest。
目前沒有把這四個階段設成宿主 builtin。

### 使用者 API 與實際執行位置

| API | 做什麼 | 預設在哪裡執行 |
|---|---|---|
| `compile(source)` | 檢查來源型別，再呼叫相同的 compiler core。 | Node 或瀏覽器宿主 JS。 |
| `run(program, options)` | 執行 main code，取回最後的結果。 | JumpJet VM。 |
| `invoke(program, name, args, options)` | 初始化乾淨的 main 狀態，再呼叫既有頂層具名入口。 | 指定函式在 JumpJet VM。 |

```js
const result = compile("function add(a, b) { return a + b; } 0;");
if (result.ok) {
    invoke(result.program, "add", [2, 3]); // 5
}
// 自舉工具則呼叫：invoke(B1, "compileCore", [S], options)
```

每次 invoke 都建立乾淨狀態。
引數與回傳值只攜帶 scalar、dense array 與 plain record。
資料複製保留 aliases 與 cycles，且不讀取 accessor 值。

Compiler 的來源錯誤正常回傳 `{ok: false, diagnostics}`。
每筆 diagnostic 有 `stage`、`message`、`start`、`end`。
Runtime trap、無效宿主引數與無效 bytecode 走宿主錯誤路徑。

### 一般使用路徑仍保留

Node 與 Studio 的 `compile` 預設繼續直接執行 compiler core。
自舉驗收才明確載入 B1、B2、B3 呼叫 compiler 入口。
因此既有操作沒有被強制增加一層 guest 編譯成本。

[下載這張 SVG](assets/self-hosting-implementation/04-host-boundary.svg)。
來源：[公開 API](../src/index.js)、[runtime ABI](../src/runtime-symbols.js)、[資料複製](../src/guest-data.js)。

## G 驗收到底測了什麼，資源還剩多少 {meta="SVG 05 · 三層 oracle 與有限限制"}

```flow TB
獨立期望值 -> 執行與診斷驗證: 合法輸出、非法四欄位
宿主compiler -> 四階段對照: tokens、AST、bindings、bytecode
B1-B2-B3 -> 完整schema比較: version、constants、functions、slots
執行與診斷驗證 -> 通過驗收
四階段對照 -> 通過驗收
完整schema比較 -> 通過驗收
```

### 643 項檢查與 534 筆資源紀錄

固定 corpus 包含 20 個合法與 13 個非法案例。
每代另重複一組失敗與成功輸入，檢查狀態殘留。
534 筆是被記錄的執行次數，不是獨立測試數。
643 項則是驗收工具完成的比較與期望值檢查。

| 記錄的入口 | 執行次數 | 對照的資料 |
|---|---|---|
| `compileCore` | 108 | 完整 CompileResult，包含固定 S 與重複輸入。 |
| `tokenize` | 108 | Tokens 與 source spans。 |
| `parse` | 102 | AST 與 parser diagnostics。 |
| `analyze` | 87 | BoundProgram、slots 與 binding diagnostics。 |
| `emit` | 66 | 完整 bytecode schema。 |
| `run` | 63 | 由該代編譯的合法程式，核對獨立期望值。 |

階段失敗時不會進入後續階段，所以執行次數不同。
完整 `compileCore` 呼叫內部也會執行四階段。
上表的 phase 次數是額外直接呼叫的對照證據。

| 案例群組 | 檢查內容 |
|---|---|
| 值與控制流 | 算術、string escape、null、undefined、短路、array、record、while。 |
| 函式與 context | 遞迴、互相遞迴、forward call、globals、locals、失敗後成功。 |
| 來源邊界 | UTF-16、非 BMP、NBSP、BOM、longest match、EOF、來源與 AST 深度。 |
| Binding | constructor、toString、__proto__、shadowing、TDZ、const、未知名稱。 |
| VM 與 verifier | 不可達壞指令、jump boundary、錯誤參照、underflow、初始化與快照。 |
| 資料與產物 | 無 accessor、無 host function、特殊 scalar encoding、完整 schema 比較。 |
| 失敗命令 | Budget、deadline、reference artifact 的 arity 差異、非零退出與重現資料。 |

### 實測自編譯用量

以下是保存報告中的實際值。
計費工作包含 opcode、資料與依長度計算的基礎操作。
它與 guest 指令數是兩個不同欄位。

```limits
單次自編譯工作 | 23191393 / 100000000 | 工作單位
S 自編譯最高 call depth | 57 / 1024 | 層
深度 diagnostic 最高 call depth | 643 / 1024 | 層
保存報告總耗時 | 5.705 / 60 | 秒
來源 S 長度 | 46386 / 1000000 | UTF-16 units
```

| 自編譯世代 | Guest 指令 | 計費工作 | Builtin 呼叫 | 最高 frame | 保存的耗時 |
|---|---|---|---|---|---|
| B1 | 13,307,643 | 23,191,393 | 198,956 | 57 | 630.563 ms |
| B2 | 13,307,643 | 23,191,393 | 198,956 | 57 | 663.068 ms |
| B3 | 13,307,643 | 23,191,393 | 198,956 | 57 | 597.651 ms |

一般 run 預設預算仍為 1,000,000。
自舉工具明確設定每次呼叫 100,000,000。
來源與 AST 的深度上限各為 128。
自舉的 call depth 上限為 1,024，與語法深度不同。

整體 worker deadline 為 60 秒。
父程序可以終止 worker，內部也會檢查已經過的時間。
計時使用 monotonic clock，避免 UTC 校正影響結果。
這些耗時是單次保存的觀察，沒有建立跨引擎效能基準。

### 怎樣判定失敗

任何 trap、超額、診斷差異或產物差異，都讓驗收以非零狀態退出。
失敗時會保存來源，並標記 stage、case 與 generation。
比較失敗另保存兩份比較值及第一個差異欄位。
Hash 供索引使用，通過條件仍是完整內容比較。

[下載這張 SVG](assets/self-hosting-implementation/05-acceptance-proofs.svg)。
來源：[驗收程式](../scripts/verify-self-hosting.mjs)、[資源設定](../scripts/bootstrap-config.mjs)、[失敗測試](../tests/self-hosting-failures.test.js)。

## H 對整個 bytecode engine 的影響 {meta="已實作能力、代價與後續約束"}

| 面向 | 這次的具體影響 | 實際意義與代價 |
|---|---|---|
| 語言能表達的程式 | 從 scalar 與條件式，擴展到資料、迴圈與直接函式。 | 引擎已能執行自己的 compiler 工作量。 |
| Compiler 架構 | 演算法可在宿主與 guest 執行，狀態由 context 明確保存。 | 減少對宿主高階語法的依賴，也增加明確參數與迴圈。 |
| Bytecode 契約 | v2 有 function table、資料指令與 global 參照。 | v1 產物會被拒絕，舊來源需重新編譯。 |
| VM 執行模型 | 從單一 locals，改為 globals 加各次呼叫的 frame。 | 能支援遞迴，也必須管理 stack base、返回值與 call depth。 |
| 驗證與信心 | 自身 compiler 成為固定的端到端工作量。 | 修改語法、emitter 或 VM 後，可用自舉流程發現跨模組差異。 |
| 宿主依賴 | 四個編譯演算法可經 bytecode 執行。 | VM、runtime、verifier、I/O 與底層記憶體仍依賴宿主。 |
| 效能 | 多了一條由 VM 解譯 compiler bytecode 的編譯路徑。 | 需要有限的較大預算；本次未證明比宿主 compiler 更快。 |
| 可移植性 | Compiler 可以 bytecode 形式交付。 | 若未來移植 VM，仍須實作相同 ABI、UTF-16 與值語意。 |
| 維護方式 | S 來源集合、intrinsic ID 與 bytecode schema 都被固定。 | 修改這些契約後，須重建世代並重跑 corpus。 |
| 使用者體驗 | 原本 compile、run 與 Studio 仍可使用。 | 新增具名 invoke；瀏覽器自舉 UI 尚未提供。 |

### 這次完成後的工程規則

新增 compiler 語法用法前，先讓子集檢查通過。
新增 opcode 或 intrinsic 時，同步修改 emitter、verifier、VM 與測試。
變更可執行 schema 時，重新評估 bytecode version。
重建 S 之後，讓新 B1、B2、B3 對同一份 S 形成固定點。

三代一致仍可能共享相同錯誤。
獨立語言 oracle 與既有回歸測試提供額外檢查。
現有 corpus 並不窮盡所有輸入，也不代表完整 JS 相容性。

### 重跑與追查

```sh
npm run verify:self-hosting
npm run check:bootstrap
npm run build:bootstrap
```

第一個命令包含回歸、syntax check、兩個 demo 與三代驗收。
Studio 冒煙需依 README 另開真實瀏覽器執行。
原始產物位於 `output/self-hosting/verification/`。

| 來源或產物 | SHA-256 縮寫 |
|---|---|
| Compiler 來源 S | `54456a9abc9f…a5216937` |
| B1、B2、B3 的 tagged encoding | `4fcf2c590dbc…300612bf` |

完整 SHA-256 保存在本頁資料快照與原始 report。
本頁由保存的 report、產物、目前來源及實作紀錄建立。
回歸與 syntax check 數字是紀錄值，不是 report.json 的欄位。
產物統計與用量則由建頁工具讀取，沒有用示意值替代。

[原始實作紀錄](plans/self-hosting-implementation.md) · [驗收 JSON](../output/self-hosting/verification/report.json) · [本頁資料快照](assets/self-hosting-implementation/evidence.json) · [建頁工具](../scripts/render-self-hosting-report.mjs) · [原始內容稿](plans/self-hosting-visualized.am.md)
