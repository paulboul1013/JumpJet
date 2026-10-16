---
status: implemented
---

# Spec: bootstrap JavaScript-to-bytecode compiler

## Objective

Build the first executable slice of JumpJet as a self-hosting JavaScript compiler. The slice will compile a small JavaScript subset to JumpJet bytecode and execute that bytecode on the JumpJet VM.

The first slice proves the architecture with this program:

```js
let answer = 1 + 2 * 3;
answer;
```

The compiler must return `7`. Full ECMAScript support and self-hosting remain later milestones.

## Assumptions for review

1. Node.js is the bootstrap host. The compiler core uses ECMAScript modules and no third-party runtime dependencies.
2. The first language slice supports decimal numeric literals, `let` declarations, identifiers, parentheses, semicolons, and `+`, `-`, `*`, `/` operators.
3. A program evaluates to the value of its final expression statement.
4. The existing browser demo remains available during the first slice. New compiler modules do not depend on the DOM or jQuery.
5. Clarity, correctness, and tests matter more than performance in this phase.

## Architecture decision

### Caller usage

```js
import { compile, run } from "./src/index.js";

const result = compile("let answer = 1 + 2 * 3; answer;");

if (!result.ok) {
    console.error(result.diagnostics);
    process.exitCode = 1;
} else {
    console.log(run(result.program)); // 7
}
```

The caller provides source text. `compile` hides lexing, parsing, name resolution, and bytecode emission. `run` accepts only a valid bytecode program.

### Core data

```js
// Tokens retain source positions for diagnostics.
{ kind: TokenKind.Number, start: 13, end: 14 }

// Compilation has two valid outcomes.
{ ok: true, program: BytecodeProgram }
{ ok: false, diagnostics: Diagnostic[] }

// Bytecode is data, not VM state.
{
    version: 1,
    constants: [1, 2, 3],
    code: [Opcode.Constant, 0, Opcode.Constant, 1],
    slotCount: 1
}
```

AST nodes use a required `type` field and fixed fields per node type. The first slice has `Program`, `VariableDeclaration`, `ExpressionStatement`, `Identifier`, `NumericLiteral`, and `BinaryExpression` nodes.

### Interfaces

```js
tokenize(source) -> { ok, tokens?, diagnostics? }
parse(source, tokens) -> { ok, ast?, diagnostics? }
emit(ast) -> { ok, program?, diagnostics? }
compile(source) -> { ok, program?, diagnostics? }
run(program) -> JavaScriptValue
```

Lexer and parser errors are expected compiler output. They return diagnostics rather than throwing. Programming errors and invalid bytecode may throw.

### Ownership

- `lexer.js` owns character classification, token boundaries, and lexical diagnostics.
- `parser.js` owns grammar, precedence, AST construction, and syntax diagnostics.
- `compiler.js` owns name resolution, slot allocation, and bytecode emission.
- `bytecode.js` owns opcode definitions and the bytecode program format.
- `vm.js` owns instruction decoding, operand stack state, variable slots, and runtime errors.
- `index.js` owns the public `compile` and `run` API. It does not contain compiler rules.

Each rule has one owner. The browser adapter may call the public API, but compiler modules never call browser code.

### Module map

```text
src/index.js
  -> src/lexer.js
  -> src/parser.js
  -> src/compiler.js
       -> src/bytecode.js

src/index.js
  -> src/vm.js
       -> src/bytecode.js

web or main.html
  -> src/index.js
```

Dependencies point toward data definitions. The lexer does not know about the parser. The parser does not know about bytecode or the VM. The VM does not know about source text or AST nodes.

### Main flow

```text
source text
-> token sequence with source spans
-> AST with operator precedence
-> name resolution and bytecode emission
-> immutable bytecode program
-> VM operand stack and variable slots
-> final JavaScript value
```

For `let answer = 1 + 2 * 3; answer;`, multiplication binds before addition. The compiler allocates one slot for `answer`. The VM stores `7` in that slot, loads it for the final expression, and returns it.

## Alternatives considered

### Class-based compiler context

This design would use `Lexer`, `Parser`, `Compiler`, and `VM` classes with mutable state. It matches the style of the existing `Reader`, but callers and tests would need to understand object lifecycles. It also makes compiler phase inputs less visible. We will keep state local inside functions and expose plain data between phases.

### Direct parser-to-bytecode compilation

This design would emit bytecode while parsing and skip the AST. It uses less code, but syntax rules, name resolution, and bytecode rules become coupled. That coupling works against the learning goal and makes later semantic passes harder. JumpJet will keep an AST boundary.

### Chosen design

Use a staged pipeline with small modules, plain data between phases, and one public facade. This design is slightly more verbose than direct emission. It gives every phase an inspectable result and lets tests locate failures quickly.

## Tech stack

- JavaScript ECMAScript modules
- Node.js 20 or newer as the bootstrap host
- `node:test` and `node:assert/strict`
- No production or test dependencies in the first slice

