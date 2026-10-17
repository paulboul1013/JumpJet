// Host implementations of the finite primitive ABI. No compiler phases here.
export function rtPush(array, value) { return array.push(value); }
export function rtPop(array) { return array.pop(); }
export function rtSlice(text, start, end) { return text.slice(start, end); }
export function rtNumber(text) { return Number(text); }
export function rtCharCode(text, index) { return text.charCodeAt(index); }
export function rtFromCharCode(code) { return String.fromCharCode(code); }
export function rtWhitespace(c) {
    const n = typeof c === "string" ? c.charCodeAt(0) : -1;
    return n === 9 || n === 10 || n === 11 || n === 12 || n === 13 || n === 32 ||
        n === 160 || n === 5760 || (n >= 8192 && n <= 8202) || n === 8232 ||
        n === 8233 || n === 8239 || n === 8287 || n === 12288 || n === 65279;
}
export function rtIsArray(value) { return Array.isArray(value); }
export function rtType(value) { return typeof value; }
export function rtFreeze(value) { return Object.freeze(value); }
export function rtTrap(message) { throw new TypeError(message); }

export function rtIsSafeInteger(value) { return Number.isSafeInteger(value); }
