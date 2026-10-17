# JavaScript 編譯器與 bytecode VM

實作 commit：`1e4e650`。

- 建立 lexer、parser、bytecode 編譯器與 stack VM。
- 支援數字、`let`、識別字、括號與四則運算。
- 提供 `compile`、`run` API，回傳程式最後一個運算式的值。
- 編譯錯誤附帶來源位置，程式透過 VM 執行。
