import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 700, height: 260 } });
page.on("pageerror", (error) => console.error("pageerror", error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error("console", message.text());
});
await page.setContent(
  '<body style="margin:0;background:white;font:64px Arial;display:grid;place-items:center"><div>HELLO VOCABULARY</div></body>',
);
const imagePath = ".impeccable/ocr-sample.png";
await page.screenshot({ path: imagePath });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:8766/", { waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const button = document.getElementById("enterApp");
  return button && !button.disabled;
});
await page.locator("#enterApp").click();
await page.waitForTimeout(600);
await page.locator('[data-view="books"]').last().click();
await page.locator('[data-action="set-reader-language"][data-language="en"]').click();
await page.locator('[data-action="upload-book"]').first().click();
await page.locator("#bookUpload").setInputFiles(imagePath);
await page.locator("main h1", { hasText: "导入预览" }).waitFor();
await page.locator('[data-action="run-pending-ocr"]').click();
await page.waitForFunction(
  () =>
    document.querySelector('[data-action="run-pending-ocr"]')?.textContent.includes(
      "重新识别",
    ),
  null,
  { timeout: 180000 },
);
const pageList = await page.locator(".import-page-list").textContent();
assert.match(pageList.toUpperCase(), /HELLO/);
await browser.close();
console.log("offline OCR check passed");
