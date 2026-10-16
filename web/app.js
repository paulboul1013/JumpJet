import { compile, run } from "../src/index.js";
import {
    DEFAULT_DOCUMENT,
    loadDraft,
    normalizeJavaScriptFileName,
    readJavaScriptFile,
    saveDraft,
} from "./document.js";

const fileNameInput = document.querySelector("#file-name");
const sourceEditor = document.querySelector("#source-editor");
const lineNumbers = document.querySelector("#line-numbers");
const saveStatus = document.querySelector("#save-status");
const saveButton = document.querySelector("#save-button");
const importInput = document.querySelector("#import-input");
const downloadButton = document.querySelector("#download-button");
const runButton = document.querySelector("#run-button");
const cursorPosition = document.querySelector("#cursor-position");
const documentSize = document.querySelector("#document-size");
const runState = document.querySelector("#run-state");
const resultOutput = document.querySelector("#result-output");
const diagnosticsOutput = document.querySelector("#diagnostics-output");
const bytecodeOutput = document.querySelector("#bytecode-output");

let autoSaveTimer = null;

function currentDocument() {
    return {
        name: normalizeJavaScriptFileName(fileNameInput.value),
        source: sourceEditor.value,
    };
}

function showSaveStatus(message, state = "neutral") {
    saveStatus.textContent = message;
    saveStatus.dataset.state = state;
}

function updateLineNumbers() {
    const lineCount = sourceEditor.value.split("\n").length;
    lineNumbers.textContent = Array.from(
        { length: lineCount },
        (_, index) => String(index + 1),
    ).join("\n");
}

function updateCursorPosition() {
    const beforeCursor = sourceEditor.value.slice(0, sourceEditor.selectionStart);
    const lines = beforeCursor.split("\n");
    cursorPosition.textContent = `行 ${lines.length}，欄 ${lines.at(-1).length + 1}`;
}

function updateDocumentMetrics() {
    const bytes = new Blob([sourceEditor.value]).size;
    documentSize.textContent = `${bytes.toLocaleString()} bytes`;
    updateLineNumbers();
    updateCursorPosition();
}

function persistDraft({ explicit = false } = {}) {
    const editorDocument = currentDocument();
    const result = saveDraft(window.localStorage, editorDocument);

    if (!result.ok) {
        showSaveStatus(result.message, "error");
        return;
    }

    if (explicit) {
        fileNameInput.value = editorDocument.name;
    }
    showSaveStatus(explicit ? "草稿已保存" : "已自動保存", "saved");
}

function scheduleAutoSave() {
    window.clearTimeout(autoSaveTimer);
    showSaveStatus("尚未保存的變更", "pending");
    autoSaveTimer = window.setTimeout(() => persistDraft(), 400);
}

function formatDiagnostics(diagnostics) {
    return diagnostics
        .map(
            (diagnostic) =>
                `[${diagnostic.stage}] ${diagnostic.message}\n位置 ${diagnostic.start}–${diagnostic.end}`,
        )
        .join("\n\n");
}

function setRunState(label, state) {
    runState.textContent = label;
    runState.dataset.state = state;
}

function compileAndRun() {
    const compilation = compile(sourceEditor.value);

    if (!compilation.ok) {
        resultOutput.textContent = "編譯失敗";
        diagnosticsOutput.textContent = formatDiagnostics(compilation.diagnostics);
        bytecodeOutput.textContent = "未產生 bytecode。";
        setRunState("編譯失敗", "error");
        return;
    }

    bytecodeOutput.textContent = JSON.stringify(compilation.program, null, 2);

    try {
        const value = run(compilation.program);
        resultOutput.textContent = String(value);
        diagnosticsOutput.textContent = "沒有 diagnostics。";
        setRunState("執行成功", "success");
    } catch (error) {
        resultOutput.textContent = "執行失敗";
        diagnosticsOutput.textContent = `[runtime] ${error.message}`;
        setRunState("執行失敗", "error");
    }
}

async function importFile() {
    const file = importInput.files?.[0];
    importInput.value = "";

    if (file === undefined) {
        return;
    }

    const result = await readJavaScriptFile(file);
    if (!result.ok) {
        showSaveStatus(result.message, "error");
        return;
    }

    fileNameInput.value = result.document.name;
    sourceEditor.value = result.document.source;
    updateDocumentMetrics();
    persistDraft({ explicit: true });
    compileAndRun();
    sourceEditor.focus();
}

function downloadDocument() {
    const editorDocument = currentDocument();
    fileNameInput.value = editorDocument.name;

    const blob = new Blob([editorDocument.source], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = editorDocument.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showSaveStatus(`已下載 ${editorDocument.name}`, "saved");
}

function insertIndent(event) {
    if (event.key !== "Tab") {
        return;
    }

    event.preventDefault();
    const start = sourceEditor.selectionStart;
    sourceEditor.setRangeText("    ", start, sourceEditor.selectionEnd, "end");
    sourceEditor.dispatchEvent(new Event("input", { bubbles: true }));
}

function restoreDocument() {
    const restored = loadDraft(window.localStorage);
    const editorDocument = restored.ok && restored.document !== null
        ? restored.document
        : DEFAULT_DOCUMENT;

    fileNameInput.value = normalizeJavaScriptFileName(editorDocument.name);
    sourceEditor.value = editorDocument.source;
    updateDocumentMetrics();

    if (!restored.ok) {
        showSaveStatus(restored.message, "error");
    } else if (restored.document === null) {
        showSaveStatus("已載入範例程式", "neutral");
    } else {
        showSaveStatus("已恢復本機草稿", "saved");
    }

    compileAndRun();
}

sourceEditor.addEventListener("input", () => {
    updateDocumentMetrics();
    scheduleAutoSave();
});
sourceEditor.addEventListener("scroll", () => {
    lineNumbers.scrollTop = sourceEditor.scrollTop;
});
sourceEditor.addEventListener("click", updateCursorPosition);
sourceEditor.addEventListener("keyup", updateCursorPosition);
sourceEditor.addEventListener("keydown", (event) => {
    insertIndent(event);
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        compileAndRun();
    }
});
fileNameInput.addEventListener("input", scheduleAutoSave);
saveButton.addEventListener("click", () => persistDraft({ explicit: true }));
importInput.addEventListener("change", importFile);
downloadButton.addEventListener("click", downloadDocument);
runButton.addEventListener("click", compileAndRun);

restoreDocument();
