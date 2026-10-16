import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "../src/analyzer.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";

function analyzeSource(source) {
    const lexed = tokenize(source);
    assert.equal(lexed.ok, true);
    const parsed = parse(source, lexed.tokens);
    assert.equal(parsed.ok, true);
    return analyze(parsed.ast);
}

test("binds nearest lexical names to stable slots", () => {
    const result = analyzeSource("let value = 1; { const value = 2; value; } value;");

    assert.equal(result.ok, true);
    assert.equal(result.program.slotCount, 2);
    assert.equal(result.program.body[0].slot, 0);
    assert.equal(result.program.body[1].body[0].slot, 1);
    assert.equal(result.program.body[1].body[1].expression.slot, 1);
    assert.equal(result.program.body[2].expression.slot, 0);
});

test("rejects assignment to a constant", () => {
    const source = "const value = 1; value = 2; value;";
    const result = analyzeSource(source);

    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics[0], {
        stage: "analyzer",
        message: "Cannot assign to constant 'value'.",
        start: source.indexOf("value", 12),
        end: source.indexOf("value", 12) + 5,
    });
});

test("reports a temporal dead zone read", () => {
    const source = "let value = value; value;";
    const result = analyzeSource(source);

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].stage, "analyzer");
    assert.equal(result.diagnostics[0].message, "Cannot access 'value' before initialization.");
    assert.equal(result.diagnostics[0].start, source.indexOf("value", 9));
});

test("rejects duplicate declarations in one scope", () => {
    const result = analyzeSource("let value = 1; const value = 2; value;");

    assert.equal(result.ok, false);
    assert.equal(
        result.diagnostics[0].message,
        "Identifier 'value' is already declared in this scope.",
    );
});

test("reports unresolved names before bytecode emission", () => {
    const result = analyzeSource("missing;");

    assert.deepEqual(result, {
        ok: false,
        diagnostics: [
            {
                stage: "analyzer",
                message: "Unknown identifier 'missing'.",
                start: 0,
                end: 7,
            },
        ],
    });
});

test("requires a final top-level expression statement", () => {
    const result = analyzeSource("let value = 1;");

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].message, "Program must end with an expression statement.");
});
