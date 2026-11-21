import assert from "node:assert/strict";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const JSZip = require(
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip",
);
const playwrightPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8766/", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const button = document.getElementById("enterApp");
  return button && !button.disabled;
});
await page.locator("#enterApp").click();
await page.waitForTimeout(600);
await page.locator('[data-view="books"]').last().click();
await page.locator('[data-action="set-reader-language"][data-language="en"]').click();
await page.locator("#bookUpload").setInputFiles({
  name: "备份测试书.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Backup test chapter.\n\nThis book should survive a complete backup."),
});
await page.locator("main h1", { hasText: "导入预览" }).waitFor();
await page.locator('[data-action="confirm-reader-import"]').click();
await page.locator(".reader-text").waitFor();
await page.locator("#openSettings").click();
const downloadPromise = page.waitForEvent("download");
await page.locator("#exportFullProgress").click();
const download = await downloadPromise;
await mkdir(".impeccable/test-output", { recursive: true });
const savedPath = path.resolve(".impeccable/test-output/backup.zip");
await download.saveAs(savedPath);
const zip = await JSZip.loadAsync(await readFile(savedPath));
const manifest = JSON.parse(await zip.file("manifest.json").async("text"));
assert.equal(manifest.format, "cike-full-backup");
assert.equal(manifest.files.length, 1);
assert.ok(zip.file(manifest.files[0].filename));

await page.locator('#settingsForm button[value="cancel"]').click();
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("cike-content-v1");
    request.onsuccess = request.onerror = request.onblocked = resolve;
  });
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const button = document.getElementById("enterApp");
  return button && !button.disabled;
});
await page.locator("#enterApp").click();
await page.waitForTimeout(600);
await page.locator("#openSettings").click();
page.once("dialog", (dialog) => dialog.accept());
await page.locator("#importFile").setInputFiles(savedPath);
await page.waitForFunction(
  () => document.getElementById("toast")?.textContent.includes("完整备份"),
  null,
  { timeout: 30000 },
);
await page.locator('#settingsForm button[value="cancel"]').click();
await page.locator('[data-view="books"]').last().click();
if (
  await page
    .locator('[data-action="set-reader-language"][data-language="en"]')
    .count()
) {
  await page
    .locator('[data-action="set-reader-language"][data-language="en"]')
    .click();
}
assert.match(await page.locator("main").innerText(), /备份测试书/);
assert.match(
  await page.locator("main").innerText(),
  /survive a complete backup/,
);
await browser.close();
console.log("full backup check passed");
