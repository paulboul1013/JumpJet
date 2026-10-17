import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {verifySelfHosting} from "../scripts/verify-self-hosting.mjs";
import {buildBootstrap} from "../scripts/build-bootstrap.mjs";
import {encodeArtifact, decodeArtifact} from "../scripts/artifact.mjs";
import {compile} from "../src/index.js";

test("a verification mismatch persists the first field and both compared values", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "jumpjet-mismatch-"));
    const bundle = await buildBootstrap();
    const expected = compile(bundle.source).program;
    expected.functions[0].arity += 1;
    const reference = path.join(output, "reference.json");
    await writeFile(reference, encodeArtifact(expected));
    const report = await verifySelfHosting({output, reference});
    assert.equal(report.ok, false);
    assert.equal(report.stage, "compare-reference");
    assert.match(report.error.difference, /functions.*arity/);
    assert.deepEqual(decodeArtifact(await readFile(path.join(output, "failure-expected.json"), "utf8")), expected);
    const actual = decodeArtifact(await readFile(path.join(output, "failure-actual.json"), "utf8"));
    assert.equal(actual.functions[0].arity, expected.functions[0].arity - 1);
    assert.equal(await readFile(path.join(output, "failure-input.js"), "utf8"), bundle.source);
});
for (const [name, args, error] of [
    ["budget", ["--max-instructions", "1"], /Instruction budget/],
    ["deadline", ["--deadline-ms", "1"], /deadline/],
]) test(`acceptance command exits nonzero and saves ${name} reproduction`, async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), `jumpjet-${name}-`));
    await writeFile(path.join(output, "B3.json"), "stale generation");
    await writeFile(path.join(output, "failure-expected.json"), "stale failure");
    const child = spawnSync(process.execPath, ["scripts/verify-self-hosting.mjs", "--output", output, ...args], {encoding: "utf8", timeout: 10000});
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, child.stderr);
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.ok, false);
    await assert.rejects(readFile(path.join(output, "B3.json")), {code: "ENOENT"});
    await assert.rejects(readFile(path.join(output, "failure-expected.json")), {code: "ENOENT"});
    assert.match(report.error.message, error);
    assert.equal(typeof await readFile(path.join(output, "failure-input.js"), "utf8"), "string");
    if (name === "budget") {
        assert.equal(report.generation, "B1");
        assert.equal(report.stage, "compileCore");
        assert.equal(report.resources.at(-1).work, 0);
        assert.ok((await readFile(path.join(output, "failure-input.js"), "utf8")).includes("function compileCore"));
    }
});

test("the standalone source subset command completes without a module await cycle", () => {
    const child = spawnSync(process.execPath, ["scripts/check-bootstrap-source.mjs"], {encoding: "utf8", timeout: 5000});
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Bootstrap source subset passed/);
    assert.doesNotMatch(child.stderr, /unsettled top-level await/);
});

test("deadline accounting is unaffected by a system clock correction", async () => {
    const {bootstrapConfig} = await import("../scripts/bootstrap-config.mjs");
    const output = await mkdtemp(path.join(os.tmpdir(), "jumpjet-clock-"));
    const originalNow = Date.now;
    try {
        const report = await verifySelfHosting({output, config: {...bootstrapConfig, maxInstructions: 1}, progress: () => {
            Date.now = () => originalNow() + 120_000;
        }});
        assert.equal(report.ok, false);
        assert.match(report.error.message, /Instruction budget/);
        assert.ok(report.elapsedMs < bootstrapConfig.deadlineMs);
    } finally { Date.now = originalNow; }
});
