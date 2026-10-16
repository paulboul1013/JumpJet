(async (page) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    for (const phase of ['before', 'after']) {
        await page.goto(`http://127.0.0.1:8765/output/playwright/bytecode-fixes/engine-evidence.html?phase=${phase}`);
        await page.locator('body[data-complete="true"]').waitFor();
        const actual = await page.evaluate(() => window.engineEvidence);
        if (actual.passed !== (phase === 'before' ? 1 : 9)) throw new Error(JSON.stringify(actual));
        await page.screenshot({ path: `output/playwright/bytecode-fixes/engine-${phase}.png`, fullPage: true });
    }
})
