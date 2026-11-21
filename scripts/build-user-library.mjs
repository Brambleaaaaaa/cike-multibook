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

const sourceRoot =
  "C:/Users/pc/Documents/xwechat_files/wxid_5y065sp6kk4k22_fdde/msg/file/2026-11";
const outputRoot = path.resolve(process.argv[2] || "app-web");
const bookRoot = path.join(outputRoot, "books");
const dataRoot = path.join(outputRoot, "data");
await fs.mkdir(bookRoot, { recursive: true });
await fs.mkdir(dataRoot, { recursive: true });

const specs = [
  {
    requested: " cicis journal (Joris Chamblain, Aurelie Neyret).pdf",
    title: "Cici's Journal",
    author: "Joris Chamblain · Aurélie Neyret",
    language: "en",
    type: "comic",
    kind: "pdf",
  },
  {
    requested: "My Not So Perfect Life (Sophie Kinsella).pdf",
    title: "My Not So Perfect Life",
    author: "Sophie Kinsella",
    language: "en",
    type: "ebook",
    kind: "text-pdf",
  },
  {
    requested: "Hyperbole and a Half.pdf",
    title: "Hyperbole and a Half",
    author: "Allie Brosh",
    language: "en",
    type: "comic",
    kind: "text-pdf",
  },
  {
    requested:
      "Rejection (Tony Tulathimutte) (z-library.sk, 1lib.sk, z-lib.sk).epub",
    title: "Rejection",
    author: "Tony Tulathimutte",
    language: "en",
    type: "ebook",
    kind: "epub",
  },
  {
    requested: "À table !.pdf",
    title: "À table !",
    author: "本地导入",
    language: "fr",
    type: "comic",
    kind: "pdf",
  },
  {
    requested: "Betises_et_limites_Mes_ptites_porquoi_-_MILAN.pdf",
    title: "Bêtises et limites",
    author: "Milan",
    language: "fr",
    type: "comic",
    kind: "pdf",
  },
  {
    requested: "《Frritt-Flacc》 Jules Verne.pdf",
    title: "Frritt-Flacc",
    author: "Jules Verne",
    language: "fr",
    type: "ebook",
    kind: "text-pdf",
  },
  {
    requested: "注释版 De l'autre côté du miroir.pdf",
    title: "De l'autre côté du miroir",
    author: "Lewis Carroll",
    language: "fr",
    type: "ebook",
    kind: "pdf",
  },
  {
    requested: "adventuresdelafa0000jose.pdf",
    title: "Adventures of Lafa",
    author: "本地导入",
    language: "en",
    type: "ebook",
    kind: "text-pdf",
  },
  {
    requested: "rebellion0000mate.pdf",
    title: "Rebellion",
    author: "本地导入",
    language: "en",
    type: "ebook",
    kind: "text-pdf",
  },
  {
    requested: "Kumo, la petite nuée timide (Kyo Maclear).pdf",
    title: "Kumo, la petite nuée timide",
    author: "Kyo Maclear",
    language: "fr",
    type: "comic",
    kind: "pdf",
  },
  {
    requested: "670. The Murders in Great Diddling (Katarina Bivald).pdf",
    title: "The Murders in Great Diddling",
    author: "Katarina Bivald",
    language: "en",
    type: "ebook",
    kind: "text-pdf",
  },
  {
    requested:
      "The Midwinter Witch (Molly Knox Ostertag@澄澄妈妈).pdf",
    title: "The Midwinter Witch",
    author: "Molly Knox Ostertag",
    language: "en",
    type: "comic",
    kind: "pdf",
  },
  {
    requested: "Hooky Vol.1 eps. 1-21 (Miriam Bonastre Tur) @澄澄妈妈.pdf",
    title: "Hooky Vol. 1",
    author: "Míriam Bonastre Tur",
    language: "en",
    type: "comic",
    kind: "pdf",
  },
];

const available = await fs.readdir(sourceRoot);
const normalize = (value) => value.normalize("NFC").toLowerCase();

function resolveSource(requested) {
  const normalized = normalize(requested);
  return available.find((name) => normalize(name) === normalized);
}

