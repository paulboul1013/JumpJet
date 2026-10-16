import { InstructionSet, Opcode } from "./bytecode.js";
import { verifyProgram } from "./verifier.js";

export const DEFAULT_MAX_INSTRUCTIONS = 1_000_000;

export function execute(input, options = {}) {
    if (options === null || typeof options !== "object") {
        throw new TypeError("Execution options must be an object.");
    }
    const { maxInstructions = DEFAULT_MAX_INSTRUCTIONS } = options;
    if (!Number.isSafeInteger(maxInstructions) || maxInstructions < 0) {
        throw new RangeError("maxInstructions must be a non-negative safe integer.");
    }
    const program = verifyProgram(input);

    const stack = [];
    const slots = new Array(program.slotCount);
    const initializedSlots = new Array(program.slotCount).fill(false);
    let instructionPointer = 0;
    let instructionsExecuted = 0;

    function readOperand() {
        const operand = program.code[instructionPointer];
        instructionPointer += 1;
        return operand;
    }

    function executeBinary(operation) {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(operation(left, right));
    }

    function executeUnary(operation) {
        stack.push(operation(stack.pop()));
    }

    while (instructionPointer < program.code.length) {
        if (instructionsExecuted >= maxInstructions) {
            throw new RangeError(`Instruction budget ${maxInstructions} exhausted.`);
        }
        instructionsExecuted += 1;
        const opcode = program.code[instructionPointer];
        instructionPointer += 1;
        const instruction = InstructionSet[opcode];
        if (stack.length < instruction.pops) {
            throw new RangeError(`Stack underflow while executing ${instruction.name}.`);
        }

        switch (opcode) {
            case Opcode.Constant: {
                const index = readOperand();
                stack.push(program.constants[index]);
                break;
            }
            case Opcode.Add:
                executeBinary((left, right) => left + right);
                break;
            case Opcode.Subtract:
                executeBinary((left, right) => left - right);
                break;
            case Opcode.Multiply:
                executeBinary((left, right) => left * right);
                break;
            case Opcode.Divide:
                executeBinary((left, right) => left / right);
                break;
            case Opcode.Negate:
                executeUnary((value) => -value);
                break;
            case Opcode.Positive:
                executeUnary((value) => +value);
                break;
            case Opcode.Not:
                executeUnary((value) => !value);
                break;
            case Opcode.Equal:
                executeBinary((left, right) => left === right);
                break;
            case Opcode.NotEqual:
                executeBinary((left, right) => left !== right);
                break;
            case Opcode.Less:
                executeBinary((left, right) => left < right);
                break;
            case Opcode.LessEqual:
                executeBinary((left, right) => left <= right);
                break;
            case Opcode.Greater:
                executeBinary((left, right) => left > right);
                break;
            case Opcode.GreaterEqual:
                executeBinary((left, right) => left >= right);
                break;
            case Opcode.StoreSlot: {
                const slot = readOperand();
                slots[slot] = stack.pop();
                initializedSlots[slot] = true;
                break;
            }
            case Opcode.LoadSlot: {
                const slot = readOperand();
                if (!initializedSlots[slot]) {
                    throw new ReferenceError(`Slot ${slot} was read before initialization.`);
                }
                stack.push(slots[slot]);
                break;
            }
            case Opcode.Duplicate:
                stack.push(stack.at(-1));
                break;
            case Opcode.JumpIfFalse: {
                const target = readOperand();
                const condition = stack.pop();
                if (!condition) {
                    instructionPointer = target;
                }
                break;
            }
            case Opcode.Jump:
                instructionPointer = readOperand();
                break;
            case Opcode.Pop:
                stack.pop();
                break;
            case Opcode.Return:
                return stack.pop();
            default:
                throw new RangeError(`Unknown opcode ${opcode}.`);
        }
    }

    throw new RangeError("Bytecode program ended without Return.");
}
