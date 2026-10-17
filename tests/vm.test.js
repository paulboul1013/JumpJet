import assert from "node:assert/strict";
import test from "node:test";

import { Opcode } from "../src/bytecode.js";
import { execute } from "../src/vm.js";

test("executes constants, slots, and arithmetic", () => {
    const value = execute({
        version: 2, functions: [],
        constants: [2, 3],
        code: [
            Opcode.Constant,
            0,
            Opcode.StoreSlot,
            0,
            Opcode.LoadSlot,
            0,
            Opcode.Constant,
            1,
            Opcode.Multiply,
            Opcode.Return,
        ],
        slotCount: 1,
    });

    assert.equal(value, 6);
});

test("rejects an unsupported bytecode version", () => {
    assert.throws(
        () => execute({ version: 99, constants: [], code: [], slotCount: 0 }),
        /Unsupported bytecode version 99/,
    );
});

test("rejects an unknown opcode", () => {
    assert.throws(
        () => execute({ version: 2, functions: [], constants: [], code: [999], slotCount: 0 }),
        /Unknown opcode 999/,
    );
});

test("rejects stack underflow instead of producing a host value", () => {
    assert.throws(
        () => execute({ version: 2, functions: [], constants: [], code: [Opcode.Add], slotCount: 0 }),
        /Stack underflow while executing Add/,
    );
});

test("rejects operands outside program bounds", () => {
    assert.throws(
        () =>
            execute({
                version: 2, functions: [],
                constants: [],
                code: [Opcode.Constant, 1],
                slotCount: 0,
            }),
        /Constant index 1 is out of bounds/,
    );
});

test("rejects non-number constants at the VM boundary", () => {
    assert.throws(
        () =>
            execute({
                version: 2, functions: [],
                constants: [{}],
                code: [Opcode.Constant, 0, Opcode.Return],
                slotCount: 0,
            }),
        /Bytecode constant 0 must be a scalar/,
    );
});

test("executes unary, comparison, and boolean opcodes", () => {
    const value = execute({
        version: 2, functions: [],
        constants: [2, 3],
        code: [
            Opcode.Constant, 0,
            Opcode.Positive,
            Opcode.Constant, 1,
            Opcode.Less,
            Opcode.Not,
            Opcode.Not,
            Opcode.Return,
        ],
        slotCount: 0,
    });

    assert.equal(value, true);
});

test("duplicates an assignment value before storing it", () => {
    const value = execute({
        version: 2, functions: [],
        constants: [4],
        code: [
            Opcode.Constant, 0,
            Opcode.Duplicate,
            Opcode.StoreSlot, 0,
            Opcode.LoadSlot, 0,
            Opcode.Add,
            Opcode.Return,
        ],
        slotCount: 1,
    });

    assert.equal(value, 8);
});

test("executes conditional and unconditional jumps", () => {
    const value = execute({
        version: 2, functions: [],
        constants: [false, 1, 2],
        code: [
            Opcode.Constant, 0,
            Opcode.JumpIfFalse, 8,
            Opcode.Constant, 1,
            Opcode.Jump, 10,
            Opcode.Constant, 2,
            Opcode.Return,
        ],
        slotCount: 0,
    });

    assert.equal(value, 2);
});

test("rejects jump targets outside the code array", () => {
    assert.throws(
        () =>
            execute({
                version: 2, functions: [],
                constants: [],
                code: [Opcode.Jump, 3],
                slotCount: 0,
            }),
        /Jump target 3 is out of bounds/,
    );
});
