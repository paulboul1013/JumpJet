import { performance } from "node:perf_hooks";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildBootstrap, saveBundle, root, digest } from "./build-bootstrap.mjs";
import { bootstrapConfig } from "./bootstrap-config.mjs";
import { encodeArtifact, decodeArtifact, assertSame } from "./artifact.mjs";
import { compile, run, invoke } from "../src/index.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analyzer.js";
import { emit } from "../src/compiler.js";
import { verifyProgram } from "../src/verifier.js";
import { valid, invalid } from "../tests/fixtures/self-hosting/corpus.js";

const generatedFiles = ["S.js", "manifest.json", "sources.json", "B1.json", "B2.json", "B3.json",
    "corpus-results.json", "report.json", "failure-input.js", "failure-expected.json", "failure-actual.json"];
async function resetOutput(output) {
    await mkdir(output, {recursive: true});
    await Promise.all(generatedFiles.map(name => unlink(path.join(output, name)).catch(error => {
        if (error.code !== "ENOENT") { throw error; }
    })));
}

export async function verifySelfHosting({output, config = bootstrapConfig, reference, referenceData, progress = () => {}}) {
    await mkdir(output, {recursive: true});
    // Use the same monotonic elapsed-time basis as timers, not the adjustable UTC clock.
    const started = performance.now();
    const report = {ok: false, config, stage: "bundle", generation: "host", case: "compiler-S", resources: [], artifacts: {}, checks: 0};
    let reproduction = "";
    function checkDeadline() {
        if (performance.now() - started >= config.deadlineMs) {
            const error = new RangeError(`Wall-clock deadline ${config.deadlineMs}ms exceeded.`);
            error.name = "DeadlineExceeded";
            throw error;
        }
    }
    function at(stage, generation, name, source) {
        checkDeadline();
        Object.assign(report, {stage, generation, case: name});
        reproduction = source;
        progress({...report, resources: report.resources.slice()});
    }
    function equal(a, b, label) {
        try { assertSame(a, b, label); }
        catch (error) { error.expected = a; error.actual = b; throw error; }
        report.checks += 1;
    }
    function guest(program, generation, entry, args, name, source) {
        at(entry, generation, name, source);
        const stats = {};
        const start = performance.now();
        try {
            const result = invoke(program, entry, args, {...config, stats});
            checkDeadline();
            return result;
        }
        finally { report.resources.push({generation, entry, case: name, elapsedMs: performance.now() - start, ...stats}); }
    }
    function phases(program, generation, source, name) {
        const lexed = tokenize(source);
        const guestLexed = guest(program, generation, "tokenize", [source], name, source);
        equal(lexed, guestLexed, `${generation} ${name} tokens`);
        if (!lexed.ok) { return; }
        if (!Object.isFrozen(guestLexed.tokens) || !guestLexed.tokens.every(Object.isFrozen)) { throw new Error("Guest token freeze contract failed."); }
        const parsed = parse(source, lexed.tokens);
        equal(parsed, guest(program, generation, "parse", [source, lexed.tokens], name, source), `${generation} ${name} AST`);
        if (!parsed.ok) { return; }
        const analyzed = analyze(parsed.ast);
        equal(analyzed, guest(program, generation, "analyze", [parsed.ast], name, source), `${generation} ${name} bindings`);
        if (!analyzed.ok) { return; }
        equal(emit(analyzed.program), guest(program, generation, "emit", [analyzed.program], name, source), `${generation} ${name} bytecode`);
    }
    try {
        const referenceText = referenceData ?? (reference === undefined ? undefined : await readFile(reference, "utf8"));
        await resetOutput(output);
        const bundle = await buildBootstrap();
        const rebuilt = await buildBootstrap();
        equal(bundle, rebuilt, "deterministic bundle");
        if (bundle.source.length > config.maxSourceLength) { throw new RangeError("Compiler source size limit exceeded."); }
        reproduction = bundle.source;
        await saveBundle(bundle, output);
        report.artifacts.S = {sha256: bundle.sha256, utf16Length: bundle.source.length};
        at("compileCore", "host", "compiler-S", bundle.source);
        const first = compile(bundle.source);
        if (!first.ok) { throw new Error(`Host compiler rejected S: ${JSON.stringify(first.diagnostics)}`); }
        const generations = [first.program];
        for (let i = 0; i < 3; i += 1) {
            const label = `B${i + 1}`;
            const program = generations[i];
            verifyProgram(program);
            const encoded = encodeArtifact(program);
            equal(program, decodeArtifact(encoded), label + " encoding roundtrip");
            await writeFile(path.join(output, label + ".json"), encoded);
            report.artifacts[label] = {sha256: digest(encoded), functions: program.functions.length, mainCode: program.code.length, constants: program.constants.length};
            if (i === 0 && reference !== undefined) {
                at("compare-reference", "B1", "compiler-S", bundle.source);
                const text = referenceText;
                report.reference = {path: reference, sha256: digest(text)};
                equal(decodeArtifact(text), program, "B1 reference artifact");
            }
            if (i < 2) {
                const next = guest(program, label, bundle.manifest.entry, [bundle.source], "compiler-S", bundle.source);
                if (!next.ok) { throw new Error(`${label} rejected S: ${JSON.stringify(next.diagnostics)}`); }
                equal(program, next.program, label + " -> B" + (i + 2));
                generations.push(next.program);
            }
        }
        const corpusResults = [];
        // Include a fixed S compile through B3 too; a terminal unusable compiler
        // generation cannot pass just by being byte-identical to its predecessors.
        for (let i = 0; i < generations.length; i += 1) {
            const generation = `B${i + 1}`;
            const program = generations[i];
            phases(program, generation, bundle.source, "compiler-S");
            for (const c of [...invalid, ...valid, ...invalid.slice(0, 1), ...valid.slice(0, 1)]) {
                if (c.source.length > config.maxSourceLength) { throw new RangeError("Corpus source size limit exceeded."); }
                const host = compile(c.source);
                const actual = guest(program, generation, bundle.manifest.entry, [c.source], c.name, c.source);
                equal(host, actual, `${generation} ${c.name} CompileResult`);
                if (Object.hasOwn(c, "diagnostic")) {
                    equal(actual, {ok: false, diagnostics: [c.diagnostic]}, `${generation} ${c.name} diagnostic oracle`);
                } else {
                    if (!host.ok || !actual.ok) { throw new Error(`Valid case ${c.name} rejected.`); }
                    const stats = {};
                    at("run", generation, c.name, c.source);
                    const result = run(actual.program, {...config, stats});
                    report.resources.push({generation, entry: "run", case: c.name, ...stats});
                    equal(result, c.value, `${generation} ${c.name} value oracle`);
                    equal(run(host.program, config), c.value, `host ${c.name} value oracle`);
                }
                corpusResults.push({generation, case: c.name, result: actual});
                phases(program, generation, c.source, c.name);
            }
        }
        at("compileCore", "B3", "compiler-S-final", bundle.source);
        const final = guest(generations[2], "B3", bundle.manifest.entry, [bundle.source], "compiler-S-final", bundle.source);
        equal(final, first, "B3 final compiler-S CompileResult");
        await writeFile(path.join(output, "corpus-results.json"), encodeArtifact(corpusResults));
        checkDeadline();
        report.ok = true;
        report.stage = "complete";
    } catch (error) {
        report.error = {name: error.name, message: error.message, difference: error.difference ?? null};
        await writeFile(path.join(output, "failure-input.js"), reproduction);
        if (Object.hasOwn(error, "expected")) {
            await writeFile(path.join(output, "failure-expected.json"), encodeArtifact(error.expected));
            await writeFile(path.join(output, "failure-actual.json"), encodeArtifact(error.actual));
        }
    }
    report.elapsedMs = performance.now() - started;
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
}

