import { compileCore } from "./compiler-core.js";
import { execute, invokeEntry } from "./vm.js";

export function compile(source) {
    if (typeof source !== "string") { throw new TypeError("Source must be a string."); }
    return compileCore(source);
}
export function run(program, options) { return execute(program, options); }
export function invoke(program, entryName, args, options) {
    return invokeEntry(program, entryName, args, options);
}
