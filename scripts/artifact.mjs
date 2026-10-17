export function encodeArtifact(value) {
    const active = new Set();
    function encode(v) {
        if (v === undefined) { return ["undefined"]; }
        if (v === null) { return ["null"]; }
        if (typeof v === "number") {
            const text = Object.is(v, -0) ? "-0" : String(v);
            return ["number", text];
        }
        if (typeof v === "string" || typeof v === "boolean") { return [typeof v, v]; }
        if (typeof v !== "object" || active.has(v)) { throw new TypeError("Artifact must be acyclic data."); }
        active.add(v);
        const result = Array.isArray(v) ? ["array", v.map(encode)] : ["record", Object.keys(v).map(k => [k, encode(v[k])])];
        active.delete(v);
        return result;
    }
    return JSON.stringify(encode(value)) + "\n";
}
export function decodeArtifact(text) {
    function decode(v) {
        switch (v[0]) {
            case "undefined": return undefined;
            case "null": return null;
            case "number": return Number(v[1]);
            case "string": case "boolean": return v[1];
            case "array": return v[1].map(decode);
            case "record": return Object.fromEntries(v[1].map(([k, x]) => [k, decode(x)]));
            default: throw new TypeError("Invalid artifact tag.");
        }
    }
    return decode(JSON.parse(text));
}
export function firstDifference(a, b, path = "$") {
    if (Object.is(a, b)) { return null; }
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) { return path; }
    if (Array.isArray(a) && a.length !== b.length) { return path + ".length"; }
    const keys = Object.keys(a);
    const other = Object.keys(b);
    if (keys.length !== other.length) { return path + ".keys.length"; }
    for (let i = 0; i < keys.length; i += 1) {
        if (keys[i] !== other[i]) { return path + ".keys[" + i + "]"; }
        const difference = firstDifference(a[keys[i]], b[keys[i]], path + "[" + JSON.stringify(keys[i]) + "]");
        if (difference !== null) { return difference; }
    }
    return null;
}
export function assertSame(a, b, label) {
    const path = firstDifference(a, b);
    if (path !== null) {
        const error = new Error(`${label}: first difference at ${path}.`);
        error.difference = path;
        throw error;
    }
}
