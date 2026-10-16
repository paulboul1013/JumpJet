# JavaScript engine 的 compiler 與 interpreter 整合架構

查閱日期：2026-10-16

## 結論先行

JumpJet 現在的方向沒有偏離主流引擎。`source -> lexer -> parser -> analyzer -> bytecode emitter -> stack VM` 是一條完整而合理的 bytecode-first pipeline。V8、JavaScriptCore、SpiderMonkey 與 Hermes 都把 bytecode 放在前端和執行器之間。QuickJS 更簡單，compiler 直接產生 stack bytecode，再交給 interpreter。[V8 的 Ignition bytecode compiler 以 parser 產生的 AST 為輸入](https://v8.dev/blog/background-compilation)，[JavaScriptCore 的各 tier 共用 bytecode](https://webkit.org/blog/10308/speculation-in-javascriptcore/)，[SpiderMonkey 由 parser、BytecodeEmitter 產生 Stencil 和 bytecode](https://firefox-source-docs.mozilla.org/js/)，[Hermes 將 high-level IR 降成 register bytecode](https://github.com/facebook/hermes/blob/static_h/doc/Design.md)，[QuickJS 則不建立一般 parse tree IR，直接產生 bytecode](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3482-L3495)。

現階段最接近 JumpJet 的參考物不是完整 V8，而是 QuickJS 的小型 interpreter 架構，加上 Hermes 的 AOT bytecode 分工。V8、JavaScriptCore 和 SpiderMonkey 的多層 JIT 值得拿來定義邊界，但不值得現在照搬。成熟的 optimizing JIT 依賴 profiling、inline cache、machine-code backend 和 deoptimization；GC 也需要能辨認執行 frame 中的 roots。[V8 Maglev](https://v8.dev/blog/maglev)與 [SpiderMonkey optimization guide](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html)呈現了這些元件的關係。這些工作不會讓 JumpJet 更早達成 self-hosting。

我的建議是保留 stack VM 與 bound AST，下一步先把「程式」升級成「module 加多個 function」，再補齊 runtime、call frame、closure、object model、host API 與 bytecode verifier。等 self-hosting compiler 能穩定跑完，而且 profiler 證明 dispatch 是主要成本，再考慮 baseline JIT。

## 分類方式

「interpreter-only」、「bytecode-first」和「tiered JIT」不是同一維度。Bytecode-first 描述前端產物，另外兩者描述執行策略。一個引擎可以同時是 bytecode-first 與 tiered JIT。

| 引擎 | 前端共同格式 | 執行策略 | VM 形式 | 嵌入介面 |
|---|---|---|---|---|
| V8 | Ignition bytecode | tiered JIT：Ignition、Sparkplug、Maglev、TurboFan | register-based interpreter | C++ V8 API，`Isolate`、`Context`、handles |
| QuickJS | bytecode | interpreter-only，官方架構未列 JIT tier | stack VM | C API，`JSRuntime`、`JSContext`、`JS_Eval` |
| JavaScriptCore | JSC bytecode | tiered JIT：LLInt、Baseline、DFG、FTL | bytecode interpreter，加三層 JIT | C API 與 Objective-C API |
| SpiderMonkey | stack bytecode 與 Stencil | tiered JIT：C++ interpreter、Baseline Interpreter、Baseline Compiler、Warp/Ion | stack VM | C++ JSAPI |
| Hermes | AOT compact bytecode，或 Static Hermes native AOT | 可混用 bytecode interpreter、per-function lazy compilation、hot-function baseline JIT 與 native execution | register VM | C++ JSI |

V8 的 tier 名稱與次序來自 [Ignition 文件](https://v8.dev/docs/ignition)、[Sparkplug 官方文章](https://v8.dev/blog/sparkplug)及 [Maglev 官方文章](https://v8.dev/blog/maglev)。QuickJS 的 stack bytecode、interpreter 和 C API 來自[官方手冊](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi)。JavaScriptCore 的四層架構來自 [WebKit 的 JSC speculation 文件](https://webkit.org/blog/10308/speculation-in-javascriptcore/)。SpiderMonkey 的四個執行 tier 來自[官方 optimization 文件](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html)。Hermes 官方在 2025 年列出 bytecode AOT、native AOT、bytecode interpreter、per-function lazy compilation 和 hot-function baseline JIT，這些模式可在同一 runtime 混用。[Hermes compilation and runtime modes](https://github.com/facebook/hermes/blob/static_h/doc/blog/2025-11-02-hermes-compilation-runtime-modes.md) 目前 `static_h` 的 [`RuntimeConfig`](https://github.com/facebook/hermes/blob/static_h/public/hermes/Public/RuntimeConfig.h)已有 `EnableJIT`、`ForceJIT`、threshold 與 memory limit，但 `EnableJIT` 預設為 `false`，因此不應再把 2021 年「Hermes 沒有 JIT」的描述當成 2026 年全貌。

## 共通整合模型

五個引擎雖然規模不同，責任大致沿著以下邊界排列：

```text
source
  -> parser / early errors
  -> scope resolution and lowering
  -> bytecode or IR
  -> interpreter and optional JIT tiers
  -> runtime helpers, object model, host calls
  -> heap and garbage collector
```

Bytecode 不是單獨「會執行」的東西。Interpreter 讀取 opcode，更新 instruction pointer、frame、register 或 operand stack；遇到物件、字串、property access、例外或 host function 時，它會呼叫 runtime helper。JIT 也必須遵守相同語意，只是把一段 bytecode 轉成 machine code。JavaScriptCore 明確指出所有 tier 都以同一份 bytecode 為輸入，但每個 tier 可以用不同演算法實作相同 opcode；這讓效能提升，也使新增 opcode 必須同步更新多個 tier。[WebKit 官方說明](https://webkit.org/blog/10308/speculation-in-javascriptcore/)

GC 不在 compiler pipeline 裡，卻和 runtime、interpreter、JIT 緊密相連。Runtime 決定哪些值是 heap object、哪些位置是 roots，以及 native host object 如何被追蹤。JIT 又必須在 safepoint 提供正確 root map，並在 speculative assumption 失效時還原 interpreter 可理解的 frame。SpiderMonkey 的 bailout 會重建 Baseline Interpreter frame，[官方架構說明](https://firefox-source-docs.mozilla.org/js/)直接呈現這個契約。

## V8

### Pipeline

V8 parser 先產生 AST，Ignition bytecode compiler 再產生 `BytecodeArray` 與執行 metadata。[V8 background compilation 文件](https://v8.dev/blog/background-compilation)說明這個 AST 到 bytecode 的邊界。Ignition 是 register-based interpreter，實作使用 TurboFan backend 所提供的低階能力。[Ignition 官方文件](https://v8.dev/docs/ignition)

所有 JavaScript 先進入 Ignition bytecode。執行時收集 object shape、type 等 feedback。Sparkplug 直接線性掃描 bytecode，幾乎不建 IR，快速產生非最佳化 machine code。[Sparkplug 官方文章](https://v8.dev/blog/sparkplug) Maglev 位於 Sparkplug 與 TurboFan 之間，目標是較快完成中階最佳化；TurboFan 負責較昂貴的 peak-performance optimization。[Maglev 官方文章](https://v8.dev/blog/maglev)

這是一個明確的 tiered JIT：

```text
AST -> Ignition bytecode
         |-> Ignition interpreter
         |-> Sparkplug baseline machine code
         |-> Maglev fast optimizing machine code
         `-> TurboFan optimizing machine code
```

### Runtime、GC 與 embedding

V8 的 Orinoco 是 generational、moving/compacting GC，並使用 parallel、incremental 與 concurrent 技術。Young generation Scavenger 會平行處理 collection，major GC 則執行 marking、sweeping 和選擇性 compaction。[V8 Orinoco 官方解說](https://v8.dev/blog/trash-talk)

Embedder 使用 C++ API。`Isolate` 是具有自己 heap 的 VM instance，`Context` 是執行環境，`Local` 與 `Persistent` handles 讓 moving GC 能更新引用。Host 可以編譯及執行 script，也可以把 C++ object 和 method 暴露給 JavaScript。[V8 embedding guide](https://v8.dev/docs/embed)

### 對 JumpJet 的意義

V8 最值得借的是「bytecode 是 baseline execution 與最佳化 compiler 的共同契約」。不應現在借 Sparkplug、Maglev 或 TurboFan。JumpJet 尚未有 function-level compilation、object shape、type feedback、deoptimization metadata 或 native code backend，直接加 tier 只會同時增加多份 opcode 語意實作。

## QuickJS

### Pipeline

QuickJS 是最簡潔的對照。官方手冊說 compiler 不建立 parse-tree IR，而是直接產生 bytecode，接著在 bytecode 上做數個 optimization pass。它選擇 stack-based bytecode，理由是實作簡單且編碼緊湊；compiler 也會預先計算每個 function 的最大 stack size。[QuickJS internals](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3482-L3503)

`qjsc` 把 script 或 module 編成 bytecode，再把 bytecode 放進生成的 C source。系統 C compiler 最後把 engine、entry point 與 bytecode 組成 executable。這不是把 JavaScript 轉成 native code，而是把已編譯 bytecode 包進 native executable。[QuickJS executable generation](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3507-L3547)

官方文件只描述 bytecode interpreter，未定義 baseline 或 optimizing JIT tier。因此本報告把 QuickJS 分類為 interpreter-only、bytecode-first engine，而不是 tiered JIT。[QuickJS main features](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L2212-L2237)

### Runtime、GC 與 embedding

QuickJS 使用 reference counting，另有 cycle removal。`JSRuntime` 對應一個 object heap；同一 runtime 可有多個 `JSContext`，各 context 有自己的 global objects，而且 context 之間可分享 object。`JSValue` 的 native owner 必須用 `JS_DupValue` 與 `JS_FreeValue` 明確維護引用。[QuickJS C API 與 memory model](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3321-L3355)

Embedder 透過 `JS_Eval` 執行 source，也能用 `js_std_eval_binary` 執行 `qjsc` bytecode。Bytecode 格式綁定特定 QuickJS version，而且執行前不做安全驗證，所以官方警告不可載入不可信 bytecode。C API 也提供 native function、native class、memory limit、custom allocator 與 interrupt handler。[QuickJS evaluation and embedding](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3357-L3477)

### 對 JumpJet 的意義

QuickJS 證明小型 engine 不必先有 JIT 或大型 IR。它也提供兩個直接可採用的設計點：在 compile time 計算 `maxStack`，以及把 bytecode 視為 version-coupled 的內部格式。JumpJet 已經保留 AST 和 bound AST，這比 QuickJS 多一層，但這層正好服務清楚 diagnostics、語意分析與 self-hosting 教學目標，沒有刪除的必要。

## JavaScriptCore

### Pipeline

JavaScriptCore 由 parser 的 AST 產生 bytecode。LLInt 先解譯 bytecode 並收集 profiling 資訊；hot function 依序可進入 Baseline JIT、DFG JIT 與 FTL JIT。[WebKit type profiling 文件](https://webkit.org/blog/3846/type-profiling-and-code-coverage-profiling-for-javascript/)

四層的角色不同：

- LLInt 避免初次執行的 compilation cost。
- Baseline JIT 為每個 bytecode 產生 machine-code template，主要移除 interpreter dispatch overhead。
- DFG 將 bytecode 轉成 DFG IR，利用執行期 profile 做 speculative optimization。
- FTL 沿用 DFG pipeline，再加入更昂貴的 IR 與 backend optimization。

各層共用 bytecode、runtime slow path 與部分 inline-cache support，但同一 opcode 在不同 tier 可以有不同實作。[JavaScriptCore tier architecture](https://webkit.org/blog/10308/speculation-in-javascriptcore/)

### Runtime、GC 與 embedding

JavaScriptCore 的 collector 是 generational GC。其 marking 可以和 mutator 並行，也會平行使用 marking threads；其他階段仍需要停止 mutator 與 compiler threads。[WebKit GC 解說](https://webkit.org/blog/12967/understanding-gc-in-jsc-from-scratch/) Riptide 的官方介紹補充了 sticky mark bits、concurrent marking、parallel marking 與 conservative stack scanning 的取捨。[Riptide 官方文章](https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/)

JavaScriptCore 提供 C API 和 Apple 平台的 Objective-C API。C API 以 `JSContextGroupRef`、`JSGlobalContextRef` 管理 context；Objective-C 的 `JSContext` 提供 `evaluateScript`、global object 與 exception handling。[JSC C API header](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/API/JSContextRef.h) [JSC Objective-C API header](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/API/JSContext.h)

### 對 JumpJet 的意義

JavaScriptCore 最重要的提醒是 opcode 數量會造成跨 tier 維護成本。能用現有 opcode 的組合表達語法時，先 lowering 或 desugaring。只有新語意無法保持原子性、效能或正確 exception behavior 時才新增 opcode。JumpJet 雖然只有一個 interpreter，也應現在建立 opcode specification 與 verifier，讓未來新增 backend 時不必猜測既有指令契約。

## SpiderMonkey

### Pipeline

SpiderMonkey parser 暫時產生 AST，`BytecodeEmitter` 產生 bytecode 與 metadata，兩者組成不依賴 GC heap 的 Stencil。Stencil 接著被 instantiate 成 execution engine 可用的 GC cells。Parser 預設可 lazy parse inner function，先完成 early-error checking，第一次執行時再 delazify 並產生完整 bytecode。[SpiderMonkey component overview](https://firefox-source-docs.mozilla.org/js/)

SpiderMonkey 的 bytecode 是 stack-based。執行 tier 依序是 C++ interpreter、帶 inline caches 的 Baseline Interpreter、把整份 script bytecode 轉成 machine code 的 Baseline Compiler，以及最高層 optimizing compiler。現行文件以 Warp frontend 擷取 bytecode 與 IC snapshot，轉成 Ion MIR，再降成 LIR，完成 register allocation 和 code generation。Speculation 失效時會 bailout 回 Baseline Interpreter。[SpiderMonkey optimization guide](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html)

SpiderMonkey 對新增 bytecode 有明確準則。優先使用 self-hosted intrinsic 或把新語法 desugar 成既有 opcode。新 opcode 應保持 atomic，才能正確處理 bailout 與 exception；對動態型別行為則最好能設計 inline cache。[SpiderMonkey bytecode checklist](https://firefox-source-docs.mozilla.org/js/bytecode_checklist.html)

### Runtime、GC 與 embedding

SpiderMonkey 的 GC 是 precise、incremental、generational、partially concurrent、parallel、compacting，而且 heap 依 zone 分區。C++ stack roots 透過 wrapper 與 static analysis 檢查；embedder 必須遵守 rooting API。[SpiderMonkey GC overview](https://firefox-source-docs.mozilla.org/js/gc.html)

SpiderMonkey 是可嵌入的 C++ library，host 透過 JSAPI 建立和操作 value、object、realm 與 script。Mozilla 維護獨立的 embedding examples 和 migration guide，因為 JSAPI 會隨 ESR 改變。[SpiderMonkey embedding resources](https://github.com/mozilla-spidermonkey/spidermonkey-embedding-examples) [SpiderMonkey 官方入口](https://spidermonkey.dev/)

### 對 JumpJet 的意義

Stencil 的概念適合 JumpJet 後續採用：把 compile-time module data 和 runtime heap object 分開。Bytecode module 應保持純資料、可驗證、可序列化；載入後才建立 function closure、global environment 和其他 runtime object。這個邊界也會讓 compiler 能在 Node bootstrap host 或 JumpJet VM 中執行，而不必依賴正在執行的 heap。

## Hermes

### Pipeline

Hermes 的經典路徑以 mobile startup 為目標。Source 經 parser、IR generation、SSA-based high-level IR、optimization、lowering 和 register allocation，最後形成 variable-length register bytecode。[Hermes IR reference](https://github.com/facebook/hermes/blob/static_h/doc/IR.md) [Hermes design overview](https://github.com/facebook/hermes/blob/static_h/doc/Design.md)

Hermes bytecode file 含 header、function table、string table、function bytecode、exception table 及其他 metadata。Runtime 載入後建立 `BytecodeModule`、`RuntimeModule`、`CodeBlock` 和 `JSFunction` 之間的 ownership 關係，讓 GC-managed function 能保持其 backing bytecode 存活。[Hermes bytecode format and VM integration](https://github.com/facebook/hermes/blob/static_h/doc/Design.md#bytecode-file-format)

React Native release build 會在 build time 把 JavaScript 編成 Hermes bytecode，device 啟動時直接載入。[React Native Hermes guide](https://reactnative.dev/docs/hermes) Hermes CLI 也把 `hermesc` compiler 和只執行 bytecode 的 `hvm` 分開，這是 compiler/runtime separation 的直接例子。[Hermes building and running](https://github.com/facebook/hermes/blob/static_h/doc/BuildingAndRunning.md)

Hermes 在 2021 年明確選擇不做 JIT，主因是 mobile workload 的 warm-up、binary size 與 memory cost。[React Native 官方文章](https://reactnative.dev/blog/2021/10/26/toward-hermes-being-the-default) 2025 年的官方架構已加入 typed 或 untyped JS 的 bytecode AOT、native AOT、bytecode interpreter、首次呼叫 function 時的 lazy source-to-bytecode compilation，以及 hot-function baseline JIT。這些模式可以存在於同一 runtime。[Hermes compilation and runtime modes](https://github.com/facebook/hermes/blob/static_h/doc/blog/2025-11-02-hermes-compilation-runtime-modes.md) `static_h` 的 [`RuntimeConfig`](https://github.com/facebook/hermes/blob/static_h/public/hermes/Public/RuntimeConfig.h)提供 JIT 開關、threshold 與 memory limit，2026 release note 也提到擴大 JIT coverage。[2026 Hermes release note](https://github.com/facebook/hermes/blob/static_h/doc/blog/2026-06-05-new-hermes-stable-release.md) 因此目前較準確的分類是「AOT-first、多種 execution mode 可混用」，不是永久的 interpreter-only engine。官方資料描述的是 baseline JIT，不是 V8 或 JSC 那種多層 optimizing JIT。

### Runtime、GC 與 embedding

Hades 是 mostly concurrent GC。Young generation 沿用 copying collection；old generation 使用 snapshot-at-the-beginning mark-sweep，多數工作在 background thread 執行。這降低 pause，但 write barrier、free-list allocation 與 fragmentation 會付出 throughput 或 memory 代價。[Hades 官方介紹](https://reactnative.dev/blog/2021/10/26/toward-hermes-being-the-default)

Hermes 透過 C++ JSI 與 host 整合。JSI 是 runtime abstraction，native code 可以操作 JS value、註冊 host function 和 host object、載入 source 或 bytecode。2025 年 Hermes 已把 JSI 稱為 stable interface，並要求 extension 透過 JSI 而不是 internal API。[Hermes JSI extension announcement](https://github.com/facebook/hermes/blob/static_h/doc/blog/2025-12-12-new-way-to-contribute.md)

### 對 JumpJet 的意義

Hermes 最適合 JumpJet self-hosting 的地方，是把 compiler artifact 和 runtime loader 明確分開。JumpJet 應讓 bootstrap Node process 產生 versioned bytecode module，JumpJet runtime 只驗證、載入和執行。這比在 `execute()` 內隱含呼叫 parser 或 analyzer 更容易測試，也能證明 self-hosting compiler 真正跑在 JumpJet VM 上。

## 與目前 JumpJet 的逐項對照

目前 JumpJet 的 public flow 已由 [`src/index.js`](../../src/index.js)串接 lexer、parser、analyzer、emitter 和 VM。Analyzer 把名稱解析成 numeric slot，[`src/analyzer.js`](../../src/analyzer.js)負責 scope、TDZ、`const` 與 slot allocation；[`src/compiler.js`](../../src/compiler.js)只走訪 bound nodes 並產生 bytecode；[`src/vm.js`](../../src/vm.js)執行 stack machine。這個分工接近成熟引擎的 frontend、bytecode contract、execution engine 三段式切法。

| JumpJet 現況 | 成熟引擎中的對應 | 判斷 |
|---|---|---|
| syntax AST 加 bound AST | V8 AST 到 bytecode、Hermes IR、SpiderMonkey Stencil 前的 frontend | 保留。現在不需新增 general-purpose SSA IR |
| numeric slots | Hermes 的 static scope resolution、一般 VM 的 frame locals | 正確方向。Functions 加入後把 slot 歸屬改成 per-function frame |
| stack bytecode | QuickJS 與 SpiderMonkey stack VM | 保留。Stack VM 不會阻礙未來 baseline JIT |
| 單一 `code` array | 成熟引擎的 per-function code object | 下一個應拆。Self-hosting 需要 function table、closure 與 call frame |
| JS primitive 直接當 VM value | runtime value representation 的 bootstrap 替代品 | 短期可用。加入 object identity、`undefined`、`null` 和 closure 前要定義 Value contract |
| `execute(program)` 內含所有 VM state | engine runtime 加 execution frame 的簡化版 | 應拆成 `Runtime`、loaded module、frame/VM 三個責任 |
| VM 只做局部 operand 檢查 | QuickJS 警告 untrusted bytecode、成熟引擎的 loader verification 邊界 | 應加完整 verifier，再談持久化 bytecode |
| 沒有 JIT | QuickJS 與早期 Hermes | 現階段正確。先完成語言與 self-hosting |

## 建議的 JumpJet 目標架構

### 現階段

```text
source
  -> lexer
  -> parser
  -> analyzer / binder
  -> bound AST
  -> bytecode emitter
  -> BytecodeModule
       - version
       - constants
       - function table
       - code per function
       - localCount / maxStack
       - source locations
  -> verifier
  -> loader
  -> Runtime
       - globals
       - heap values
       - host functions
       - loaded modules
  -> VM
       - call frames
       - operand stacks
       - instruction pointers
```

具體變更順序如下：

1. 先建立 instruction decoder 與 bytecode verifier。Verifier 應檢查 opcode boundary、operand range、jump target 是否落在 instruction boundary、所有 CFG path 的 stack height 是否一致、return 是否有值，以及 `maxStack` 是否足夠。QuickJS 會在 compile time 計算 function 最大 stack size，[官方手冊](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3482-L3499)證明這項 metadata 對 stack VM 很實用。
2. 把 `BytecodeProgram` 升級成 `BytecodeModule`，每個 function 有自己的 `code`、arity、local count、max stack 和 source metadata。Hermes 與 SpiderMonkey 都以 function 或 script 作為 compilation 和 execution unit。[Hermes function table](https://github.com/facebook/hermes/blob/static_h/doc/Design.md#bytecode-file-format) [SpiderMonkey script unit](https://firefox-source-docs.mozilla.org/js/)
3. 把 runtime 和 frame 拆開。Runtime 持有 global environment、host bindings、module registry 與未來 heap；frame 持有 function、instruction pointer、locals、operand stack 與 caller link。
4. 定義 embedding API，而不是讓 UI 或 Node code 直接碰 VM internals。最小介面可包含 `compile(source)`、`load(module)`、`evaluate(source)`、`call(functionValue, args)`、`defineHostFunction(name, fn)` 和 `drainJobs()`。V8、QuickJS、JSC、SpiderMonkey 與 Hermes 都把 context/runtime 和 script evaluation 放在公開嵌入邊界，而非 compiler internal。
5. 繼續使用 bound AST 做 name resolution。等 closure conversion、control-flow optimization 或多 backend 確實需要共用表示，再評估 CFG IR。QuickJS 沒有一般 parse-tree IR 也能形成完整 engine，[官方設計](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3482-L3489)支持延後這項工作。

### Self-hosting 所需階段

JumpJet 的 ADR 將 self-hosting 定義為「JumpJet compiler source 被編成 JumpJet bytecode，再由 JumpJet VM 執行」。[`docs/adr/0001-language-and-execution-model.md`](../adr/0001-language-and-execution-model.md) 這要求的不是 JIT，而是 compiler 自身所用語言功能與 runtime library。

建議依 compiler 實際依賴補功能，不要依 ECMAScript 章節順序實作：

1. Functions、parameters、`return`、call frame 與 recursion。
2. Strings、arrays、plain objects、property get/set 和基本 built-ins。
3. Lexical closures、environment objects 與 captured binding。
4. `while` 或 `for`、`break`、`continue`、logical operators 和 short-circuit。
5. `undefined`、`null`、function value、object identity 與完整 truthiness contract。
6. 只有 compiler source 確實使用時，再加入 exception、class、module syntax 或 async behavior。

每加入一項語法，優先 lowering 成既有 bound node 或 opcode sequence。SpiderMonkey 和 JavaScriptCore 都提醒，新 opcode 會增加每個 execution tier 的維護成本。[SpiderMonkey checklist](https://firefox-source-docs.mozilla.org/js/bytecode_checklist.html) [JavaScriptCore tier architecture](https://webkit.org/blog/10308/speculation-in-javascriptcore/)

### Bootstrap 驗證

Self-hosting 應用三階段 bootstrap 驗證，而不是只看一個 sample 結果：

```text
stage 0: Node 執行目前的 JumpJet compiler source
         -> 編譯 compiler source，產生 stage-1 bytecode

stage 1: JumpJet VM 執行 stage-1 compiler
         -> 再次編譯同一份 compiler source，產生 stage-2 bytecode

stage 2: JumpJet VM 執行 stage-2 compiler
         -> 編譯 conformance corpus
```

驗證條件應包括：

- Stage 1 與 stage 2 產生 canonical-equivalent bytecode。若 constant ordering 或 debug metadata 有允許差異，先 canonicalize 再比較。
- Stage 1 與 stage 2 對同一份合法及非法 corpus 產生相同 result、diagnostic stage 和 source span。
- Bytecode verifier 拒絕 truncated operand、unknown opcode、jump into operand、stack underflow、inconsistent merge height、out-of-range constant/local/function index。
- 每個 opcode 都有 interpreter unit test，以及 emitter 到真實 VM 的 integration test。
- 對 JumpJet 已支援的 ECMAScript subset 做 differential test，同一個純程式分別交給 JumpJet 與 Node，對照 value 或 error class。這只能驗證共同 subset，不能用 Node 的 host behavior 取代 JumpJet VM 測試。
- Functions、closures 與 objects 完成後，建立 allocation stress test，讓每個可配置 allocation interval 都可能觸發 GC。若 JumpJet 仍使用 host JavaScript object 和 host GC，測試必須明確標示這只是 bootstrap memory model。

### 何時才加 JIT

達成 self-hosting 後，先量測：

- opcode dispatch 佔總執行時間的比例；
- 最熱 function 與 loop；
- property access、arithmetic、call 和 allocation 各自的 runtime helper 成本；
- compile latency、bytecode size、peak memory 和 execution time。

若 dispatch 是主要瓶頸，第一個 JIT 應像 Sparkplug 或 JavaScriptCore Baseline，只把 bytecode 快速翻成等價 machine code，不先做 type speculation。[Sparkplug](https://v8.dev/blog/sparkplug)和 [JSC Baseline](https://webkit.org/blog/10308/speculation-in-javascriptcore/) 都把移除 dispatch overhead 與快速 compilation 當成 baseline tier 的主要工作。只有 profiler 顯示 dynamic type checks 或 property lookup 佔主導，才需要 inline cache、type feedback 和 optimizing IR。

## 不建議現在做的事

- 不要為了看起來像 V8 而先加 SSA IR。Hermes 需要 IR 是因為它做 AOT optimization 與 register allocation；JumpJet 現在沒有相同需求。
- 不要改成 register VM。QuickJS 與 SpiderMonkey 證明 stack bytecode 可支援完整 JavaScript 及後續 JIT。先用 `maxStack`、function frame 和 verifier 把現有模型做完整。
- 不要先寫 GC。現階段 VM 值仍是 host JavaScript primitive，還沒有 JumpJet-owned object graph。先定義 Value、object、root 和 host handle 契約，否則 collector 不知道要管理什麼。
- 不要承諾跨版本 bytecode compatibility。QuickJS 明確把 bytecode 綁定 engine version 並拒絕不可信輸入，[官方警告](https://github.com/bellard/quickjs/blob/master/doc/quickjs.texi#L3387-L3408)很適合 JumpJet 目前階段。
- 不要把 self-hosting 和 ECMAScript 全相容綁在一起。先支援 compiler source 實際使用的 subset，再另外以 Test262 追蹤語言相容性。

## 最終判斷

JumpJet 不是要在 V8、QuickJS 或 Hermes 之中三選一。較合適的組合是：

- 採 QuickJS 的小型 stack-bytecode interpreter 與 compile-time `maxStack`。
- 採 Hermes 的 compiler artifact、runtime loader 分離與 AOT self-hosting 路徑。
- 採 SpiderMonkey 的 bytecode verifier 思維、function compilation unit 和 desugaring 準則。
- 採 JavaScriptCore 的共用 bytecode contract，但延後多 tier。
- 採 V8 的明確 embedding boundary 與未來 baseline JIT 路線，不複製當前複雜度。

下一個架構里程碑應是 `BytecodeModule + FunctionRecord + verifier + Runtime + call frames`。完成這一層後，functions、closures、objects 和 self-hosting 都有清楚的歸屬；在它之前加入 JIT 或 GC，只會把尚未穩定的語意複製到更多地方。

## 來源範圍

本報告只使用以下第一方材料，查閱日期均為 2026-10-16：

- V8 官方文件與官方部落格：<https://v8.dev/>
- QuickJS 官方 source repository 與內附手冊：<https://github.com/bellard/quickjs>
- WebKit 官方部落格與 JavaScriptCore source repository：<https://webkit.org/blog/>、<https://github.com/WebKit/WebKit>
- Mozilla Firefox Source Docs、SpiderMonkey 官方網站與官方 embedding repository：<https://firefox-source-docs.mozilla.org/js/>、<https://spidermonkey.dev/>、<https://github.com/mozilla-spidermonkey/spidermonkey-embedding-examples>
- Hermes 官方 source repository 與 React Native 官方文件：<https://github.com/facebook/hermes>、<https://reactnative.dev/>
