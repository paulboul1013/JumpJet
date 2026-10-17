import assert from "node:assert/strict";
import test from "node:test";
import {buildBootstrap} from "../scripts/build-bootstrap.mjs";
import {checkBootstrapSource} from "../scripts/check-bootstrap-source.mjs";
import {encodeArtifact, decodeArtifact, firstDifference, assertSame} from "../scripts/artifact.mjs";
import {compile, invoke} from "../src/index.js";
import {tokenize} from "../src/lexer.js";
import {parse} from "../src/parser.js";
import {analyze} from "../src/analyzer.js";
import {emit} from "../src/compiler.js";

test("artifact encoding preserves special scalars and field order without tag collisions", () => {
    const input = {undefined: undefined, numbers: [NaN, Infinity, -Infinity, -0, 0, 1.25], user: {tag: "undefined"}, text: "😀"};
    const encoded = encodeArtifact(input);
    assertSame(input, decodeArtifact(encoded), "roundtrip");
    assert.equal(encoded, encodeArtifact(input));
    for (const [a, b] of [[0, -0], [undefined, null], [NaN, null], [Infinity, -Infinity]]) {
        assert.notEqual(encodeArtifact(a), encodeArtifact(b));
        assert.throws(() => assertSame(a, b, "mismatch"), /first difference at \$/);
    }
});
test("artifact comparison includes every executable field and array order", () => {
    const result = compile("function f(a) { return a; } f(1);");
    for (const mutate of [
        p => { p.version += 1; }, p => { p.constants.reverse(); },
        p => { p.code[0] += 1; }, p => { p.slotCount += 1; },
        p => { p.functions[0].name = "g"; }, p => { p.functions[0].arity = 0; },
        p => { p.functions[0].slotCount += 1; }, p => { p.functions[0].code[0] += 1; },
    ]) {
        const changed = structuredClone(result.program);
        mutate(changed);
        assert.notEqual(firstDifference(result.program, changed), null);
    }
});
test("subset guard rejects unsupported syntax rather than transpiling it", () => {
    for (const bad of [
        'function compileCore(s) { const f = () => s; return f(); } 0;',
        'function compileCore(s) { function inner() { return s; } return inner(); } 0;',
        'function compileCore(s) { return s.slice(0, 1); } 0;',
        'function compileCore(s) { return new Map(); } 0;',
        'function compileCore(s) { return /x/; } 0;',
        'function compileCore(s) { return `${s}`; } 0;',
    ]) { assert.throws(() => checkBootstrapSource(bad), /Bootstrap subset/); }
});
test("fixed manifest rebuilds S and the same complete compiler executes every phase in VM", async () => {
    const bundle = await buildBootstrap();
    assert.deepEqual(bundle, await buildBootstrap());
    assert.ok(!bundle.manifest.modules.includes("src/vm.js"));
    const first = compile(bundle.source);
    assert.equal(first.ok, true);
    const options = {maxInstructions: 100_000_000};
    const stats = {};
    const second = invoke(first.program, "compileCore", [bundle.source], {...options, stats});
    assertSame(first, second, "self compilation");
    assert.ok(stats.instructions > 1_000_000);
    const s = 'let box = {values: [2, 3]}; box.values[0];';
    const lexed = tokenize(s);
    assert.deepEqual(invoke(first.program, "tokenize", [s], options), lexed);
    const parsed = parse(s, lexed.tokens);
    assert.deepEqual(invoke(first.program, "parse", [s, lexed.tokens], options), parsed);
    const bound = analyze(parsed.ast);
    assert.deepEqual(invoke(first.program, "analyze", [parsed.ast], options), bound);
    assert.deepEqual(invoke(first.program, "emit", [bound.program], options), emit(bound.program));
    const bad = invoke(first.program, "compileCore", ["let = 0;"], options);
    assert.equal(bad.ok, false);
    assert.deepEqual(invoke(first.program, "compileCore", [s], options), compile(s));
});
