import assert from "node:assert/strict";
import test from "node:test";

import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";

function parseSource(source) {
    const lexed = tokenize(source);
    assert.equal(lexed.ok, true);
    return parse(source, lexed.tokens);
}

test("parses multiplication before addition", () => {
    const result = parseSource("1 + 2 * 3;");

    assert.equal(result.ok, true);
    const expression = result.ast.body[0].expression;
    assert.equal(expression.type, "BinaryExpression");
    assert.equal(expression.operator, "+");
    assert.equal(expression.left.value, 1);
    assert.equal(expression.right.operator, "*");
    assert.equal(expression.right.left.value, 2);
    assert.equal(expression.right.right.value, 3);
});

test("parentheses override arithmetic precedence", () => {
    const result = parseSource("(1 + 2) * 3;");

    assert.equal(result.ok, true);
    const expression = result.ast.body[0].expression;
    assert.equal(expression.operator, "*");
    assert.equal(expression.left.operator, "+");
    assert.equal(expression.right.value, 3);
});

test("parses a let declaration and identifier expression", () => {
    const result = parseSource("let answer = 7; answer;");

    assert.equal(result.ok, true);
    assert.equal(result.ast.body[0].type, "VariableDeclaration");
    assert.equal(result.ast.body[0].kind, "let");
    assert.equal(result.ast.body[0].id.name, "answer");
    assert.equal(result.ast.body[0].init.value, 7);
    assert.equal(result.ast.body[1].type, "ExpressionStatement");
    assert.equal(result.ast.body[1].expression.name, "answer");
});

test("reports malformed declarations at the unexpected token", () => {
    const result = parseSource("let = 1;");

    assert.deepEqual(result, {
        ok: false,
        diagnostics: [
            {
                stage: "parser",
                message: "Expected an identifier after 'let'.",
                start: 4,
                end: 5,
            },
        ],
    });
});