function splitText(text, limit = 1400) {
  const blocks = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const pages = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length > limit) {
      pages.push(current);
      current = "";
    }
    // 单段本身超过上限时，按句子切开，避免整页被一段撑爆。
    if (!current && block.length > limit) {
      const sentences = block.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*/g) || [block];
      let piece = "";
      for (const sentence of sentences) {
        if (piece && piece.length + sentence.length > limit) {
          pages.push(piece.trim());
          piece = "";
        }
        piece += sentence;
      }
      if (piece.trim()) current = piece.trim();
      continue;
    }
    current += `${current ? "\n\n" : ""}${block}`;
  }
  if (current) pages.push(current);
  return pages;
}

// 把 pdf.js 的文本碎片按基线还原成行，丢失行结构会让章节识别、
// 段落翻译和正文分段全部挤成一整段。
function itemsToLines(items) {
  const lines = [];
  let current = null;
  for (const item of items) {
    if (!("str" in item)) continue;
    const str = String(item.str || "");
    if (!str) continue;
    const x = Array.isArray(item.transform) ? item.transform[4] : 0;
    const y = Array.isArray(item.transform) ? item.transform[5] : 0;
    const width = Number(item.width) || 0;
    const height = Math.abs(Number(item.height) || 10);
    if (current && Math.abs(y - current.y) <= Math.max(2, height * 0.45)) {
      const gap = x - current.endX;
      const needsSpace = gap > Math.max(1.2, height * 0.12) && !/\s$/.test(current.text) && !/^\s/.test(str);
      current.text += `${needsSpace ? " " : ""}${str}`;
      current.endX = x + width;
    } else {
      if (current) lines.push(current);
      current = { text: str, x, y, endX: x + width, height };
    }
    if (item.hasEOL && current) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() })).filter((line) => line.text);
}

