export const DRAFT_STORAGE_KEY = "jumpjet.editor.document.v1";
export const MAX_IMPORT_BYTES = 1_000_000;

export const DEFAULT_DOCUMENT = Object.freeze({
    name: "main.js",
    source: "let answer = 1 + 2 * 3;\nanswer;\n",
});

function isDocument(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof value.name === "string" &&
        typeof value.source === "string"
    );
}

export function loadDraft(storage) {
    try {
        const saved = storage.getItem(DRAFT_STORAGE_KEY);
        if (saved === null) {
            return { ok: true, document: null };
        }

        try {
            const document = JSON.parse(saved);
            return {
                ok: true,
                document: isDocument(document) ? document : null,
            };
        } catch {
            return { ok: true, document: null };
        }
    } catch {
        return { ok: false, message: "Browser storage is unavailable." };
    }
}

export function saveDraft(storage, document) {
    if (!isDocument(document)) {
        throw new TypeError("Document must contain string name and source fields.");
    }

    try {
        storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(document));
        return { ok: true };
    } catch {
        return { ok: false, message: "Browser storage is unavailable." };
    }
}

export function normalizeJavaScriptFileName(name) {
    const lastPathPart = String(name ?? "")
        .trim()
        .split(/[\\/]/u)
        .at(-1);
    const safeName = lastPathPart
        .replace(/[^a-zA-Z0-9._-]+/gu, "-")
        .replace(/^[.-]+|[.-]+$/gu, "");

    if (safeName.length === 0) {
        return "main.js";
    }

    return safeName.toLowerCase().endsWith(".js") ? safeName : `${safeName}.js`;
}

export async function readJavaScriptFile(file) {
    if (file === null || typeof file !== "object" || typeof file.name !== "string") {
        return { ok: false, message: "Choose a .js file." };
    }
    if (!file.name.toLowerCase().endsWith(".js")) {
        return { ok: false, message: "Choose a .js file." };
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_IMPORT_BYTES) {
        return { ok: false, message: "JavaScript files must be 1 MB or smaller." };
    }
    if (typeof file.text !== "function") {
        return { ok: false, message: "The selected file cannot be read." };
    }

    try {
        const source = await file.text();
        if (typeof source !== "string") {
            return { ok: false, message: "The selected file cannot be read." };
        }
        return {
            ok: true,
            document: {
                name: normalizeJavaScriptFileName(file.name),
                source,
            },
        };
    } catch {
        return { ok: false, message: "The selected file cannot be read." };
    }
}
