# JumpJet

JumpJet 的領域是將受支援的 JavaScript 子集編譯為 JumpJet bytecode，並由 JumpJet VM 執行。

## Language

**JumpJet compiler（完整編譯器）**:
將 JumpJet 支援的 JavaScript 原始碼轉為 JumpJet bytecode 的完整編譯系統。
_Avoid_: 只用 emitter 代表完整 compiler。

**JumpJet emitter（指令產生器）**:
將已完成語意分析的程式表示轉為 JumpJet bytecode 的編譯階段。
_Avoid_: 在討論自舉範圍時，將 emitter 與完整 compiler 混用。

**JumpJet bytecode**:
JumpJet compiler 產生、供 JumpJet VM 執行的程式表示。
_Avoid_: JavaScript 原始碼、宿主引擎的 bytecode。

**Compiler 自舉**:
JumpJet compiler 能將自身原始碼編譯為 JumpJet bytecode，且產出的 compiler 能在 JumpJet VM 上執行並再次編譯自身。
_Avoid_: 僅以 JavaScript 撰寫 compiler、僅自舉內建函式。

**Self-hosted builtin（自舉內建函式）**:
由 JumpJet 支援的 JavaScript 實作，並由 JumpJet 自己編譯與執行的內建函式。
_Avoid_: Compiler 自舉。

**JumpJet bootstrap 子集**:
第一個 compiler 自舉階段所採用、足以表達同一套 JumpJet compiler 的受控 JavaScript 子集。
_Avoid_: 完整 ECMAScript、自舉專用的第二套 compiler。

**宿主基礎操作**:
自舉期間由宿主提供、具有明確契約的有限 runtime 操作。
_Avoid_: 將 tokenize、parse、analyze 或 emit 委派回宿主。

**Compiler 產物世代**:
固定同一份 compiler 來源後，由前一代 compiler 編譯得到的 compiler bytecode 版本。
_Avoid_: 將不同 compiler 原始碼產生的版本當成同一輪穩定性比較。

**Runtime trap**:
Guest 執行遇到不可恢復錯誤時的中止結果，與正常回傳的來源 diagnostics 分開處理。
_Avoid_: 可由 guest try/catch 捕捉的例外、來源語法錯誤。
