export const BYTECODE_VERSION = 1;

// Array positions are the version-1 wire opcodes. Append new instructions;
// changing an existing position requires a bytecode version change.
const definitions = [
    ["Constant", "constant", 0, 1],
    ["Add", null, 2, 1],
    ["Subtract", null, 2, 1],
    ["Multiply", null, 2, 1],
    ["Divide", null, 2, 1],
    ["StoreSlot", "slot", 1, 0],
    ["LoadSlot", "slot", 0, 1],
    ["Pop", null, 1, 0],
    ["Return", null, 1, 0],
    ["Negate", null, 1, 1],
    ["Positive", null, 1, 1],
    ["Not", null, 1, 1],
    ["Equal", null, 2, 1],
    ["NotEqual", null, 2, 1],
    ["Less", null, 2, 1],
    ["LessEqual", null, 2, 1],
    ["Greater", null, 2, 1],
    ["GreaterEqual", null, 2, 1],
    ["Duplicate", null, 1, 2],
    ["JumpIfFalse", "target", 1, 0],
    ["Jump", "target", 0, 0],
];

export const InstructionSet = Object.freeze(definitions.map(
    ([name, operand, pops, pushes], opcode) => Object.freeze({ opcode, name, operand, pops, pushes }),
));

export const Opcode = Object.freeze(Object.fromEntries(
    InstructionSet.map(({ name, opcode }) => [name, opcode]),
));
