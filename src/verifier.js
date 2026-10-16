import { BYTECODE_VERSION, InstructionSet } from "./bytecode.js";

export function verifyProgram(program) {
    if (program === null || typeof program !== "object") {
        throw new TypeError("Bytecode program must be an object.");
    }
    const { version, constants, code, slotCount } = program;
    if (version !== BYTECODE_VERSION) {
        throw new RangeError(`Unsupported bytecode version ${version}.`);
    }
    if (!Array.isArray(constants)) {
        throw new TypeError("Bytecode constants must be an array.");
    }
    const verifiedConstants = [];
    for (let index = 0; index < constants.length; index += 1) {
        const constant = Object.hasOwn(constants, index) ? constants[index] : undefined;
        if (typeof constant !== "number" && typeof constant !== "boolean") {
            throw new TypeError(`Bytecode constant ${index} must be a number or boolean.`);
        }
        verifiedConstants.push(constant);
    }
    if (!Array.isArray(code)) {
        throw new TypeError("Bytecode code must be an array.");
    }
    if (!Number.isSafeInteger(slotCount) || slotCount < 0) {
        throw new RangeError("Bytecode slotCount must be a non-negative safe integer.");
    }

    // Execute a private snapshot so array accessors cannot change instructions
    // or constants between verification and execution.
    const verifiedCode = Array.from({ length: code.length }, (_, index) =>
        Object.hasOwn(code, index) ? code[index] : undefined,
    );
    const starts = new Set([verifiedCode.length]);
    const targets = [];
    let position = 0;
    while (position < verifiedCode.length) {
        starts.add(position);
        const opcode = verifiedCode[position];
        position += 1;
        const instruction = Number.isInteger(opcode) ? InstructionSet[opcode] : undefined;
        if (instruction === undefined) {
            throw new RangeError(`Unknown opcode ${opcode}.`);
        }
        if (instruction.operand === null) {
            continue;
        }
        if (position >= verifiedCode.length) {
            throw new RangeError(`Missing operand for ${instruction.name}.`);
        }
        const operand = verifiedCode[position];
        position += 1;
        if (!Number.isSafeInteger(operand) || operand < 0) {
            throw new RangeError(`Invalid operand ${operand} for ${instruction.name}.`);
        }
        switch (instruction.operand) {
            case "constant":
                if (operand >= verifiedConstants.length) {
                    throw new RangeError(`Constant index ${operand} is out of bounds.`);
                }
                break;
            case "slot":
                if (operand >= slotCount) {
                    throw new RangeError(`Slot index ${operand} is out of bounds.`);
                }
                break;
            case "target":
                if (operand > verifiedCode.length) {
                    throw new RangeError(`Jump target ${operand} is out of bounds.`);
                }
                targets.push(operand);
                break;
        }
    }
    for (const target of targets) {
        if (!starts.has(target)) {
            throw new RangeError(`Jump target ${target} is not an instruction boundary.`);
        }
    }
    return { constants: verifiedConstants, code: verifiedCode, slotCount };
}
