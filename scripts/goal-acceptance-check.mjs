import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const executablePath =
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const appUrl = pathToFileURL(
  process.env.CIKE_URL ||
    "D:/CodexData/Home/visualizations/2026/11/18/01a1ec28-62b4-7201-a8a2-a22e543b2190/app-web/index.html",
).href;

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

try {
  await page.goto(appUrl, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });

  await page.locator("#enterApp").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.getElementById("enterApp")?.disabled);
  assert.ok(
    (await page.locator("#splashParticles span").count()) >= 12,
    "splash particles are missing",
  );
  const enterBox = await page.locator("#enterApp").boundingBox();
  assert.ok(enterBox, "enter button is not rendered");
  await page.mouse.move(enterBox.x + 24, enterBox.y + enterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(enterBox.x + 118, enterBox.y + enterBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.locator("body.app-is-entered").waitFor({ timeout: 3000 });

  assert.equal(await page.locator(".mobile-nav-item").count(), 5);
  assert.equal(await page.locator(".mobile-nav-item.is-active").count(), 1);
  const selectedBackground = await page
    .locator(".mobile-nav-item.is-active")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const idleBackground = await page
    .locator(".mobile-nav-item:not(.is-active)")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(selectedBackground, idleBackground);
  assert.equal(await page.locator("main.view-enter").count(), 1);

  await page.evaluate(() => window.scrollTo(0, 420));
  await page.waitForTimeout(120);
  const parallax = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--page-scroll"),
  );
  assert.ok(parallax && parallax !== "0px", "parallax scroll is not updating");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-action="pick-mode"][data-mode="mixed"]').click();
  await page.locator('[data-action="start-session"]').first().click();
  await page.locator(".study-card").waitFor();
  const firstWord = (await page.locator(".study-word").textContent()).trim();
  await page.locator('[data-action="reveal"]').click();
  const firstMeaning = (
    await page.locator(".study-meaning").first().textContent()
  ).trim();
  await page.locator('[data-action="grade"][data-grade="know"]').click();
  await page.locator('[data-action="next-question"]').click();
  assert.match(
    await page.locator(".prompt-label").textContent(),
    /根据释义，写出/,
  );
  assert.equal(
    (await page.locator(".prompt-meaning").textContent()).trim(),
    firstMeaning,
  );
  await page.locator("#answerInput").fill(firstWord);
  await page.locator("#answerForm").evaluate((form) => form.requestSubmit());
  await page.locator(".feedback-status.is-correct").waitFor();

  await page.locator('[data-action="next-question"]').click();
  assert.match(
    await page.locator(".study-progress-label span").first().textContent(),
    /3\s*\/\s*\d+/,
  );

  await page.locator('[data-view="corpus"]').last().click();
  await page
    .locator('[data-action="set-writing-language"][data-language="en"]')
    .click();
  await page.locator('[data-action="open-writing-doc"]').first().click();
  assert.equal(await page.locator(".chapter-strip button").count(), 55);

  await page.locator('[data-view="home"]').last().click();
  await page.locator('[data-action="open-typewords"]').click();
  assert.equal(await page.locator(".typewords-card").count(), 194);
} finally {
  await context.close();
  await browser.close();
}

if (errors.length) throw new Error(errors.join("\n"));
console.log("goal acceptance checks passed");
