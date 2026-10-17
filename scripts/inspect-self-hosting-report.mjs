import {fileURLToPath} from "node:url";

// Run through Playwright CLI. Export styles from the renderer's actual SVGs;
// this function does not draw shapes or choose diagram coordinates.
export async function inspectSelfHostingReport(page) {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") { errors.push(message.text()); } });
    function check(value, message) { if (!value) { throw new Error(message); } }
    await page.setViewportSize({width: 1440, height: 1080});
    await page.goto(page.url().split("#")[0]);
    const initial = await page.evaluate(() => {
        const panels = [...document.querySelectorAll(".am-panel")];
        const diagrams = [...document.querySelectorAll(".am-diagram svg")];
        const geometry = diagrams.map(svg => {
            const box = svg.getBBox(); const view = svg.viewBox.baseVal;
            return {width: view.width, height: view.height, bounds: {x: box.x, y: box.y, width: box.width, height: box.height},
                clipped: box.x < view.x - 2 || box.y < view.y - 2 || box.x + box.width > view.x + view.width + 2 || box.y + box.height > view.y + view.height + 2};
        });
        const tables = [...document.querySelectorAll(".am-panel table")].map(table => ({
            columns: table.tHead.rows[0].cells.length,
            rows: [...table.tBodies[0].rows].map(row => row.cells.length),
        }));
        const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "letter-spacing", "text-anchor", "dominant-baseline"];
        const images = diagrams.map((svg, index) => {
            const clone = svg.cloneNode(true);
            const originals = [svg, ...svg.querySelectorAll("*")];
            const copies = [clone, ...clone.querySelectorAll("*")];
            originals.forEach((original, i) => {
                const computed = getComputedStyle(original);
                for (const name of properties) { copies[i].style.setProperty(name, computed.getPropertyValue(name)); }
            });
            clone.style.backgroundColor = getComputedStyle(svg.closest(".am-panel")).backgroundColor;
            return {index, svg: new XMLSerializer().serializeToString(clone)};
        });
        return {panels: panels.length, svgCount: diagrams.length, headings: panels.map(p => p.querySelector("h2").textContent),
            geometry, tables, images, width: document.documentElement.scrollWidth, viewport: innerWidth};
    });
    check(initial.panels === 8, "Expected eight report panels.");
    check(initial.svgCount === 5, "Expected five generated SVG diagrams.");
    check(initial.geometry.every(g => !g.clipped), "A diagram extends beyond its viewBox.");
    check(initial.tables.every(t => t.rows.every(n => n === t.columns)), "A Markdown table has split columns.");
    check(initial.width <= initial.viewport, "The desktop page overflows horizontally.");
    await page.screenshot({path: "output/playwright/self-hosting-report-desktop.png", fullPage: false});
    await page.locator("#panel-C .am-diagram").screenshot({path: "output/playwright/self-hosting-report-pipeline.png"});
    await page.locator("#panel-B").screenshot({path: "output/playwright/self-hosting-report-generations.png"});
    await page.locator("#panel-F").screenshot({path: "output/playwright/self-hosting-report-boundary.png"});
    await page.locator('[data-am="mode"]').click();
    check(await page.locator("html").getAttribute("data-mode") === "dark", "Dark mode did not activate.");
    await page.locator("#panel-A").scrollIntoViewIfNeeded();
    await page.screenshot({path: "output/playwright/self-hosting-report-dark.png", fullPage: false});
    await page.locator('[data-am="mode"]').click();
    await page.locator('[data-am="mode"]').click();
    check(await page.locator("html").getAttribute("data-mode") === "light", "Light mode did not restore.");
    await page.locator('[data-am="theme"]').click();
    check(await page.locator("html").getAttribute("data-theme") === "shadcn", "Theme switch failed.");
    await page.locator('[data-am="theme"]').click();
    await page.locator('.am-toc a[href="#panel-D"]').click();
    check(page.url().endsWith("#panel-D"), "Table-of-contents navigation failed.");
    await page.setViewportSize({width: 390, height: 844});
    const mobile = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth}));
    check(mobile.width <= mobile.viewport, "The mobile page overflows horizontally.");
    await page.locator("#panel-D").screenshot({path: "output/playwright/self-hosting-report-language-mobile.png"});
    check(errors.length === 0, "Browser errors: " + errors.join("; "));
    return {ok: true, panels: initial.panels, svgCount: initial.svgCount, geometry: initial.geometry,
        tableCount: initial.tables.length, desktop: {width: initial.width, viewport: initial.viewport}, mobile,
        interactions: ["dark mode", "light mode", "theme switch", "table of contents"], errors, images: initial.images};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { console.log(inspectSelfHostingReport.toString()); }
