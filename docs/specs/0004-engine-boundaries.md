---
status: implemented
---

# Engine boundary fixes

JumpJet rejects malformed bytecode before executing any instruction. It reports excessive source depth through parser diagnostics. Lexical binding uses declarations from the entire current scope.

## Correct lexical binding

The analyzer first collects the direct `let` and `const` declarations in each program or block. It assigns slots and marks the bindings uninitialized. It then analyzes statements in source order. A binding becomes initialized after its initializer is analyzed.

A later declaration therefore shadows an outer binding even before that declaration executes. JumpJet statically rejects a read or assignment in this temporal dead zone. This remains a static language-slice rule, rather than JavaScript's complete runtime TDZ model.

The lexer looks up only the keyword table's own properties. `constructor`, `toString`, and `__proto__` remain ordinary identifiers.

## Bytecode contract

`src/bytecode.js` defines each instruction's opcode, name, operand kind, and stack effect. Existing version-1 opcode numbers remain unchanged.

`src/verifier.js` validates the complete program, including unreachable instructions. It checks:

- The version, array fields, and non-negative integer slot count.
- Every constant's own array cell and number or boolean value.
- Every opcode, instruction width, and non-negative integer operand.
- Constant indexes, slot indexes, and jump ranges.
- Every jump target against the decoded instruction boundaries.

A jump target can equal `code.length`, as in the previous contract. Taking that jump without a `Return` still throws `Bytecode program ended without Return.`

The verifier copies constants and code into private arrays before execution. The VM reads those arrays. Array getters cannot change an instruction between verification and execution. Sparse cells and inherited numeric array properties cannot supply instructions, operands, or constants.

The verifier checks bytecode structure. The VM still checks stack underflow and slot initialization along the executed path. This change does not add control-flow stack-height analysis.

## Execution budget

Both entry points accept the same optional execution options:

```js
run(program, { maxInstructions: 1000 });
execute(program, { maxInstructions: 1000 });
```

The default budget is 1,000,000 instructions. `maxInstructions` must be a non-negative safe integer. Zero permits no instruction to execute. The VM counts every executed opcode, including `Return`. Operands do not count as instructions. The VM throws `RangeError` before executing an instruction that would exceed the budget.

The budget limits VM instructions. It does not impose a wall-clock deadline on lexing, verification, or host code. The browser still executes the engine synchronously. A Worker-based cancel button remains separate future work.

## Source depth and UI errors

The parser limits recursive syntactic nesting to 128. It also checks the resulting syntax tree iteratively, with a maximum node depth of 128. The second limit covers long left-associative expressions that do not recurse deeply during parsing but would recurse in the analyzer or emitter.

Both failures return parser diagnostics with source spans. They do not depend on catching a host stack overflow. The Studio error boundary covers compilation and execution, so unexpected compile exceptions also produce a visible error state and clear stale bytecode.

## Alternatives

Checking jumps only when taken misses malformed untaken branches and cannot establish instruction boundaries. Complete linear decoding therefore runs before execution.

Keeping structural checks inside the VM loop would duplicate the verifier's contract. The VM trusts the verified private snapshot and retains only runtime checks.

Converting all parser and analyzer traversals to iterative state machines would remove recursion limits. Explicit limits keep this language slice smaller while providing deterministic diagnostics.

## Verification

`tests/engine-boundaries.test.js` covers the reported failures and boundary controls. The first 29 tests produced 23 failures before the fixes and passed after the fixes. Seventeen additional tests cover depth variants, exact budgets, default budgets, and array snapshot behavior.

The evidence package includes frozen original source, test logs, real Studio screenshots, and a browser fixture that calls each version of the engine directly. The fixture runs the infinite-jump case in a Worker so the original engine cannot block the evidence page.

See [the before-and-after evidence](../../output/pstack-bytecode-fixes/report.html).
