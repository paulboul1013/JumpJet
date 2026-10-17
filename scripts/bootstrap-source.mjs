import { tokenize } from "../src/lexer.js";
import { parse, syntaxChildren } from "../src/parser.js";
import { analyze } from "../src/analyzer.js";

export function checkBootstrapSource(source, entry = "compileCore") {
    const lexed = tokenize(source);
    if (!lexed.ok) { throw new Error(`Bootstrap subset: ${JSON.stringify(lexed.diagnostics)}`); }
    const parsed = parse(source, lexed.tokens);
    if (!parsed.ok) { throw new Error(`Bootstrap subset: ${JSON.stringify(parsed.diagnostics)}`); }
    const bound = analyze(parsed.ast);
    if (!bound.ok) { throw new Error(`Bootstrap subset: ${JSON.stringify(bound.diagnostics)}`); }
    const names = new Set();
    const topFunctions = new Set();
    for (const stmt of parsed.ast.body) {
        if (stmt.type === "FunctionDeclaration" || stmt.type === "VariableDeclaration") {
            if (names.has(stmt.id.name)) { throw new Error(`Duplicate bundle name ${stmt.id.name}.`); }
            names.add(stmt.id.name);
            if (stmt.type === "FunctionDeclaration") { topFunctions.add(stmt.id.name); }
        }
    }
    if (!topFunctions.has(entry)) { throw new Error(`Missing compiler entry ${entry}.`); }
    // Literal calls have no host property fallback. Analyze also checks arity,
    // nested declarations and runtime-name collisions on all reachable AST nodes.
    const pending = [parsed.ast];
    while (pending.length > 0) {
        const node = pending.pop();
        if (node.type === "CallExpression" && node.callee.type !== "Identifier") {
            throw new Error("Bootstrap calls must use a fixed function or intrinsic name.");
        }
        pending.push(...syntaxChildren(node));
    }
    return {functions: topFunctions.size, slots: bound.program.slotCount};
}
