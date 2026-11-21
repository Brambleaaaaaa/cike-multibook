import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const executablePath =
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const appUrl = pathToFileURL(
  "D:/CodexData/Home/visualizations/2026/11/18/01a1ec28-62b4-7201-a8a2-a22e543b2190/app-web/index.html",
).href;
const outputDir = ".impeccable/review-handdrawn";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(appUrl, { waitUntil: "load" });
await page.waitForFunction(
  () => {
    const button = document.getElementById("enterApp");
    return button && !button.disabled;
  },
  null,
  { timeout: 60000 },
);
await page.screenshot({
  path: `${outputDir}/splash.png`,
  fullPage: true,
});
await page.locator("#enterApp").click();
await page.waitForTimeout(700);

await page.screenshot({
  path: `${outputDir}/home.png`,
  fullPage: true,
});
assert.equal(await page.locator(".mobile-nav-item").count(), 5);

await page.locator('[data-view="books"]').last().click();
await page.locator('[data-action="set-reader-language"][data-language="en"]').click();
assert.equal(await page.locator(".reader-book-card").count() >= 2, true);
await page.locator('[data-action="open-reader"]').first().click();
await page.locator(".reader-text").waitFor();
await page.locator('[data-action="reader-next"]').click();
assert.match(await page.locator(".reader-progress-text").textContent(), /2 \/ \d+/);
await page.screenshot({
  path: `${outputDir}/reader.png`,
  fullPage: true,
});
await page.locator('[data-action="close-reader"]').click();

const uploadButton = page.locator('[data-action="upload-book"]').first();
await uploadButton.waitFor();
const fileInput = page.locator("#bookUpload");
await fileInput.setInputFiles({
  name: "我的英语阅读.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(
    "Chapter 1 A New Notebook\n\nThis is the first paragraph of a locally imported book. It should appear in the reader.\n\nChapter 2 The Next Page\n\nThis is another chapter, kept on this device only.",
  ),
});
await page.locator("main h1", { hasText: "导入预览" }).waitFor();
await page.locator('[data-action="confirm-reader-import"]').click();
await page.locator(".reader-text").waitFor();
assert.match(await page.locator(".reader-text").textContent(), /A New Notebook/);
await page.locator('[data-action="close-reader"]').click();

await page.locator('[data-view="corpus"]').last().click();
await page.locator('[data-action="set-writing-language"][data-language="en"]').click();
await page.locator('[data-action="open-writing-doc"]').first().click();
await page.locator("#writingDraft").fill("A locally saved translation draft.");
await page.locator('[data-action="complete-writing-board"]').click();
await page.locator('[data-view="home"]').last().click();
assert.equal(await page.locator('[data-action="open-review"]').count() >= 1, true);
await page.locator('[data-action="open-review"]').first().click();
await page.locator(".review-sheet").waitFor();
await page.locator('[data-action="review-reveal"]').click();
assert.equal(await page.locator(".review-answer").isVisible(), true);
await page.locator('[data-action="review-grade"][data-grade="know"]').click();

await page.locator('[data-view="corpus"]').last().click();
await page.locator('[data-action="close-writing-doc"]').click();
await page.locator('[data-action="change-writing-language"]').click();
await page.locator('[data-action="set-writing-language"][data-language="fr"]').click();
assert.match(await page.locator("main h1").textContent(), /法语写译资料/);
assert.match(await page.locator(".empty-state").textContent(), /不会伪造/);

await page.locator('[data-view="profile"]').last().click();
assert.equal(await page.locator(".mobile-nav-item.is-active").count(), 1);
await page.locator("#profileName").fill("纸页上的我");
await page.locator("#profileTag").fill("英语与法语双线练习");
await page.locator("#profileNote").fill("今天也要写下一页。");
await page.screenshot({
  path: `${outputDir}/profile.png`,
  fullPage: true,
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(
  () => {
    const button = document.getElementById("enterApp");
    return button && !button.disabled;
  },
  null,
  { timeout: 60000 },
);
await page.locator("#enterApp").click();
await page.waitForTimeout(600);
await page.locator('[data-view="profile"]').last().click();
assert.equal(await page.locator("#profileName").inputValue(), "纸页上的我");

await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log("handdrawn mobile UI checks passed");
