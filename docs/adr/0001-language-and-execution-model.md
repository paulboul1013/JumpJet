---
status: accepted
---

# Build a self-hosting JavaScript compiler with a bytecode VM

JumpJet's source language and implementation language are both JavaScript. Its first execution target is bytecode interpreted by the JumpJet virtual machine, because this keeps the compiler stages and runtime behavior explicit for learning and development.

Self-hosting is an explicit milestone: JumpJet must eventually compile its own compiler source to bytecode, then run that compiler on the JumpJet VM. The implementation may support JavaScript incrementally; the self-hosting milestone requires every JavaScript feature used by the compiler, while broader ECMAScript compatibility remains a separate goal.

The initial priority is a clear, correct, and testable architecture with complete end-to-end compiler functionality. Compilation speed and generated-program speed are not initial feature goals; performance work will follow only after the pipeline is functional and measurable. This decision does not prevent adding other backends later.
