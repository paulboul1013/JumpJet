import { InstructionSet, Opcode } from "./bytecode.js";
import { IntrinsicDefinitions } from "./runtime-symbols.js";
import * as primitives from "./runtime.js";
import { verifyProgram } from "./verifier.js";
import { copyGuestData } from "./guest-data.js";

export const DEFAULT_MAX_INSTRUCTIONS = 1_000_000;
export const DEFAULT_MAX_CALL_DEPTH = 1024;
export const DEFAULT_MAX_VALUE_SIZE = 1_000_000;

function executionOptions(options) {
    if (options === null || typeof options !== "object") { throw new TypeError("Execution options must be an object."); }
    const { maxInstructions = DEFAULT_MAX_INSTRUCTIONS, maxCallDepth = DEFAULT_MAX_CALL_DEPTH, maxValueSize = DEFAULT_MAX_VALUE_SIZE, stats } = options;
    for (const [name, value] of Object.entries({maxInstructions, maxCallDepth, maxValueSize})) {
        if (!Number.isSafeInteger(value) || value < 0) { throw new RangeError(`${name} must be a non-negative safe integer.`); }
    }
    if (stats !== undefined && (stats === null || typeof stats !== "object")) { throw new TypeError("stats must be an object."); }
    return {maxInstructions, maxCallDepth, maxValueSize, stats};
}
function scalar(value) {
    if (value !== null && typeof value === "object") { throw new TypeError("Object to scalar conversion is not supported."); }
    return value;
}
function arrayIndex(key) {
    if (Number.isSafeInteger(key) && key >= 0) { return key; }
    if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && Number.isSafeInteger(Number(key))) { return Number(key); }
    return -1;
}
function getProperty(object, key) {
    if (typeof key !== "string" && typeof key !== "number") { throw new TypeError("Property key must be a string or number."); }
    if (Array.isArray(object) || typeof object === "string") {
        if (key === "length") { return object.length; }
        const index = arrayIndex(key);
        return index >= 0 && index < object.length ? object[index] : undefined;
    }
    if (object === null || typeof object !== "object") { throw new TypeError("Cannot read property of a scalar value."); }
    return Object.hasOwn(object, key) ? object[key] : undefined;
}
function setProperty(object, key, value, maxValueSize) {
    if (object === null || typeof object !== "object" || Object.isFrozen(object)) { throw new TypeError("Cannot write property of a scalar or frozen value."); }
    if (typeof key !== "string" && typeof key !== "number") { throw new TypeError("Property key must be a string or number."); }
    if (Array.isArray(object)) {
        const index = arrayIndex(key);
        if (index < 0 || index > object.length || index >= maxValueSize) { throw new RangeError("Array write must use a dense index within the size limit."); }
        object[index] = value;
    } else {
        if (!Object.hasOwn(object, key)) { throw new TypeError(`Cannot add record field '${key}'.`); }
        object[key] = value;
    }
    return value;
}
function runMachine(input, entryName, inputArgs, options) {
    const limits = executionOptions(options);
    const program = verifyProgram(input);
    let entryIndex = -1;
    if (entryName !== null) {
        if (typeof entryName !== "string" || !Array.isArray(inputArgs)) { throw new TypeError("Entry name must be a string and arguments must be an array."); }
        entryIndex = program.functions.findIndex(fn => fn.name === entryName);
        if (entryIndex < 0) { throw new RangeError(`Unknown guest entry '${entryName}'.`); }
        if (inputArgs.length !== program.functions[entryIndex].arity) { throw new TypeError("Guest entry argument count does not match arity."); }
    }
    const metrics = {instructions: 0, work: 0, builtinCalls: 0, maxFrames: 0};
    function charge(n) {
        if (n > limits.maxInstructions - metrics.work) { throw new RangeError(`Instruction budget ${limits.maxInstructions} exhausted.`); }
        metrics.work += n;
    }
    function size(n) {
        if (n > limits.maxValueSize) { throw new RangeError("Guest value size limit exceeded."); }
    }
    function makeFrame(fn, args, base, depth) {
        if (fn.slotCount > limits.maxValueSize) { throw new RangeError("Guest local slot size limit exceeded."); }
        charge(args.length);
        const slots = args.slice();
        const initialized = new Set(args.map((_, index) => index));
        return {code: fn.code, p: 0, slots, initialized, base, depth};
    }
    const stack = [];
    const globals = [];
    const initializedGlobals = new Set();
    let frame = {code: program.code, p: 0, slots: globals, initialized: initializedGlobals, base: 0, depth: 0};
    const frames = [];
    function call(fn, args) {
        if (frame.depth >= limits.maxCallDepth) { throw new RangeError(`Guest call depth limit ${limits.maxCallDepth} exceeded.`); }
        frames.push(frame);
        frame = makeFrame(fn, args, stack.length, frame.depth + 1);
        metrics.maxFrames = Math.max(metrics.maxFrames, frame.depth);
    }
    function builtin(id, args) {
        const name = IntrinsicDefinitions[id].name;
        metrics.builtinCalls += 1;
        const [a, b, c] = args;
        switch (name) {
            case "rtPush":
                if (!Array.isArray(a)) { throw new TypeError("rtPush requires an array."); }
                size(a.length + 1); return primitives.rtPush(a, b);
            case "rtPop":
                if (!Array.isArray(a)) { throw new TypeError("rtPop requires an array."); }
                return primitives.rtPop(a);
            case "rtSlice": {
                if (typeof a !== "string" || !Number.isSafeInteger(b) || !Number.isSafeInteger(c)) { throw new TypeError("rtSlice requires a string and integer bounds."); }
                const normalize = n => n < 0 ? Math.max(a.length + n, 0) : Math.min(n, a.length);
                charge(Math.max(0, normalize(c) - normalize(b)));
                return primitives.rtSlice(a, b, c);
            }
            case "rtNumber":
                if (typeof a !== "string") { throw new TypeError("rtNumber requires a string."); }
                charge(a.length); return primitives.rtNumber(a);
            case "rtCharCode":
                if (typeof a !== "string" || !Number.isSafeInteger(b)) { throw new TypeError("rtCharCode requires a string and integer index."); }
                return primitives.rtCharCode(a, b);
            case "rtFromCharCode":
                if (typeof a !== "number") { throw new TypeError("rtFromCharCode requires a number."); }
                return primitives.rtFromCharCode(a);
            case "rtWhitespace":
                if (typeof a !== "string" || a.length !== 1) { throw new TypeError("rtWhitespace requires one UTF-16 unit."); }
                return primitives.rtWhitespace(a);
            case "rtFreeze":
                if (a === null || typeof a !== "object") { throw new TypeError("rtFreeze requires an array or record."); }
                charge(Array.isArray(a) ? a.length : Object.keys(a).length);
                return primitives.rtFreeze(a);
            case "rtTrap":
                if (typeof a !== "string") { throw new TypeError("rtTrap requires a string."); }
                return primitives.rtTrap(a);
            case "rtIsArray": return primitives.rtIsArray(a);
            case "rtType": return primitives.rtType(a);
            case "rtIsSafeInteger": return primitives.rtIsSafeInteger(a);
            default: throw new RangeError("Unknown builtin.");
        }
    }
    try {
        const args = entryIndex < 0 ? [] : copyGuestData(inputArgs, {toGuest: true, maxValueSize: limits.maxValueSize, charge});
        for (;;) {
            if (frame.p >= frame.code.length) { throw new RangeError("Bytecode program ended without Return."); }
            charge(1);
            metrics.instructions += 1;
            const opcode = frame.code[frame.p++];
            const instruction = InstructionSet[opcode];
            let operand;
            if (instruction.operand !== null) { operand = frame.code[frame.p++]; }
            let pops = instruction.pops;
            if (opcode === Opcode.MakeArray) { pops = operand; }
            if (opcode === Opcode.MakeRecord) { pops = operand * 2; }
            if (opcode === Opcode.Call) { pops = program.functions[operand].arity; }
            if (opcode === Opcode.Builtin) { pops = IntrinsicDefinitions[operand].arity; }
            if (stack.length - frame.base < pops) { throw new RangeError(`Stack underflow while executing ${instruction.name}.`); }
            switch (opcode) {
                case Opcode.Constant: {
                    const value = program.constants[operand];
                    if (typeof value === "string") { size(value.length); }
                    stack.push(value); break;
                }
                case Opcode.StoreSlot: frame.slots[operand] = stack.pop(); frame.initialized.add(operand); break;
                case Opcode.LoadSlot:
                    if (!frame.initialized.has(operand)) { throw new ReferenceError(`Slot ${operand} was read before initialization.`); }
                    stack.push(frame.slots[operand]); break;
                case Opcode.StoreGlobal: globals[operand] = stack.pop(); initializedGlobals.add(operand); break;
                case Opcode.LoadGlobal:
                    if (!initializedGlobals.has(operand)) { throw new ReferenceError(`Global slot ${operand} was read before initialization.`); }
                    stack.push(globals[operand]); break;
                case Opcode.Pop: stack.pop(); break;
                case Opcode.Duplicate: stack.push(stack.at(-1)); break;
                case Opcode.Jump: frame.p = operand; break;
                case Opcode.JumpIfFalse: if (!stack.pop()) { frame.p = operand; } break;
                case Opcode.Negate: stack.push(-scalar(stack.pop())); break;
                case Opcode.Positive: stack.push(+scalar(stack.pop())); break;
                case Opcode.Not: stack.push(!stack.pop()); break;
                case Opcode.GetProperty: {
                    const key = stack.pop(); const object = stack.pop();
                    stack.push(getProperty(object, key)); break;
                }
                case Opcode.SetProperty: {
                    const value = stack.pop(); const key = stack.pop(); const object = stack.pop();
                    stack.push(setProperty(object, key, value, limits.maxValueSize)); break;
                }
                case Opcode.MakeArray: {
                    size(operand); charge(operand);
                    const values = stack.splice(stack.length - operand, operand);
                    stack.push(values); break;
                }
                case Opcode.MakeRecord: {
                    size(operand); charge(operand * 2);
                    const start = stack.length - operand * 2;
                    const record = Object.create(null);
                    for (let i = start; i < stack.length; i += 2) {
                        const key = stack[i];
                        if (typeof key !== "string" || Object.hasOwn(record, key)) { throw new TypeError("Invalid or duplicate record key."); }
                        record[key] = stack[i + 1];
                    }
                    stack.length = start; stack.push(record); break;
                }
                case Opcode.Call: {
                    charge(pops);
                    const values = stack.splice(stack.length - pops, pops);
                    call(program.functions[operand], values); break;
                }
                case Opcode.Builtin: {
                    charge(pops);
                    const values = stack.splice(stack.length - pops, pops);
                    stack.push(builtin(operand, values)); break;
                }
                case Opcode.Return: {
                    const result = stack.pop();
                    stack.length = frame.base;
                    if (frames.length > 0) { frame = frames.pop(); stack.push(result); }
                    else if (entryIndex >= 0) {
                        const fn = program.functions[entryIndex];
                        entryIndex = -1;
                        if (limits.maxCallDepth < 1) { throw new RangeError("Guest call depth limit exceeded."); }
                        frame = makeFrame(fn, args, 0, 1);
                        metrics.maxFrames = Math.max(metrics.maxFrames, 1);
                    } else { return copyGuestData(result, {maxValueSize: limits.maxValueSize, charge}); }
                    break;
                }
                default: {
                    const right = stack.pop(); const left = stack.pop();
                    if (opcode !== Opcode.Equal && opcode !== Opcode.NotEqual) { scalar(left); scalar(right); }
                    let value;
                    switch (opcode) {
                        case Opcode.Add:
                            if (typeof left === "string" || typeof right === "string") {
                                const a = String(left); const b = String(right);
                                size(a.length + b.length); charge(a.length + b.length);
                            }
                            value = left + right; break;
                        case Opcode.Subtract: value = left - right; break;
                        case Opcode.Multiply: value = left * right; break;
                        case Opcode.Divide: value = left / right; break;
                        case Opcode.Equal: value = left === right; break;
                        case Opcode.NotEqual: value = left !== right; break;
                        case Opcode.Less: value = left < right; break;
                        case Opcode.LessEqual: value = left <= right; break;
                        case Opcode.Greater: value = left > right; break;
                        case Opcode.GreaterEqual: value = left >= right; break;
                        default: throw new RangeError(`Unknown opcode ${opcode}.`);
                    }
                    if (typeof left === "string" || typeof right === "string") {
                        if (opcode !== Opcode.Add) { charge((typeof left === "string" ? left.length : 0) + (typeof right === "string" ? right.length : 0)); }
                    }
                    stack.push(value);
                }
            }
            size(stack.length);
        }
    } finally {
        if (limits.stats !== undefined) { Object.assign(limits.stats, metrics); }
    }
}
export function execute(input, options = {}) { return runMachine(input, null, [], options); }
export function invokeEntry(input, entryName, args, options = {}) {
    if (typeof entryName !== "string") { throw new TypeError("Entry name must be a string."); }
    return runMachine(input, entryName, args, options);
}
