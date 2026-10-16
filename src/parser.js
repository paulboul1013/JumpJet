import { TokenKind } from "./lexer.js";

const additiveOperators = Object.freeze({
    [TokenKind.Plus]: "+",
    [TokenKind.Minus]: "-",
});

const multiplicativeOperators = Object.freeze({
    [TokenKind.Star]: "*",
    [TokenKind.Slash]: "/",
});

export function parse(source, tokens) {
    if (typeof source !== "string") {
        throw new TypeError("Source must be a string.");
    }
    if (!Array.isArray(tokens)) {
        throw new TypeError("Tokens must be an array.");
    }

    let position = 0;
    let diagnostic = null;

    function current() {
        return tokens[position];
    }

    function advance() {
        const token = current();
        if (token?.kind !== TokenKind.Eof) {
            position += 1;
        }
        return token;
    }

    function fail(message, token = current()) {
        if (diagnostic === null) {
            diagnostic = {
                stage: "parser",
                message,
                start: token?.start ?? source.length,
                end: token?.end ?? source.length,
            };
        }
        return null;
    }

    function consume(kind, message) {
        if (current()?.kind !== kind) {
            return fail(message);
        }
        return advance();
    }

    function parsePrimary() {
        const token = current();

        if (token?.kind === TokenKind.Number) {
            advance();
            return {
                type: "NumericLiteral",
                value: Number(source.slice(token.start, token.end)),
                start: token.start,
                end: token.end,
            };
        }

        if (token?.kind === TokenKind.Identifier) {
            advance();
            return {
                type: "Identifier",
                name: source.slice(token.start, token.end),
                start: token.start,
                end: token.end,
            };
        }

        if (token?.kind === TokenKind.LeftParen) {
            const leftParen = advance();
            const expression = parseExpression();
            if (expression === null) {
                return null;
            }
            const rightParen = consume(TokenKind.RightParen, "Expected ')' after expression.");
            if (rightParen === null) {
                return null;
            }
            return { ...expression, start: leftParen.start, end: rightParen.end };
        }

        return fail("Expected an expression.", token);
    }

    function parseBinary(parseOperand, operators) {
        let expression = parseOperand();
        if (expression === null) {
            return null;
        }

        while (operators[current()?.kind] !== undefined) {
            const operatorToken = advance();
            const right = parseOperand();
            if (right === null) {
                return null;
            }
            expression = {
                type: "BinaryExpression",
                operator: operators[operatorToken.kind],
                left: expression,
                right,
                start: expression.start,
                end: right.end,
            };
        }

        return expression;
    }

    function parseMultiplicative() {
        return parseBinary(parsePrimary, multiplicativeOperators);
    }

    function parseExpression() {
        return parseBinary(parseMultiplicative, additiveOperators);
    }

    function parseVariableDeclaration() {
        const letToken = advance();
        const identifierToken = consume(
            TokenKind.Identifier,
            "Expected an identifier after 'let'.",
        );
        if (identifierToken === null) {
            return null;
        }
        if (consume(TokenKind.Equal, "Expected '=' after variable name.") === null) {
            return null;
        }

        const init = parseExpression();
        if (init === null) {
            return null;
        }

        const semicolon = consume(TokenKind.Semicolon, "Expected ';' after declaration.");
        if (semicolon === null) {
            return null;
        }

        return {
            type: "VariableDeclaration",
            kind: "let",
            id: {
                type: "Identifier",
                name: source.slice(identifierToken.start, identifierToken.end),
                start: identifierToken.start,
                end: identifierToken.end,
            },
            init,
            start: letToken.start,
            end: semicolon.end,
        };
    }

    function parseExpressionStatement() {
        const expression = parseExpression();
        if (expression === null) {
            return null;
        }

        const semicolon = consume(TokenKind.Semicolon, "Expected ';' after expression.");
        if (semicolon === null) {
            return null;
        }

        return {
            type: "ExpressionStatement",
            expression,
            start: expression.start,
            end: semicolon.end,
        };
    }

    const body = [];
    while (current()?.kind !== TokenKind.Eof && diagnostic === null) {
        const statement =
            current()?.kind === TokenKind.Let
                ? parseVariableDeclaration()
                : parseExpressionStatement();
        if (statement !== null) {
            body.push(statement);
        }
    }

    if (diagnostic !== null) {
        return { ok: false, diagnostics: [diagnostic] };
    }

    return {
        ok: true,
        ast: {
            type: "Program",
            body,
            start: body[0]?.start ?? 0,
            end: body.at(-1)?.end ?? 0,
        },
    };
}
