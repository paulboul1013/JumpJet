import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { Opcode } from "../src/bytecode.js";
import { compile, run } from "../src/index.js";
import { tokenize, TokenKind } from "../src/lexer.js";
import { execute } from "../src/vm.js";

function program(code, constants = [], slotCount = 0) {
    return { version: 2, functions: [], constants, code, slotCount };
}

for (const [name, source] of [
    ["read before a later top-level declaration", "value; let value = 2; value;"],
    ["read before an inner declaration", "let value = 1; { value; let value = 2; } value;"],
    ["write before an inner declaration", "let value = 1; { value = 2; let value = 3; } value;"],
    ["write in an inner binding's initializer", "let value = 1; { let value = (value = 2); } value;"],
    ["write before a later top-level declaration", "value = 1; let value = 2; value;"],
]) {
    test(`reports TDZ for ${name}`, () => {
        const result = compile(source);

        assert.equal(result.ok, false);
        assert.equal(result.diagnostics[0].stage, "analyzer");
        assert.equal(result.diagnostics[0].message, "Cannot access 'value' before initialization.");
    });
}

test("preserves initialized shadowing and writes to the nearest declared binding", () => {
    const result = compile("let value = 1; { let value = 2; value = 3; } value;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program), 1);
});

for (const name of ["constructor", "toString", "__proto__"]) {
    test(`tokenizes prototype name ${name} as an identifier`, () => {
        const result = tokenize(`${name};`);

        assert.equal(result.ok, true);
        assert.equal(result.tokens[0].kind, TokenKind.Identifier);
    });

    test(`compiles and executes a binding named ${name}`, () => {
        const result = compile(`let ${name} = 7; ${name} = ${name} + 1; ${name};`);

        assert.equal(result.ok, true);
        assert.equal(run(result.program), 8);
    });
}

test("rejects a jump into an operand even if its value is a valid opcode", () => {
    const malformed = program(
        [Opcode.Constant, 0, Opcode.Jump, 5, Opcode.Constant, Opcode.Return, Opcode.Return],
        Array(9).fill(42),
    );

    assert.throws(() => execute(malformed), /instruction boundary/i);
});

test("rejects an untaken conditional jump into an operand", () => {
    const malformed = program(
        [Opcode.Constant, 0, Opcode.JumpIfFalse, 5, Opcode.Constant, 1, Opcode.Return],
        [true, 42],
    );

    assert.throws(() => execute(malformed), /instruction boundary/i);
});

test("executes a forward jump to a valid instruction boundary", () => {
    const value = execute(program(
        [Opcode.Jump, 4, Opcode.Constant, 0, Opcode.Constant, 1, Opcode.Return],
        [0, 42],
    ));

    assert.equal(value, 42);
});

test("allows an untaken conditional jump to code.length", () => {
    const value = execute(program(
        [Opcode.Constant, 0, Opcode.JumpIfFalse, 7, Opcode.Constant, 1, Opcode.Return],
        [true, 42],
    ));

    assert.equal(value, 42);
});

test("reports missing Return when a jump to code.length is taken", () => {
    assert.throws(() => execute(program([Opcode.Jump, 2])), /ended without Return/);
});

test("rejects a sparse constant pool instead of returning undefined", () => {
    assert.throws(
        () => execute(program([Opcode.Constant, 0, Opcode.Return], new Array(1))),
        /constant 0/i,
    );
});

test("rejects a constant inherited from the array's prototype", () => {
    const constants = new Array(1);
    const inherited = Object.create(Array.prototype);
    inherited[0] = 42;
    Object.setPrototypeOf(constants, inherited);

    assert.throws(
        () => execute(program([Opcode.Constant, 0, Opcode.Return], constants)),
        /constant 0/i,
    );
});

test("rejects an unknown opcode after an unreachable Return", () => {
    assert.throws(
        () => execute(program([Opcode.Constant, 0, Opcode.Return, 999], [42])),
        /Unknown opcode 999/,
    );
});

for (const name of ["Constant", "StoreSlot", "LoadSlot", "Jump", "JumpIfFalse"]) {
    test(`rejects an unreachable ${name} with a missing operand`, () => {
        assert.throws(
            () => execute(program([Opcode.Constant, 0, Opcode.Return, Opcode[name]], [42], 1)),
            new RegExp(`Missing operand for ${name}`),
        );
    });
}

for (const entry of ["execute", "run"]) {
    test(`${entry} stops a backward jump at its instruction budget`, () => {
        const moduleUrl = new URL(entry === "execute" ? "../src/vm.js" : "../src/index.js", import.meta.url).href;
        const source = `
            import assert from "node:assert/strict";
            import { ${entry} } from ${JSON.stringify(moduleUrl)};
            assert.throws(
                () => ${entry}({version: 2, functions: [], constants: [], code: [${Opcode.Jump}, 0], slotCount: 0}, {maxInstructions: 20}),
                error => error instanceof RangeError && /Instruction budget/.test(error.message),
            );
            console.log("instruction budget enforced");
        `;
        const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
            encoding: "utf8",
            timeout: 2000,
        });

        assert.equal(child.error, undefined, `Child must terminate under its budget: ${child.error?.message}`);
        assert.equal(child.status, 0, child.stderr);
        assert.match(child.stdout, /instruction budget enforced/);
    });
}

