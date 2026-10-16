import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_IMPORT_BYTES,
    loadDraft,
    normalizeJavaScriptFileName,
    readJavaScriptFile,
    saveDraft,
} from "../web/document.js";

class MemoryStorage {
    #values = new Map();

    getItem(key) {
        return this.#values.get(key) ?? null;
    }

    setItem(key, value) {
        this.#values.set(key, value);
    }
}

test("draft storage preserves the filename and source exactly", () => {
    const storage = new MemoryStorage();
    const document = {
        name: "calculation.js",
        source: "let total = 2 * 4;\ntotal;\n",
    };

    assert.deepEqual(saveDraft(storage, document), { ok: true });
    assert.deepEqual(loadDraft(storage), { ok: true, document });
});

test("malformed saved data is ignored", () => {
    const storage = new MemoryStorage();
    storage.setItem("jumpjet.editor.document.v1", "not-json");

    assert.deepEqual(loadDraft(storage), { ok: true, document: null });
});

test("storage errors do not escape into the editor", () => {
    const storage = {
        getItem() {
            throw new Error("storage denied");
        },
    };

    const result = loadDraft(storage);

    assert.equal(result.ok, false);
    assert.equal(result.message, "Browser storage is unavailable.");
});

test("normalizes download names to a safe JavaScript filename", () => {
    assert.equal(normalizeJavaScriptFileName(" calculations "), "calculations.js");
    assert.equal(normalizeJavaScriptFileName("../my demo.js"), "my-demo.js");
    assert.equal(normalizeJavaScriptFileName(""), "main.js");
});

test("reads an imported JavaScript file as plain text", async () => {
    const file = {
        name: "program.js",
        size: 18,
        async text() {
            return "let value = 4;\n";
        },
    };

    assert.deepEqual(await readJavaScriptFile(file), {
        ok: true,
        document: {
            name: "program.js",
            source: "let value = 4;\n",
        },
    });
});

test("rejects non-JavaScript and oversized imports before reading", async () => {
    assert.deepEqual(
        await readJavaScriptFile({ name: "notes.txt", size: 10, text: async () => "ignored" }),
        { ok: false, message: "Choose a .js file." },
    );
    assert.deepEqual(
        await readJavaScriptFile({
            name: "large.js",
            size: MAX_IMPORT_BYTES + 1,
            text: async () => "ignored",
        }),
        { ok: false, message: "JavaScript files must be 1 MB or smaller." },
    );
});
