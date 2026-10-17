---
status: accepted
---

# 使用較小 JavaScript 子集完成 compiler 自舉

JumpJet 第一個自舉階段允許等價改寫同一套 compiler，採用較小的 JavaScript 子集。Compiler 使用頂層具名函式、一般呼叫與遞迴，狀態由 context 明確傳入。Closure、函式當參數與 callback 延後，避免先實作現有 compiler 所用的全部語言能力。

Tokenize、parse、analyze 與 emit 四階段必須在 JumpJet VM 執行。宿主可以提供 VM、verifier、檔案 I/O 與列明契約的有限基礎操作。不能把編譯階段委派回宿主，並將該路徑當成自舉證據。

固定的 compiler 來源集合靜態打包成單一入口，打包流程必須可重現。第一階段新增 Node.js 自舉入口，維持既有瀏覽器 Studio 可用。執行期 ES module loader 與瀏覽器自舉操作流程延後。

固定同一份 compiler 來源 S，宿主 compiler 產生 B1，VM 執行 B1 編譯 S 產生 B2，VM 執行 B2 編譯 S 產生 B3。B1、B2、B3 的完整可執行內容必須相同，並另行驗證合法程式的執行結果。對同一份來源，host compiler 與 VM compiler 的 diagnostics 必須具有相同的 stage、message、start、end。

來源錯誤以 diagnostics 回傳，內部不可恢復錯誤透過明確的 runtime trap 中止，對外參數檢查留在宿主入口。Guest 的 throw、try、catch 與 new Error 延後。

允許 bytecode 格式升版，本階段不承諾執行舊版產物，也不增加 version-1 相容執行層。既有來源程式與 compile、run 的用法保持可用。格式變更時，回歸測試改用當期格式，繼續驗證原有語意與邊界規則。

這個選擇縮小第一階段的引擎範圍，但 compiler 會增加顯式狀態參數與部分迴圈。改寫必須保留既有支援範圍的行為與診斷。另一個方案是盡量原樣保留 compiler，優先支援 closure、Map、正規表示式與其他用法；本階段未採用該方案。

詳見 [規劃與訪談紀錄](../plans/self-hosting-compiler.md)。

使用者於 2026-10-16 確認整體規格與 M0 至 M6 的階段順序。訪談結束，後續依 [自舉規格](../specs/0005-self-hosting-compiler.md) 執行。
