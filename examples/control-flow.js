import { compile, run } from "../src/index.js";

const source = `
let score = 3;
if (score < 5) {
    score = -score + 10;
} else {
    score = 0;
}
score === 7;
`;

const compilation = compile(source);

if (!compilation.ok) {
    console.error(compilation.diagnostics);
    process.exitCode = 1;
} else {
    console.log("Source:", source.trim());
    console.log("Bytecode:", compilation.program);
    console.log("Result:", run(compilation.program));
}
