import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "../src/analyzer.js";
import { Opcode } from "../src/bytecode.js";
import { emit } from "../src/compiler.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";

function emitSource(source) {
    const lexed = tokenize(source);
    assert.equal(lexed.ok, true);
    const parsed = parse(source, lexed.tokens);
    assert.equal(parsed.ok, true);
    const analyzed = analyze(parsed.ast);
    assert.equal(analyzed.ok, true);
    return emit(analyzed.program);
}

test("emits deterministic bytecode for declarations and arithmetic", () => {
    const result = emitSource("let answer = 1 + 2 * 3; answer;");

    assert.deepEqual(result, {
        ok: true,
        program: {
            version: 2, functions: [],
            constants: [1, 2, 3],
            code: [
                Opcode.Constant,
                0,
                Opcode.Constant,
                1,
                Opcode.Constant,
                2,
                Opcode.Multiply,
                Opcode.Add,
                Opcode.StoreSlot,
                0,
                Opcode.LoadSlot,
                0,
                Opcode.Return,
            ],
            slotCount: 1,
        },
    });
});

test("discards non-final expression statement values", () => {
    const result = emitSource("1; 2;");

    assert.equal(result.ok, true);
    assert.deepEqual(result.program.code, [
        Opcode.Constant,
        0,
        Opcode.Pop,
        Opcode.Constant,
        1,
        Opcode.Return,
    ]);
});

test("emits and patches conditional branches", () => {
    const result = emitSource(
        "let value = 1; if (true) { value = 2; } else { value = 3; } value;",
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.program.constants, [1, true, 2, 3]);
    assert.deepEqual(result.program.code, [
        Opcode.Constant, 0,
        Opcode.StoreSlot, 0,
        Opcode.Constant, 1,
        Opcode.JumpIfFalse, 16,
        Opcode.Constant, 2,
        Opcode.Duplicate,
        Opcode.StoreSlot, 0,
        Opcode.Pop,
        Opcode.Jump, 22,
        Opcode.Constant, 3,
        Opcode.Duplicate,
        Opcode.StoreSlot, 0,
        Opcode.Pop,
        Opcode.LoadSlot, 0,
        Opcode.Return,
    ]);
});
