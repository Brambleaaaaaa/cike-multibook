import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  ebookToText,
  epubToText,
  htmlToText,
  normalizeParagraphs,
} from "./ebook-extract.mjs";

const require = createRequire(import.meta.url);
const JSZip = require(
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip",
);

const SOURCE_ROOT = "C:/Users/pc/Downloads/小说";
const outputRoot = path.resolve(process.argv[2] || ".");
const textRoot = path.join(outputRoot, "books", "text");
await fs.mkdir(textRoot, { recursive: true });

const books = [];
let pageTotal = 0;
let charTotal = 0;

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function countChars(text) {
  return String(text || "").replace(/\s/g, "").length;
}

function detectLanguage(text) {
  const sample = String(text || "").slice(0, 120000);
  const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return latin > cjk * 1.6 ? "en" : "zh";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (match, code) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch (error) {
        return "";
      }
    });
}

function stripTags(value) {
  return escapeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const HEADING_RE =
  /^(?:CHAPTER|Chapter|BOOK|Book|PART|Part|ACT|Act|SCENE|Scene|LETTER|Letter|STAVE|Stave|第[一二三四五六七八九十百千万0-9]+[章节回部分篇])\b/;

function countPages(text) {
  const blocks = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  let pages = 0;
  let current = 0;
  for (const block of blocks) {
    const firstLine = block.split("\n")[0].trim();
    const heading =
      HEADING_RE.test(firstLine) ||
      /^#{1,6}\s+\S/.test(firstLine) ||
      /^[IVXLC]+\.?$/.test(firstLine);
    if (heading && current) {
      pages += 1;
      current = block.length;
      continue;
    }
    if (current && current + block.length > 1100) {
      pages += 1;
      current = 0;
    }
    current += block.length + 2;
  }
  if (current) pages += 1;
  return Math.max(1, pages);
}

async function writeBook({ id, title, author, text, source, type = "ebook", language = "" }) {
  const normalized = normalizeParagraphs(text);
  if (countChars(normalized) < 200) {
    console.warn(`Skip empty book: ${title}`);
    return null;
  }
  const filename = `${id}.txt`;
  await fs.writeFile(path.join(textRoot, filename), normalized, "utf8");
  const detectedLanguage = language || detectLanguage(normalized);
  const pageCount = countPages(normalized);
  const book = {
    id,
    title,
    author,
    language: detectedLanguage,
    type,
    kind: "txt",
    assetPath: `books/text/${filename}`,
    source,
    importedAt: "2026-11-20T00:00:00+08:00",
    pageCount,
    pages: [],
  };
  books.push(book);
  pageTotal += pageCount;
  charTotal += normalized.length;
  console.log(
    `+ ${title} · ${pageCount} 页 · ${(normalized.length / 1024).toFixed(0)} KB · ${detectedLanguage}`,
  );
  return book;
}

// ---------- 单本 TXT / EPUB / MOBI ----------

const singles = [
  {
    file: "Harry Potter and the Sorcerer's Stone.txt",
    id: "novel-hp-01",
    title: "Harry Potter and the Sorcerer's Stone",
    author: "J.K. Rowling",
  },
  {
    file: "Harry Potter and the Chamber of Secrets.txt",
    id: "novel-hp-02",
    title: "Harry Potter and the Chamber of Secrets",
    author: "J.K. Rowling",
  },
  {
    file: "Harry Potter and the Prisoner of Azkaban.txt",
    id: "novel-hp-03",
    title: "Harry Potter and the Prisoner of Azkaban",
    author: "J.K. Rowling",
  },
  {
    file: "Harry Potter and the Goblet of Fire.txt",
    id: "novel-hp-04",
    title: "Harry Potter and the Goblet of Fire",
    author: "J.K. Rowling",
  },
  {
    file: "Harry Potter and the Order Of the Phoenix.txt",
    id: "novel-hp-05",
    title: "Harry Potter and the Order of the Phoenix",
    author: "J.K. Rowling",
  },
  {
    file: "Harry Potter and the Half-Blood Prince.txt",
    id: "novel-hp-06",
    title: "Harry Potter and the Half-Blood Prince",
    author: "J.K. Rowling",
  },
  {
    file: "Harry Potter and the Deathly Hallows.txt",
    id: "novel-hp-07",
    title: "Harry Potter and the Deathly Hallows",
    author: "J.K. Rowling",
  },
  {
    file: "冰与火之歌.epub",
    id: "novel-ice-and-fire",
    title: "冰与火之歌",
    author: "乔治·R·R·马丁",
  },
  {
    file: "经典阅读/罗密欧与朱丽叶.txt",
    id: "novel-classic-romeo",
    title: "罗密欧与朱丽叶",
    author: "莎士比亚",
  },
  {
    file: "经典阅读/巴黎圣母院.txt",
    id: "novel-classic-notre-dame",
    title: "巴黎圣母院",
    author: "维克多·雨果",
  },
  {
    file: "经典阅读/简爱.txt",
    id: "novel-classic-jane-eyre",
    title: "简爱",
    author: "夏洛蒂·勃朗特",
  },
  {
    file: "经典阅读/双城记.txt",
    id: "novel-classic-two-cities",
    title: "双城记",
    author: "查尔斯·狄更斯",
  },
  {
    file: "经典阅读/牛津书虫 英汉双语读物 137册/书虫·牛津英汉双语读物：1级全套.mobi",
    id: "novel-bookworm-1",
    title: "书虫·牛津英汉双语读物 1级",
    author: "牛津大学出版社",
    type: "teaching",
  },
  {
    file: "经典阅读/牛津书虫 英汉双语读物 137册/书虫·牛津英汉双语读物：2级全套.mobi",
    id: "novel-bookworm-2",
    title: "书虫·牛津英汉双语读物 2级",
    author: "牛津大学出版社",
    type: "teaching",
  },
  {
    file: "经典阅读/牛津书虫 英汉双语读物 137册/书虫·牛津英汉双语读物：3级全套.mobi",
    id: "novel-bookworm-3",
    title: "书虫·牛津英汉双语读物 3级",
    author: "牛津大学出版社",
    type: "teaching",
  },
  {
    file: "经典阅读/牛津书虫 英汉双语读物 137册/书虫·牛津英汉双语读物：4级全套.mobi",
    id: "novel-bookworm-4",
    title: "书虫·牛津英汉双语读物 4级",
    author: "牛津大学出版社",
    type: "teaching",
  },
  {
    file: "经典阅读/牛津书虫 英汉双语读物 137册/书虫·牛津英汉双语读物：5级全套.mobi",
    id: "novel-bookworm-5",
    title: "书虫·牛津英汉双语读物 5级",
    author: "牛津大学出版社",
    type: "teaching",
  },
  {
    file: "经典阅读/牛津书虫 英汉双语读物 137册/书虫·牛津英汉双语读物：6级全套.mobi",
    id: "novel-bookworm-6",
    title: "书虫·牛津英汉双语读物 6级",
    author: "牛津大学出版社",
    type: "teaching",
  },
  {
    file: "经典阅读/《自然》杂志百年物理经典 1869至今150年 (英汉对照版)/《自然》百年物理经典(英汉对照版)(全两册)麦克斯韦 爱因斯坦 霍金等.epub",
    id: "novel-nature-classics",
    title: "《自然》百年物理经典",
    author: "麦克斯韦 · 爱因斯坦 · 霍金 等",
    type: "teaching",
  },
];

// ---------- 莎士比亚全集 ----------
// MOBI 里的剧本标题混在每本书自己的目录页里，没有稳定结构；
// 强行切分会把导言、译后记和正文错配。这里保留完整全集一本，
// 由阅读器按“第X幕 / 第X场”自动生成目录。

async function buildShakespeare() {
  const file = path.join(
    SOURCE_ROOT,
    "经典阅读/莎士比亚全集（套装39本 英汉双语)/莎士比亚全集（套装39本 英汉双语).mobi",
  );
  console.log("Reading Shakespeare collection…");
  const text = await ebookToText(file);
  await writeBook({
    id: "novel-shakespeare",
    title: "莎士比亚全集（39 本 · 英汉双语）",
    author: "莎士比亚",
    text,
    source: path.basename(file),
    type: "teaching",
  });
}

// ---------- 双语译林 108 册：按目录拆成 108 本 ----------

async function buildShuangyu() {
  const file = path.join(
    SOURCE_ROOT,
    "经典阅读/双语译林文库 世界名著 108册/双语译林文库 世界名著(108册) 毛姆 海明威 麦卡勒斯 等.epub",
  );
  console.log("Reading 双语译林 108-volume EPUB…");
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const opfPath = "OEBPS/content.opf";
  const opf = await zip.file(opfPath)?.async("text");
  if (!opf) throw new Error("找不到 EPUB 的 content.opf");
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = tag.match(/\bid\s*=\s*"([^"]+)"/i)?.[1];
    const href = tag.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1];
    if (id && href) manifest.set(id, href.replace(/^\.\//, ""));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref\s*=\s*"([^"]+)"/gi)]
    .map((match) => manifest.get(match[1]))
    .filter(Boolean);
  const spineIndex = new Map();
  spine.forEach((href, index) => {
    spineIndex.set(href, index);
    spineIndex.set(path.posix.basename(href), index);
  });

  const tocFile = "OEBPS/Text/part0000.xhtml";
  const toc = await zip.file(tocFile)?.async("text");
  if (!toc) throw new Error("找不到总目录");
  const volumes = [...toc.matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (match) => ({
      href: match[1].split("#")[0],
      title: stripTags(match[2]),
    }),
  );
  if (!volumes.length) throw new Error("总目录里没有书名");
  console.log(`Found ${volumes.length} volumes`);
  // 合集里与单本重复的书不再重复入库（例如《简爱》）。
  const standaloneTitles = new Set(
    singles
      .filter((spec) => spec.file.endsWith(".txt"))
      .map((spec) => spec.title.replace(/\s+/g, "").toLowerCase()),
  );
  const existing = new Set(
    books.map((book) => book.title.replace(/\s+/g, "").toLowerCase()),
  );

  for (let index = 0; index < volumes.length; index += 1) {
    const volume = volumes[index];
    const normalizedTitle = volume.title.replace(/\s+/g, "").toLowerCase();
    if (standaloneTitles.has(normalizedTitle) || existing.has(normalizedTitle)) {
      console.log(`= Skip duplicate: ${volume.title}`);
      continue;
    }
    existing.add(normalizedTitle);
    const start = spineIndex.get(volume.href);
    const next = volumes[index + 1]?.href;
    const end = next != null ? spineIndex.get(next) : spine.length;
    if (start == null) {
      console.warn(`Missing spine entry: ${volume.href}`);
      continue;
    }
    const parts = [];
    for (let at = start; at < (end ?? spine.length); at += 1) {
      const entry = zip.file(`OEBPS/${spine[at]}`);
      if (!entry) continue;
      const html = await entry.async("text");
      if (!html) continue;
      const body = htmlToText(html);
      if (body.replace(/\s/g, "").length >= 20) parts.push(body);
    }
    await writeBook({
      id: `novel-shuangyu-${String(index + 1).padStart(3, "0")}-${slug(volume.title)}`,
      title: volume.title,
      author: "双语译林文库",
      text: parts.join("\n\n"),
      source: path.basename(file),
      type: "teaching",
      language: "zh",
    });
  }
}

async function main() {
  for (const spec of singles) {
    const file = path.join(SOURCE_ROOT, spec.file);
    try {
      await fs.access(file);
    } catch (error) {
      console.warn(`Missing source: ${spec.file}`);
      continue;
    }
    console.log(`Reading ${spec.file}…`);
    const text = await ebookToText(file);
    await writeBook({
      id: spec.id,
      title: spec.title,
      author: spec.author,
      text,
      source: spec.file.split("/").pop(),
      type: spec.type || "ebook",
    });
  }
  await buildShakespeare();
  await buildShuangyu();

  const payload = {
    meta: {
      source: "用户提供的小说与经典阅读资料",
      count: books.length,
      generatedAt: new Date().toISOString(),
    },
    books,
  };
  await fs.writeFile(
    path.join(outputRoot, "preloaded-novels-library.js"),
    `window.PRELOADED_NOVELS_LIBRARY = ${JSON.stringify(payload)};\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        books: books.length,
        textAssets: books.length,
        pageTotal,
        charTotal,
        megabytes: +(charTotal / 1024 / 1024).toFixed(1),
        outputRoot,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});