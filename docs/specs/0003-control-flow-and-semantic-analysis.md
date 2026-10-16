---
status: implemented
---

# Spec: control flow and semantic analysis

## Objective

Extend JumpJet with mutable bindings, immutable bindings, booleans, comparisons, unary operators, block scope, and conditional control flow. Split semantic analysis from bytecode emission so scope rules do not leak into instruction generation.

The executable target for this slice is:

```js
let score = 3;
if (score < 5) {
    score = -score + 10;
} else {
    score = 0;
}
score === 7;
```

The program must return `true` from the JumpJet VM.

## Grammar

JumpJet still requires semicolons after declarations and expression statements. Braces are mandatory around each `if` or `else` body. An `else if` chain is valid because the `else` branch may contain another `if` statement.

```ebnf
Program               ::= Statement* EOF ;

Statement             ::= VariableDeclaration
                        | IfStatement
                        | BlockStatement
                        | ExpressionStatement ;

VariableDeclaration   ::= ("let" | "const") Identifier "=" Expression ";" ;
IfStatement           ::= "if" "(" Expression ")" BlockStatement
                          ("else" (BlockStatement | IfStatement))? ;
BlockStatement        ::= "{" Statement* "}" ;
ExpressionStatement   ::= Expression ";" ;

Expression            ::= Assignment ;
Assignment            ::= Equality ("=" Assignment)? ;
Equality              ::= Comparison (("===" | "!==") Comparison)* ;
Comparison            ::= Term (("<" | "<=" | ">" | ">=") Term)* ;
Term                  ::= Factor (("+" | "-") Factor)* ;
Factor                ::= Unary (("*" | "/") Unary)* ;
Unary                 ::= ("!" | "+" | "-") Unary | Primary ;
Primary               ::= Number | "true" | "false" | Identifier
                        | "(" Expression ")" ;
```

### Precedence and associativity

From lowest to highest precedence:

1. Assignment, right-associative
2. Strict equality and inequality, left-associative
3. Relational comparison, left-associative
4. Addition and subtraction, left-associative
5. Multiplication and division, left-associative
6. Unary operators, right-associative
7. Literals, identifiers, and parenthesized expressions

Only an identifier may appear on the left side of assignment. `first = second = 4;` means `first = (second = 4);` and evaluates to `4`.

### Values and operators

This slice has two runtime value types: number and boolean.

- `+`, `-`, `*`, and `/` use the corresponding JavaScript host operations.
- Unary `+` converts its operand to a number.
- Unary `-` negates its operand.
- `!` applies JavaScript truthiness and returns a boolean.
- `<`, `<=`, `>`, and `>=` return booleans.
- `===` and `!==` use strict equality and return booleans.
- An `if` condition uses JavaScript truthiness.

Strings, loose equality, logical operators, loops, functions, objects, arrays, and automatic semicolon insertion remain outside this slice.

## Static semantics

The analyzer applies these rules before bytecode emission:

1. Each block creates a lexical scope.
2. A declaration may shadow a binding in an outer scope.
3. Two declarations with the same name in one scope are invalid.
4. The analyzer collects each scope's direct declarations before analyzing its statements. A binding shadows outer names throughout that scope. Reading or assigning it before its initializer completes reports a temporal dead zone diagnostic.
5. An identifier must resolve to the nearest binding in the scope chain.
6. A `const` binding cannot be assigned after initialization.
7. The program must end with a top-level expression statement. That expression becomes the VM result.

The analyzer allocates one numeric slot per declaration. It does not reuse slots after a block ends. This keeps the first scoped implementation deterministic and leaves slot-lifetime optimization for a later pass.

## Architecture

```text
source
  -> lexer: tokens with source spans
  -> parser: syntax AST with names
  -> analyzer: bound AST with slots
  -> compiler: bytecode with patched jump targets
  -> verifier: complete instruction stream and jump boundaries
  -> VM: number or boolean result, within an instruction budget
```

### Phase contracts

```js
tokenize(source) -> { ok: true, tokens } | { ok: false, diagnostics }
parse(source, tokens) -> { ok: true, ast } | { ok: false, diagnostics }
analyze(ast) -> { ok: true, program } | { ok: false, diagnostics }
emit(boundProgram) -> { ok: true, program: bytecodeProgram }
execute(bytecodeProgram) -> number | boolean
```

`analyze` owns source-name rules. A bound identifier or assignment contains a slot number, so `emit` never performs name lookup or checks mutability.

### Bound nodes

The bound tree preserves statement and expression structure but replaces source identifiers with resolved slots.

```js
{ type: "BoundIdentifier", slot: 0, start: 8, end: 13 }
{ type: "BoundAssignmentExpression", slot: 0, value, start: 31, end: 40 }
{ type: "BoundVariableDeclaration", kind: "const", slot: 1, init, start, end }
```

