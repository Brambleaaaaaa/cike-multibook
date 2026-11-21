import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pdfjsPath =
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const pdfjs = await import(pathToFileURL(pdfjsPath).href);

const [, , sourceArg, jsonArg, textArg] = process.argv;
if (!sourceArg || !jsonArg || !textArg) {
  throw new Error("Usage: node scripts/extract_pdf.mjs <pdf> <json> <txt>");
}

const source = path.resolve(sourceArg);
const data = new Uint8Array(await readFile(source));
const document = await pdfjs.getDocument({
  data,
  useSystemFonts: true,
  disableFontFace: true,
}).promise;
const pages = [];
const plainPages = [];

for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const lines = new Map();

  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const y = Math.round(item.transform[5] / 2) * 2;
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({
      x: item.transform[4],
      text: item.str,
    });
  }

  const ordered = [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => {
      items.sort((a, b) => a.x - b.x);
      return items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);

  pages.push({ page: pageNumber, lines: ordered });
  plainPages.push(`\n===== 第 ${pageNumber} 页 =====\n${ordered.join("\n")}`);
}

await mkdir(path.dirname(jsonArg), { recursive: true });
await mkdir(path.dirname(textArg), { recursive: true });
await writeFile(
  jsonArg,
  JSON.stringify(
    {
      source: path.basename(source),
      pageCount: pages.length,
      pages,
    },
    null,
    2,
  ),
  "utf8",
);
await writeFile(textArg, plainPages.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      pages: pages.length,
      lines: pages.reduce((sum, page) => sum + page.lines.length, 0),
      characters: plainPages.reduce((sum, page) => sum + page.length, 0),
      json: jsonArg,
      text: textArg,
    },
    null,
    2,
  ),
);
