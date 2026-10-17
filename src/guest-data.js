// This boundary accepts data only. It never evaluates accessors or copies host prototypes.
export function copyGuestData(root, { toGuest = false, maxValueSize = 1_000_000, charge = () => {} } = {}) {
    const seen = new Map();
    const pending = [];
    function copy(value) {
        if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") { return value; }
        if (typeof value === "string") {
            if (value.length > maxValueSize) { throw new RangeError("Guest data string size limit exceeded."); }
            charge(value.length);
            return value;
        }
        if (typeof value !== "object") { throw new TypeError("Guest data must contain only scalars, dense arrays and records."); }
        if (seen.has(value)) { return seen.get(value); }
        if (seen.size >= maxValueSize) { throw new RangeError("Guest data size limit exceeded."); }
        const array = Array.isArray(value);
        const proto = Object.getPrototypeOf(value);
        if (!array && proto !== null && proto !== Object.prototype) { throw new TypeError("Guest data must use plain records."); }
        const out = array ? [] : (toGuest ? Object.create(null) : {});
        seen.set(value, out);
        pending.push({ value, out, array });
        return out;
    }
    const result = copy(root);
    while (pending.length > 0) {
        const { value, out, array } = pending.pop();
        const keys = Reflect.ownKeys(value);
        if (keys.length > maxValueSize + 1) { throw new RangeError("Guest data size limit exceeded."); }
        charge(keys.length);
        if (array && value.length > maxValueSize) { throw new RangeError("Guest data array size limit exceeded."); }
        if (array && keys.length !== value.length + 1) { throw new TypeError("Guest data arrays must be dense and have no extra fields."); }
        for (const key of keys) {
            if (array && key === "length") { continue; }
            if (typeof key !== "string" || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
                throw new TypeError("Guest data contains an unsupported property.");
            }
            const d = Object.getOwnPropertyDescriptor(value, key);
            if (!Object.hasOwn(d, "value") || !d.enumerable) { throw new TypeError("Guest data cannot contain accessors or hidden fields."); }
            Object.defineProperty(out, key, { value: copy(d.value), writable: true, enumerable: true, configurable: true });
        }
        if (Object.isFrozen(value)) { Object.freeze(out); }
    }
    return result;
}
