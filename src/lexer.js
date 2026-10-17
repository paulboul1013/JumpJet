import { rtFreeze, rtPush, rtSlice, rtType, rtTrap, rtWhitespace } from "./runtime.js";

export const TokenKind = rtFreeze({
    Number: "Number", String: "String", Identifier: "Identifier",
    Let: "Let", Const: "Const", True: "True", False: "False", Null: "Null",
    Undefined: "Undefined", If: "If", Else: "Else", While: "While",
    Function: "Function", Return: "Return", Plus: "Plus", Minus: "Minus",
    Star: "Star", Slash: "Slash", Bang: "Bang", Equal: "Equal",
    EqualEqualEqual: "EqualEqualEqual", BangEqualEqual: "BangEqualEqual",
    Less: "Less", LessEqual: "LessEqual", Greater: "Greater", GreaterEqual: "GreaterEqual",
    And: "And", Or: "Or", LeftParen: "LeftParen", RightParen: "RightParen",
    LeftBrace: "LeftBrace", RightBrace: "RightBrace", LeftBracket: "LeftBracket",
    RightBracket: "RightBracket", Semicolon: "Semicolon", Comma: "Comma",
    Colon: "Colon", Dot: "Dot", Eof: "Eof"
});
const lexerSymbols = [
    ["===", "EqualEqualEqual"], ["!==", "BangEqualEqual"], ["<=", "LessEqual"],
    [">=", "GreaterEqual"], ["&&", "And"], ["||", "Or"],
    ["+", "Plus"], ["-", "Minus"], ["*", "Star"], ["/", "Slash"], ["!", "Bang"],
    ["=", "Equal"], ["<", "Less"], [">", "Greater"], ["(", "LeftParen"],
    [")", "RightParen"], ["{", "LeftBrace"], ["}", "RightBrace"],
    ["[", "LeftBracket"], ["]", "RightBracket"], [";", "Semicolon"],
    [",", "Comma"], [":", "Colon"], [".", "Dot"]
];
const lexerKeywords = [
    ["let", "Let"], ["const", "Const"], ["true", "True"], ["false", "False"],
    ["null", "Null"], ["undefined", "Undefined"], ["if", "If"], ["else", "Else"],
    ["while", "While"], ["function", "Function"], ["return", "Return"]
];
function lexDigit(c) { return c >= "0" && c <= "9"; }
function lexNameStart(c) {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
}
function lexNamePart(c) { return lexNameStart(c) || lexDigit(c); }
function lexToken(kind, start, end) { return rtFreeze({kind: kind, start: start, end: end}); }
function lexFail(message, start, end) {
    return {ok: false, diagnostics: [{stage: "lexer", message: message, start: start, end: end}]};
}
export function tokenize(source) {
    if (rtType(source) !== "string") { rtTrap("Source must be a string."); }
    const tokens = [];
    let p = 0;
    while (p < source.length) {
        const c = source[p];
        const start = p;
        if (rtWhitespace(c)) {
            p = p + 1;
        } else if (c === "/" && source[p + 1] === "/") {
            p = p + 2;
            while (p < source.length && source[p] !== "\n" && source[p] !== "\r" && source[p] !== "\u2028" && source[p] !== "\u2029") { p = p + 1; }
        } else if (c === "/" && source[p + 1] === "*") {
            p = p + 2;
            while (p < source.length && !(source[p] === "*" && source[p + 1] === "/")) { p = p + 1; }
            if (p >= source.length) { return lexFail("Unterminated block comment.", start, p); }
            p = p + 2;
        } else if (c === "'" || c === '"') {
            p = p + 1;
            let closed = false;
            while (p < source.length && !closed) {
                if (source[p] === c) { closed = true; }
                else if (source[p] === "\n" || source[p] === "\r" || source[p] === "\u2028" || source[p] === "\u2029") {
                    return lexFail("Unterminated string literal.", start, p);
                } else if (source[p] === "\\") { p = p + 1; }
                p = p + 1;
            }
            if (!closed) { return lexFail("Unterminated string literal.", start, source.length); }
            rtPush(tokens, lexToken(TokenKind.String, start, p));
        } else if (lexDigit(c)) {
            p = p + 1;
            while (p < source.length && lexDigit(source[p])) { p = p + 1; }
            if (source[p] === "." && p + 1 < source.length && lexDigit(source[p + 1])) {
                p = p + 2;
                while (p < source.length && lexDigit(source[p])) { p = p + 1; }
            }
            rtPush(tokens, lexToken(TokenKind.Number, start, p));
        } else if (lexNameStart(c)) {
            p = p + 1;
            while (p < source.length && lexNamePart(source[p])) { p = p + 1; }
            const text = rtSlice(source, start, p);
            let kind = TokenKind.Identifier;
            let k = 0;
            while (k < lexerKeywords.length) {
                if (lexerKeywords[k][0] === text) { kind = lexerKeywords[k][1]; }
                k = k + 1;
            }
            rtPush(tokens, lexToken(kind, start, p));
        } else {
            let k = 0;
            let matched = false;
            while (k < lexerSymbols.length && !matched) {
                const symbol = lexerSymbols[k];
                if (rtSlice(source, p, p + symbol[0].length) === symbol[0]) {
                    p = p + symbol[0].length;
                    rtPush(tokens, lexToken(symbol[1], start, p));
                    matched = true;
                }
                k = k + 1;
            }
            if (!matched) { return lexFail("Unexpected character '" + c + "'.", p, p + 1); }
        }
    }
    rtPush(tokens, lexToken(TokenKind.Eof, p, p));
    return {ok: true, tokens: rtFreeze(tokens)};
}
