import assert from "node:assert/strict";
import test from "node:test";

import { compile, run } from "../src/index.js";

test("compiles and runs a declaration followed by an expression", () => {
    const result = compile("let answer = 1 + 2 * 3; answer;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 7);
});

test("parentheses change the result produced by the VM", () => {
    const result = compile("(1 + 2) * 3;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 9);
});

test("supports subtraction, division, and decimal literals", () => {
    const result = compile("20 / 4 - 1.5;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 3.5);
});

test("returns lexer diagnostics without entering later phases", () => {
    const result = compile("1 @ 2;");

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].stage, "lexer");
    assert.equal(result.diagnostics[0].start, 2);
});

test("returns parser diagnostics for malformed syntax", () => {
    const result = compile("let = 1;");

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].stage, "parser");
});

test("returns compiler diagnostics for unresolved names", () => {
    const result = compile("missing;");

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].stage, "analyzer");
});

test("compiles mutable state and conditional control flow", () => {
    const result = compile(`
        let score = 3;
        if (score < 5) {
            score = -score + 10;
        } else {
            score = 0;
        }
        score === 7;
    `);

    assert.equal(result.ok, true);
    assert.equal(run(result.program), true);
});

test("preserves outer bindings when a block shadows a name", () => {
    const result = compile("let value = 1; if (true) { const value = 4; value; } value;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 1);
});

test("chained assignment stores and returns the assigned value", () => {
    const result = compile("let first = 0; let second = 0; first = second = 4; first + second;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 8);
});

test("takes the else branch for a false condition", () => {
    const result = compile("let value = 0; if (false) { value = 1; } else { value = 2; } value;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 2);
});

test("rejects non-string source at the public boundary", () => {
    assert.throws(() => compile(null), /Source must be a string/);
});
