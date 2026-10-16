const before = new URLSearchParams(location.search).get("phase") === "before";
const modulePath = before ? "/output/pstack-bytecode-fixes/before/src/index.js" : "/src/index.js";
const { compile, run } = await import(modulePath);
document.querySelector("#phase").textContent = before ? "修正前 · 原始引擎快照" : "修正後 · 目前引擎";
document.querySelector("#module").textContent = `真實模組：${modulePath}`;

function sourceResult(source) {
    const compilation = compile(source);
    if (!compilation.ok) {
        const diagnostic = compilation.diagnostics[0];
        return `[${diagnostic.stage}] ${diagnostic.message}`;
    }
    return `value: ${String(run(compilation.program))}`;
}

function bytecodeResult(code, constants = []) {
    return `value: ${String(run({ version: 1, code, constants, slotCount: 0 }))}`;
}

function budgetResult() {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("budget-worker.js", import.meta.url), { type: "module" });
        let timer;
        worker.onmessage = ({ data }) => {
            if (data === "entered") {
                timer = setTimeout(() => {
                    worker.terminate();
                    resolve("Timed out: 2 秒後仍未返回，測試器終止 Worker");
                }, 2000);
                return;
            }
            clearTimeout(timer);
            worker.terminate();
            resolve(data);
        };
        worker.onerror = (error) => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(error.message));
        };
        worker.postMessage(modulePath);
    });
}

const cases = [
    {
        name: "01 · Block scope / TDZ",
        input: "let value = 1;\n{ value = 2; let value = 3; }\nvalue;",
        expected: "analyzer TDZ diagnostic",
        matches: (text) => text.startsWith("[analyzer]") && text.includes("before initialization"),
        run: () => sourceResult("let value = 1; { value = 2; let value = 3; } value;"),
    },
    {
        name: "02 · constructor 識別字",
        input: "let constructor = 1;\nconstructor;",
        expected: "value: 1",
        run: () => sourceResult("let constructor = 1; constructor;"),
    },
    {
        name: "03 · toString 識別字",
        input: "let toString = 1;\ntoString;",
        expected: "value: 1",
        run: () => sourceResult("let toString = 1; toString;"),
    },
    {
        name: "04 · Jump 進入 operand",
        input: "code: [0,0,20,5,0,8,8]\nconstants: Array(9).fill(42)",
        expected: "RangeError: target 5 is not an instruction boundary",
        matches: (text) => text.startsWith("RangeError:") && text.includes("instruction boundary"),
        run: () => bytecodeResult([0, 0, 20, 5, 0, 8, 8], Array(9).fill(42)),
    },
    {
        name: "05 · 稀疏 constant pool",
        input: "code: [0,0,8]\nconstants: new Array(1)",
        expected: "TypeError: constant 0 is invalid",
        matches: (text) => text.startsWith("TypeError:") && text.includes("constant 0"),
        run: () => bytecodeResult([0, 0, 8], new Array(1)),
    },
    {
        name: "06 · 不可達未知 opcode",
        input: "code: [0,0,8,999]\nconstants: [42]",
        expected: "RangeError: Unknown opcode 999.",
        run: () => bytecodeResult([0, 0, 8, 999], [42]),
    },
    {
        name: "07 · 過深來源程式",
        input: "'('.repeat(20000) + '1'\n+ ')'.repeat(20000) + ';'",
        expected: "parser depth diagnostic",
        matches: (text) => text.startsWith("[parser]") && text.includes("limit"),
        run: () => sourceResult("(".repeat(20000) + "1" + ")".repeat(20000) + ";"),
    },
    {
        name: "08 · 指令預算 / Jump 0",
        input: "code: [20,0]\nrun(program, {maxInstructions:20})",
        expected: "RangeError: Instruction budget 20 exhausted.",
        run: budgetResult,
    },
    {
        name: "09 · 原有控制流正常",
        input: "let score = 3;\nif (score < 5) { score = -score + 10; }\nscore === 7;",
        expected: "value: true",
        run: () => sourceResult("let score = 3; if (score < 5) { score = -score + 10; } score === 7;"),
    },
];

const observations = [];
for (const testCase of cases) {
    let actual;
    try {
        actual = await testCase.run();
    } catch (error) {
        actual = `${error.name}: ${error.message}`;
    }
    const pass = testCase.matches ? testCase.matches(actual) : actual === testCase.expected;
    const card = document.createElement("article");
    card.className = pass ? "pass" : "fail";
    const title = document.createElement("h2");
    title.textContent = `${pass ? "PASS" : "FAIL"} · ${testCase.name}`;
    const input = document.createElement("pre");
    input.textContent = testCase.input;
    const result = document.createElement("pre");
    result.className = "actual";
    result.textContent = `實際：${actual}`;
    const expected = document.createElement("p");
    expected.className = "expected";
    expected.textContent = `預期：${testCase.expected}`;
    card.append(title, input, result, expected);
    document.querySelector("#results").append(card);
    observations.push({ name: testCase.name, input: testCase.input, actual, expected: testCase.expected, pass });
}
const passed = observations.filter((item) => item.pass).length;
document.querySelector("#summary").textContent = `${passed} / ${cases.length} 符合修正後契約`;
document.body.dataset.complete = "true";
window.engineEvidence = { phase: before ? "before" : "after", modulePath, passed, total: cases.length, observations };
