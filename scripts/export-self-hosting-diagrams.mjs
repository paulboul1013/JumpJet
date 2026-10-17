import assert from "node:assert/strict";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

assert.ok(process.argv[2], "Usage: node scripts/export-self-hosting-diagrams.mjs <Playwright CLI JSON>");
const envelope = JSON.parse(await readFile(process.argv[2], "utf8"));
const report = typeof envelope.result === "string" ? JSON.parse(envelope.result) : envelope;
assert.equal(report.ok, true, "Browser inspection must pass before exporting diagrams.");
assert.deepEqual(report.errors, []);
const names = ["01-generations.svg", "02-compiler-pipeline.svg", "03-call-frames.svg", "04-host-boundary.svg", "05-acceptance-proofs.svg"];
assert.equal(report.images.length, names.length);
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "docs/assets/self-hosting-implementation");
await mkdir(directory, {recursive: true});
for (let i = 0; i < names.length; i += 1) {
    assert.equal(report.images[i].index, i);
    assert.match(report.images[i].svg, /^<svg\s/);
    assert.match(report.images[i].svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    await writeFile(path.join(directory, names[i]), report.images[i].svg + "\n");
}
const {images, ...summary} = report;
summary.svgFiles = names.map(name => "docs/assets/self-hosting-implementation/" + name);
await mkdir(path.join(root, "output/playwright"), {recursive: true});
await writeFile(path.join(root, "output/playwright/self-hosting-report-check.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`Exported ${names.length} standalone SVGs. Browser checks passed for desktop, mobile, navigation and themes.`);
