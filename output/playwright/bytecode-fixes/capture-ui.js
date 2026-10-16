(async (page) => {
    const before = page.url().includes('/before/');
    const phase = before ? 'before' : 'after';
    await page.setViewportSize({ width: 1440, height: 1000 });
    const cases = [
        {
            name: 'tdz',
            source: 'let value = 1;\n{\n    value = 2;\n    let value = 3;\n}\nvalue;',
            expected: before ? '2' : '編譯失敗',
        },
        {
            name: 'identifiers',
            source: 'let constructor = 1;\nlet toString = 2;\nconstructor + toString;',
            expected: before ? '編譯失敗' : '3',
        },
    ];
    for (const testCase of cases) {
        await page.locator('#file-name').fill(`${testCase.name}.js`);
        await page.getByRole('textbox', { name: 'JavaScript 原始碼', exact: true }).fill(testCase.source);
        await page.getByRole('button', { name: '編譯並執行', exact: true }).click();
        const actual = await page.locator('#result-output').innerText();
        if (actual !== testCase.expected) throw new Error(`${phase}/${testCase.name}: ${actual}`);
        if (!before && testCase.name === 'tdz') {
            const diagnostic = await page.locator('#diagnostics-output').innerText();
            if (!diagnostic.includes('before initialization')) throw new Error(diagnostic);
        }
        await page.screenshot({ path: `output/playwright/bytecode-fixes/${testCase.name}-${phase}.png`, fullPage: true });
        console.log(JSON.stringify({ phase, case: testCase.name, source: testCase.source, result: actual, diagnostics: await page.locator('#diagnostics-output').innerText() }));
    }
})
