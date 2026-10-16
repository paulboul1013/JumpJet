---
template: doc
theme: blueprint
title: JumpJet bytecode engine 架構檢查
subtitle: 保留現有分層，先修正名稱綁定與 VM 輸入契約
date: 2026-10-16
scope: 目前工作目錄，包含未提交的 analyzer 與控制流實作
---

## A 架構方向可以保留

這是修正前的歷史報告。
後續修正與照片請讀 [修正證據](../pstack-bytecode-fixes/report.html)。
重現腳本改為使用保存的修正前 source 快照。

JumpJet 已有完整的 source-to-bytecode-to-result 流程。
analyzer 分離名稱語意，compiler 負責指令生成。
這個邊界適合目前的 number、boolean 與 if 語言切片。

目前最值得處理的是正確性與執行邊界。
我建議先修正 scope 綁定、關鍵字查找與 bytecode 驗證。
新增函式之前，再定義 call frame 與變數生命週期。

本次檢查採用 pstack 的 how、unslop 與驗證原則。
只新增報告與重現腳本，沒有修改 engine。

## B 真正的入口與模組責任

```flow LR
source -> lexer: tokens 與 span
lexer -> parser: syntax AST
parser -> analyzer: 名稱與 scope
analyzer -> compiler: bound AST 與 slot
compiler -> VM: bytecode program
VM -> result: number 或 boolean
```

瀏覽器的 compileAndRun 呼叫公開的 compile，再呼叫 run。
compile 依序執行各 phase，遇到 diagnostics 就返回。
run 直接委派 execute。

| 模組 | 擁有的責任 | 對後續階段的承諾 |
|---|---|---|
| lexer | 字元、關鍵字、最長運算子辨識 | tokens 附來源範圍 |
| parser | precedence、associativity、statement 結構 | syntax AST 保留名稱 |
| analyzer | scope、const、初始化檢查、slot 分配 | bound AST 的識別字已換成 slot |
| compiler | 指令選擇、stack 配平、jump 回填 | 產生可供 VM 執行的 program |
| VM | program 邊界檢查與指令執行 | 對合法程式返回值 |

這些依賴沒有形成循環。
compiler 不重做名稱查找，VM 也不依賴 AST 或 DOM。
這是目前設計最值得保留的部分。

依據：[公開入口](../../src/index.js)、[瀏覽器入口，第 95 行](../../web/app.js)、[analyzer](../../src/analyzer.js)、[compiler](../../src/compiler.js)。

## C Bytecode 與執行狀態

program 有 version、constants、code 與 slotCount。
code 是平坦的 JavaScript number array，沒有二進位編碼。
共有 21 個 opcode，使用零個或一個 operand。
jump target 是 code array 的絕對 index。

每次 execute 都建立自己的 operand stack、slots 與 initializedSlots。
instructionPointer 指向下一個待讀位置。
各次執行沒有共用 VM 可變狀態。

例如，賦值先產生值，再 Duplicate，最後 StoreSlot。
StoreSlot 取走副本，原值保留作為賦值運算結果。
一般 expression statement 用 Pop 丟棄結果。
最後一個頂層 expression statement 用 Return 返回結果。

analyzer 為每個宣告分配唯一 slot，離開 block 不回收。
目前沒有函式呼叫、call frame、closure 或物件 heap。
數值運算直接使用宿主 JavaScript 的運算子。
目前也尚未 self-host。

依據：[opcode 定義](../../src/bytecode.js)、[指令生成，第 69 行](../../src/compiler.js)、[執行狀態，第 30 行](../../src/vm.js)、[現行規格](../../docs/specs/0003-control-flow-and-semantic-analysis.md)。

## D 語意層有兩個可重現問題

### 優先修正：內層宣告前的引用會綁到外層

```js
let value = 1;
{
	value = 2;
	let value = 3;
}
value;
```

JumpJet 成功編譯並返回 2。
同一段程式在 Node 會因 TDZ 拋出 ReferenceError。
analyzer 在走到宣告時才加入 binding。
因此，前面的賦值會解析成外層 slot。

最小修正是進入 scope 時先收集該 scope 的直接宣告。
所有 binding 起初都標成未初始化。
接著依序分析 statement，並更新初始化狀態。
這項責任應留在 analyzer。

現行規格明文描述 initializer 自我引用的 TDZ。
上述案例揭露的是與 JavaScript block scope 的語意落差。
規格也需要補上整個 block 的宣告可見範圍。

依據：[resolve，第 37 行](../../src/analyzer.js)、[宣告建立，第 129 行](../../src/analyzer.js)、[block traversal，第 169 行](../../src/analyzer.js)。

### 接著修正：關鍵字表讀到 Object prototype

`let constructor = 1; constructor;` 會編譯失敗。
`toString` 作為變數名稱也會失敗。
keywords 是一般 object，查找會讀到繼承的屬性。
Object.freeze 不會移除 prototype。

