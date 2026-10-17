import assert from "node:assert/strict";
import test from "node:test";
import {compile, run, invoke} from "../src/index.js";
import {Opcode, InstructionSet} from "../src/bytecode.js";
import {IntrinsicDefinitions} from "../src/runtime-symbols.js";
import {tokenize} from "../src/lexer.js";
import {emit} from "../src/compiler.js";
import {analyze} from "../src/analyzer.js";

function compiled(source) { const c = compile(source); assert.equal(c.ok, true, JSON.stringify(c)); return c.program; }
function bytecode(code, functions = [], constants = []) { return {version: 2, slotCount: 0, constants, code, functions}; }

test("ABI definitions cannot be mutated through their exported records", () => {
    assert.ok(Object.isFrozen(InstructionSet));
    assert.ok(InstructionSet.every(Object.isFrozen));
    assert.ok(Object.isFrozen(IntrinsicDefinitions));
    assert.ok(IntrinsicDefinitions.every(Object.isFrozen));
});
test("public phase shape checks retain their errors", () => {
    for (const value of [null, undefined, 2]) {
        assert.throws(() => analyze(value), /Expected a Program AST/);
        assert.throws(() => emit(value), /Expected a BoundProgram/);
    }
    for (const slotCount of [NaN, Infinity, 1.5, '2', -1]) {
        assert.throws(() => emit({type: "BoundProgram", body: [], slotCount, functions: []}), /Expected a BoundProgram/);
    }
});
for (const [name, source] of [
    ["function collision", "let f = 1; function f() {} 0;"],
    ["duplicate functions", "function f() {} function f() {} 0;"],
    ["duplicate parameters", "function f(a, a) { return a; } 0;"],
    ["parameter declaration collision", "function f(a) { let a = 1; return a; } 0;"],
    ["reserved variable", "let rtPush = 1; rtPush;"],
    ["reserved function", "function rtPush() {} 0;"],
    ["reserved parameter", "function f(rtPush) {} 0;"],
    ["function as value", "function f() {} f;"],
    ["callback", "function f(a) {} function g() {} f(g);"],
    ["nested function", "function f() { function g() {} } 0;"],
    ["arity", "function f(a) { return a; } f();"],
    ["method call", "let r = {}; r.toString();"],
    ["duplicate key", "let r = {x: 1, x: 2}; r;"],
    ["const global write", "const x = 0; function f() { x = 1; } 0;"],
    ["local TDZ", "function f() { x; let x = 1; } 0;"],
]) test(`rejects ${name}`, () => { assert.equal(compile(source).ok, false); });

