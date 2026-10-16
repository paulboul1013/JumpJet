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

test("parses every expression precedence layer", () => {
    const result = parseSource("!false === 1 < 2 + 3 * 4;");

    assert.equal(result.ok, true);
    const expression = result.ast.body[0].expression;
    assert.equal(expression.operator, "===");
    assert.equal(expression.left.type, "UnaryExpression");
    assert.equal(expression.left.operator, "!");
    assert.equal(expression.left.argument.value, false);
    assert.equal(expression.right.operator, "<");
    assert.equal(expression.right.right.operator, "+");
    assert.equal(expression.right.right.right.operator, "*");
});

test("parses right-associative assignment", () => {
    const result = parseSource("first = second = 4;");

    assert.equal(result.ok, true);
    const expression = result.ast.body[0].expression;
    assert.equal(expression.type, "AssignmentExpression");
    assert.equal(expression.target.name, "first");
    assert.equal(expression.value.type, "AssignmentExpression");
    assert.equal(expression.value.target.name, "second");
});

test("parses const declarations and if else blocks", () => {
    const result = parseSource("const ready = true; if (ready) { 1; } else if (false) { 2; }");

    assert.equal(result.ok, true);
    assert.equal(result.ast.body[0].kind, "const");
    assert.equal(result.ast.body[0].init.type, "BooleanLiteral");
    assert.equal(result.ast.body[1].type, "IfStatement");
    assert.equal(result.ast.body[1].consequent.type, "BlockStatement");
    assert.equal(result.ast.body[1].alternate.type, "IfStatement");
});

test("rejects a non-identifier assignment target", () => {
    const result = parseSource("(1 + 2) = 3;");

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].message, "Invalid assignment target.");
    assert.equal(result.diagnostics[0].start, 0);
    assert.equal(result.diagnostics[0].end, 7);
});
