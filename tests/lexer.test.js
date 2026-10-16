import assert from "node:assert/strict";
import test from "node:test";

import { TokenKind, tokenize } from "../src/lexer.js";

test("tokenizes the first supported JavaScript slice with source spans", () => {
    const source = "let answer = 12.5 + value;";
    const result = tokenize(source);

    assert.equal(result.ok, true);
    assert.deepEqual(
        result.tokens.map(({ kind, start, end }) => ({ kind, start, end })),
        [
            { kind: TokenKind.Let, start: 0, end: 3 },
            { kind: TokenKind.Identifier, start: 4, end: 10 },
            { kind: TokenKind.Equal, start: 11, end: 12 },
            { kind: TokenKind.Number, start: 13, end: 17 },
            { kind: TokenKind.Plus, start: 18, end: 19 },
            { kind: TokenKind.Identifier, start: 20, end: 25 },
            { kind: TokenKind.Semicolon, start: 25, end: 26 },
            { kind: TokenKind.Eof, start: 26, end: 26 },
        ],
    );
});

test("skips JavaScript whitespace", () => {
    const result = tokenize("\n\t 1\r + 2 ; ");

    assert.equal(result.ok, true);
    assert.deepEqual(
        result.tokens.map((token) => token.kind),
        [TokenKind.Number, TokenKind.Plus, TokenKind.Number, TokenKind.Semicolon, TokenKind.Eof],
    );
});

test("reports an unexpected character at its source position", () => {
    const result = tokenize("1 @ 2;");

    assert.deepEqual(result, {
        ok: false,
        diagnostics: [
            {
                stage: "lexer",
                message: "Unexpected character '@'.",
                start: 2,
                end: 3,
            },
        ],
    });
});

test("tokenizes control-flow keywords, braces, and longest-match operators", () => {
    const source = "const ready = true; if (!ready !== false) { ready === 1 <= 2 >= 0; } else {}";
    const result = tokenize(source);

    assert.equal(result.ok, true);
    assert.deepEqual(
        result.tokens.map((token) => token.kind),
        [
            TokenKind.Const,
            TokenKind.Identifier,
            TokenKind.Equal,
            TokenKind.True,
            TokenKind.Semicolon,
            TokenKind.If,
            TokenKind.LeftParen,
            TokenKind.Bang,
            TokenKind.Identifier,
            TokenKind.BangEqualEqual,
            TokenKind.False,
            TokenKind.RightParen,
            TokenKind.LeftBrace,
            TokenKind.Identifier,
            TokenKind.EqualEqualEqual,
            TokenKind.Number,
            TokenKind.LessEqual,
            TokenKind.Number,
            TokenKind.GreaterEqual,
            TokenKind.Number,
            TokenKind.Semicolon,
            TokenKind.RightBrace,
            TokenKind.Else,
            TokenKind.LeftBrace,
            TokenKind.RightBrace,
            TokenKind.Eof,
        ],
    );
});
