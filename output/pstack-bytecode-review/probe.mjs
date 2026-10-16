// Historical characterization of the frozen pre-fix engine, not the current
// engine. Corrected behavior is covered by tests/engine-boundaries.test.js.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { compile, run } from "../pstack-bytecode-fixes/before/src/index.js";
import { Opcode } from "../pstack-bytecode-fixes/before/src/bytecode.js";

const observations = [];
function observe(name, operation) {
    observations.push({ name, ...operation() });
}

observe("source-to-result baseline", () => {
    const compilation = compile("let score = 3; if (score < 5) { score = -score + 10; } else { score = 0; } score === 7;");
    assert.equal(compilation.ok, true);
    const result = run(compilation.program);
    assert.equal(result, true);
    return { kind: "baseline", result };
});

for (const identifier of ["constructor", "toString"]) {
    observe(`identifier ${identifier}`, () => {
        const source = `let ${identifier} = 1; ${identifier};`;
        const compilation = compile(source);
        assert.equal(compilation.ok, false);
        assert.equal(compilation.diagnostics[0].stage, "parser");
        return { kind: "gap", source, diagnostic: compilation.diagnostics[0] };
    });
}

observe("assignment before inner declaration", () => {
    const source = "let value = 1; { value = 2; let value = 3; } value;";
    const compilation = compile(source);
    assert.equal(compilation.ok, true);
    const result = run(compilation.program);
    assert.equal(result, 2);
    const native = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 3000 });
    assert.equal(native.error, undefined);
    assert.notEqual(native.status, 0);
    assert.match(native.stderr, /ReferenceError: Cannot access 'value' before initialization/);
    return { kind: "gap", source, jumpjet: result, native: "ReferenceError before initialization" };
});

observe("jump into operand", () => {
    const program = {
        version: 1,
        constants: Array(9).fill(42),
        code: [Opcode.Constant, 0, Opcode.Jump, 5, Opcode.Constant, Opcode.Return, Opcode.Return],
        slotCount: 0,
    };
    // Linear decoding has instruction starts at 0, 2, 4, 6. Index 5 is
    // Constant's operand, whose value 8 also happens to mean Return.
    const result = run(program);
    assert.equal(result, 42);
    return { kind: "gap", program, instructionStarts: [0, 2, 4, 6], target: 5, result };
});

observe("sparse constant pool", () => {
    const result = run({ version: 1, constants: new Array(1), code: [Opcode.Constant, 0, Opcode.Return], slotCount: 0 });
    assert.equal(result, undefined);
    return { kind: "gap", constantPool: "one hole", resultType: typeof result };
});

observe("unreachable invalid opcode", () => {
    const result = run({ version: 1, constants: [42], code: [Opcode.Constant, 0, Opcode.Return, 999], slotCount: 0 });
    assert.equal(result, 42);
    return { kind: "boundary-policy", trailingOpcode: 999, result };
});

observe("deep source escapes diagnostics", () => {
    const depth = 20000;
    assert.throws(() => compile("(".repeat(depth) + "1" + ")".repeat(depth) + ";"), RangeError);
    return { kind: "gap", parenthesisDepth: depth, result: "RangeError, rather than diagnostics" };
});

observe("backward jump has no execution limit", () => {
    const entry = new URL("../pstack-bytecode-fixes/before/src/index.js", import.meta.url).href;
    const childSource = `import { run } from ${JSON.stringify(entry)}; console.log('entered'); run({version:1,constants:[],code:[${Opcode.Jump},0],slotCount:0});`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], { encoding: "utf8", timeout: 750 });
    assert.match(child.stdout, /entered/);
    assert.equal(child.error?.code, "ETIMEDOUT");
    return { kind: "future-loop-risk", program: "Jump 0", termination: "parent killed child after 750 ms" };
});

console.log(JSON.stringify({ node: process.version, characterizationCount: observations.length, observations }, null, 2));
