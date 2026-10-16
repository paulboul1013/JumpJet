import { BYTECODE_VERSION, Opcode } from "./bytecode.js";

const opcodeNames = new Map(
    Object.entries(Opcode).map(([name, value]) => [value, name]),
);

function validateProgram(program) {
    if (program === null || typeof program !== "object") {
        throw new TypeError("Bytecode program must be an object.");
    }
    if (program.version !== BYTECODE_VERSION) {
        throw new RangeError(`Unsupported bytecode version ${program.version}.`);
    }
    if (!Array.isArray(program.constants)) {
        throw new TypeError("Bytecode constants must be an array.");
    }
    program.constants.forEach((constant, index) => {
        if (typeof constant !== "number" && typeof constant !== "boolean") {
            throw new TypeError(`Bytecode constant ${index} must be a number or boolean.`);
        }
    });
    if (!Array.isArray(program.code)) {
        throw new TypeError("Bytecode code must be an array.");
    }
    if (!Number.isSafeInteger(program.slotCount) || program.slotCount < 0) {
        throw new RangeError("Bytecode slotCount must be a non-negative safe integer.");
    }
}

export function execute(program) {
    validateProgram(program);

    const stack = [];
    const slots = new Array(program.slotCount);
    const initializedSlots = new Array(program.slotCount).fill(false);
    let instructionPointer = 0;

    function readOperand(opcodeName) {
        if (instructionPointer >= program.code.length) {
            throw new RangeError(`Missing operand for ${opcodeName}.`);
        }
        const operand = program.code[instructionPointer];
        instructionPointer += 1;
        if (!Number.isSafeInteger(operand) || operand < 0) {
            throw new RangeError(`Invalid operand ${operand} for ${opcodeName}.`);
        }
        return operand;
    }

    function requireStack(size, opcodeName) {
        if (stack.length < size) {
            throw new RangeError(`Stack underflow while executing ${opcodeName}.`);
        }
    }

    function executeBinary(opcodeName, operation) {
        requireStack(2, opcodeName);
        const right = stack.pop();
        const left = stack.pop();
        stack.push(operation(left, right));
    }

    function executeUnary(opcodeName, operation) {
        requireStack(1, opcodeName);
        stack.push(operation(stack.pop()));
    }

    function readJumpTarget(opcodeName) {
        const target = readOperand(opcodeName);
        if (target > program.code.length) {
            throw new RangeError(`Jump target ${target} is out of bounds.`);
        }
        return target;
    }

    while (instructionPointer < program.code.length) {
        const opcode = program.code[instructionPointer];
        instructionPointer += 1;
        const opcodeName = opcodeNames.get(opcode);

        if (opcodeName === undefined) {
            throw new RangeError(`Unknown opcode ${opcode}.`);
        }

        switch (opcode) {
            case Opcode.Constant: {
                const index = readOperand(opcodeName);
                if (index >= program.constants.length) {
                    throw new RangeError(`Constant index ${index} is out of bounds.`);
                }
                stack.push(program.constants[index]);
                break;
            }
            case Opcode.Add:
                executeBinary(opcodeName, (left, right) => left + right);
                break;
            case Opcode.Subtract:
                executeBinary(opcodeName, (left, right) => left - right);
                break;
            case Opcode.Multiply:
                executeBinary(opcodeName, (left, right) => left * right);
                break;
            case Opcode.Divide:
                executeBinary(opcodeName, (left, right) => left / right);
                break;
            case Opcode.Negate:
                executeUnary(opcodeName, (value) => -value);
                break;
            case Opcode.Positive:
                executeUnary(opcodeName, (value) => +value);
                break;
            case Opcode.Not:
                executeUnary(opcodeName, (value) => !value);
                break;
            case Opcode.Equal:
                executeBinary(opcodeName, (left, right) => left === right);
                break;
            case Opcode.NotEqual:
                executeBinary(opcodeName, (left, right) => left !== right);
                break;
            case Opcode.Less:
                executeBinary(opcodeName, (left, right) => left < right);
                break;
            case Opcode.LessEqual:
                executeBinary(opcodeName, (left, right) => left <= right);
                break;
            case Opcode.Greater:
                executeBinary(opcodeName, (left, right) => left > right);
                break;
            case Opcode.GreaterEqual:
                executeBinary(opcodeName, (left, right) => left >= right);
                break;
            case Opcode.StoreSlot: {
                const slot = readOperand(opcodeName);
                if (slot >= slots.length) {
                    throw new RangeError(`Slot index ${slot} is out of bounds.`);
                }
                requireStack(1, opcodeName);
                slots[slot] = stack.pop();
                initializedSlots[slot] = true;
                break;
            }
            case Opcode.LoadSlot: {
                const slot = readOperand(opcodeName);
                if (slot >= slots.length) {
                    throw new RangeError(`Slot index ${slot} is out of bounds.`);
                }
                if (!initializedSlots[slot]) {
                    throw new ReferenceError(`Slot ${slot} was read before initialization.`);
                }
                stack.push(slots[slot]);
                break;
            }
            case Opcode.Duplicate:
                requireStack(1, opcodeName);
                stack.push(stack.at(-1));
                break;
            case Opcode.JumpIfFalse: {
                const target = readJumpTarget(opcodeName);
                requireStack(1, opcodeName);
                const condition = stack.pop();
                if (!condition) {
                    instructionPointer = target;
                }
                break;
            }
            case Opcode.Jump:
                instructionPointer = readJumpTarget(opcodeName);
                break;
            case Opcode.Pop:
                requireStack(1, opcodeName);
                stack.pop();
                break;
            case Opcode.Return:
                requireStack(1, opcodeName);
                return stack.pop();
            default:
                throw new RangeError(`Unknown opcode ${opcode}.`);
        }
    }

    throw new RangeError("Bytecode program ended without Return.");
}
