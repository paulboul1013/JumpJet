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

    return emit(parsed.ast);
}

export function run(program) {
    return execute(program);
}
