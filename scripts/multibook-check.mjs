import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const executablePath =
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const baseUrl = process.env.CIKE_URL || "http://127.0.0.1:8766/";
const screenshotDir = ".impeccable/review-v2";
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("requestfailed", (request) => {
  errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`);
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await enterApp(page);
await page.locator("main h1").waitFor();

assert.equal(await page.locator(".book-card").count(), 5);
assert.match(await page.locator(".book-card").first().textContent(), /六级核心 2000/);
assert.match(await page.locator(".book-card").nth(1).textContent(), /1,526/);
assert.match(await page.locator(".book-card").nth(2).textContent(), /10,000/);
assert.match(await page.locator(".book-card").nth(3).textContent(), /5,000/);
assert.match(await page.locator(".book-card").nth(4).textContent(), /194/);

await page.locator('[data-action="open-typewords"]').click();
assert.match(await page.locator("main h1").textContent(), /TypeWords/);
assert.equal(await page.locator(".typewords-card").count() > 190, true);
await page.locator(".typewords-card", { hasText: "CET-6" }).first().click();
await page.waitForTimeout(150);
assert.match(await page.locator(".current-book-line").textContent(), /CET-6/);
assert.match(await page.locator(".current-book-line").textContent(), /2,345/);

await page.locator('[data-view="home"]').last().click();
await page.locator(".book-card", { hasText: "英语万词扩展" }).click();
await page.waitForTimeout(120);
assert.match(
  await page.locator(".book-card.is-active").textContent(),
  /英语万词扩展/,
);

await page.locator('[data-action="pick-mode"][data-mode="recognize"]').click();
await page.locator('[data-action="start-session"]').first().click();
await page.locator(".study-card").waitFor();
assert.match(await page.locator(".study-progress-label").textContent(), /1 \/ 20/);
await page.locator('[data-action="reveal"]').click();
await page.locator('[data-action="grade"][data-grade="know"]').click();
await page.locator('[data-action="next-question"]').waitFor({ timeout: 3000 });
await page.locator('[data-action="next-question"]').click();
assert.match(await page.locator(".study-progress-label").textContent(), /2 \/ 20/);
await page.locator('[data-action="reveal"]').click();
await page.locator('[data-action="grade"][data-grade="again"]').click();
await page.locator('[data-action="next-question"]').waitFor({ timeout: 3000 });
await page.locator('[data-action="next-question"]').click();
assert.match(await page.locator(".study-progress-label").textContent(), /3 \/ 20/);
await page.locator('[data-action="reveal"]').click();
await page.locator('[data-action="grade"][data-grade="hard"]').click();
await page.locator('[data-action="next-question"]').waitFor({ timeout: 3000 });
await page.locator('[data-action="next-question"]').click();
assert.match(await page.locator(".study-progress-label").textContent(), /4 \/ 20/);
await page.waitForTimeout(320);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: `${screenshotDir}/study-next-fixed.png`,
  fullPage: true,
});

await page.locator('[data-view="corpus"]').last().click();
assert.match(await page.locator("main h1").textContent(), /写译学习/);
await page.locator('[data-action="set-writing-language"][data-language="en"]').click();
await page.locator('[data-action="open-writing-doc"]').first().click();
await page.locator('[data-action="toggle-writing-reveal"]').click();
assert.equal(await page.locator(".typewriter-copy").isVisible(), true);
const beforeBoard = await page.locator(".typewriter-copy").textContent();
assert.ok(beforeBoard.trim().length > 0);
await page.locator('[data-action="complete-writing-board"]').click();
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: `${screenshotDir}/corpus.png`,
  fullPage: true,
});

await page.locator('[data-view="home"]').last().click();
await page.locator("#openSettings").click();
await page.locator("#sessionSizeInput").fill("25");
await page.locator('#settingsForm button[value="save"]').click();
await page.waitForTimeout(100);
assert.match(await page.locator('[data-action="start-session"]').first().textContent(), /25 词/);

await page.locator(".book-card", { hasText: "法语 A1 → B2" }).click();
await page.waitForTimeout(100);
await page.locator('[data-view="library"]').last().click();
assert.match(await page.locator(".current-book-line").textContent(), /法语 A1 → B2/);
assert.match(await page.locator(".filter-tabs").textContent(), /A1/);
assert.match(await page.locator(".filter-tabs").textContent(), /B2/);
await page.locator(".search-form").click();
await page.locator("#searchInput").fill("bonjour");
await page.locator("#headerSearch").press("Enter");
assert.equal(await page.locator(".word-main", { hasText: "bonjour" }).count() > 0, true);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: `${screenshotDir}/french-library.png`,
  fullPage: true,
});

await page.locator('[data-view="home"]').last().click();
await page.locator('[data-action="pick-mode"][data-mode="write"]').click();
await page.locator('[data-action="start-session"]').first().click();
assert.match(await page.locator(".prompt-label").textContent(), /法语/);
await page.locator("#answerInput").fill("le");
await page.locator("#answerForm").evaluate((form) => form.requestSubmit());
await assertVisible(page, ".feedback-status.is-correct");
await page.screenshot({
  path: `${screenshotDir}/french-writing-correct.png`,
  fullPage: true,
});
await page.locator('[data-action="next-question"]').click();
await page.locator('[data-view="home"]').last().click();

await page.locator(".book-card", { hasText: "六级 1570 词 + 短语" }).click();
await page.locator('[data-view="library"]').last().click();
await page.locator(".search-form").click();
await page.locator("#searchInput").fill("conduct research");
await page.locator("#headerSearch").press("Enter");
assert.equal(
  await page.locator(".word-main", { hasText: "conduct research" }).count(),
  1,
);

await page.reload({ waitUntil: "networkidle" });
await enterApp(page);
assert.match(
  await page.locator(".book-card.is-active").textContent(),
  /六级 1570 词 \+ 短语/,
);

await browser.close();
if (errors.length) {
  throw new Error(errors.join("\n"));
}
console.log("multi-book interaction checks passed");

async function assertVisible(page, selector) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 5000 });
}

async function enterApp(page) {
  const enter = page.locator("#enterApp");
  await enter.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const button = document.getElementById("enterApp");
    return button && !button.disabled;
  }, null, { timeout: 60000 });
  await enter.click();
  await page.waitForTimeout(650);
}
