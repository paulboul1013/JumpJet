export function analyze(ast) {
    if (ast?.type !== "Program" || !Array.isArray(ast.body)) {
        throw new TypeError("Expected a Program AST.");
    }

    const lastStatement = ast.body.at(-1);
    if (lastStatement?.type !== "ExpressionStatement") {
        return {
            ok: false,
            diagnostics: [
                {
                    stage: "analyzer",
                    message: "Program must end with an expression statement.",
                    start: ast.start,
                    end: ast.end,
                },
            ],
        };
    }

    const scopes = [];
    let slotCount = 0;
    let diagnostic = null;

    function fail(message, node) {
        if (diagnostic === null) {
            diagnostic = {
                stage: "analyzer",
                message,
                start: node.start,
                end: node.end,
            };
        }
        return null;
    }

    function resolve(identifier) {
        for (let index = scopes.length - 1; index >= 0; index -= 1) {
            const binding = scopes[index].get(identifier.name);
            if (binding !== undefined) {
                if (!binding.initialized) {
                    return fail(
                        `Cannot access '${identifier.name}' before initialization.`,
                        identifier,
                    );
                }
                return binding;
            }
        }
        return fail(`Unknown identifier '${identifier.name}'.`, identifier);
    }

    function analyzeExpression(expression) {
        switch (expression.type) {
            case "NumericLiteral":
                return { ...expression, type: "BoundNumericLiteral" };
            case "BooleanLiteral":
                return { ...expression, type: "BoundBooleanLiteral" };
            case "Identifier": {
                const binding = resolve(expression);
                if (binding === null) {
                    return null;
                }
                return {
                    type: "BoundIdentifier",
                    slot: binding.slot,
                    start: expression.start,
                    end: expression.end,
                };
            }
            case "UnaryExpression": {
                const argument = analyzeExpression(expression.argument);
                return argument === null
                    ? null
                    : {
                        type: "BoundUnaryExpression",
                        operator: expression.operator,
                        argument,
                        start: expression.start,
                        end: expression.end,
                    };
            }
            case "BinaryExpression": {
                const left = analyzeExpression(expression.left);
                if (left === null) {
                    return null;
                }
                const right = analyzeExpression(expression.right);
                return right === null
                    ? null
                    : {
                        type: "BoundBinaryExpression",
                        operator: expression.operator,
                        left,
                        right,
                        start: expression.start,
                        end: expression.end,
                    };
            }
            case "AssignmentExpression": {
                const binding = resolve(expression.target);
                if (binding === null) {
                    return null;
                }
                if (binding.kind === "const") {
                    return fail(
                        `Cannot assign to constant '${expression.target.name}'.`,
                        expression.target,
                    );
                }
                const value = analyzeExpression(expression.value);
                return value === null
                    ? null
                    : {
                        type: "BoundAssignmentExpression",
                        slot: binding.slot,
                        value,
                        start: expression.start,
                        end: expression.end,
                    };
            }
            default:
                throw new TypeError(`Unsupported expression type '${expression.type}'.`);
        }
    }

    function analyzeStatement(statement) {
        switch (statement.type) {
            case "VariableDeclaration": {
                const binding = scopes.at(-1).get(statement.id.name);
                const init = analyzeExpression(statement.init);
                if (init === null) {
                    return null;
                }
                binding.initialized = true;
                return {
                    type: "BoundVariableDeclaration",
                    kind: statement.kind,
                    slot: binding.slot,
                    init,
                    start: statement.start,
                    end: statement.end,
                };
            }
            case "ExpressionStatement": {
                const expression = analyzeExpression(statement.expression);
                return expression === null
                    ? null
                    : {
                        type: "BoundExpressionStatement",
                        expression,
                        start: statement.start,
                        end: statement.end,
                    };
            }
            case "BlockStatement": {
                const body = analyzeBody(statement.body);
                return body !== null
                    ? {
                        type: "BoundBlockStatement",
                        body,
                        start: statement.start,
                        end: statement.end,
                    }
                    : null;
            }
            case "IfStatement": {
                const test = analyzeExpression(statement.test);
                if (test === null) {
                    return null;
                }
                const consequent = analyzeStatement(statement.consequent);
                if (consequent === null) {
                    return null;
                }
                const alternate = statement.alternate === null
                    ? null
                    : analyzeStatement(statement.alternate);
                if (statement.alternate !== null && alternate === null) {
                    return null;
                }
                return {
                    type: "BoundIfStatement",
                    test,
                    consequent,
                    alternate,
                    start: statement.start,
                    end: statement.end,
                };
            }
            default:
                throw new TypeError(`Unsupported statement type '${statement.type}'.`);
        }
    }

    function analyzeBody(statements) {
        const scope = new Map();
        // Lexical declarations shadow outer names throughout their scope.
        for (const statement of statements) {
            if (statement.type !== "VariableDeclaration") {
                continue;
            }
            if (scope.has(statement.id.name)) {
                return fail(
                    `Identifier '${statement.id.name}' is already declared in this scope.`,
                    statement.id,
                );
            }
            scope.set(statement.id.name, {
                kind: statement.kind,
                slot: slotCount,
                initialized: false,
            });
            slotCount += 1;
        }

        scopes.push(scope);
        const body = [];
        for (const statement of statements) {
            const boundStatement = analyzeStatement(statement);
            if (boundStatement === null) {
                break;
            }
            body.push(boundStatement);
        }
        scopes.pop();
        return diagnostic === null ? body : null;
    }

    const body = analyzeBody(ast.body);
    if (body === null) {
        return { ok: false, diagnostics: [diagnostic] };
    }

    return {
        ok: true,
        program: {
            type: "BoundProgram",
            body,
            slotCount,
            start: ast.start,
            end: ast.end,
        },
    };
}