function linesToParagraphs(lines) {
  if (!lines.length) return [];
  const heights = lines.map((line) => line.height || 10).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 10;
  const leftEdge = Math.min(...lines.map((line) => line.x));
  const rightEdge = Math.max(...lines.map((line) => line.endX));
  const paragraphs = [];
  let current = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const prev = lines[index - 1];
    if (!current) {
      current = line.text;
      continue;
    }
    const gap = prev ? Math.abs(prev.y - line.y) : 0;
    const indented = line.x - leftEdge > Math.max(8, medianHeight * 0.8);
    const prevShort = prev && prev.endX < rightEdge - medianHeight * 2;
    const breakByGap = gap > medianHeight * 1.55;
    // 缩进且上一行排满，基本就是新段落；标题短行后也断开。
    const breakByIndent = indented && prev && !prevShort;
    if (breakByGap || breakByIndent) {
      paragraphs.push(current);
      current = line.text;
    } else {
      current = `${current} ${line.text}`;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

const CHAPTER_RE =
  /^(chapter|chapitre|part|partie|book|livre|prologue|epilogue|introduction|pr[ée]face|avant[- ]propos|afterword|conclusion)\b[\s.:\-–—]*(.*)$/i;

function detectChapterTitle(lines) {
  if (!lines.length) return "";
  // 标题只认页面最前面的几行。章节首页往往正文很长，
  // 不能用整页字数判断；正文里 "Book called ..." 这类句子由下面的
  // 大小写规则排除。
  const scan = lines.slice(0, 10);
  let matches = 0;
  for (const line of scan) {
    if ((line.text.match(/\b(chapter|chapitre|part|partie)\b/gi) || []).length > 0) matches += 1;
  }
  if (matches >= 3) return ""; // 目录页
  for (const [lineIndex, line] of scan.entries()) {
    const text = line.text.trim();
    if (!text || text.length > 88) continue;
    const match = text.match(CHAPTER_RE);
    if (!match) continue;
    if (lineIndex > 3) return "";
    let rest = match[2].replace(/^[\s.:\-–—·]+/, "").trim();
    // "Book called..." / "part of..." 是正文句子，不是标题；
    // 真正的标题后面跟的是序号或大写开头的名字。
    if (rest && !/^([ivxlcdm]+|\d+|[A-ZÀ-ÖØ-Þ])/.test(rest)) continue;
    const head = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const numeral = rest.match(/^([ivxlcdm]+|\d+)\b[\s.:\-–—·]*/i);
    if (numeral) {
      const label = `${head} ${numeral[1].toUpperCase()}`;
      const subtitle = rest
        .slice(numeral[0].length)
        .replace(/^[\s.:\-–—·]+/, "")
        .split(/[.!?。！？]/)[0]
        .trim();
      return subtitle && subtitle.length <= 48 ? `${label} · ${subtitle}` : label;
    }
    if (rest) {
      const short = rest.split(/[.!?。！？]/)[0].trim();
      if (short && short.length <= 42) return `${head} · ${short}`;
    }
    return head;
  }
  return "";
}

async function extractPdf(file) {
  const data = new Uint8Array(await fs.readFile(file));
  const document = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const pages = [];
  const pageStarts = [];
  const detected = [];
  let currentChapter = "";
  for (let index = 1; index <= document.numPages; index++) {
    pageStarts[index - 1] = pages.length;
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items);
    const heading = detectChapterTitle(lines);
    if (heading && heading !== currentChapter) {
      currentChapter = heading;
      detected.push({ start: pages.length, title: heading });
    }
    const paragraphs = linesToParagraphs(lines);
    const text = paragraphs.join("\n\n").replace(/ ([.,])(?=\s|$)/g, "$1").trim();
    for (const chunk of splitText(text)) {
      pages.push({ title: `第 ${index} 页`, text: chunk });
    }
    page.cleanup();
  }
  const outline = await pdfOutline(document);
  const toc = outline
    .map((entry) => ({
      title: String(entry.title || "").replace(/\s+/g, " ").trim(),
      depth: entry.depth,
      start: pageStarts[entry.pageIndex],
    }))
    .filter((entry) => entry.title && Number.isInteger(entry.start));
  toc.sort((a, b) => a.start - b.start || a.depth - b.depth);
  const marks = toc.length ? toc : detected;
  for (let index = 0; index < marks.length; index += 1) {
    const entry = marks[index];
    const end = (marks[index + 1]?.start ?? pages.length) - 1;
    for (let at = entry.start; at <= end && at < pages.length; at += 1) {
      if (!pages[at].chapterTitle) pages[at].chapterTitle = entry.title;
    }
  }
  await document.destroy().catch(() => {});
  return { pages, toc };
}

async function pdfOutline(document) {
  const outline = await document.getOutline().catch(() => null);
  if (!Array.isArray(outline) || !outline.length) return [];
  const entries = [];
  const walk = async (items, depth) => {
    for (const item of items) {
      let pageIndex = null;
      try {
        let destination = item.dest;
        if (typeof destination === "string") destination = await document.getDestination(destination);
        if (Array.isArray(destination) && destination[0]) {
          pageIndex = await document.getPageIndex(destination[0]);
        }
      } catch (error) {
        pageIndex = null;
      }
      if (Number.isInteger(pageIndex) && pageIndex >= 0) {
        entries.push({ title: item.title, pageIndex, depth });
      }
      if (Array.isArray(item.items) && item.items.length) await walk(item.items, depth + 1);
    }
  };
  await walk(outline, 0);
  return entries;
}

function usefulToc(toc, totalPages) {
  if (!Array.isArray(toc) || toc.length < 3) return false;
  const numeric = toc.filter((entry) => /^\d+$/.test(String(entry.title || "").trim())).length;
  if (numeric / toc.length > 0.8) return false;
  const generic =
    /^(title page|cover|front cover|back cover|copyright|contents|dedication|acknowledg(e)?ments?|about the author|index|colophon)$/i;
  if (toc.every((entry) => generic.test(String(entry.title || "").trim()))) return false;
  if (toc[toc.length - 1].start < totalPages * 0.05) return false;
  return true;
}

async function extractEpub(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const names = Object.keys(zip.files)
    .filter((name) => /\.x?html?$/i.test(name))
    .filter((name) => !/(^|\/)(nav|toc|cover|titlepage)\.x?html?$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const pages = [];
  let currentChapter = "";
  for (const name of names) {
    const html = await zip.file(name).async("text");
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
    const marked = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, (match, inner) => `\n\n@@HEADING@@${inner.replace(/<[^>]+>/g, "").trim()}\n\n`)
      .replace(/<\/(p|div|li|blockquote|section|article)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const blocks = marked
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);
    let buffer = "";
    const flush = () => {
      if (!buffer.trim()) return;
      for (const chunk of splitText(buffer)) {
        pages.push({
          title: currentChapter || rawTitle || `第 ${pages.length + 1} 节`,
          ...(currentChapter ? { chapterTitle: currentChapter } : {}),
          text: chunk,
        });
      }
      buffer = "";
    };
    for (const block of blocks) {
      if (block.startsWith("@@HEADING@@")) {
        flush();
        const heading = block.slice("@@HEADING@@".length).trim();
        if (heading && heading.length <= 90) currentChapter = heading;
        continue;
      }
      if (!block) continue;
      buffer += `${buffer ? "\n\n" : ""}${block}`;
      if (buffer.length >= 1400) flush();
    }
    flush();
    if (!currentChapter && rawTitle && pages.length) {
      currentChapter = rawTitle;
    }
  }
  return pages;
}

const books = [];
let textPages = 0;
let copiedFiles = 0;
for (let index = 0; index < specs.length; index++) {
  const spec = specs[index];
  const sourceName = resolveSource(spec.requested);
  if (!sourceName) {
    console.warn(`Missing source: ${spec.requested}`);
    continue;
  }
  const source = path.join(sourceRoot, sourceName);
  const id = `provided-${String(index + 1).padStart(2, "0")}`;
  const extension = path.extname(sourceName).toLowerCase();
  let pages;
  let toc = [];
  let assetPath = "";
  let kind = spec.kind;
  if (spec.kind === "text-pdf") {
    const extracted = await extractPdf(source);
    pages = extracted.pages;
    toc = extracted.toc;
    kind = "text";
  } else if (spec.kind === "epub") {
    pages = await extractEpub(source);
    kind = "text";
  } else {
    const filename = `${id}${extension}`;
    const target = path.join(bookRoot, filename);
    const existing = await fs.stat(target).catch(() => null);
    const sourceSize = (await fs.stat(source)).size;
    if (!existing || existing.size !== sourceSize) {
      await fs.copyFile(source, target);
    }
    assetPath = `books/${filename}`;
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await fs.readFile(source)),
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;
    pages = Array.from({ length: pdf.numPages }, (_, pageIndex) => ({
      title: `第 ${pageIndex + 1} 页`,
      text: "",
    }));
    toc = (await pdfOutline(pdf)).map((entry) => ({
      title: String(entry.title || "").replace(/\s+/g, " ").trim(),
      depth: entry.depth,
      start: entry.pageIndex,
    }));
    await pdf.destroy().catch(() => {});
    copiedFiles++;
  }
  textPages += pages.length;
  books.push({
    id,
    title: spec.title,
    author: spec.author,
    language: spec.language,
    type: spec.type,
    kind,
    assetPath,
    source: sourceName,
    importedAt: "2026-11-19T00:00:00+08:00",
    pages,
    ...(usefulToc(toc, pages.length) ? { toc } : {}),
  });
  console.log(`${index + 1}/${specs.length} ${spec.title}: ${pages.length} pages (${kind})${toc.length ? `, toc ${toc.length}` : ""}`);
}

await fs.writeFile(
  path.join(dataRoot, "preloaded-user-library.js"),
  `window.PRELOADED_USER_LIBRARY = ${JSON.stringify({
    meta: {
      source: "用户提供的私人阅读资料",
      count: books.length,
      copiedPdfAssets: copiedFiles,
      generatedAt: new Date().toISOString(),
    },
    books,
  })};\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    { books: books.length, copiedFiles, textPages, outputRoot },
    null,
    2,
  ),
);
