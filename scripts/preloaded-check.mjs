import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto("http://127.0.0.1:8766/", { waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const button = document.getElementById("enterApp");
  return button && !button.disabled;
});
await page.locator("#enterApp").click();
await page.waitForTimeout(650);
await page.locator('[data-view="books"]').last().click();
await page.locator('[data-action="set-reader-language"][data-language="en"]').click();
await page.locator(".reader-book-card", { hasText: "Cici's Journal" }).click();
try {
  await page.locator(".reader-pdf-canvas").waitFor({ timeout: 60000 });
} catch (error) {
  console.error(errors.join("\n"));
  console.error(await page.locator("#readerPdfPage").textContent());
  throw error;
}
assert.ok((await page.locator(".reader-pdf-canvas").boundingBox()).height > 100);
await mkdir(".impeccable/review-handdrawn", { recursive: true });
await page.screenshot({
  path: ".impeccable/review-handdrawn/preloaded-comic.png",
  fullPage: false,
});
await page.locator('[data-action="close-reader"]').click();
await page.locator(".reader-book-card", { hasText: "My Not So Perfect Life" }).click();
await page.locator(".reader-text").waitFor();
assert.ok((await page.locator(".reader-text").textContent()).trim().length > 100);
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log("preloaded book checks passed");