## Commands

```sh
npm test
npm run check
npm run demo
```

- `npm test` runs all unit and integration tests with `node --test`.
- `npm run check` checks JavaScript syntax for source, tests, and examples.
- `npm run demo` compiles and runs the first example program.

## Project structure

```text
src/
  index.js       public compile and run API
  lexer.js       source text to tokens
  parser.js      tokens to AST
  bytecode.js    opcode and program definitions
  compiler.js    AST to bytecode
  vm.js          bytecode execution
tests/
  lexer.test.js
  parser.test.js
  compiler.test.js
  integration.test.js
examples/
  arithmetic.js
docs/
  adr/
  specs/
main.html        legacy browser demo during migration
reader.js        legacy reader during migration
```

## Code style

Use explicit names, immutable phase outputs, and JSDoc where a data contract is not obvious.

```js
export function compile(source) {
    const tokens = tokenize(source);
    const parsed = parse(source, tokens);

    if (!parsed.ok) {
        return parsed;
    }

    return emit(parsed.ast);
}
```

Use four spaces, semicolons, strict equality, named exports, and lower camel case for functions and values. Use PascalCase for enum-like frozen objects such as `TokenKind` and `Opcode`.

## Testing strategy

Tests follow red, green, refactor. Each phase gets small state-based tests. Integration tests exercise the public API and real VM without mocks.

- Lexer tests cover token kinds, positions, whitespace, and unexpected characters.
- Parser tests cover precedence, parentheses, declarations, and diagnostics.
- Compiler tests cover constants, slots, unknown identifiers, and bytecode structure.
- Integration tests compile and run real source programs.
- A test must fail for the intended reason before production code is added.

No coverage percentage is required in the first slice. Every supported syntax form and every diagnostic path must have a test.

## Boundaries

Always:

- Keep compiler core free of DOM and jQuery dependencies.
- Preserve source positions through lexer and parser diagnostics.
- Run `npm test` and `npm run check` after each task.
- Add behavior through the public API or a phase contract with tests.

Ask first:

- Add a third-party dependency.
- Change the bytecode format after another component consumes it.
- Remove the legacy browser demo.
- Expand the first slice beyond the syntax listed in this spec.

Never:

- Use `eval` or `Function` to execute compiled programs.
- Treat host JavaScript execution as proof that JumpJet bytecode works.
- Suppress a compiler diagnostic to make a test pass.
- Mix DOM operations into compiler phases.

## Implementation plan and tasks

- [x] Establish the test and module scaffold.
  - Acceptance: `npm test` runs a deliberately failing public API test.
  - Verify: observe the expected red test before implementing `compile`.
  - Files: `package.json`, `tests/integration.test.js`.

- [x] Implement token data and the lexer.
  - Acceptance: supported tokens have correct kinds and source spans; invalid characters produce diagnostics.
  - Verify: `node --test tests/lexer.test.js`.
  - Files: `src/lexer.js`, `tests/lexer.test.js`.

- [x] Implement the parser and AST.
  - Acceptance: precedence, parentheses, `let`, identifiers, and expression statements parse correctly.
  - Verify: `node --test tests/parser.test.js`.
  - Files: `src/parser.js`, `tests/parser.test.js`.

- [x] Define bytecode and compile the AST.
  - Acceptance: constants, arithmetic, declaration slots, identifier loads, and return emission are deterministic.
  - Verify: `node --test tests/compiler.test.js`.
  - Files: `src/bytecode.js`, `src/compiler.js`, `tests/compiler.test.js`.

- [x] Implement the VM and public API.
  - Acceptance: the first example returns `7`; compile failures never enter the VM.
  - Verify: `npm test` and `npm run demo`.
  - Files: `src/vm.js`, `src/index.js`, `tests/integration.test.js`, `examples/arithmetic.js`.

- [x] Update project documentation.
  - Acceptance: README commands and supported syntax match the implementation.
  - Verify: run every documented command.
  - Files: `README.md`, this spec.

## Success criteria

The first slice is complete when all of these statements are true:

1. `compile("let answer = 1 + 2 * 3; answer;")` returns a bytecode program without diagnostics.
2. `run(program)` returns `7` without using `eval` or `Function`.
3. Operator precedence and parentheses produce distinct, correct results.
4. Unknown identifiers, invalid characters, and malformed syntax return source-positioned diagnostics.
5. Phase unit tests and the public integration test pass with Node's built-in test runner.
6. Compiler modules contain no DOM or jQuery references.
7. The existing browser demo still exists until a later migration task replaces it.

## Risks

- JavaScript semantics are much larger than the first slice. New syntax must extend the same phase contracts rather than bypass them.
- The bytecode format will evolve. Versioning starts at `1`, but compatibility is not promised until a later milestone.
- Self-hosting requires functions, objects, arrays, strings, control flow, and closures. The arithmetic slice validates architecture, not language completeness.

## Open question

Approve or revise the five assumptions above before implementation begins.