export async function verifyInWorker({output, config = bootstrapConfig, reference}) {
    // Read a reference before clearing generated files, so the preceding B1 in
    // the same output directory can be used as a reproducibility reference.
    const referenceData = reference === undefined ? undefined : await readFile(reference, "utf8");
    await resetOutput(output);
    return new Promise((resolve, reject) => {
        const started = performance.now();
        const worker = new Worker(new URL(import.meta.url), {workerData: {output, config, reference, referenceData}});
        let latest = {ok: false, stage: "startup", generation: "host", case: "compiler-S", config, resources: [], artifacts: {}};
        let complete = false;
        async function failed(error) {
            const report = {...latest, ok: false, elapsedMs: performance.now() - started, error: {name: error.name, message: error.message}};
            const c = [...valid, ...invalid].find(c => c.name === latest.case);
            let source = c?.source ?? "";
            if (!source && latest.artifacts.S) { source = await readFile(path.join(output, "S.js"), "utf8").catch(() => ""); }
            await writeFile(path.join(output, "failure-input.js"), source);
            await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
            resolve(report);
        }
        const timer = setTimeout(() => {
            if (complete) { return; }
            complete = true;
            worker.terminate().then(() => failed({name: "DeadlineExceeded", message: `Wall-clock deadline ${config.deadlineMs}ms exceeded.`})).catch(reject);
        }, config.deadlineMs);
        worker.on("message", message => {
            if (complete) { return; }
            if (message.type === "progress") { latest = message.report; }
            if (message.type === "result") {
                complete = true; clearTimeout(timer);
                if (performance.now() - started >= config.deadlineMs) {
                    failed({name: "DeadlineExceeded", message: `Wall-clock deadline ${config.deadlineMs}ms exceeded.`}).catch(reject);
                } else { resolve(message.report); }
            }
        });
        worker.on("error", error => {
            if (complete) { return; }
            complete = true; clearTimeout(timer); failed(error).catch(reject);
        });
        worker.on("exit", code => {
            if (complete) { return; }
            complete = true; clearTimeout(timer);
            failed({name: "WorkerExit", message: `Verification worker exited with code ${code}.`}).catch(reject);
        });
    });
}
if (!isMainThread) {
    const report = await verifySelfHosting({...workerData, progress: report => parentPort.postMessage({type: "progress", report})});
    parentPort.postMessage({type: "result", report});
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const config = {...bootstrapConfig};
        let output = path.join(root, "output/self-hosting/verification");
        let reference;
        for (let i = 2; i < process.argv.length; i += 2) {
            const flag = process.argv[i]; const value = process.argv[i + 1];
            if (flag === "--reference" && value) { reference = path.resolve(value); }
            else if (flag === "--output" && value) { output = path.resolve(value); }
            else if (flag === "--max-instructions" || flag === "--deadline-ms") {
                const number = Number(value);
                if (value === undefined || !Number.isSafeInteger(number) || number < (flag === "--deadline-ms" ? 1 : 0)) { throw new Error(`Invalid value for ${flag}.`); }
                config[flag === "--deadline-ms" ? "deadlineMs" : "maxInstructions"] = number;
            } else { throw new Error(`Unknown argument ${flag}.`); }
        }
        const report = await verifyInWorker({output, config, reference});
        if (!report.ok) {
            console.error(`Self-hosting failed: ${report.generation ?? "host"} ${report.stage} ${report.case ?? ""}: ${report.error.message}`);
            process.exitCode = 1;
        } else {
            console.log(`Self-hosting passed: B1 = B2 = B3, ${report.checks} checks, ${report.elapsedMs}ms.`);
        }
        console.log(`Artifacts: ${output}`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
