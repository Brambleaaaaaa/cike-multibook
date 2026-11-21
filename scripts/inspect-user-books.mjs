import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const JSZip = require(
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip",
);

const pdfjs = await import(
  pathToFileURL(
    "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  ).href
);
const root =
  "C:/Users/pc/Documents/xwechat_files/wxid_5y065sp6kk4k22_fdde/msg/file/2026-11";
const names = [
  " cicis journal (Joris Chamblain, Aurelie Neyret).pdf",
  "My Not So Perfect Life (Sophie Kinsella).pdf",
  "Hyperbole and a Half.pdf",
  "Rejection (Tony Tulathimutte) (z-library.sk, 1lib.sk, z-lib.sk).epub",
  "À table !.pdf",
  "Betises_et_limites_Mes_ptites_porquoi_-_MILAN.pdf",
  "《Frritt-Flacc》 Jules Verne.pdf",
  "注释版 De l'autre côté du miroir.pdf",
  "adventuresdelafa0000jose.pdf",
  "rebellion0000mate.pdf",
  "Kumo, la petite nuée timide (Kyo Maclear).pdf",
  "670. The Murders in Great Diddling (Katarina Bivald).pdf",
  "The Midwinter Witch (Molly Knox Ostertag@澄澄妈妈).pdf",
  "Hooky Vol.1 eps. 1-21 (Miriam Bonastre Tur) @澄澄妈妈.pdf",
];
const available = await fs.readdir(root);

function resolveName(requested) {
  const normalize = (value) => value.normalize("NFC").toLowerCase();
  return (
    available.find((name) => normalize(name) === normalize(requested)) ||
    available.find((name) => normalize(name).includes(normalize(requested).slice(0, 12))) ||
    requested
  );
}

async function inspectPdf(file) {
  const data = new Uint8Array(await fs.readFile(file));
  const document = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const sample = new Set([
    1,
    Math.ceil(document.numPages * 0.15),
    Math.ceil(document.numPages * 0.35),
    Math.ceil(document.numPages * 0.6),
    Math.ceil(document.numPages * 0.85),
    document.numPages,
  ]);
  let chars = 0;
  for (const pageNumber of sample) {
    if (pageNumber < 1 || pageNumber > document.numPages) continue;
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    chars += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join("")
      .replace(/\s/g, "").length;
  }
  return {
    pages: document.numPages,
    sampledPages: sample.size,
    sampleChars: chars,
    charsPerPage: Math.round(chars / sample.size),
    mode: chars / sample.size < 30 ? "image-or-scan" : "text",
  };
}

async function inspectEpub(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const htmlFiles = Object.keys(zip.files).filter((name) =>
    /\.x?html?$/i.test(name),
  );
  let chars = 0;
  for (const name of htmlFiles) {
    const html = await zip.file(name).async("text");
    chars += html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&[^;]+;/g, " ")
      .replace(/\s/g, "").length;
  }
  return { pages: htmlFiles.length, mode: "text", chars };
}

for (const name of names) {
  const resolvedName = resolveName(name);
  const file = path.join(root, resolvedName);
  const size = (await fs.stat(file)).size;
  const result = name.endsWith(".epub")
    ? await inspectEpub(file)
    : await inspectPdf(file);
  console.log(
    JSON.stringify({
      name,
      fileName: resolvedName,
      sizeMB: Number((size / 1024 / 1024).toFixed(2)),
      ...result,
    }),
  );
}
