import { analyze } from "./analyzer.js";
import { emit } from "./compiler.js";
import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { execute } from "./vm.js";

export function compile(source) {
    if (typeof source !== "string") {
        throw new TypeError("Source must be a string.");
    }

    const lexed = tokenize(source);
    if (!lexed.ok) {
        return lexed;
    }

    const parsed = parse(source, lexed.tokens);
    if (!parsed.ok) {
        return parsed;
    }

    const analyzed = analyze(parsed.ast);
    if (!analyzed.ok) {
        return analyzed;
    }

    return emit(analyzed.program);
}

export function run(program, options) {
    return execute(program, options);
}
