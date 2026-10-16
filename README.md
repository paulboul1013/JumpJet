<p align="center">
  <img src="web/jumpjet-icon.png" width="200" alt="JumpJet bytecode-first JavaScript engine icon">
</p>

# JumpJet

JumpJet 是使用 JavaScript 實作自己的 bytecode-first JavaScript engine。它包含自己的 compiler、bytecode 格式與 VM，目前支援下方列出的 JavaScript 語言子集。

Node.js 或瀏覽器是 JumpJet 的宿主環境，持續執行 compiler 與 VM 的 JavaScript 實作。使用者程式會先編譯成 JumpJet bytecode，再由 JumpJet VM 逐條解譯執行，不使用 `eval` 或 `Function` 執行使用者原始碼。

Self-hosting 是後續目標，目前尚未完成。達成時，JumpJet compiler 的原始碼將能編譯成 JumpJet bytecode，並在 JumpJet VM 上執行，再次編譯自身。

## 使用方式

1. 在專案目錄啟動本機伺服器：

   ```sh
   npm run dev
   ```

2. 用瀏覽器開啟 <http://127.0.0.1:8000/main.html>。
3. 在左側編輯 JavaScript，然後按下「編譯並執行」。也可以按 Ctrl+Enter 或 Command+Enter。
4. 在右側查看執行結果、編譯器 diagnostics 與 bytecode。

編輯器會自動在瀏覽器中保存草稿，也可以匯入或下載 `.js` 檔案。

## 支援的語法

目前的語言切片支援：

- `let` 與 `const` 宣告
- 數字、`true`、`false`、識別字與括號
- `!`、一元 `+`、一元 `-`
- `+`、`-`、`*`、`/`
- `<`、`<=`、`>`、`>=`、`===`、`!==`
- 賦值與鏈式賦值
- block scope 與 `if` / `else if` / `else`

宣告與 expression statement 都必須以分號結尾。`if` 與 `else` 的本體必須使用大括號。程式最末必須是 expression statement，它的值就是 VM 的執行結果。

```js
let score = 3;
if (score < 5) {
    score = -score + 10;
} else {
    score = 0;
}
score === 7;
```

完整 EBNF、precedence、scope 規則、bytecode 指令與檔案職責請讀 [控制流與語意分析規格](docs/specs/0003-control-flow-and-semantic-analysis.md)。架構關係可從 [視覺化設計頁](docs/jumpjet-grammar-architecture.html) 查看。

## Engine 架構

```text
source
  -> lexer      tokens 與 source spans
  -> parser     syntax AST
  -> analyzer   scope、binding、const 與 slot
  -> compiler   bound AST 到 bytecode
  -> verifier   驗證完整指令、operand 與跳躍邊界
  -> VM         在指令預算內執行 bytecode
```

`src/analyzer.js` 把來源名稱解析成 numeric slot，讓 `src/compiler.js` 只處理合法的 bound nodes 與指令選擇。`src/vm.js` 維護 instruction pointer、operand stack 與變數 slots，執行產生的 bytecode。

`run(program, { maxInstructions: 1000 })` 可指定指令預算，預設為 1,000,000。parser 的語法巢狀深度與 AST 深度上限均為 128；超過上限會回傳 diagnostic。完整契約請讀 [engine 邊界規格](docs/specs/0004-engine-boundaries.md)。

## 驗證

```sh
npm test
npm run check
npm run demo
npm run demo:control-flow
```

- `npm test` 驗證每一個 compiler phase、VM 邊界與完整 source-to-result 流程。
- `npm run check` 對 source、web、tests 與 examples 執行 JavaScript syntax check。
- `npm run demo` 驗證原有算術切片沒有 regression。
- `npm run demo:control-flow` 透過真實 compiler 與 VM 執行上面的控制流範例，預期結果為 `true`。