for (const [name, source] of [
    ["array", "[".repeat(2000) + "0" + "]".repeat(2000) + ";"],
    ["record", "({x:".repeat(2000) + "0" + "})".repeat(2000) + ";"],
    ["member AST", "let x = {}; x" + ".x".repeat(2000) + ";"],
    ["call AST", "f" + "()".repeat(2000) + ";"],
    ["call arguments", "f(".repeat(2000) + "0" + ")".repeat(2000) + ";"],
    ["while", "while (false) {".repeat(2000) + "0;" + "}".repeat(2000) + "0;"],
    ["functions", "function f() {".repeat(2000) + "0;" + "}".repeat(2000) + "0;"],
]) test(`depth checks include ${name}`, () => {
    const result = compile(source);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].stage, "parser");
    assert.match(result.diagnostics[0].message, /(?:nesting|depth).*limit/);
});
test("all ECMAScript whitespace units and EOF comments keep UTF-16 spans", () => {
    const units = [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279];
    const space = String.fromCharCode(...units);
    const lexed = tokenize(space + "1;//😀");
    assert.equal(lexed.ok, true);
    assert.equal(lexed.tokens[0].start, space.length);
    assert.equal(lexed.tokens.at(-1).start, space.length + 6);
    assert.equal(tokenize("\u00851;").ok, false);
    assert.equal(tokenize("/*").ok, false);
    for (const source of ['"unterminated', '"\\uQQQQ";', '"\\q";', '"a\nb";']) { assert.equal(compile(source).ok, false); }
});
test("records expose own fields and arrays expose only data and length", () => {
    for (const source of ['({}).constructor;', '[1].constructor;', '"abc".toString;', '({}).__proto__;']) {
        assert.equal(run(compiled(source)), undefined);
    }
    assert.deepEqual(run(compiled('let a = [1]; a[1] = 2; a;')), [1, 2]);
    for (const source of ['let a = [1]; a[2] = 3; a;', 'let a = [1]; a.length = 0; a;', 'let a = {}; a.x = 1; a;', 'let a = rtFreeze([1]); a[0] = 2; a;']) {
        assert.throws(() => run(compiled(source)), /dense index|record field|frozen/);
    }
});
test("recursive budgets and call depth apply across every frame", () => {
    const p = compiled("function f(n) { return f(n + 1); } f(0);");
    assert.throws(() => run(p, {maxInstructions: 50}), /Instruction budget/);
    assert.throws(() => run(p, {maxInstructions: 10000, maxCallDepth: 4}), /call depth/);
    const stats = {};
    assert.throws(() => run(p, {maxInstructions: 50, stats}), /Instruction budget/);
    assert.equal(stats.work, 50);
});
test("host string work and data transfer consume finite work and size budgets", () => {
    const p = compiled('function f(s) { return rtNumber(s); } 0;');
    assert.throws(() => invoke(p, "f", ["1".repeat(100)], {maxInstructions: 110}), /Instruction budget/);
    assert.throws(() => invoke(p, "f", ["1".repeat(100)], {maxValueSize: 10}), /size limit/);
    assert.throws(() => run(compiled('"hello" + "world";'), {maxValueSize: 8}), /size limit/);
    assert.throws(() => run(compiled('rtSlice(1, 0, 1);')), /rtSlice requires/);
    assert.throws(() => run(compiled('rtTrap("stop");')), /stop/);
});
test("callee underflow cannot consume operands in its caller", () => {
    const p = bytecode([Opcode.Constant, 0, Opcode.Call, 0, Opcode.Return], [{name: "f", arity: 0, slotCount: 0, code: [Opcode.Pop]}], [42]);
    assert.throws(() => run(p), /Stack underflow.*Pop/);
});
test("verifies all function bodies and references even when unreachable", () => {
    const main = [Opcode.Constant, 0, Opcode.Return];
    for (const bad of [
        [Opcode.Call, 1], [Opcode.Builtin, IntrinsicDefinitions.length],
        [Opcode.LoadGlobal, 0], [Opcode.LoadSlot, 0], [Opcode.Constant, 1],
        [Opcode.Jump, 1], [Opcode.MakeArray], [Opcode.MakeRecord, -1], [999],
    ]) {
        const p = bytecode(main, [{name: "f", arity: 0, slotCount: 0, code: bad}], [0]);
        assert.throws(() => run(p), /out of bounds|instruction boundary|Missing operand|Invalid operand|Unknown opcode/);
    }
    assert.throws(() => run(bytecode(main, [{name: "f", arity: 1, slotCount: 0, code: []}], [0])), /arity/);
    assert.throws(() => run({...bytecode(main, [], [0]), version: 1}), /Unsupported bytecode version 1/);
});
test("function metadata and bodies use private snapshots", () => {
    let reads = 0;
    const p = compiled("function f() { return 3; } f();");
    const body = p.functions[0].code;
    Object.defineProperty(body, 0, {get() { reads += 1; return reads === 1 ? Opcode.Constant : 999; }});
    assert.equal(run(p), 3);
    assert.equal(reads, 1);
});
test("invoke copies own data, preserves aliases and rejects getters without calling them", () => {
    const p = compiled("function f(c) { c.x = c.x + 1; return c; } 0;");
    const input = {x: 1};
    assert.deepEqual(invoke(p, "f", [input]), {x: 2});
    assert.equal(input.x, 1);
    let reads = 0;
    const accessor = {get x() { reads += 1; return 0; }};
    assert.throws(() => invoke(p, "f", [accessor]), /Guest data.*accessors/);
    assert.equal(reads, 0);
    for (const bad of [new Date(), Symbol(), () => 0, new Array(2)]) { assert.throws(() => invoke(p, "f", [bad]), /Guest data/); }
    const identity = compiled("function f(c) { return c; } 0;");
    const shared = {a: 1}; const cyclic = {x: shared, y: shared}; cyclic.self = cyclic;
    const copied = invoke(identity, "f", [cyclic]);
    assert.equal(copied.x, copied.y); assert.equal(copied.self, copied);
    assert.throws(() => invoke(p, "f", []), /arity/);
    assert.throws(() => invoke(p, null, []), /Entry name/);
    const early = compiled("f(); let x = 1; function f() { return x; } 0;");
    assert.throws(() => run(early), /before initialization/);
});

test("slot initialization cannot be inherited from the host array prototype", () => {
    const p = bytecode([Opcode.LoadSlot, 0, Opcode.Return]);
    p.slotCount = 1;
    Object.defineProperty(Array.prototype, "0", {value: true, writable: true, configurable: true});
    try { assert.throws(() => run(p), /before initialization/); }
    finally { delete Array.prototype[0]; }
});
test("opcode metadata cannot be inherited for unreachable instructions", () => {
    const p = bytecode([Opcode.Constant, 0, Opcode.Return, 999], [], [42]);
    Object.defineProperty(Array.prototype, "999", {value: {name: "Fake", operand: null, pops: 0, pushes: 0}, writable: true, configurable: true});
    try { assert.throws(() => run(p), /Unknown opcode 999/); }
    finally { delete Array.prototype[999]; }
});
