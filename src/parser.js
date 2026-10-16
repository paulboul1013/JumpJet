import { TokenKind } from "./lexer.js";

const additiveOperators = Object.freeze({
    [TokenKind.Plus]: "+",
    [TokenKind.Minus]: "-",
});

const multiplicativeOperators = Object.freeze({
    [TokenKind.Star]: "*",
    [TokenKind.Slash]: "/",
});

const comparisonOperators = Object.freeze({
    [TokenKind.Less]: "<",
    [TokenKind.LessEqual]: "<=",
    [TokenKind.Greater]: ">",
    [TokenKind.GreaterEqual]: ">=",
});

const equalityOperators = Object.freeze({
    [TokenKind.EqualEqualEqual]: "===",
    [TokenKind.BangEqualEqual]: "!==",
});

const unaryOperators = Object.freeze({
    [TokenKind.Bang]: "!",
    [TokenKind.Plus]: "+",
    [TokenKind.Minus]: "-",
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

        if (token?.kind === TokenKind.True || token?.kind === TokenKind.False) {
            advance();
            return {
                type: "BooleanLiteral",
                value: token.kind === TokenKind.True,
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

    function parseUnary() {
        const operator = unaryOperators[current()?.kind];
        if (operator === undefined) {
            return parsePrimary();
        }

        const operatorToken = advance();
        const argument = parseUnary();
        if (argument === null) {
            return null;
        }
        return {
            type: "UnaryExpression",
            operator,
            argument,
            start: operatorToken.start,
            end: argument.end,
        };
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
        return parseBinary(parseUnary, multiplicativeOperators);
    }

    function parseAdditive() {
        return parseBinary(parseMultiplicative, additiveOperators);
    }

    function parseComparison() {
        return parseBinary(parseAdditive, comparisonOperators);
    }

    function parseEquality() {
        return parseBinary(parseComparison, equalityOperators);
    }

    function parseAssignment() {
        const target = parseEquality();
        if (target === null || current()?.kind !== TokenKind.Equal) {
            return target;
        }
        if (target.type !== "Identifier") {
            return fail("Invalid assignment target.", target);
        }

        advance();
        const value = parseAssignment();
        if (value === null) {
            return null;
        }
        return {
            type: "AssignmentExpression",
            target,
            value,
            start: target.start,
            end: value.end,
        };
    }

    function parseExpression() {
        return parseAssignment();
    }

    function parseVariableDeclaration() {
        const declarationToken = advance();
        const kind = declarationToken.kind === TokenKind.Let ? "let" : "const";
        const identifierToken = consume(
            TokenKind.Identifier,
            `Expected an identifier after '${kind}'.`,
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
            kind,
            id: {
                type: "Identifier",
                name: source.slice(identifierToken.start, identifierToken.end),
                start: identifierToken.start,
                end: identifierToken.end,
            },
            init,
            start: declarationToken.start,
            end: semicolon.end,
        };
    }

    function parseBlockStatement() {
        const leftBrace = consume(TokenKind.LeftBrace, "Expected '{' before block.");
        if (leftBrace === null) {
            return null;
        }

        const body = [];
        while (
            current()?.kind !== TokenKind.RightBrace &&
            current()?.kind !== TokenKind.Eof &&
            diagnostic === null
        ) {
            const statement = parseStatement();
            if (statement !== null) {
                body.push(statement);
            }
        }

        const rightBrace = consume(TokenKind.RightBrace, "Expected '}' after block.");
        if (rightBrace === null) {
            return null;
        }
        return {
            type: "BlockStatement",
            body,
            start: leftBrace.start,
            end: rightBrace.end,
        };
    }

    function parseIfStatement() {
        const ifToken = advance();
        if (consume(TokenKind.LeftParen, "Expected '(' after 'if'.") === null) {
            return null;
        }
        const test = parseExpression();
        if (test === null) {
            return null;
        }
        if (consume(TokenKind.RightParen, "Expected ')' after if condition.") === null) {
            return null;
        }
        const consequent = parseBlockStatement();
        if (consequent === null) {
            return null;
        }

        let alternate = null;
        if (current()?.kind === TokenKind.Else) {
            advance();
            alternate = current()?.kind === TokenKind.If
                ? parseIfStatement()
                : parseBlockStatement();
            if (alternate === null) {
                return null;
            }
        }

        return {
            type: "IfStatement",
            test,
            consequent,
            alternate,
            start: ifToken.start,
            end: alternate?.end ?? consequent.end,
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

    function parseStatement() {
        switch (current()?.kind) {
            case TokenKind.Let:
            case TokenKind.Const:
                return parseVariableDeclaration();
            case TokenKind.If:
                return parseIfStatement();
            case TokenKind.LeftBrace:
                return parseBlockStatement();
            default:
                return parseExpressionStatement();
        }
    }

    const body = [];
    while (current()?.kind !== TokenKind.Eof && diagnostic === null) {
        const statement = parseStatement();
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
