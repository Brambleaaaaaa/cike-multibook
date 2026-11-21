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
  await enterApp(page);

  await page.locator('[data-view="corpus"]').last().click();
  await page
    .locator('[data-action="set-writing-language"][data-language="en"]')
    .click();
  await page.locator('[data-action="upload-writing"]').first().click();
  await page.locator("#bookUpload").setInputFiles({
    name: "写作专项.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      [
        "# 第一章 写作方法",
        "",
        "先提出中心观点，再解释原因，最后用具体例子收束。",
        "",
        "# 第二章 翻译技巧",
        "",
        "翻译时先识别主干，再处理修饰成分，最后检查语序和逻辑。",
      ].join("\n"),
    ),
  });
  await page.locator("main h1", { hasText: "导入预览" }).waitFor();
  await page.locator('[data-action="confirm-reader-import"]').click();
  await page.locator(".chapter-strip").waitFor();
  const chapterText = await page.locator(".chapter-strip").textContent();
  assert.match(chapterText, /第一章 写作方法/);
  assert.match(chapterText, /第二章 翻译技巧/);
  assert.ok(
    (await page.locator(".chapter-strip button").count()) >= 2,
    "heading-aware writing chapters were not created",
  );

  await page.locator('[data-action="toggle-writing-reveal"]').click();
  assert.match(
    await page.locator(".typewriter-copy").textContent(),
    /先提出中心观点|翻译时先识别主干/,
  );
  assert.ok(
    (await page.locator(".board-map button").count()) >= 1,
    "writing board navigation is missing",
  );

  await page.locator('[data-view="books"]').last().click();
  await page
    .locator('[data-action="set-reader-language"][data-language="en"]')
    .click();
  await page.locator('[data-action="upload-book"]').first().click();
  await page.locator("#bookUpload").setInputFiles({
    name: "句子阅读练习.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "# Reading Practice",
        "",
        "The first sentence introduces a clear idea. The second sentence explains why that idea matters.",
        "",
        "A third sentence gives an example. A fourth sentence brings the paragraph to a close.",
      ].join("\n"),
    ),
  });
  await page.locator("main h1", { hasText: "导入预览" }).waitFor();
  await page.locator('[data-action="confirm-reader-import"]').click();
  await page.locator(".reader-text").waitFor();

  assert.ok(
    (await page.locator(".sentence-pair").count()) >= 2,
    "sentence-by-sentence translation view is missing",
  );
  assert.ok(
    (await page.locator(".token-list button").count()) >= 2,
    "sentence analysis tokens are missing",
  );
  const firstSentence = page.locator(".sentence-translation").first();
  await firstSentence.fill("这是保存在本机的逐句译文。");

  await page.waitForTimeout(1200);
  await page.locator('[data-action="close-reader"]').click();
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem("cike-cet6-state-v2");
    return raw ? JSON.parse(raw) : null;
  });
  assert.ok(
    Number(persisted?.profile?.readingSeconds || 0) >= 1,
    "reading time was not persisted when closing the reader",
  );
  assert.ok(
    Object.values(persisted?.reader?.sentenceTranslations || {}).includes(
      "这是保存在本机的逐句译文。",
    ),
    "sentence translation was not saved locally",
  );

  await page.reload({ waitUntil: "load" });
  await enterApp(page);
  await page.locator('[data-view="books"]').last().click();
  await page
    .locator(".reader-book-card", { hasText: "句子阅读练习" })
    .click();
  await page.locator(".reader-text").waitFor();
  assert.equal(
    await page.locator(".sentence-translation").first().inputValue(),
    "这是保存在本机的逐句译文。",
  );
} finally {
  await context.close();
  await browser.close();
}

if (errors.length) throw new Error(errors.join("\n"));
console.log("content parsing, sentence translation and reading clock checks passed");

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
