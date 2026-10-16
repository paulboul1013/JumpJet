(async (page) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:8765/main.html');
    const editor = page.getByRole('textbox', { name: 'JavaScript 原始碼', exact: true });
    const runButton = page.getByRole('button', { name: '編譯並執行', exact: true });
    await editor.fill('('.repeat(20000) + '1' + ')'.repeat(20000) + ';');
    await runButton.click();
    const deepResult = await page.locator('#result-output').innerText();
    const deepDiagnostic = await page.locator('#diagnostics-output').innerText();
    if (deepResult !== '編譯失敗' || !deepDiagnostic.includes('[parser]') || !deepDiagnostic.includes('limit')) throw new Error(deepDiagnostic);
    await editor.fill('6 * 7;');
    await runButton.click();
    const recoveryResult = await page.locator('#result-output').innerText();
    if (recoveryResult !== '42') throw new Error(recoveryResult);

    // This separate check injects a compiler exception only to exercise the UI
    // catch boundary. It is not used for any before/after screenshot.
    await page.route('**/src/index.js', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: 'export function compile() { throw new RangeError("UI boundary probe"); } export function run() {}',
    }));
    await page.reload();
    const exceptionDiagnostic = await page.locator('#diagnostics-output').innerText();
    const exceptionBytecode = await page.locator('#bytecode-output').innerText();
    if (!exceptionDiagnostic.includes('[compiler] UI boundary probe') || exceptionBytecode !== '未產生 bytecode。') throw new Error(exceptionDiagnostic);
    await page.unroute('**/src/index.js');
    if (errors.length > 0) throw new Error(JSON.stringify(errors));
    await page.reload();
    await page.evaluate((result) => { window.uiVerification = result; }, {
        deepSource: { result: deepResult, diagnostic: deepDiagnostic },
        recoveryResult,
        simulatedCompilerException: { diagnostic: exceptionDiagnostic, bytecode: exceptionBytecode },
        uncaughtPageErrors: errors,
    });
})
