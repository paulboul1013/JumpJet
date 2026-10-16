export const TokenKind = Object.freeze({
    Number: "Number",
    Identifier: "Identifier",
    Let: "Let",
    Plus: "Plus",
    Minus: "Minus",
    Star: "Star",
    Slash: "Slash",
    Equal: "Equal",
    LeftParen: "LeftParen",
    RightParen: "RightParen",
    Semicolon: "Semicolon",
    Eof: "Eof",
});

const singleCharacterTokens = Object.freeze({
    "+": TokenKind.Plus,
    "-": TokenKind.Minus,
    "*": TokenKind.Star,
    "/": TokenKind.Slash,
    "=": TokenKind.Equal,
    "(": TokenKind.LeftParen,
    ")": TokenKind.RightParen,
    ";": TokenKind.Semicolon,
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
            const kind = text === "let" ? TokenKind.Let : TokenKind.Identifier;
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