test("executes ordinary arithmetic under an instruction budget", () => {
    const result = compile("1 + 2 * 3;");

    assert.equal(result.ok, true);
    assert.equal(run(result.program, { maxInstructions: 20 }), 7);
});

test("reports parser diagnostics for excessive source depth without throwing", () => {
    const source = "(".repeat(20000) + "1" + ")".repeat(20000) + ";";
    const result = compile(source);

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.diagnostics[0].stage, "parser");
});

for (const [name, source] of [
    ["unary operators", "!".repeat(20000) + "1;"],
    ["assignment operators", "let value = 0; " + "value = ".repeat(20000) + "1;"],
    ["nested blocks", "{".repeat(20000) + "1;" + "}".repeat(20000) + "1;"],
    ["else-if statements", "if (false) {} else ".repeat(20000) + "{ } 1;"],
    ["left-associative binary expressions", "1 + ".repeat(20000) + "1;"],
]) {
    test(`reports parser depth diagnostics for excessive ${name}`, () => {
        const result = compile(source);

        assert.equal(result.ok, false);
        assert.equal(result.diagnostics[0].stage, "parser");
        assert.match(result.diagnostics[0].message, /(?:nesting|depth).*limit/i);
    });
}

test("executes valid source with thirty levels of mixed nesting", () => {
    const source = "let value = 0; " + "if (true) { ".repeat(30)
        + "value = " + "!(".repeat(30) + "true" + ")".repeat(30) + ";"
        + " }".repeat(30) + " value;";
    const result = compile(source);

    assert.equal(result.ok, true);
    assert.equal(run(result.program), true);
});

for (const [name, entry] of [["execute", execute], ["run", run]]) {
    test(`${name} counts Return toward the exact instruction budget`, () => {
        const bytecode = program([Opcode.Constant, 0, Opcode.Return], [42]);

        assert.equal(entry(bytecode, { maxInstructions: 2 }), 42);
        assert.throws(
            () => entry(bytecode, { maxInstructions: 1 }),
            error => error instanceof RangeError && /Instruction budget 1 exhausted/.test(error.message),
        );
        assert.throws(
            () => entry(bytecode, { maxInstructions: 0 }),
            error => error instanceof RangeError && /Instruction budget 0 exhausted/.test(error.message),
        );
    });

    test(`${name} rejects invalid instruction budgets`, () => {
        for (const maxInstructions of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "20", null]) {
            assert.throws(
                () => entry(program([Opcode.Constant, 0, Opcode.Return], [42]), { maxInstructions }),
                error => error instanceof RangeError && /maxInstructions/.test(error.message),
                `Expected rejection for maxInstructions=${String(maxInstructions)}`,
            );
        }
    });

    test(`${name} rejects invalid execution options`, () => {
        for (const options of [null, 20, "20", false, () => 20]) {
            assert.throws(
                () => entry(program([Opcode.Constant, 0, Opcode.Return], [42]), options),
                error => error instanceof TypeError && /Execution options/.test(error.message),
                `Expected rejection for options=${String(options)}`,
            );
        }
    });

    test(`${name} enforces its default budget for a backward jump`, () => {
        const moduleUrl = new URL(name === "execute" ? "../src/vm.js" : "../src/index.js", import.meta.url).href;
        const source = `
            import assert from "node:assert/strict";
            import { ${name} } from ${JSON.stringify(moduleUrl)};
            assert.throws(
                () => ${name}({version: 2, functions: [], constants: [], code: [${Opcode.Jump}, 0], slotCount: 0}),
                error => error instanceof RangeError && /Instruction budget/.test(error.message),
            );
            console.log("default instruction budget enforced");
        `;
        const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
            encoding: "utf8",
            timeout: 5000,
        });

        assert.equal(child.error, undefined, `Child must terminate under its default budget: ${child.error?.message}`);
        assert.equal(child.status, 0, child.stderr);
        assert.match(child.stdout, /default instruction budget enforced/);
    });
}

test("executes the verified snapshot and reads accessor instructions and constants once", () => {
    let opcodeReads = 0;
    let constantReads = 0;
    const code = [Opcode.Constant, 0, Opcode.Return];
    const constants = [42];
    Object.defineProperty(code, 0, {
        get() {
            opcodeReads += 1;
            return opcodeReads === 1 ? Opcode.Constant : 999;
        },
    });
    Object.defineProperty(constants, 0, {
        get() {
            constantReads += 1;
            return constantReads === 1 ? 42 : "unverified value";
        },
    });

    assert.equal(execute(program(code, constants)), 42);
    assert.equal(opcodeReads, 1);
    assert.equal(constantReads, 1);
});

for (const [name, index, inheritedValue, message] of [
    ["opcode", 0, Opcode.Constant, /Unknown opcode/],
    ["operand", 1, 0, /Invalid operand.*Constant/],
]) {
    test(`rejects an inherited ${name} in a bytecode array hole`, () => {
        const code = [Opcode.Constant, 0, Opcode.Return];
        delete code[index];
        const inherited = Object.create(Array.prototype);
        inherited[index] = inheritedValue;
        Object.setPrototypeOf(code, inherited);

        assert.throws(() => execute(program(code, [42])), message);
    });
}
