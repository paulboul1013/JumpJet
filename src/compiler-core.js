import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { analyze } from "./analyzer.js";
import { emit } from "./compiler.js";

export function compileCore(source) {
    const lexed = tokenize(source);
    if (!lexed.ok) { return lexed; }
    const parsed = parse(source, lexed.tokens);
    if (!parsed.ok) { return parsed; }
    const analyzed = analyze(parsed.ast);
    if (!analyzed.ok) { return analyzed; }
    return emit(analyzed.program);
}
