import { IntrinsicDefinitions } from "./runtime-symbols.js";
import { rtIsArray, rtTrap, rtPush, rtPop, rtType } from "./runtime.js";

function analyzerFail(c, message, node) {
    if (c.diagnostic === null) { c.diagnostic = {stage: "analyzer", message: message, start: node.start, end: node.end}; }
    return null;
}
function analyzerBuiltin(name) {
    let i = 0;
    while (i < IntrinsicDefinitions.length) {
        if (IntrinsicDefinitions[i].name === name) { return i; }
        i = i + 1;
    }
    return -1;
}
function analyzerSignature(c, name) {
    let i = 0;
    while (i < c.signatures.length) {
        if (c.signatures[i].name === name) { return i; }
        i = i + 1;
    }
    return -1;
}
function analyzerFind(scope, name) {
    let i = 0;
    while (i < scope.length) {
        if (scope[i].name === name) { return scope[i]; }
        i = i + 1;
    }
    return null;
}
function analyzerLookup(c, name) {
    let i = c.scopes.length - 1;
    while (i >= 0) {
        const binding = analyzerFind(c.scopes[i], name);
        if (binding !== null) { return binding; }
        i = i - 1;
    }
    return null;
}
function analyzerResolve(c, node) {
    const binding = analyzerLookup(c, node.name);
    if (binding === null) { return analyzerFail(c, "Unknown identifier '" + node.name + "'.", node); }
    if (!binding.initialized) { return analyzerFail(c, "Cannot access '" + node.name + "' before initialization.", node); }
    return binding;
}
function analyzerDeclare(c, scope, id, kind, initialized) {
    if (analyzerFind(scope, id.name) !== null) { return analyzerFail(c, "Identifier '" + id.name + "' is already declared in this scope.", id); }
    if (analyzerBuiltin(id.name) >= 0) { return analyzerFail(c, "Reserved runtime name '" + id.name + "'.", id); }
    const binding = {name: id.name, kind: kind, slot: c.slotCount, initialized: initialized, global: !c.inFunction};
    c.slotCount = c.slotCount + 1;
    rtPush(scope, binding);
    return binding;
}
function analyzerScope(c, statements, params) {
    const scope = [];
    let i = 0;
    while (i < params.length && c.diagnostic === null) { analyzerDeclare(c, scope, params[i], "let", true); i = i + 1; }
    i = 0;
    while (i < statements.length && c.diagnostic === null) {
        const stmt = statements[i];
        if (stmt.type === "VariableDeclaration") { analyzerDeclare(c, scope, stmt.id, stmt.kind, false); }
        i = i + 1;
    }
    return scope;
}
function analyzerExpressions(c, nodes) {
    const bound = [];
    let i = 0;
    while (i < nodes.length && c.diagnostic === null) {
        const node = analyzerExpression(c, nodes[i]);
        if (node === null) { return null; }
        rtPush(bound, node);
        i = i + 1;
    }
    return bound;
}
function analyzerExpression(c, n) {
    const t = n.type;
    if (t === "NumericLiteral" || t === "BooleanLiteral" || t === "StringLiteral" || t === "Literal") {
        return {type: "Bound" + t, value: n.value, start: n.start, end: n.end};
    }
    if (t === "Identifier") {
        const b = analyzerResolve(c, n);
        if (b === null) { return null; }
        return {type: "BoundIdentifier", slot: b.slot, global: c.inFunction && b.global, start: n.start, end: n.end};
    }
    if (t === "UnaryExpression") {
        const arg = analyzerExpression(c, n.argument);
        if (arg === null) { return null; }
        return {type: "BoundUnaryExpression", operator: n.operator, argument: arg, start: n.start, end: n.end};
    }
    if (t === "BinaryExpression") {
        const left = analyzerExpression(c, n.left);
        if (left === null) { return null; }
        const right = analyzerExpression(c, n.right);
        if (right === null) { return null; }
        return {type: "BoundBinaryExpression", operator: n.operator, left: left, right: right, start: n.start, end: n.end};
    }
    if (t === "MemberExpression") {
        const object = analyzerExpression(c, n.object);
        if (object === null) { return null; }
        const property = analyzerExpression(c, n.property);
        if (property === null) { return null; }
        return {type: "BoundMemberExpression", object: object, property: property, start: n.start, end: n.end};
    }
    if (t === "AssignmentExpression") {
        if (n.target.type === "MemberExpression") {
            const target = analyzerExpression(c, n.target);
            if (target === null) { return null; }
            const value = analyzerExpression(c, n.value);
            if (value === null) { return null; }
            return {type: "BoundMemberAssignment", target: target, value: value, start: n.start, end: n.end};
        }
        const b = analyzerResolve(c, n.target);
        if (b === null) { return null; }
        if (b.kind === "const") { return analyzerFail(c, "Cannot assign to constant '" + n.target.name + "'.", n.target); }
        const value = analyzerExpression(c, n.value);
        if (value === null) { return null; }
        return {type: "BoundAssignmentExpression", slot: b.slot, global: c.inFunction && b.global, value: value, start: n.start, end: n.end};
    }
    if (t === "ArrayExpression") {
        const elements = analyzerExpressions(c, n.elements);
        if (elements === null) { return null; }
        return {type: "BoundArrayExpression", elements: elements, start: n.start, end: n.end};
    }
    if (t === "RecordExpression") {
        const properties = [];
        let i = 0;
        while (i < n.properties.length) {
            const p = n.properties[i];
            let j = 0;
            while (j < i) {
                if (n.properties[j].key === p.key) { return analyzerFail(c, "Duplicate record key '" + p.key + "'.", p); }
                j = j + 1;
            }
            const value = analyzerExpression(c, p.value);
            if (value === null) { return null; }
            rtPush(properties, {key: p.key, value: value});
            i = i + 1;
        }
        return {type: "BoundRecordExpression", properties: properties, start: n.start, end: n.end};
    }
    if (t === "CallExpression") {
        if (n.callee.type !== "Identifier") { return analyzerFail(c, "Only direct named calls are supported.", n.callee); }
        const name = n.callee.name;
        if (analyzerLookup(c, name) !== null) { return analyzerFail(c, "Binding '" + name + "' is not callable.", n.callee); }
        const builtin = analyzerBuiltin(name);
        const index = analyzerSignature(c, name);
        let arity = 0;
        if (builtin >= 0) { arity = IntrinsicDefinitions[builtin].arity; }
        else if (index >= 0) { arity = c.signatures[index].arity; }
        else { return analyzerFail(c, "Unknown function '" + name + "'.", n.callee); }
        if (n.arguments.length !== arity) { return analyzerFail(c, "Function '" + name + "' expects " + arity + " arguments.", n); }
        const args = analyzerExpressions(c, n.arguments);
        if (args === null) { return null; }
        return {type: "BoundCallExpression", builtin: builtin, index: index, arguments: args, start: n.start, end: n.end};
    }
    rtTrap("Unsupported expression type '" + t + "'.");
}
function analyzerStatements(c, statements, scope) {
    rtPush(c.scopes, scope);
    const body = [];
    let i = 0;
    while (i < statements.length && c.diagnostic === null) {
        if (statements[i].type === "FunctionDeclaration" && !c.inFunction && c.scopes.length === 1) {
            // Signatures were collected before any function body is analyzed.
        } else {
            const stmt = analyzerStatement(c, statements[i]);
            if (stmt !== null) { rtPush(body, stmt); }
        }
        i = i + 1;
    }
    rtPop(c.scopes);
    if (c.diagnostic !== null) { return null; }
    return body;
}
function analyzerStatement(c, n) {
    const t = n.type;
    if (t === "FunctionDeclaration") { return analyzerFail(c, "Functions must be declared at top level.", n); }
    if (t === "VariableDeclaration") {
        const b = analyzerFind(c.scopes[c.scopes.length - 1], n.id.name);
        const init = analyzerExpression(c, n.init);
        if (init === null) { return null; }
        b.initialized = true;
        return {type: "BoundVariableDeclaration", kind: n.kind, slot: b.slot, init: init, start: n.start, end: n.end};
    }
    if (t === "ExpressionStatement") {
        const expr = analyzerExpression(c, n.expression);
        if (expr === null) { return null; }
        return {type: "BoundExpressionStatement", expression: expr, start: n.start, end: n.end};
    }
    if (t === "ReturnStatement") {
        if (!c.inFunction) { return analyzerFail(c, "Return is only allowed in a function.", n); }
        let arg = {type: "BoundLiteral", value: undefined, start: n.start, end: n.end};
        if (n.argument !== null) { arg = analyzerExpression(c, n.argument); }
        if (arg === null) { return null; }
        return {type: "BoundReturnStatement", argument: arg, start: n.start, end: n.end};
    }
    if (t === "BlockStatement") {
        const body = analyzerStatements(c, n.body, analyzerScope(c, n.body, []));
        if (body === null) { return null; }
        return {type: "BoundBlockStatement", body: body, start: n.start, end: n.end};
    }
    if (t === "IfStatement") {
        const test = analyzerExpression(c, n.test);
        if (test === null) { return null; }
        const consequent = analyzerStatement(c, n.consequent);
        if (consequent === null) { return null; }
        let alternate = null;
        if (n.alternate !== null) { alternate = analyzerStatement(c, n.alternate); if (alternate === null) { return null; } }
        return {type: "BoundIfStatement", test: test, consequent: consequent, alternate: alternate, start: n.start, end: n.end};
    }
    if (t === "WhileStatement") {
        const test = analyzerExpression(c, n.test);
        if (test === null) { return null; }
        const body = analyzerStatement(c, n.body);
        if (body === null) { return null; }
        return {type: "BoundWhileStatement", test: test, body: body, start: n.start, end: n.end};
    }
    rtTrap("Unsupported statement type '" + t + "'.");
}
export function analyze(ast) {
    if (rtType(ast) !== "object" || ast === null || ast.type !== "Program" || !rtIsArray(ast.body)) { rtTrap("Expected a Program AST."); }
    if (ast.body.length === 0 || ast.body[ast.body.length - 1].type !== "ExpressionStatement") {
        return {ok: false, diagnostics: [{stage: "analyzer", message: "Program must end with an expression statement.", start: ast.start, end: ast.end}]};
    }
    const c = {scopes: [], signatures: [], slotCount: 0, inFunction: false, diagnostic: null};
    let i = 0;
    while (i < ast.body.length && c.diagnostic === null) {
        const n = ast.body[i];
        if (n.type === "FunctionDeclaration") {
            if (analyzerSignature(c, n.id.name) >= 0 || analyzerBuiltin(n.id.name) >= 0) { analyzerFail(c, "Duplicate or reserved function '" + n.id.name + "'.", n.id); }
            else { rtPush(c.signatures, {name: n.id.name, arity: n.params.length, node: n}); }
        }
        i = i + 1;
    }
    const globals = analyzerScope(c, ast.body, []);
    i = 0;
    while (i < globals.length && c.diagnostic === null) {
        if (analyzerSignature(c, globals[i].name) >= 0) { analyzerFail(c, "Name conflicts with function '" + globals[i].name + "'.", ast); }
        i = i + 1;
    }
    const body = analyzerStatements(c, ast.body, globals);
    const globalCount = c.slotCount;
    const functions = [];
    c.inFunction = true;
    rtPush(c.scopes, globals);
    i = 0;
    while (i < c.signatures.length && c.diagnostic === null) {
        const sig = c.signatures[i];
        const n = sig.node;
        c.slotCount = 0;
        const scope = analyzerScope(c, n.body.body, n.params);
        const functionBody = analyzerStatements(c, n.body.body, scope);
        rtPush(functions, {name: sig.name, arity: sig.arity, slotCount: c.slotCount, body: functionBody});
        i = i + 1;
    }
    if (c.diagnostic !== null) { return {ok: false, diagnostics: [c.diagnostic]}; }
    return {ok: true, program: {type: "BoundProgram", body: body, slotCount: globalCount, functions: functions, start: ast.start, end: ast.end}};
}