改用 Map，或用 Object.hasOwn 限制查找自己的 key。
這是 lexer 的責任，parser 不需要繞過錯誤 token。

依據：[keywords 定義，第 53 行](../../src/lexer.js)、[查表，第 148 行](../../src/lexer.js)。

## E VM 邊界驗證仍不完整

### Jump target 只檢查範圍

下面的 program 返回 42。
線性解碼的指令起點是 0、2、4、6。
target 5 指向 Constant 的 operand，VM 卻把它當作 Return。

```js
{
	version: 1,
	constants: Array(9).fill(42),
	code: [0, 0, 20, 5, 0, 8, 8],
	slotCount: 0
}
```

目前 compiler 產生的 jump 不會觸發這個案例。
缺口在公開 run 接受任意 program 的邊界。
最小修正是先解碼指令，再檢查 target 是否為指令起點。
code.length 作為 target 的既有政策可另行保留。

### 稀疏 constants 會讓 undefined 進入 VM

constants 為 new Array(1) 時，forEach 會跳過空洞。
Constant 0 因此取得 undefined，Return 也直接返回 undefined。
這違反目前 number 或 boolean 的值域契約。

改用逐 index 驗證，拒絕空洞或不合法的常數。
另外，Return 後方的未知 opcode 目前不會被檢查。
若承諾驗證整個 program，解碼階段就需要檢查不可達指令。
若只承諾檢查執行路徑，文件應明確說明。

依據：[constants 驗證，第 17 行](../../src/vm.js)、[jump 檢查，第 68 行](../../src/vm.js)、[Constant，第 86 行](../../src/vm.js)。

## F 執行控制需要明確的邊界

手寫 bytecode 的 Jump 0 會持續執行。
重現腳本由父行程在 750 ms 後終止子行程。
目前來源語法沒有 loop，compiler 也只產生向前跳躍。
因此，這項風險現在主要出現在直接呼叫 run。

瀏覽器在主執行緒同步執行 compile 與 run。
增加 loop 前，建議讓 execute 接受 instruction budget。
若需要使用者中止執行，再把工作移到 Worker。
主執行緒上的 timeout 無法中斷同步 execute。

目前還有可由 source 觸發的問題。
20,000 層括號會讓 compile 拋出 RangeError。
瀏覽器的 try 只涵蓋 run，無法顯示這個編譯例外。
可加入巢狀深度上限，並讓 UI 包住整個編譯執行流程。

依據：[VM loop，第 76 行](../../src/vm.js)、[parser 遞迴，第 106 行](../../src/parser.js)、[UI 例外邊界，第 95 行](../../web/app.js)。

## G 後續架構調整的順序

| 時機 | 建議 | 原因 |
|---|---|---|
| 現在 | 修正 scope 預先宣告與 keywords 查找 | 已影響現行語法的正確性 |
| 現在 | 補齊 bytecode 結構驗證 | run 是獨立的公開入口 |
| 現在 | 共用 opcode metadata | 指令寬度與 stack effect 目前散在實作中 |
| 加入 loop 前 | 定義 instruction budget 與中止方式 | execute 現在沒有執行上限 |
| 加入 function 前 | 定義 FunctionCode、Frame 與 capture | 單一 slots array 無法表達多次呼叫 |
| 加入 debugger 前 | 保留 bytecode offset 到 source span 的對應 | emitter 目前丟棄來源位置 |

共用 opcode metadata 可先包含 name、operand kind 與 stack effect。
解碼器、verifier 與 disassembler 可使用同一份資料。
指令的實際運算仍可保留在 VM switch。

目前不需要先增加通用 IR 或 JIT。
bound AST 已經把語意分析與指令生成分開。
slot 不重用、constant 不去重也有明確的簡化價值。
沒有量測結果前，我會保留這些取捨。

這些是建議，尚未存在於目前實作。
依據：[opcode 契約](../../src/bytecode.js)、[emitter 輸出，第 121 行](../../src/compiler.js)、[VM 狀態](../../src/vm.js)。

## H 驗證與重現

本次檢查使用 Node v24.21.0。
既有 npm test 的 7 個測試檔案全部通過。
npm run check 也通過。
另外逐檔執行 node --check，18 個 JavaScript 檔案全部通過。

[重現腳本](probe.mjs) 包含 9 項目前行為的斷言。
其中一項確認完整 source-to-result 流程。
其餘涵蓋上述缺口與驗證政策。
這些斷言記錄現況，不能當作修正後的驗收條件。

在 repo 根目錄執行：

```sh
node output/pstack-bytecode-review/probe.mjs
```

[本次重現輸出](observations.json) 保存每項觀察。
修正時應將相應案例改成預期正確行為的 regression test。
本次沒有修改既有 source、tests 或未提交的工作。
