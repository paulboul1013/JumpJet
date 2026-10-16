import assert from "node:assert/strict";
import test from "node:test";

import { Opcode } from "../src/bytecode.js";
import { emit } from "../src/compiler.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";

function emitSource(source) {
    const lexed = tokenize(source);
    assert.equal(lexed.ok, true);
    const parsed = parse(source, lexed.tokens);
    assert.equal(parsed.ok, true);
    return emit(parsed.ast);
}

test("emits deterministic bytecode for declarations and arithmetic", () => {
    const result = emitSource("let answer = 1 + 2 * 3; answer;");

    assert.deepEqual(result, {
        ok: true,
        program: {
            version: 1,
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

test("reports an unknown identifier with its source span", () => {
    const result = emitSource("missing;");

    assert.deepEqual(result, {
        ok: false,
        diagnostics: [
            {
                stage: "compiler",
                message: "Unknown identifier 'missing'.",
                start: 0,
                end: 7,
            },
        ],
    });
});

test("rejects duplicate declarations", () => {
    const result = emitSource("let value = 1; let value = 2; value;");

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].message, "Identifier 'value' is already declared.");
    assert.equal(result.diagnostics[0].start, 19);
    assert.equal(result.diagnostics[0].end, 24);
});

test("requires a final expression statement", () => {
    const result = emitSource("let value = 1;");

    assert.deepEqual(result, {
        ok: false,
        diagnostics: [
            {
                stage: "compiler",
                message: "Program must end with an expression statement.",
                start: 0,
                end: 14,
            },
        ],
    });
});
