import { BYTECODE_VERSION, Opcode } from "./bytecode.js";

const binaryOpcodes = Object.freeze({
    "+": Opcode.Add,
    "-": Opcode.Subtract,
    "*": Opcode.Multiply,
    "/": Opcode.Divide,
});

export function emit(ast) {
    if (ast?.type !== "Program" || !Array.isArray(ast.body)) {
        throw new TypeError("Expected a Program AST.");
    }

    const lastStatement = ast.body.at(-1);
    if (lastStatement?.type !== "ExpressionStatement") {
        return {
            ok: false,
            diagnostics: [
                {
                    stage: "compiler",
                    message: "Program must end with an expression statement.",
                    start: ast.start,
                    end: ast.end,
                },
            ],
        };
    }

    const constants = [];
    const code = [];
    const slots = new Map();
    let diagnostic = null;

    function fail(message, node) {
        if (diagnostic === null) {
            diagnostic = {
                stage: "compiler",
                message,
                start: node.start,
                end: node.end,
            };
        }
    }

    function emitExpression(expression) {
        if (diagnostic !== null) {
            return;
        }

        switch (expression.type) {
            case "NumericLiteral": {
                const constantIndex = constants.length;
                constants.push(expression.value);
                code.push(Opcode.Constant, constantIndex);
                return;
            }
            case "Identifier": {
                const slot = slots.get(expression.name);
                if (slot === undefined) {
                    fail(`Unknown identifier '${expression.name}'.`, expression);
                    return;
                }
                code.push(Opcode.LoadSlot, slot);
                return;
            }
            case "BinaryExpression": {
                emitExpression(expression.left);
                emitExpression(expression.right);
                const opcode = binaryOpcodes[expression.operator];
                if (opcode === undefined) {
                    throw new TypeError(`Unsupported binary operator '${expression.operator}'.`);
                }
                code.push(opcode);
                return;
            }
            default:
                throw new TypeError(`Unsupported expression type '${expression.type}'.`);
        }
    }

    ast.body.forEach((statement, index) => {
        if (diagnostic !== null) {
            return;
        }

        if (statement.type === "VariableDeclaration") {
            if (slots.has(statement.id.name)) {
                fail(`Identifier '${statement.id.name}' is already declared.`, statement.id);
                return;
            }

            emitExpression(statement.init);
            if (diagnostic !== null) {
                return;
            }

            const slot = slots.size;
            slots.set(statement.id.name, slot);
            code.push(Opcode.StoreSlot, slot);
            return;
        }

        if (statement.type === "ExpressionStatement") {
            emitExpression(statement.expression);
            if (diagnostic !== null) {
                return;
            }
            code.push(index === ast.body.length - 1 ? Opcode.Return : Opcode.Pop);
            return;
        }

        throw new TypeError(`Unsupported statement type '${statement.type}'.`);
    });

    if (diagnostic !== null) {
        return { ok: false, diagnostics: [diagnostic] };
    }

    return {
        ok: true,
        program: {
            version: BYTECODE_VERSION,
            constants,
            code,
            slotCount: slots.size,
        },
    };
}
