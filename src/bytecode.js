export const BYTECODE_VERSION = 1;

export const Opcode = Object.freeze({
    Constant: 0,
    Add: 1,
    Subtract: 2,
    Multiply: 3,
    Divide: 4,
    StoreSlot: 5,
    LoadSlot: 6,
    Pop: 7,
    Return: 8,
});
