self.onmessage = async ({ data: modulePath }) => {
    try {
        const { run } = await import(modulePath);
        self.postMessage("entered");
        const result = run({ version: 1, constants: [], code: [20, 0], slotCount: 0 }, { maxInstructions: 20 });
        self.postMessage(`value: ${String(result)}`);
    } catch (error) {
        self.postMessage(`${error.name}: ${error.message}`);
    }
};
