import { rtFreeze } from "./runtime.js";

// The order is the bytecode intrinsic ABI. This data is part of compiler S.
export const IntrinsicDefinitions = rtFreeze([
    rtFreeze({ name: "rtPush", arity: 2 }),
    rtFreeze({ name: "rtPop", arity: 1 }),
    rtFreeze({ name: "rtSlice", arity: 3 }),
    rtFreeze({ name: "rtNumber", arity: 1 }),
    rtFreeze({ name: "rtCharCode", arity: 2 }),
    rtFreeze({ name: "rtFromCharCode", arity: 1 }),
    rtFreeze({ name: "rtWhitespace", arity: 1 }),
    rtFreeze({ name: "rtIsArray", arity: 1 }),
    rtFreeze({ name: "rtType", arity: 1 }),
    rtFreeze({ name: "rtFreeze", arity: 1 }),
    rtFreeze({ name: "rtTrap", arity: 1 }),
    rtFreeze({ name: "rtIsSafeInteger", arity: 1 }),
]);
