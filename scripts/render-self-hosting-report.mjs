import assert from "node:assert/strict";
import {readFile, writeFile, mkdir, mkdtemp} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {homedir, tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {buildBootstrap, digest} from "./build-bootstrap.mjs";
import {decodeArtifact} from "./artifact.mjs";
import {InstructionSet} from "../src/bytecode.js";
import {IntrinsicDefinitions} from "../src/runtime-symbols.js";
import {verifyProgram} from "../src/verifier.js";
import {valid, invalid} from "../tests/fixtures/self-hosting/corpus.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFile(path.join(root, name), "utf8");
const directory = "output/self-hosting/verification/";
const reportText = await read(directory + "report.json");
const report = JSON.parse(reportText);
assert.equal(report.ok, true, "The saved self-hosting report must pass.");
const bundle = await buildBootstrap();
assert.equal(bundle.sha256, report.artifacts.S.sha256, "Compiler source changed; rerun verify:self-hosting before publishing this report.");
assert.equal(await read(directory + "S.js"), bundle.source);
const artifactTexts = await Promise.all(["B1", "B2", "B3"].map(name => read(directory + name + ".json")));
assert.equal(artifactTexts[0], artifactTexts[1]);
assert.equal(artifactTexts[1], artifactTexts[2]);
const program = decodeArtifact(artifactTexts[0]);
verifyProgram(program);
for (let i = 0; i < 3; i += 1) { assert.equal(digest(artifactTexts[i]), report.artifacts[`B${i + 1}`].sha256); }
const recordText = await read("docs/plans/self-hosting-implementation.md");
const recordedChecks = recordText.match(/(\d+) 個測試、(\d+) 個檔案的 syntax check/);
assert.ok(recordedChecks, "Recorded regression counts are missing.");
const browserEnvelope = JSON.parse(await read("output/playwright/studio-smoke.json"));
const browser = typeof browserEnvelope.result === "string" ? JSON.parse(browserEnvelope.result) : browserEnvelope;
assert.equal(browser.ok, true);
assert.deepEqual(browser.errors, []);
let codeWords = 0;
let staticOpcodes = 0;
for (const code of [program.code, ...program.functions.map(fn => fn.code)]) {
    codeWords += code.length;
    for (let i = 0; i < code.length;) {
        const instruction = InstructionSet[code[i]];
        i += instruction.operand === null ? 1 : 2;
        staticOpcodes += 1;
    }
}
const phaseCalls = {};
for (const row of report.resources) { phaseCalls[row.entry] = (phaseCalls[row.entry] ?? 0) + 1; }
const selfCompiles = report.resources.filter(row => row.entry === "compileCore" && row.case.startsWith("compiler-S"));
assert.equal(selfCompiles.length, 3);
const self = selfCompiles[0];
const fmt = n => n.toLocaleString("en-US");
const descriptions = {
    compileCore: "完整 CompileResult，包含固定 S 與重複輸入。",
    tokenize: "Tokens 與 source spans。",
    parse: "AST 與 parser diagnostics。",
    analyze: "BoundProgram、slots 與 binding diagnostics。",
    emit: "完整 bytecode schema。",
    run: "由該代編譯的合法程式，核對獨立期望值。",
};
const data = {
    checks: fmt(report.checks), elapsedSeconds: (report.elapsedMs / 1000).toFixed(3),
    tests: recordedChecks[1], syntaxFiles: recordedChecks[2],
    moduleCount: bundle.manifest.modules.length, sourceLength: fmt(bundle.source.length),
    functions: fmt(program.functions.length), constants: fmt(program.constants.length),
    codeWords: fmt(codeWords), staticOpcodes: fmt(staticOpcodes), mainCode: fmt(program.code.length),
    intrinsics: IntrinsicDefinitions.length, validCases: valid.length, invalidCases: invalid.length,
    phaseRows: Object.entries(phaseCalls).map(([name, count]) => `| \`${name}\` | ${count} | ${descriptions[name]} |`).join("\n"),
    selfWorkRaw: self.work, maxWorkRaw: report.config.maxInstructions,
    selfFramesRaw: self.maxFrames, maxFramesRaw: report.config.maxCallDepth,
    boundaryFramesRaw: Math.max(...report.resources.map(row => row.maxFrames ?? 0)),
    deadlineSeconds: report.config.deadlineMs / 1000,
    sourceLengthRaw: bundle.source.length, maxSourceRaw: report.config.maxSourceLength,
    selfCompileRows: selfCompiles.map(row => `| ${row.generation} | ${fmt(row.instructions)} | ${fmt(row.work)} | ${fmt(row.builtinCalls)} | ${row.maxFrames} | ${row.elapsedMs.toFixed(3)} ms |`).join("\n"),
    sourceHash: bundle.sha256, bytecodeHash: digest(artifactTexts[0]),
    sourceHashShort: bundle.sha256.slice(0, 12) + "…" + bundle.sha256.slice(-8),
    bytecodeHashShort: digest(artifactTexts[0]).slice(0, 12) + "…" + digest(artifactTexts[0]).slice(-8),
};
const template = await read("docs/plans/self-hosting-visualized.am.md");
const content = template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    assert.ok(Object.hasOwn(data, name), `Unknown report field ${name}.`);
    return String(data[name]);
});
const assets = path.join(root, "docs/assets/self-hosting-implementation");
await mkdir(assets, {recursive: true});
const evidence = {
    reportSource: directory + "report.json", reportSha256: digest(reportText),
    sourceSha256: bundle.sha256, executableEncodingSha256: digest(artifactTexts[0]),
    modules: bundle.sources, report: {ok: report.ok, checks: report.checks, elapsedMs: report.elapsedMs, config: report.config},
    compiler: {functions: program.functions.length, constants: program.constants.length, mainCodeWords: program.code.length, allCodeWords: codeWords, staticOpcodes},
    corpus: {valid: valid.length, invalid: invalid.length}, phaseCalls, selfCompiles,
    regressionRecord: {source: "docs/plans/self-hosting-implementation.md", tests: Number(recordedChecks[1]), syntaxFiles: Number(recordedChecks[2])},
    browser,
};
await writeFile(path.join(assets, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
const contentPath = path.join(assets, "content.am.md");
await writeFile(contentPath, content);
if (!process.argv.includes("--prepare-only")) {
    const rendererIndex = process.argv.indexOf("--renderer");
    const renderer = rendererIndex >= 0 ? process.argv[rendererIndex + 1] : path.join(homedir(), ".codex/skills/answer-me-with-html/scripts/am.mjs");
    assert.ok(renderer, "--renderer requires a path to am.mjs.");
    const temporaryHome = await mkdtemp(path.join(tmpdir(), "jumpjet-html-"));
    const child = spawnSync(process.execPath, [renderer, "render", contentPath, "-o", path.join(root, "docs/self-hosting-implementation.html"), "--no-open"], {
        cwd: root, encoding: "utf8", env: {...process.env, AM_HOME: temporaryHome},
    });
    if (child.stdout) { process.stdout.write(child.stdout); }
    if (child.stderr) { process.stderr.write(child.stderr); }
    if (child.error) { throw child.error; }
    assert.equal(child.status, 0, "The HTML renderer failed.");
}
console.log(`Report data verified: ${report.checks} checks, ${program.functions.length} functions, ${report.resources.length} resource rows.`);
