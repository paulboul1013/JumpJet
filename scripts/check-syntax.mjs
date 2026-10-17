// node --check accepts a single file; shell globs do not check every argument.
import {readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
let checked = 0;
async function check(directory) {
    for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { await check(file); }
        else if (/\.(mjs|js)$/.test(entry.name)) {
            const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {encoding: "utf8"});
            if (result.error) { throw result.error; }
            if (result.status !== 0) { throw new Error(`${file}: ${result.stderr}`); }
            checked += 1;
        }
    }
}
for (const directory of ["src", "web", "tests", "examples", "scripts"]) { await check(directory); }
console.log(`Syntax check passed: ${checked} files.`);
