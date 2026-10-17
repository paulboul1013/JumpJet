import {fileURLToPath} from "node:url";

// Receives a real Playwright page; no browser dependency is added to the engine.
export async function smokeStudio(page, url = "http://127.0.0.1:8000/main.html") {
    function check(condition, message) { if (!condition) { throw new Error(message); } }
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") { errors.push(message.text()); } });
    await page.goto(url);
    const cases = [
        {name: "old-control-flow", source: "let x = 3; if (x < 5) { x = -x + 10; } x === 7;", value: "true"},
        {name: "diagnostic", source: "missing;", diagnostic: "Unknown identifier 'missing'."},
        {name: "data-loop", source: "let box = {values: [1, 2, 3]}; let i = 0; let total = 0; while (i < box.values.length) { total = total + box.values[i]; i = i + 1; } total;", value: "6"},
        {name: "recursion", source: "function sumTo(n) {\n    if (n === 0) { return 0; }\n    let saved = n;\n    let rest = sumTo(n - 1);\n    return saved + rest;\n}\nsumTo(5);", value: "15"},
    ];
    const results = [];
    for (const c of cases) {
        await page.getByRole("textbox", {name: "JavaScript 原始碼"}).fill(c.source);
        await page.getByRole("button", {name: "編譯並執行"}).click();
        const result = await page.locator("#result-output").textContent();
        const diagnostics = await page.locator("#diagnostics-output").textContent();
        if (c.diagnostic) { check(diagnostics.includes(c.diagnostic), c.name + ": wrong diagnostic"); }
        else { check(result === c.value, c.name + ": expected " + c.value + ", got " + result); check(diagnostics === "沒有 diagnostics。", c.name + ": unexpected diagnostic"); }
        results.push({name: c.name, result, diagnostics});
    }
    check(errors.length === 0, "Browser errors: " + errors.join("; "));
    await page.screenshot({path: "output/playwright/self-hosting-implemented.png", fullPage: true});
    const report = {ok: true, cases: results, errors};
    return report;
}

// The CLI evaluates this self-contained test function in its browser harness.
if (process.argv[1] === fileURLToPath(import.meta.url)) { console.log(smokeStudio.toString()); }
