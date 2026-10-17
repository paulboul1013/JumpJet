# Bootstrap executable contract

This document fixes the M0 decisions for spec 0005. The manifest is
`scripts/bootstrap-manifest.json`. Only its ordered compiler modules form S.
`src/runtime.js`, VM, verifier and Node tooling stay outside S. Imports are named,
relative imports from manifest modules or the explicit runtime allowlist. The
bundler removes these imports and the `export` keyword without transforming bodies.
Names must be unique across modules. The bundle ends with `0;`.

Two designs were considered: preserving closures with an environment heap, or
lifting functions and passing explicit contexts. We use contexts as specified in
ADR 0002. Each phase owns its context. No phase calls back into a host compiler.

## Grammar

```ebnf
program = { statement } ;
statement = ("let" | "const"), identifier, "=", expression, ";"
          | expression, ";" | block
          | "if", "(", expression, ")", block, ["else", (block | ifStatement)]
          | "while", "(", expression, ")", block
          | "return", [expression], ";"
          | "function", identifier, "(", [identifier, {",", identifier}], ")", block ;
block = "{", {statement}, "}" ;
expression = assignment ;
assignment = logicalOr, ["=", assignment] ;
logicalOr = logicalAnd, {"||", logicalAnd} ;
logicalAnd = equality, {"&&", equality} ;
equality = comparison, {("===" | "!=="), comparison} ;
comparison = additive, {("<" | "<=" | ">" | ">="), additive} ;
additive = multiplicative, {("+" | "-"), multiplicative} ;
multiplicative = unary, {("*" | "/"), unary} ;
unary = ("!" | "+" | "-"), unary | postfix ;
postfix = primary, {".", identifierName | "[", expression, "]"
                   | "(", [expression, {",", expression}], ")"} ;
primary = number | string | "true" | "false" | "null" | "undefined"
        | identifier | "(", expression, ")"
        | "[", [expression, {",", expression}, [","]], "]"
        | "{", [key, ":", expression, {",", key, ":", expression}, [","]], "}" ;
key = identifierName | string ;
```

Numbers are digits with an optional decimal point followed by digits, without
exponents. Names use ASCII letters, `_`, `$`, followed by those or digits.
Strings use single or double quotes and escapes `\\`, `\'`, `\"`, `\n`, `\r`,
`\t`, `\b`, `\f`, `\v`, `\0`, `\uXXXX`. Raw line terminators and unknown
escapes are errors. Offsets count UTF-16 units. Line and block comments are
supported. Whitespace is exactly ECMAScript WhiteSpace and LineTerminator,
including NBSP and BOM. Operators use longest match. Logical operators return
operands and short circuit. Arithmetic uses JS scalar coercion; object-to-scalar
coercion traps. Record and array identity equality is supported.

Only top-level functions can be declared or called. Calls require exact arity;
functions cannot be values. Functions can see top-level lexical bindings, with
runtime initialization checks when called early. Function locals and parameters
shadow globals. Parameters share a scope with the function body. Lexical names
are predeclared per block for TDZ. User functions, top-level variables and runtime
symbols cannot collide. Runtime symbols are reserved in all scopes. Duplicate
parameters, record keys and declarations are errors. Member assignment is allowed
through const bindings. Program must end in an expression; function fallthrough
returns undefined. Return at top level and nested function declarations are errors.

## Values and runtime symbols

Guest values are scalars, dense arrays and own-field records. A record's fixed
fields are created at its literal. Missing fields read as undefined; writes to
missing fields trap. `__proto__`, `constructor`, `toString` are ordinary fields.
Array indexes are nonnegative safe integers. Reads past length return undefined;
writes can replace an element or append at length, without holes. Length is read
only. Strings support UTF-16 index reads and length. Other properties never expose
host prototypes. Freeze is shallow and enforced for guest writes.

The ordered `IntrinsicDefinitions` array in `src/runtime-symbols.js` is the ABI.
Each entry fixes ID, name and arity. Runtime operations are:

| Symbol | Arguments | Result / failure |
|---|---|---|
| rtPush | array, value | new length; frozen or oversized array traps |
| rtPop | array | last value or undefined; frozen array traps |
| rtSlice | string, start, end | UTF-16 slice; invalid types trap |
| rtNumber | string | JS numeric conversion, including NaN |
| rtCharCode | string, index | UTF-16 code unit or NaN |
| rtFromCharCode | number | one UTF-16 unit |
| rtWhitespace | one-unit string | fixed ECMAScript whitespace membership |
| rtIsArray | value | boolean |
| rtType | value | JS typeof string; no callable guest values |
| rtIsSafeInteger | value | validates the public emitter slot-count boundary |
| rtFreeze | array or record | same shallow frozen value |
| rtTrap | string | unrecoverable TypeError |

Lexer uses string/number/whitespace operations and token freeze. Parser uses
string decoding and array operations. Analyzer uses array scope tables. Emitter
uses append and numeric opcode records. No intrinsic makes a lexical, grammar,
binding or instruction-selection decision. `runtime-symbols.js` is included in S;
runtime implementations are excluded.

## Bytecode version 2 and frames

```text
Program = { version: 2, constants: Scalar[], code: Integer[], slotCount: Integer,
            functions: Function[] }
Function = { name: string, arity: Integer, slotCount: Integer, code: Integer[] }
```

`src/bytecode.js` fixes every opcode, operand kind and stack effect. Original
opcodes retain their numbers for readability; version 1 is rejected. Constants
are ordered by first emission, including repeats. Main slots are globals; function
slots hold parameters first, then locals. All functions share the program constants.
Call has one function-index operand; arity comes from the verified function table.
Builtin has one intrinsic-ID operand. MakeArray/MakeRecord take element/field
counts; record construction consumes key/value pairs. GetProperty consumes object
and key. SetProperty consumes object, key, value and returns value. Global load/store
use main slot bounds. Every body is verified, including unreachable instructions.

Each VM frame owns code position, local values, initialized flags and stack base.
Call consumes arguments, creates new slots, and leaves one result on return.
Return discards the callee stack segment. No call can consume its caller's operands.
`invoke` verifies and snapshots bytecode and input data, runs main initialization,
then calls one table entry. Each invocation is independent. Results are copied to
plain host data with own properties; no functions, accessors or prototypes cross
this boundary. Internal aliases and cycles are preserved by the copy operation.

## Encoding and limits

`scripts/artifact.mjs` encodes every value with a tag, including finite numbers,
NaN, infinities, negative zero and undefined. Record entries retain their source
order; arrays retain their order. Comparison reports the first differing path
using Object.is for scalars. Digests are indexes, never the equality oracle.

Source nesting and AST depth are separately limited to 128. New array, record,
call, member and function nodes participate. Default run budget remains 1,000,000.
VM call depth, data length and total charged work are finite; intrinsic string work
and construction/copy costs are charged as well as opcodes. Defaults and measured
bootstrap limits live in `scripts/bootstrap-config.mjs`. The verification process
runs in a worker with a wall-clock deadline, enforced by its parent.

`scripts/verify-self-hosting.mjs` records phase, case, generation, resource totals,
first mismatch and reproduction input on failure. It preserves S, manifest, source
digests, all three complete programs and a report. `tests/fixtures/self-hosting/`
contains independent expected values and exact diagnostics. All compiler generations
must also compile the corpus, survive failure followed by success and match each
phase on S and corpus inputs. The command exits nonzero on any difference or trap.
