import assert from "node:assert/strict";
import test from "node:test";
import { compile, run } from "../src/index.js";
import * as api from "../src/index.js";
import { valid, invalid } from "./fixtures/self-hosting/corpus.js";

for (const c of valid) test(`bootstrap language: ${c.name}`, () => {
    const result = compile(c.source);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(run(result.program), c.value);
});
for (const c of invalid) test(`bootstrap diagnostic: ${c.name}`, () => {
    assert.deepEqual(compile(c.source), {ok: false, diagnostics: [c.diagnostic]});
});
test("invoke initializes fresh globals and accepts data without source interpolation", () => {
    const result = compile("let x = 0; function next(c) { x = x + c.n; return {value: x}; } 0;");
    assert.equal(result.ok, true);
    assert.deepEqual(api.invoke(result.program, "next", [{n: 3}]), {value: 3});
    assert.deepEqual(api.invoke(result.program, "next", [{n: 8}]), {value: 8});
    assert.throws(() => api.invoke(result.program, "missing", []), /entry/i);
    assert.throws(() => api.invoke(result.program, "next", [() => 0]), /Guest data/);
});
