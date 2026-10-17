import { TokenKind } from "./lexer.js";
import { rtType, rtTrap, rtIsArray, rtPush, rtPop, rtSlice, rtNumber, rtFromCharCode } from "./runtime.js";

export const MAX_SYNTAX_DEPTH = 128;
function parserCurrent(c) {
    if (c.position >= c.tokens.length) { return {kind: "Eof", start: c.source.length, end: c.source.length}; }
    return c.tokens[c.position];
}
function parserAdvance(c) {
    const t = parserCurrent(c);
    if (t.kind !== "Eof") { c.position = c.position + 1; }
    return t;
}
function parserFail(c, message, t) {
    if (c.diagnostic === null) { c.diagnostic = {stage: "parser", message: message, start: t.start, end: t.end}; }
    return null;
}
function parserConsume(c, kind, message) {
    if (parserCurrent(c).kind !== kind) { return parserFail(c, message, parserCurrent(c)); }
    return parserAdvance(c);
}
function parserEnter(c) {
    if (c.depth >= MAX_SYNTAX_DEPTH) {
        parserFail(c, "Source nesting exceeds limit " + MAX_SYNTAX_DEPTH + ".", parserCurrent(c));
        return false;
    }
    c.depth = c.depth + 1;
    return true;
}
function parserText(c, t) { return rtSlice(c.source, t.start, t.end); }
function parserIdentifier(c, t) { return {type: "Identifier", name: parserText(c, t), start: t.start, end: t.end}; }
function parserString(c, t) {
    let p = t.start + 1;
    let value = "";
    while (p < t.end - 1) {
        let ch = c.source[p];
        if (ch === "\\") {
            p = p + 1;
            const e = c.source[p];
            if (e === "n") { ch = "\n"; }
            else if (e === "r") { ch = "\r"; }
            else if (e === "t") { ch = "\t"; }
            else if (e === "b") { ch = "\b"; }
            else if (e === "f") { ch = "\f"; }
            else if (e === "v") { ch = "\v"; }
            else if (e === "0") { ch = "\0"; }
            else if (e === "\\" || e === "'" || e === '"') { ch = e; }
            else if (e === "u") {
                let code = 0;
                let i = 0;
                while (i < 4) {
                    p = p + 1;
                    const h = c.source[p];
                    let digit = -1;
                    if (h >= "0" && h <= "9") { digit = rtNumber(h); }
                    else if (h >= "a" && h <= "f") {
                        let j = 0;
                        while (j < 6) { if ("abcdef"[j] === h) { digit = j + 10; } j = j + 1; }
                    } else if (h >= "A" && h <= "F") {
                        let j = 0;
                        while (j < 6) { if ("ABCDEF"[j] === h) { digit = j + 10; } j = j + 1; }
                    }
                    if (digit < 0 || p >= t.end - 1) { return parserFail(c, "Invalid Unicode escape.", t); }
                    code = code * 16 + digit;
                    i = i + 1;
                }
                ch = rtFromCharCode(code);
            } else { return parserFail(c, "Unsupported string escape.", t); }
        }
        value = value + ch;
        p = p + 1;
    }
    return {type: "StringLiteral", value: value, start: t.start, end: t.end};
}
function parserNameToken(c, t) {
    const s = parserText(c, t);
    const ch = s[0];
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}
function parserPrimary(c) {
    const t = parserCurrent(c);
    if (t.kind === "Number") {
        parserAdvance(c);
        return {type: "NumericLiteral", value: rtNumber(parserText(c, t)), start: t.start, end: t.end};
    }
    if (t.kind === "String") { parserAdvance(c); return parserString(c, t); }
    if (t.kind === "True" || t.kind === "False") {
        parserAdvance(c);
        return {type: "BooleanLiteral", value: t.kind === "True", start: t.start, end: t.end};
    }
    if (t.kind === "Null" || t.kind === "Undefined") {
        parserAdvance(c);
        let value = undefined;
        if (t.kind === "Null") { value = null; }
        return {type: "Literal", value: value, start: t.start, end: t.end};
    }
    if (t.kind === "Identifier") { parserAdvance(c); return parserIdentifier(c, t); }
    if (t.kind === "LeftParen") {
        parserAdvance(c);
        const node = parserExpression(c);
        if (node === null) { return null; }
        const end = parserConsume(c, "RightParen", "Expected ')' after expression.");
        if (end === null) { return null; }
        node.start = t.start;
        node.end = end.end;
        return node;
    }
    if (t.kind === "LeftBracket" || t.kind === "LeftBrace") {
        parserAdvance(c);
        const items = [];
        let closer = "RightBracket";
        if (t.kind === "LeftBrace") { closer = "RightBrace"; }
        while (parserCurrent(c).kind !== closer && c.diagnostic === null) {
            if (t.kind === "LeftBracket") {
                const item = parserExpression(c);
                if (item === null) { return null; }
                rtPush(items, item);
            } else {
                const keyToken = parserAdvance(c);
                let key = "";
                if (keyToken.kind === "String") {
                    const decoded = parserString(c, keyToken);
                    if (decoded === null) { return null; }
                    key = decoded.value;
                } else if (parserNameToken(c, keyToken)) { key = parserText(c, keyToken); }
                else { return parserFail(c, "Expected a record key.", keyToken); }
                if (parserConsume(c, "Colon", "Expected ':' after record key.") === null) { return null; }
                const value = parserExpression(c);
                if (value === null) { return null; }
                rtPush(items, {type: "Property", key: key, value: value, start: keyToken.start, end: value.end});
            }
            if (parserCurrent(c).kind !== closer) {
                if (parserConsume(c, "Comma", "Expected ',' between elements.") === null) { return null; }
            }
        }
        const end = parserConsume(c, closer, "Expected closing delimiter.");
        if (end === null) { return null; }
        if (t.kind === "LeftBracket") { return {type: "ArrayExpression", elements: items, start: t.start, end: end.end}; }
        return {type: "RecordExpression", properties: items, start: t.start, end: end.end};
    }
    return parserFail(c, "Expected an expression.", t);
}
function parserPostfix(c) {
    let node = parserPrimary(c);
    let more = true;
    while (node !== null && more && c.diagnostic === null) {
        const t = parserCurrent(c);
        if (t.kind === "Dot" || t.kind === "LeftBracket") {
            parserAdvance(c);
            let key = null;
            let end = 0;
            if (t.kind === "Dot") {
                const name = parserAdvance(c);
                if (!parserNameToken(c, name)) { return parserFail(c, "Expected a field name.", name); }
                key = {type: "StringLiteral", value: parserText(c, name), start: name.start, end: name.end};
                end = name.end;
            } else {
                key = parserExpression(c);
                if (key === null) { return null; }
                const close = parserConsume(c, "RightBracket", "Expected ']' after index.");
                if (close === null) { return null; }
                end = close.end;
            }
            node = {type: "MemberExpression", object: node, property: key, start: node.start, end: end};
        } else if (t.kind === "LeftParen") {
            parserAdvance(c);
            const args = [];
            while (parserCurrent(c).kind !== "RightParen" && c.diagnostic === null) {
                const arg = parserExpression(c);
                if (arg === null) { return null; }
                rtPush(args, arg);
                if (parserCurrent(c).kind !== "RightParen") {
                    if (parserConsume(c, "Comma", "Expected ',' between arguments.") === null) { return null; }
                    if (parserCurrent(c).kind === "RightParen") { return parserFail(c, "Expected an expression.", parserCurrent(c)); }
                }
            }
            const end = parserConsume(c, "RightParen", "Expected ')' after arguments.");
            if (end === null) { return null; }
            node = {type: "CallExpression", callee: node, arguments: args, start: node.start, end: end.end};
        } else { more = false; }
    }
    return node;
}
function parserUnary(c) {
    const t = parserCurrent(c);
    if (t.kind === "Bang" || t.kind === "Plus" || t.kind === "Minus") {
        parserAdvance(c);
        if (!parserEnter(c)) { return null; }
        const arg = parserUnary(c);
        c.depth = c.depth - 1;
        if (arg === null) { return null; }
        return {type: "UnaryExpression", operator: parserText(c, t), argument: arg, start: t.start, end: arg.end};
    }
    return parserPostfix(c);
}
function parserPrecedence(kind) {
    if (kind === "Equal") { return 1; }
    if (kind === "Or") { return 2; }
    if (kind === "And") { return 3; }
    if (kind === "EqualEqualEqual" || kind === "BangEqualEqual") { return 4; }
    if (kind === "Less" || kind === "LessEqual" || kind === "Greater" || kind === "GreaterEqual") { return 5; }
    if (kind === "Plus" || kind === "Minus") { return 6; }
    if (kind === "Star" || kind === "Slash") { return 7; }
    return 0;
}
function parserLevel(c, min) {
    if (!parserEnter(c)) { return null; }
    let left = parserUnary(c);
    while (left !== null && c.diagnostic === null && parserPrecedence(parserCurrent(c).kind) >= min) {
        const op = parserAdvance(c);
        const precedence = parserPrecedence(op.kind);
        if (op.kind === "Equal" && left.type !== "Identifier" && left.type !== "MemberExpression") {
            return parserFail(c, "Invalid assignment target.", left);
        }
        let next = precedence + 1;
        if (op.kind === "Equal") { next = precedence; }
        const right = parserLevel(c, next);
        if (right === null) { return null; }
        if (op.kind === "Equal") {
            left = {type: "AssignmentExpression", target: left, value: right, start: left.start, end: right.end};
        } else {
            left = {type: "BinaryExpression", operator: parserText(c, op), left: left, right: right, start: left.start, end: right.end};
        }
    }
    c.depth = c.depth - 1;
    return left;
}
function parserExpression(c) { return parserLevel(c, 1); }
function parserBlock(c) {
    const start = parserConsume(c, "LeftBrace", "Expected '{' before block.");
    if (start === null) { return null; }
    const body = [];
    while (parserCurrent(c).kind !== "RightBrace" && parserCurrent(c).kind !== "Eof" && c.diagnostic === null) {
        const stmt = parserStatement(c);
        if (stmt !== null) { rtPush(body, stmt); }
    }
    const end = parserConsume(c, "RightBrace", "Expected '}' after block.");
    if (end === null) { return null; }
    return {type: "BlockStatement", body: body, start: start.start, end: end.end};
}
function parserStatementInner(c) {
    const t = parserCurrent(c);
    if (t.kind === "LeftBrace") { return parserBlock(c); }
    if (t.kind === "Let" || t.kind === "Const") {
        parserAdvance(c);
        const kind = parserText(c, t);
        const id = parserConsume(c, "Identifier", "Expected an identifier after '" + kind + "'.");
        if (id === null) { return null; }
        if (parserConsume(c, "Equal", "Expected '=' after variable name.") === null) { return null; }
        const init = parserExpression(c);
        if (init === null) { return null; }
        const end = parserConsume(c, "Semicolon", "Expected ';' after declaration.");
        if (end === null) { return null; }
        return {type: "VariableDeclaration", kind: kind, id: parserIdentifier(c, id), init: init, start: t.start, end: end.end};
    }
    if (t.kind === "If" || t.kind === "While") {
        parserAdvance(c);
        const text = parserText(c, t);
        if (parserConsume(c, "LeftParen", "Expected '(' after '" + text + "'.") === null) { return null; }
        const test = parserExpression(c);
        if (test === null) { return null; }
        if (parserConsume(c, "RightParen", "Expected ')' after " + text + " condition.") === null) { return null; }
        const body = parserBlock(c);
        if (body === null) { return null; }
        if (t.kind === "While") { return {type: "WhileStatement", test: test, body: body, start: t.start, end: body.end}; }
        let alternate = null;
        let end = body.end;
        if (parserCurrent(c).kind === "Else") {
            parserAdvance(c);
            if (parserCurrent(c).kind === "If") { alternate = parserStatement(c); }
            else { alternate = parserBlock(c); }
            if (alternate === null) { return null; }
            end = alternate.end;
        }
        return {type: "IfStatement", test: test, consequent: body, alternate: alternate, start: t.start, end: end};
    }
    if (t.kind === "Function") {
        parserAdvance(c);
        const id = parserConsume(c, "Identifier", "Expected a function name.");
        if (id === null) { return null; }
        if (parserConsume(c, "LeftParen", "Expected '(' after function name.") === null) { return null; }
        const params = [];
        while (parserCurrent(c).kind !== "RightParen" && c.diagnostic === null) {
            const param = parserConsume(c, "Identifier", "Expected a parameter name.");
            if (param === null) { return null; }
            rtPush(params, parserIdentifier(c, param));
            if (parserCurrent(c).kind !== "RightParen") {
                if (parserConsume(c, "Comma", "Expected ',' between parameters.") === null) { return null; }
                if (parserCurrent(c).kind === "RightParen") { return parserFail(c, "Expected a parameter name.", parserCurrent(c)); }
            }
        }
        if (parserConsume(c, "RightParen", "Expected ')' after parameters.") === null) { return null; }
        const body = parserBlock(c);
        if (body === null) { return null; }
        return {type: "FunctionDeclaration", id: parserIdentifier(c, id), params: params, body: body, start: t.start, end: body.end};
    }
    if (t.kind === "Return") {
        parserAdvance(c);
        let arg = null;
        if (parserCurrent(c).kind !== "Semicolon") { arg = parserExpression(c); if (arg === null) { return null; } }
        const end = parserConsume(c, "Semicolon", "Expected ';' after return.");
        if (end === null) { return null; }
        return {type: "ReturnStatement", argument: arg, start: t.start, end: end.end};
    }
    const expression = parserExpression(c);
    if (expression === null) { return null; }
    const end = parserConsume(c, "Semicolon", "Expected ';' after expression.");
    if (end === null) { return null; }
    return {type: "ExpressionStatement", expression: expression, start: expression.start, end: end.end};
}
function parserStatement(c) {
    if (!parserEnter(c)) { return null; }
    const node = parserStatementInner(c);
    c.depth = c.depth - 1;
    return node;
}
// Explicit AST child enumeration. No object reflection is needed in the guest.
export function syntaxChildren(node) {
    const t = node.type;
    if (t === "Program" || t === "BlockStatement") { return node.body; }
    if (t === "ArrayExpression") { return node.elements; }
    if (t === "RecordExpression") { return node.properties; }
    if (t === "Property") { return [node.value]; }
    if (t === "VariableDeclaration") { return [node.id, node.init]; }
    if (t === "ExpressionStatement") { return [node.expression]; }
    if (t === "UnaryExpression") { return [node.argument]; }
    if (t === "BinaryExpression") { return [node.left, node.right]; }
    if (t === "AssignmentExpression") { return [node.target, node.value]; }
    if (t === "MemberExpression") { return [node.object, node.property]; }
    if (t === "WhileStatement") { return [node.test, node.body]; }
    if (t === "IfStatement") { if (node.alternate === null) { return [node.test, node.consequent]; } return [node.test, node.consequent, node.alternate]; }
    if (t === "ReturnStatement") { if (node.argument === null) { return []; } return [node.argument]; }
    if (t === "FunctionDeclaration") {
        const children = [node.id, node.body];
        let i = 0;
        while (i < node.params.length) { rtPush(children, node.params[i]); i = i + 1; }
        return children;
    }
    if (t === "CallExpression") {
        const children = [node.callee];
        let i = 0;
        while (i < node.arguments.length) { rtPush(children, node.arguments[i]); i = i + 1; }
        return children;
    }
    return [];
}
export function parse(source, tokens) {
    if (rtType(source) !== "string") { rtTrap("Source must be a string."); }
    if (!rtIsArray(tokens)) { rtTrap("Tokens must be an array."); }
    const c = {source: source, tokens: tokens, position: 0, diagnostic: null, depth: 0};
    const body = [];
    while (parserCurrent(c).kind !== "Eof" && c.diagnostic === null) {
        const stmt = parserStatement(c);
        if (stmt !== null) { rtPush(body, stmt); }
    }
    let start = 0;
    let end = 0;
    if (body.length > 0) { start = body[0].start; end = body[body.length - 1].end; }
    const ast = {type: "Program", body: body, start: start, end: end};
    const pending = [];
    let i = 0;
    while (i < body.length) { rtPush(pending, {node: body[i], depth: 1}); i = i + 1; }
    while (pending.length > 0 && c.diagnostic === null) {
        const item = rtPop(pending);
        if (item.depth > MAX_SYNTAX_DEPTH) {
            parserFail(c, "Syntax tree depth exceeds limit " + MAX_SYNTAX_DEPTH + ".", item.node);
        } else {
            const children = syntaxChildren(item.node);
            i = 0;
            while (i < children.length) { rtPush(pending, {node: children[i], depth: item.depth + 1}); i = i + 1; }
        }
    }
    if (c.diagnostic !== null) { return {ok: false, diagnostics: [c.diagnostic]}; }
    return {ok: true, ast: ast};
}
