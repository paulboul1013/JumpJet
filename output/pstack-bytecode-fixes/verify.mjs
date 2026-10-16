import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
function checked(command, args) {
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result.stdout;
}

const testLog = checked(process.execPath, ["--test"]);
writeFileSync(new URL("tests-after.txt", import.meta.url), testLog);
let syntaxFiles = 0;
for (const directory of ["src", "web", "tests", "examples"]) {
    for (const name of readdirSync(new URL(`../../${directory}/`, import.meta.url))) {
        if (name.endsWith(".js")) {
            checked(process.execPath, ["--check", `${directory}/${name}`]);
            syntaxFiles += 1;
        }
    }
}
const arithmetic = checked(process.execPath, ["examples/arithmetic.js"]);
const controlFlow = checked(process.execPath, ["examples/control-flow.js"]);
const independentReview = checked(process.execPath, ["output/pstack-bytecode-fixes/independent-review.mjs"]);
writeFileSync(new URL("independent-review.txt", import.meta.url), independentReview);
console.log(JSON.stringify({
    testSummary: testLog.split("\n").filter((line) => /^(?:ℹ|#) (?:tests|pass|fail|skipped|cancelled)/.test(line)),
    syntaxFiles,
    arithmeticDemo: arithmetic.trim(),
    controlFlowDemo: controlFlow.trim(),
    independentReview: JSON.parse(independentReview),
}, null, 2));
