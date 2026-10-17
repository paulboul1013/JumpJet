import { fileURLToPath } from "node:url";
import { buildBootstrap } from "./build-bootstrap.mjs";
import { checkBootstrapSource } from "./bootstrap-source.mjs";
export { checkBootstrapSource } from "./bootstrap-source.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const bundle = await buildBootstrap();
    console.log("Bootstrap source subset passed:", checkBootstrapSource(bundle.source));
}
