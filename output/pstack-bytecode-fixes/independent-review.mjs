import assert from "node:assert/strict";
import vm from "node:vm";

import { compile, run } from "../../src/index.js";

// Deterministic generation: no random source or seed. Depths are 0..199.
// Program case i uses k=(i*17+j*13)%7 for each statement j=0..9.
const nestingShapes = [
    ["parentheses", "(", ")", false],
    ["unary parentheses", "!(", ")", false],
    ["if blocks", "if (true) { ", " }", true],
    ["blocks", "{", "}", true],
];
let acceptedDepthCases = 0;
let rejectedDepthCases = 0;

for (let depth = 0; depth < 200; depth += 1) {
    for (const [name, prefix, suffix, statements] of nestingShapes) {
        const source = statements
            ? prefix.repeat(depth) + "1;" + suffix.repeat(depth) + " 1;"
            : prefix.repeat(depth) + "1" + suffix.repeat(depth) + ";";
        const context = `${name}, depth ${depth}`;
        let compilation;
        assert.doesNotThrow(() => { compilation = compile(source); }, context);
        if (compilation.ok) {
            assert.equal(run(compilation.program), vm.runInNewContext(source), context);
            acceptedDepthCases += 1;
        } else {
            assert.ok(depth > 0, `Depth zero must compile: ${context}`);
            assert.equal(compilation.diagnostics[0].stage, "parser", context);
            assert.match(compilation.diagnostics[0].message, /(?:nesting|depth).*limit/i, context);
            rejectedDepthCases += 1;
        }
    }
}
assert.equal(acceptedDepthCases + rejectedDepthCases, 800);
assert.ok(acceptedDepthCases > 0);
assert.ok(rejectedDepthCases > 0);

const distinctPrograms = new Set();
for (let i = 0; i < 500; i += 1) {
    let source = "let x=1; ";
    for (let j = 0; j < 10; j += 1) {
        const k = (i * 17 + j * 13) % 7;
        source += k < 2
            ? `if (${j % 2}) {x = x + ${j};} `
            : k < 4
                ? `{let x = ${j}; x = x + 1;} `
                : `x = x + ${j}; `;
    }
    source += "x;";
    distinctPrograms.add(source);
    const compilation = compile(source);
    assert.equal(compilation.ok, true, `Differential case ${i}: ${JSON.stringify(compilation)}`);
    assert.equal(run(compilation.program), vm.runInNewContext(source), `Differential case ${i}`);
}

console.log(JSON.stringify({
    node: process.version,
    generation: "Deterministic; no RNG. Depth 0..199 across four shapes; k=(i*17+j*13)%7 for 500 differential cases with ten statements each.",
    nesting: { total: 800, accepted: acceptedDepthCases, rejectedWithParserDiagnostic: rejectedDepthCases },
    differential: { total: 500, distinctPrograms: distinctPrograms.size, nativeEngine: "node:vm" },
    totalChecks: 1300,
    result: "All assertions passed",
}, null, 2));
