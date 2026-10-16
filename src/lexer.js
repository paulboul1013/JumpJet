export const TokenKind = Object.freeze({
    Number: "Number",
    Identifier: "Identifier",
    Let: "Let",
    Const: "Const",
    True: "True",
    False: "False",
    If: "If",
    Else: "Else",
    Plus: "Plus",
    Minus: "Minus",
    Star: "Star",
    Slash: "Slash",
    Bang: "Bang",
    Equal: "Equal",
    EqualEqualEqual: "EqualEqualEqual",
    BangEqualEqual: "BangEqualEqual",
    Less: "Less",
    LessEqual: "LessEqual",
    Greater: "Greater",
    GreaterEqual: "GreaterEqual",
    LeftParen: "LeftParen",
    RightParen: "RightParen",
    LeftBrace: "LeftBrace",
    RightBrace: "RightBrace",
    Semicolon: "Semicolon",
    Eof: "Eof",
});

const singleCharacterTokens = Object.freeze({
    "+": TokenKind.Plus,
    "-": TokenKind.Minus,
    "*": TokenKind.Star,
    "/": TokenKind.Slash,
    "!": TokenKind.Bang,
    "=": TokenKind.Equal,
    "<": TokenKind.Less,
    ">": TokenKind.Greater,
    "(": TokenKind.LeftParen,
    ")": TokenKind.RightParen,
    "{": TokenKind.LeftBrace,
    "}": TokenKind.RightBrace,
    ";": TokenKind.Semicolon,
});

const multiCharacterTokens = Object.freeze([
    ["===", TokenKind.EqualEqualEqual],
    ["!==", TokenKind.BangEqualEqual],
    ["<=", TokenKind.LessEqual],
    [">=", TokenKind.GreaterEqual],
]);

const keywords = Object.freeze({
    let: TokenKind.Let,
    const: TokenKind.Const,
    true: TokenKind.True,
    false: TokenKind.False,
    if: TokenKind.If,
    else: TokenKind.Else,
});

function isDigit(character) {
    return character >= "0" && character <= "9";
}

function isIdentifierStart(character) {
    return (
        (character >= "a" && character <= "z") ||
        (character >= "A" && character <= "Z") ||
        character === "_" ||
        character === "$"
    );
}

function isIdentifierPart(character) {
    return isIdentifierStart(character) || isDigit(character);
}

function makeToken(kind, start, end) {
    return Object.freeze({ kind, start, end });
}

export function tokenize(source) {
    if (typeof source !== "string") {
        throw new TypeError("Source must be a string.");
    }

    const tokens = [];
    let position = 0;

    while (position < source.length) {
        const character = source[position];

        if (/\s/u.test(character)) {
            position += 1;
            continue;
        }

        const multiCharacterToken = multiCharacterTokens.find(([text]) =>
            source.startsWith(text, position),
        );
        if (multiCharacterToken !== undefined) {
            const [text, kind] = multiCharacterToken;
            tokens.push(makeToken(kind, position, position + text.length));
            position += text.length;
            continue;
        }

        const singleCharacterKind = singleCharacterTokens[character];
        if (singleCharacterKind !== undefined) {
            tokens.push(makeToken(singleCharacterKind, position, position + 1));
            position += 1;
            continue;
        }

        if (isDigit(character)) {
            const start = position;
            position += 1;

            while (position < source.length && isDigit(source[position])) {
                position += 1;
            }

            if (
                source[position] === "." &&
                position + 1 < source.length &&
                isDigit(source[position + 1])
            ) {
                position += 2;
                while (position < source.length && isDigit(source[position])) {
                    position += 1;
                }
            }

            tokens.push(makeToken(TokenKind.Number, start, position));
            continue;
        }

        if (isIdentifierStart(character)) {
            const start = position;
            position += 1;

            while (position < source.length && isIdentifierPart(source[position])) {
                position += 1;
            }

            const text = source.slice(start, position);
            const kind = Object.hasOwn(keywords, text) ? keywords[text] : TokenKind.Identifier;
            tokens.push(makeToken(kind, start, position));
            continue;
        }

        return {
            ok: false,
            diagnostics: [
                {
                    stage: "lexer",
                    message: `Unexpected character '${character}'.`,
                    start: position,
                    end: position + 1,
                },
            ],
        };
    }

    tokens.push(makeToken(TokenKind.Eof, source.length, source.length));
    return { ok: true, tokens: Object.freeze(tokens) };
}
