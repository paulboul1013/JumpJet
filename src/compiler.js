import { BYTECODE_VERSION, Opcode } from "./bytecode.js";

const binaryOpcodes = Object.freeze({
    "+": Opcode.Add,
    "-": Opcode.Subtract,
    "*": Opcode.Multiply,
    "/": Opcode.Divide,
    "===": Opcode.Equal,
    "!==": Opcode.NotEqual,
    "<": Opcode.Less,
    "<=": Opcode.LessEqual,
    ">": Opcode.Greater,
    ">=": Opcode.GreaterEqual,
});

const unaryOpcodes = Object.freeze({
    "-": Opcode.Negate,
    "+": Opcode.Positive,
    "!": Opcode.Not,
});

export function emit(boundProgram) {
    if (
        boundProgram?.type !== "BoundProgram" ||
        !Array.isArray(boundProgram.body) ||
        !Number.isSafeInteger(boundProgram.slotCount) ||
        boundProgram.slotCount < 0
    ) {
        throw new TypeError("Expected a BoundProgram.");
    }

    const constants = [];
    const code = [];

    function emitConstant(value) {
        const constantIndex = constants.length;
        constants.push(value);
        code.push(Opcode.Constant, constantIndex);
    }

    function emitExpression(expression) {
        switch (expression.type) {
            case "BoundNumericLiteral":
            case "BoundBooleanLiteral":
                emitConstant(expression.value);
                return;
            case "BoundIdentifier":
                code.push(Opcode.LoadSlot, expression.slot);
                return;
            case "BoundUnaryExpression": {
                emitExpression(expression.argument);
                const opcode = unaryOpcodes[expression.operator];
                if (opcode === undefined) {
                    throw new TypeError(`Unsupported unary operator '${expression.operator}'.`);
                }
                code.push(opcode);
                return;
            }
            case "BoundBinaryExpression": {
                emitExpression(expression.left);
                emitExpression(expression.right);
                const opcode = binaryOpcodes[expression.operator];
                if (opcode === undefined) {
                    throw new TypeError(`Unsupported binary operator '${expression.operator}'.`);
                }
                code.push(opcode);
                return;
            }
            case "BoundAssignmentExpression":
                emitExpression(expression.value);
                code.push(Opcode.Duplicate, Opcode.StoreSlot, expression.slot);
                return;
            default:
                throw new TypeError(`Unsupported bound expression type '${expression.type}'.`);
        }
    }

    function emitJump(opcode) {
        code.push(opcode, 0);
        return code.length - 1;
    }

    function emitStatement(statement, returnsResult = false) {
        switch (statement.type) {
            case "BoundVariableDeclaration":
                emitExpression(statement.init);
                code.push(Opcode.StoreSlot, statement.slot);
                return;
            case "BoundExpressionStatement":
                emitExpression(statement.expression);
                code.push(returnsResult ? Opcode.Return : Opcode.Pop);
                return;
            case "BoundBlockStatement":
                statement.body.forEach((child) => emitStatement(child));
                return;
            case "BoundIfStatement": {
                emitExpression(statement.test);
                const falseTargetOperand = emitJump(Opcode.JumpIfFalse);
                emitStatement(statement.consequent);

                if (statement.alternate === null) {
                    code[falseTargetOperand] = code.length;
                    return;
                }

                const endTargetOperand = emitJump(Opcode.Jump);
                code[falseTargetOperand] = code.length;
                emitStatement(statement.alternate);
                code[endTargetOperand] = code.length;
                return;
            }
            default:
                throw new TypeError(`Unsupported bound statement type '${statement.type}'.`);
        }
    }

    boundProgram.body.forEach((statement, index) => {
        emitStatement(statement, index === boundProgram.body.length - 1);
    });

    return {
        ok: true,
        program: {
            version: BYTECODE_VERSION,
            constants,
            code,
            slotCount: boundProgram.slotCount,
        },
    };
}
