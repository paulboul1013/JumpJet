import assert from "node:assert/strict";
import test from "node:test";

import { Opcode } from "../src/bytecode.js";
import { execute } from "../src/vm.js";

test("executes constants, slots, and arithmetic", () => {
    const value = execute({
        version: 1,
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
        () => execute({ version: 1, constants: [], code: [999], slotCount: 0 }),
        /Unknown opcode 999/,
    );
});

test("rejects stack underflow instead of producing a host value", () => {
    assert.throws(
        () => execute({ version: 1, constants: [], code: [Opcode.Add], slotCount: 0 }),
        /Stack underflow while executing Add/,
    );
});

test("rejects operands outside program bounds", () => {
    assert.throws(
        () =>
            execute({
                version: 1,
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
                version: 1,
                constants: [{}],
                code: [Opcode.Constant, 0, Opcode.Return],
                slotCount: 0,
            }),
        /Bytecode constant 0 must be a number/,
    );
});
