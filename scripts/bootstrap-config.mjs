// First complete bundle measured ~23M charged work and 57 guest frames; depth-limit diagnostics need more parser frames.
// Keep explicit headroom without weakening normal run defaults.
export const bootstrapConfig = Object.freeze({
    maxInstructions: 100_000_000,
    maxCallDepth: 1024,
    maxValueSize: 1_000_000,
    maxSourceLength: 1_000_000,
    deadlineMs: 60_000,
});
