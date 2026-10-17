import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { IntrinsicDefinitions } from "../src/runtime-symbols.js";
import { checkBootstrapSource } from "./bootstrap-source.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
export function digest(text) { return createHash("sha256").update(text).digest("hex"); }
export async function buildBootstrap() {
    const manifestText = await readFile(new URL("./bootstrap-manifest.json", import.meta.url), "utf8");
    const manifest = JSON.parse(manifestText);
    const sources = [];
    const exportsByModule = new Map();
    for (const name of manifest.modules) {
        const text = await readFile(path.join(root, name), "utf8");
        const exports = [...text.matchAll(/^export (?:function|const|let) (\w+)/gm)].map(m => m[1]);
        exportsByModule.set(name, exports);
        sources.push({name, text, sha256: digest(text)});
    }
    const intrinsicNames = IntrinsicDefinitions.map(d => d.name);
    let source = "// JumpJet compiler bundle, manifest version " + manifest.version + "\n";
    for (const item of sources) {
        const body = item.text.replace(/^import \{ ([\w, ]+) \} from "([.\w/-]+)";\r?\n/gm, (_, bindings, target) => {
            const module = path.posix.normalize(path.posix.join(path.posix.dirname(item.name), target));
            const allowed = module === "src/runtime.js" ? intrinsicNames : exportsByModule.get(module);
            for (const binding of bindings.split(",").map(s => s.trim())) {
                if (!allowed?.includes(binding)) { throw new Error(`Unsupported import ${binding} from ${target} in ${item.name}.`); }
            }
            return "";
        }).replace(/^export (?=(?:function|const|let) )/gm, "");
        source += "\n// Module: " + item.name + "\n" + body;
    }
    source += "\n0;\n";
    checkBootstrapSource(source, manifest.entry);
    return {source, manifest, manifestText, sources: sources.map(({name, sha256}) => ({name, sha256})), sha256: digest(source)};
}
export async function saveBundle(bundle, directory) {
    await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, "S.js"), bundle.source);
    await writeFile(path.join(directory, "manifest.json"), bundle.manifestText);
    await writeFile(path.join(directory, "sources.json"), JSON.stringify({sha256: bundle.sha256, sources: bundle.sources}, null, 2) + "\n");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const bundle = await buildBootstrap();
    await saveBundle(bundle, path.join(root, "output/self-hosting/bundle"));
    console.log(`Bundle ${bundle.sha256}: ${bundle.source.length} UTF-16 units, ${bundle.sources.length} modules.`);
}
