import { compile, run } from "../src/index.js";

const source = "let answer = 1 + 2 * 3; answer;";
const result = compile(source);

if (!result.ok) {
    console.error(result.diagnostics);
    process.exitCode = 1;
} else {
    console.log("Source:", source);
    console.log("Bytecode:", result.program);
    console.log("Result:", run(result.program));
}
