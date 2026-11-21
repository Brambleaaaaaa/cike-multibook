import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const executablePath =
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const appUrl = pathToFileURL(
  "C:/Users/pc/Documents/ChatGPT/englishstudy/cet6-mobile.html",
).href;

await mkdir(".impeccable/review", { recursive: true });
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
await page.locator("h1").waitFor({ state: "visible" });
assert.match(await page.locator("h1").textContent(), /今天，把词记住/);
assert.equal(await page.locator(".mobile-nav").isVisible(), true);

await page.locator('[data-action="start-session"]').first().click();
await page.locator(".study-card").waitFor({ state: "visible" });
assert.match(await page.locator(".study-word").textContent(), /accord/i);

await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: ".impeccable/review/mobile-single.png",
  fullPage: true,
});
await browser.close();

if (errors.length) {
  throw new Error(errors.join("\n"));
}

console.log("single-file mobile check passed");
