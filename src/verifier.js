import { BYTECODE_VERSION, InstructionSet } from "./bytecode.js";
import { IntrinsicDefinitions } from "./runtime-symbols.js";

export const MAX_PROGRAM_ITEMS = 1_000_000;
function count(value, name, limit = MAX_PROGRAM_ITEMS) {
    if (!Number.isSafeInteger(value) || value < 0 || value > limit) {
        throw new RangeError(`Bytecode ${name} must be a non-negative safe integer at most ${limit}.`);
    }
    return value;
}
function arraySnapshot(input, name) {
    if (!Array.isArray(input)) { throw new TypeError(`Bytecode ${name} must be an array.`); }
    const length = count(input.length, `${name} length`);
    const result = [];
    for (let i = 0; i < length; i += 1) {
        if (!Object.hasOwn(input, i)) { throw new TypeError(`Bytecode ${name} ${i} is missing.`); }
        result.push(input[i]);
    }
    return result;
}
function verifyCode(input, slotCount, globalCount, constants, functions) {
    // Snapshot every instruction, including accessor elements, exactly once.
    // Holes stay undefined, so the opcode/operand checks give the relevant error.
    if (!Array.isArray(input)) { throw new TypeError("Bytecode code must be an array."); }
    const length = count(input.length, "code length");
    const code = [];
    for (let i = 0; i < length; i += 1) { code.push(Object.hasOwn(input, i) ? input[i] : undefined); }
    const starts = new Set([code.length]);
    const targets = [];
    let p = 0;
    while (p < code.length) {
        starts.add(p);
        const opcode = code[p++];
        const instruction = Number.isInteger(opcode) && Object.hasOwn(InstructionSet, opcode) ? InstructionSet[opcode] : undefined;
        if (instruction === undefined) { throw new RangeError(`Unknown opcode ${opcode}.`); }
        if (instruction.operand === null) { continue; }
        if (p >= code.length) { throw new RangeError(`Missing operand for ${instruction.name}.`); }
        const operand = code[p++];
        if (!Number.isSafeInteger(operand) || operand < 0) { throw new RangeError(`Invalid operand ${operand} for ${instruction.name}.`); }
        switch (instruction.operand) {
            case "constant":
                if (operand >= constants.length) { throw new RangeError(`Constant index ${operand} is out of bounds.`); }
                break;
            case "slot":
                if (operand >= slotCount) { throw new RangeError(`Slot index ${operand} is out of bounds.`); }
                break;
            case "global":
                if (operand >= globalCount) { throw new RangeError(`Global slot index ${operand} is out of bounds.`); }
                break;
            case "target":
                if (operand > code.length) { throw new RangeError(`Jump target ${operand} is out of bounds.`); }
                targets.push(operand);
                break;
            case "function":
                if (operand >= functions.length) { throw new RangeError(`Function index ${operand} is out of bounds.`); }
                break;
            case "builtin":
                if (operand >= IntrinsicDefinitions.length) { throw new RangeError(`Builtin index ${operand} is out of bounds.`); }
                break;
            case "count": count(operand, "construction count"); break;
        }
    }
    for (const target of targets) {
        if (!starts.has(target)) { throw new RangeError(`Jump target ${target} is not an instruction boundary.`); }
    }
    return code;
}
export function verifyProgram(program) {
    if (program === null || typeof program !== "object") { throw new TypeError("Bytecode program must be an object."); }
    const { version, constants, code, slotCount, functions } = program;
    if (version !== BYTECODE_VERSION) { throw new RangeError(`Unsupported bytecode version ${version}.`); }
    const pool = arraySnapshot(constants, "constant");
    for (let i = 0; i < pool.length; i += 1) {
        const v = pool[i];
        if (v !== null && v !== undefined && typeof v !== "number" && typeof v !== "boolean" && typeof v !== "string") {
            throw new TypeError(`Bytecode constant ${i} must be a scalar value.`);
        }
        if (typeof v === "string" && v.length > MAX_PROGRAM_ITEMS) { throw new RangeError("Bytecode string length limit exceeded."); }
    }
    count(slotCount, "slotCount");
    const rawFunctions = arraySnapshot(functions, "functions");
    const names = new Set();
    const table = rawFunctions.map(fn => {
        if (fn === null || typeof fn !== "object") { throw new TypeError("Bytecode function must be an object."); }
        const { name, arity, slotCount: locals, code: body } = fn;
        if (typeof name !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || names.has(name) || IntrinsicDefinitions.some(d => d.name === name)) {
            throw new TypeError("Bytecode function name is invalid, duplicate or reserved.");
        }
        names.add(name);
        count(arity, "function arity"); count(locals, "function slotCount");
        if (arity > locals) { throw new RangeError("Function arity exceeds local slots."); }
        return { name, arity, slotCount: locals, code: body };
    });
    const main = verifyCode(code, slotCount, slotCount, pool, table);
    for (const fn of table) { fn.code = verifyCode(fn.code, fn.slotCount, slotCount, pool, table); }
    return { version, constants: pool, code: main, slotCount, functions: table };
}
