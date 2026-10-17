// Independent language oracles, also executed through every compiler generation.
export const valid = [
    { name: "arithmetic", source: "let answer = 1 + 2 * 3; answer;", value: 7 },
    { name: "data-loop", source: "let box = { values: [1, 2, 3] }; let i = 0; let total = 0; while (i < box.values.length) { total = total + box.values[i]; i = i + 1; } total;", value: 6 },
    { name: "recursion", source: "function sumTo(n) { if (n === 0) { return 0; } let saved = n; let rest = sumTo(n - 1); return saved + rest; } sumTo(5);", value: 15 },
    { name: "mutual-forward", source: "function even(n) { if (n === 0) { return true; } return odd(n - 1); } function odd(n) { if (n === 0) { return false; } return even(n - 1); } even(10);", value: true },
    { name: "strings", source: '"😀\\n" + "\\u0041";', value: "😀\nA" },
    { name: "whitespace-comments", source: "\uFEFF/* c */let\u00a0x = 3;// c\n x >= 3;", value: true },
    { name: "short-circuit", source: "let x = 0; false && (x = 1); true || (x = 2); x;", value: 0 },
    { name: "prototype-fields", source: 'let r = {"__proto__": 7, constructor: 8, toString: 9}; r.__proto__ = 10; r.__proto__ + r.constructor + r.toString;', value: 27 },
    { name: "shadow", source: "let x = 1; { let x = 2; x = 3; } x;", value: 1 },
    { name: "global-frame", source: "let x = 3; function f(n) { let x = n; return x; } f(8) + x;", value: 11 },
    { name: "undefined-return", source: "function f() {} f();", value: undefined },
    { name: "null", source: "null;", value: null },
    { name: "negative-zero", source: "-0;", value: -0 },
    { name: "nan", source: "0 / 0;", value: NaN },
    { name: "infinity", source: "1 / 0;", value: Infinity },
    { name: "context", source: "function sum(c) { let i = 0; while (i < c.values.length) { c.total = c.total + c.values[i]; i = i + 1; } return c.total; } sum({values: [2, 4], total: 0});", value: 6 },
];
valid.push(
    {name: "mutual-locals", source: "function a(n) { if (n === 0) { return 0; } let saved = n; let rest = b(n - 1); return saved + rest; } function b(n) { if (n === 0) { return 0; } let saved = n; let rest = a(n - 1); return saved + rest; } a(5);", value: 15},
    {name: "nested-data", source: "let a = [1]; a[1] = {x: 2}; a;", value: [1, {x: 2}]},
    {name: "missing-own-field", source: "({}).constructor;", value: undefined},
    {name: "negative-infinity", source: "-1 / 0;", value: -Infinity},
);
export const invalid = [
    {name: "nesting-depth", source: "[".repeat(140) + "0" + "]".repeat(140) + ";", diagnostic: {stage: "parser", message: "Source nesting exceeds limit 128.", start: 127, end: 128}},
    {name: "member-ast-depth", source: "a" + ".b".repeat(140) + ";", diagnostic: {stage: "parser", message: "Syntax tree depth exceeds limit 128.", start: 28, end: 29}},
    {name: "eof", source: "1", diagnostic: {stage: "parser", message: "Expected ';' after expression.", start: 1, end: 1}},
    {name: "prototype-unknown", source: "constructor;", diagnostic: {stage: "analyzer", message: "Unknown identifier 'constructor'.", start: 0, end: 11}},
    {name: "prototype-tdz", source: "let toString = toString; toString;", diagnostic: {stage: "analyzer", message: "Cannot access 'toString' before initialization.", start: 15, end: 23}},
    {name: "prototype-const", source: "const __proto__ = 1; __proto__ = 2; __proto__;", diagnostic: {stage: "analyzer", message: "Cannot assign to constant '__proto__'.", start: 21, end: 30}},

    { name: "lexical", source: "1 @ 2;", diagnostic: {stage: "lexer", message: "Unexpected character '@'.", start: 2, end: 3} },
    { name: "utf16", source: '"😀"; @;', diagnostic: {stage: "lexer", message: "Unexpected character '@'.", start: 6, end: 7} },
    { name: "syntax", source: "let = 1;", diagnostic: {stage: "parser", message: "Expected an identifier after 'let'.", start: 4, end: 5} },
    { name: "unknown", source: "missing;", diagnostic: {stage: "analyzer", message: "Unknown identifier 'missing'.", start: 0, end: 7} },
    { name: "tdz", source: "let x = x; x;", diagnostic: {stage: "analyzer", message: "Cannot access 'x' before initialization.", start: 8, end: 9} },
    { name: "const", source: "const x = 1; x = 2; x;", diagnostic: {stage: "analyzer", message: "Cannot assign to constant 'x'.", start: 13, end: 14} },
    { name: "top-return", source: "return 1; 0;", diagnostic: {stage: "analyzer", message: "Return is only allowed in a function.", start: 0, end: 9} },
];
