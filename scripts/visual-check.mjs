import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const executablePath =
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const baseUrl = process.env.CIKE_URL || "http://127.0.0.1:8765/";
const reviewDir = ".impeccable/review";
await mkdir(reviewDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];

async function openPage(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  return { context, page };
}

async function capture(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({
    path: `${reviewDir}/${name}.png`,
    fullPage: true,
  });
}

const desktop = await openPage({ width: 1440, height: 1000 });
await assertVisible(desktop.page, "h1", "今天，把词记住");
await assertVisible(desktop.page, ".task-board h2");
assert.equal(await desktop.page.locator(".word-main").count() > 0, true);
await capture(desktop.page, "desktop");

await desktop.page.locator('[data-view="library"]').first().click();
await desktop.page.locator('[data-action="set-tag"][data-tag="writing"]').click();
assert.equal(await desktop.page.locator(".word-table .word-row").count() > 0, true);
await capture(desktop.page, "desktop-library");
await desktop.page.locator("#searchInput").fill("perspective");
await desktop.page.locator("#headerSearch").press("Enter");
assert.equal(
  await desktop.page.locator(".word-main", { hasText: "perspective" }).count(),
  1,
);

await desktop.page.locator('[data-view="home"]').first().click();
await desktop.page.locator('[data-action="quick-start"][data-mode="write"]').click();
await assertVisible(desktop.page, ".prompt-meaning");
await desktop.page.locator("#answerInput").fill("accord");
await desktop.page.locator("#answerForm").evaluate((form) => form.requestSubmit());
await assertVisible(desktop.page, ".feedback-status.is-correct");
await capture(desktop.page, "study-correct");

await desktop.page.locator('[data-action="next-question"]').click();
await desktop.page.locator("#answerInput").fill("definitely-wrong");
await desktop.page.locator("#answerForm").evaluate((form) => form.requestSubmit());
await assertVisible(desktop.page, ".feedback-status.is-wrong");
await capture(desktop.page, "study-wrong");

await desktop.page.reload({ waitUntil: "networkidle" });
await desktop.page.locator('[data-view="stats"]').first().click();
await assertVisible(desktop.page, "h1", "学习进度");
assert.match(
  await desktop.page.locator(".metric").first().textContent(),
  /2\s*\/\s*2000/,
);
await capture(desktop.page, "stats");

const mobile = await openPage({ width: 390, height: 844 });
await assertVisible(mobile.page, "h1", "今天，把词记住");
await assert.equal(await mobile.page.locator(".mobile-nav").isVisible(), true);
await capture(mobile.page, "mobile");

await mobile.page.locator('[data-view="library"]').last().click();
await assertVisible(mobile.page, "h1", "词库");
await capture(mobile.page, "mobile-library");
await mobile.page.locator('[data-view="home"]').last().click();
await mobile.page.locator('[data-action="start-session"]').first().click();
await assertVisible(mobile.page, ".study-card");
await capture(mobile.page, "mobile-study");

await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("visual checks passed");
}

async function assertVisible(page, selector, expectedText = "") {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 5000 });
  if (expectedText) {
    assert.equal((await locator.textContent()).trim(), expectedText);
  }
}
