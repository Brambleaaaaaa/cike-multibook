import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
const screenshotDir = ".impeccable/bug-regression";
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
const widths = [320, 375, 390, 430];

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push(`${width}px pageerror: ${error.message}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`${width}px console: ${message.text()}`);
      }
    });

    await page.goto(appUrl, { waitUntil: "load" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    await enterApp(page);

    await assertNoHorizontalOverflow(page, `${width}px home`);
    for (const view of ["library", "books", "profile"]) {
      await page.locator(`[data-view="${view}"]`).last().click();
      await page.locator("main h1").waitFor();
      await assertNoHorizontalOverflow(page, `${width}px ${view}`);
    }
    await page.locator('[data-view="home"]').last().click();

    await page.locator('[data-action="pick-mode"][data-mode="recognize"]').click();
    await page.locator('[data-action="start-session"]').first().click();
    await page.locator(".study-card").waitFor();

    for (const grade of ["again", "hard"]) {
      const before = await page.locator(".study-progress-label span").first().textContent();
      await page.locator('[data-action="reveal"]').click();
      await page.locator(`[data-action="grade"][data-grade="${grade}"]`).click();
      await page.locator('[data-action="next-question"]').waitFor({
        state: "visible",
        timeout: 3000,
      });
      await page.locator('[data-action="next-question"]').click();
      const after = await page.locator(".study-progress-label span").first().textContent();
      assert.notEqual(after, before, `${width}px: ${grade} did not advance`);
    }

    await assertNoHorizontalOverflow(page, `${width}px study`);
    await page.screenshot({
      path: `${screenshotDir}/study-${width}.png`,
      fullPage: true,
    });

    await page.locator('[data-view="corpus"]').last().click();
    await page
      .locator('[data-action="set-writing-language"][data-language="en"]')
      .click();
    await page.locator('[data-action="open-writing-doc"]').first().click();
    await page.locator('[data-action="toggle-writing-reveal"]').click();
    await page.locator("#writingFontSize").evaluate((input) => {
      input.value = "30";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(80);

    await assertNoHorizontalOverflow(page, `${width}px writing`);
    const outOfBounds = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return [...document.querySelectorAll("#main *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") return false;
          let ancestor = element.parentElement;
          while (ancestor && ancestor !== document.body) {
            const ancestorStyle = getComputedStyle(ancestor);
            const scrollsHorizontally =
              ancestorStyle.overflowX === "auto" ||
              ancestorStyle.overflowX === "scroll";
            if (scrollsHorizontally) return false;
            ancestor = ancestor.parentElement;
          }
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < -1 || rect.right > viewport + 1);
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: (element.textContent || "").trim().slice(0, 40),
          rect: element.getBoundingClientRect().toJSON(),
        }));
    });
    assert.deepEqual(outOfBounds, [], `${width}px writing has clipped content`);
    await page.screenshot({
      path: `${screenshotDir}/writing-${width}.png`,
      fullPage: true,
    });
    await context.close();
  }

  const fallbackContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await fallbackContext.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
  });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.goto(appUrl, { waitUntil: "load" });
  await fallbackPage.evaluate(() => localStorage.clear());
  await fallbackPage.reload({ waitUntil: "load" });
  await enterApp(fallbackPage);
  await fallbackPage
    .locator('[data-action="pick-mode"][data-mode="listen"]')
    .click();
  await fallbackPage.locator('[data-action="start-session"]').first().click();
  await fallbackPage.locator('[data-action="speak"]').first().click();
  await fallbackPage.locator(".toast.is-visible").waitFor({ timeout: 3000 });
  assert.match(
    await fallbackPage.locator(".toast.is-visible").textContent(),
    /不支持|语音|朗读/,
  );
  await fallbackContext.close();
} finally {
  await browser.close();
}

if (errors.length) throw new Error(errors.join("\n"));
console.log("bug regression checks passed at 320, 375, 390 and 430 px");

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

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > viewport + 1);
      })
      .slice(0, 15)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: String(element.className || "").slice(0, 100),
        text: (element.textContent || "").trim().slice(0, 60),
        rect: element.getBoundingClientRect().toJSON(),
      }));
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
    };
  });
  assert.ok(
    overflow.documentWidth <= overflow.viewport + 1,
    `${label} has document overflow: ${JSON.stringify(overflow)}`,
  );
  assert.ok(
    overflow.bodyWidth <= overflow.viewport + 1,
    `${label} has body overflow: ${JSON.stringify(overflow)}`,
  );
}
