import { BYTECODE_VERSION, Opcode } from "./bytecode.js";
import { rtTrap, rtIsArray, rtPush, rtType, rtIsSafeInteger } from "./runtime.js";

function emitterInstruction(c, opcode) { rtPush(c.code, opcode); }
function emitterOperand(c, opcode, value) { rtPush(c.code, opcode); rtPush(c.code, value); }
function emitterConstant(c, value) {
    const index = c.constants.length;
    rtPush(c.constants, value);
    emitterOperand(c, Opcode.Constant, index);
}
function emitterJump(c, opcode) {
    emitterOperand(c, opcode, 0);
    return c.code.length - 1;
}
function emitterBinaryOpcode(op) {
    if (op === "+") { return Opcode.Add; }
    if (op === "-") { return Opcode.Subtract; }
    if (op === "*") { return Opcode.Multiply; }
    if (op === "/") { return Opcode.Divide; }
    if (op === "===") { return Opcode.Equal; }
    if (op === "!==") { return Opcode.NotEqual; }
    if (op === "<") { return Opcode.Less; }
    if (op === "<=") { return Opcode.LessEqual; }
    if (op === ">") { return Opcode.Greater; }
    if (op === ">=") { return Opcode.GreaterEqual; }
    rtTrap("Unsupported binary operator '" + op + "'.");
}
function emitterExpression(c, n) {
    const t = n.type;
    if (t === "BoundNumericLiteral" || t === "BoundBooleanLiteral" || t === "BoundStringLiteral" || t === "BoundLiteral") { emitterConstant(c, n.value); return; }
    if (t === "BoundIdentifier") {
        let op = Opcode.LoadSlot;
        if (n.global) { op = Opcode.LoadGlobal; }
        emitterOperand(c, op, n.slot);
        return;
    }
    if (t === "BoundUnaryExpression") {
        emitterExpression(c, n.argument);
        if (n.operator === "-") { emitterInstruction(c, Opcode.Negate); }
        else if (n.operator === "+") { emitterInstruction(c, Opcode.Positive); }
        else if (n.operator === "!") { emitterInstruction(c, Opcode.Not); }
        else { rtTrap("Unsupported unary operator '" + n.operator + "'."); }
        return;
    }
    if (t === "BoundBinaryExpression") {
        emitterExpression(c, n.left);
        if (n.operator === "&&" || n.operator === "||") {
            emitterInstruction(c, Opcode.Duplicate);
            const branch = emitterJump(c, Opcode.JumpIfFalse);
            if (n.operator === "&&") {
                emitterInstruction(c, Opcode.Pop);
                emitterExpression(c, n.right);
                c.code[branch] = c.code.length;
            } else {
                const end = emitterJump(c, Opcode.Jump);
                c.code[branch] = c.code.length;
                emitterInstruction(c, Opcode.Pop);
                emitterExpression(c, n.right);
                c.code[end] = c.code.length;
            }
        } else {
            emitterExpression(c, n.right);
            emitterInstruction(c, emitterBinaryOpcode(n.operator));
        }
        return;
    }
    if (t === "BoundAssignmentExpression") {
        emitterExpression(c, n.value);
        emitterInstruction(c, Opcode.Duplicate);
        let op = Opcode.StoreSlot;
        if (n.global) { op = Opcode.StoreGlobal; }
        emitterOperand(c, op, n.slot);
        return;
    }
    if (t === "BoundMemberExpression") {
        emitterExpression(c, n.object);
        emitterExpression(c, n.property);
        emitterInstruction(c, Opcode.GetProperty);
        return;
    }
    if (t === "BoundMemberAssignment") {
        emitterExpression(c, n.target.object);
        emitterExpression(c, n.target.property);
        emitterExpression(c, n.value);
        emitterInstruction(c, Opcode.SetProperty);
        return;
    }
    if (t === "BoundArrayExpression") {
        let i = 0;
        while (i < n.elements.length) { emitterExpression(c, n.elements[i]); i = i + 1; }
        emitterOperand(c, Opcode.MakeArray, n.elements.length);
        return;
    }
    if (t === "BoundRecordExpression") {
        let i = 0;
        while (i < n.properties.length) {
            emitterConstant(c, n.properties[i].key);
            emitterExpression(c, n.properties[i].value);
            i = i + 1;
        }
        emitterOperand(c, Opcode.MakeRecord, n.properties.length);
        return;
    }
    if (t === "BoundCallExpression") {
        let i = 0;
        while (i < n.arguments.length) { emitterExpression(c, n.arguments[i]); i = i + 1; }
        if (n.builtin >= 0) { emitterOperand(c, Opcode.Builtin, n.builtin); }
        else { emitterOperand(c, Opcode.Call, n.index); }
        return;
    }
    rtTrap("Unsupported bound expression type '" + t + "'.");
}
function emitterStatements(c, body) {
    let i = 0;
    while (i < body.length) { emitterStatement(c, body[i], false); i = i + 1; }
}
function emitterStatement(c, n, returnsResult) {
    const t = n.type;
    if (t === "BoundVariableDeclaration") {
        emitterExpression(c, n.init);
        emitterOperand(c, Opcode.StoreSlot, n.slot);
        return;
    }
    if (t === "BoundExpressionStatement") {
        emitterExpression(c, n.expression);
        if (returnsResult) { emitterInstruction(c, Opcode.Return); }
        else { emitterInstruction(c, Opcode.Pop); }
        return;
    }
    if (t === "BoundReturnStatement") {
        emitterExpression(c, n.argument);
        emitterInstruction(c, Opcode.Return);
        return;
    }
    if (t === "BoundBlockStatement") { emitterStatements(c, n.body); return; }
    if (t === "BoundIfStatement") {
        emitterExpression(c, n.test);
        const branch = emitterJump(c, Opcode.JumpIfFalse);
        emitterStatement(c, n.consequent, false);
        if (n.alternate === null) { c.code[branch] = c.code.length; return; }
        const end = emitterJump(c, Opcode.Jump);
        c.code[branch] = c.code.length;
        emitterStatement(c, n.alternate, false);
        c.code[end] = c.code.length;
        return;
    }
    if (t === "BoundWhileStatement") {
        const start = c.code.length;
        emitterExpression(c, n.test);
        const end = emitterJump(c, Opcode.JumpIfFalse);
        emitterStatement(c, n.body, false);
        emitterOperand(c, Opcode.Jump, start);
        c.code[end] = c.code.length;
        return;
    }
    rtTrap("Unsupported bound statement type '" + t + "'.");
}
export function emit(boundProgram) {
    if (rtType(boundProgram) !== "object" || boundProgram === null || boundProgram.type !== "BoundProgram" || !rtIsArray(boundProgram.body) || !rtIsSafeInteger(boundProgram.slotCount) || boundProgram.slotCount < 0) { rtTrap("Expected a BoundProgram."); }
    const constants = [];
    const c = {constants: constants, code: []};
    let i = 0;
    while (i < boundProgram.body.length) {
        emitterStatement(c, boundProgram.body[i], i === boundProgram.body.length - 1);
        i = i + 1;
    }
    const code = c.code;
    const functions = [];
    i = 0;
    while (i < boundProgram.functions.length) {
        const fn = boundProgram.functions[i];
        c.code = [];
        emitterStatements(c, fn.body);
        emitterConstant(c, undefined);
        emitterInstruction(c, Opcode.Return);
        rtPush(functions, {name: fn.name, arity: fn.arity, slotCount: fn.slotCount, code: c.code});
        i = i + 1;
    }
    return {ok: true, program: {version: BYTECODE_VERSION, constants: constants, code: code, slotCount: boundProgram.slotCount, functions: functions}};
}