The analyzer returns `slotCount` with the bound program. The emitter uses that value directly.

## Bytecode changes

The bytecode version remains `1` because no external compatibility promise exists yet. The constant pool now accepts numbers and booleans.

New instructions:

| Instruction | Operand | Stack effect | Purpose |
|---|---:|---|---|
| `Negate` | none | `value -> -value` | Unary minus |
| `Positive` | none | `value -> +value` | Unary plus |
| `Not` | none | `value -> !value` | Boolean negation |
| `Equal` | none | `left right -> boolean` | Strict equality |
| `NotEqual` | none | `left right -> boolean` | Strict inequality |
| `Less` | none | `left right -> boolean` | Less than |
| `LessEqual` | none | `left right -> boolean` | Less than or equal |
| `Greater` | none | `left right -> boolean` | Greater than |
| `GreaterEqual` | none | `left right -> boolean` | Greater than or equal |
| `Duplicate` | none | `value -> value value` | Preserve assignment result |
| `JumpIfFalse` | absolute address | `condition ->` | Enter the false branch |
| `Jump` | absolute address | unchanged | Skip or repeat code |

Jump operands are absolute code-array indices. A target may equal `code.length`, but it may not exceed it. The compiler emits a placeholder operand and patches it after the destination address is known.

## File ownership

- `src/lexer.js` owns keyword recognition and longest-match operator tokenization.
- `src/parser.js` owns the grammar, precedence, associativity, and syntax diagnostics.
- `src/analyzer.js` owns scopes, bindings, temporal dead zones, mutability, slot allocation, and the final-result rule.
- `src/compiler.js` owns bound-tree traversal, instruction selection, and jump patching.
- `src/bytecode.js` owns opcode numbers and bytecode version data.
- `src/bytecode.js` also owns instruction names, operand kinds, and stack effects.
- `src/verifier.js` owns bytecode structure validation and the private execution snapshot.
- `src/vm.js` owns instruction execution, stack checks, slot initialization, and the instruction budget.
- `src/index.js` owns phase sequencing and early return on diagnostics.

No later phase repeats an earlier phase's rules.

See [engine boundary fixes](0004-engine-boundaries.md) for the complete validation policy, source-depth limits, and execution options.

### Alternatives considered

Keeping name resolution inside `src/compiler.js` would add scope stacks, binding state, diagnostics, and instruction emission to one traversal. That design saves one intermediate tree but forces bytecode code to understand source names and `const` policy.

A general-purpose intermediate representation could support later optimizations. JumpJet does not have optimization requirements yet, so that layer would add node types without removing current complexity.

The chosen bound AST is deliberately narrow. It removes names and mutability checks from the emitter while preserving the syntax tree shape. A later lowering pass can replace it when functions or optimization create a concrete need.

## Diagnostics

Expected source errors return one diagnostic with the owning stage and source span. Examples:

- parser: `Invalid assignment target.`
- analyzer: `Unknown identifier 'missing'.`
- analyzer: `Identifier 'value' is already declared in this scope.`
- analyzer: `Cannot access 'value' before initialization.`
- analyzer: `Cannot assign to constant 'value'.`

Invalid bytecode remains a VM programming error and throws.

## Verification

Run focused phase tests while developing:

```sh
node --test tests/lexer.test.js
node --test tests/parser.test.js
node --test tests/analyzer.test.js
node --test tests/compiler.test.js
node --test tests/vm.test.js
node --test tests/integration.test.js
```

Then run the full checks:

```sh
npm test
npm run check
npm run demo
```

Correctness requires all of these results:

1. The target program compiles and returns `true` through the real VM.
2. Both `if` branches execute correctly.
3. Block shadowing leaves the outer binding unchanged.
4. Chained assignment returns the assigned value.
5. A `const` write fails in the analyzer with the assignment span.
6. A self-reference in an initializer reports a temporal dead zone error.
7. Malformed jump operands fail at the VM boundary.
8. Existing arithmetic programs and browser code still pass their tests.

## Risks and limits

- Slot allocation grows monotonically. Deep code with many short-lived blocks uses more slots than necessary.
- Jump operands are absolute code indices. Any instruction-width change must keep jump patching and VM validation in sync.
- Values remain dynamically typed. Arithmetic follows host JavaScript coercion for the two supported value types.
- The bound AST is an internal contract. Adding functions will require explicit ownership for function scopes, local slots, parameters, and returns.

## Verification record

On 2026-10-16, `npm test`, `npm run check`, `npm run demo`, and `npm run demo:control-flow` passed. The control-flow demo returned `true` through the emitted bytecode and JumpJet VM. The generated visual page passed the answer-me-with-html STE check with zero warnings.
