import assert from "node:assert/strict";
import test from "node:test";
import { compile, run } from "../src/index.js";
import { tokenize, TokenKind } from "../src/lexer.js";

for (const [name, source] of [
    ["read before a later top-level declaration", "value; let value = 2; value;"],
    ["read before an inner declaration", "let value = 1; { value; let value = 2; } value;"],
    ["write before an inner declaration", "let value = 1; { value = 2; let value = 3; } value;"],
    ["write in an inner binding's initializer", "let value = 1; { let value = (value = 2); } value;"],
    ["write before a later top-level declaration", "value = 1; let value = 2; value;"],
]) {
    test(`reports TDZ for ${name}`, () => {
        const result = compile(source);

        assert.equal(result.ok, false);
        assert.equal(result.diagnostics[0].stage, "analyzer");
        assert.equal(result.diagnostics[0].message, "Cannot access 'value' before initialization.");
    });
}

test("preserves initialized shadowing and writes to the nearest declared binding", () => {
    const result = compile("let value = 1; { let value = 2; value = 3; } value;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 1);
});

for (const name of ["constructor", "toString", "__proto__"]) {
    test(`tokenizes prototype name ${name} as an identifier`, () => {
        const result = tokenize(`${name};`);

        assert.equal(result.ok, true);
        assert.equal(result.tokens[0].kind, TokenKind.Identifier);
    });

    test(`compiles and executes a binding named ${name}`, () => {
        const result = compile(`let ${name} = 7; ${name} = ${name} + 1; ${name};`);

        assert.equal(result.ok, true);
        assert.equal(run(result.program), 8);
    });
}
