import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require(
  "D:/CodexData/RuntimeCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip",
);

const TEXT_LABELS = ["utf-8", "gb18030", "big5", "windows-1252"];

function decodeWithLabel(bytes, label) {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch (error) {
    return null;
  }
}

function replacementRatio(text) {
  const bad = (text.match(/\uFFFD/g) || []).length;
  return text.length ? bad / text.length : 1;
}

export function decodeBest(bytes) {
  for (const label of TEXT_LABELS) {
    const text = decodeWithLabel(bytes, label);
    if (text != null && replacementRatio(text) < 0.002) return text;
  }
  return decodeWithLabel(bytes, "utf-8") ?? new TextDecoder().decode(bytes);
}

function cjk(ch) {
  return /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch);
}

/**
 * 把 HTML 里的块级标签还原成段落。MOBI 的书籍正文全部是 HTML，
 * 直接去标签会把一章挤成一行，后续分页、分段翻译都会失效。
 */
export function htmlToText(html) {
  let text = String(html || "");
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<mbp:pagebreak[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article|table|ul|ol|pre)>/gi, "\n\n")
    .replace(/<(p|div|h[1-6]|li|blockquote|tr|section|article|table|ul|ol|pre)(\s[^>]*)?>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (error) {
        return " ";
      }
    })
    .replace(/&#(\d+);/g, (match, value) => {
      try {
        return String.fromCodePoint(Number(value));
      } catch (error) {
        return " ";
      }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\u0000/g, "");

  return normalizeParagraphs(text);
}

export function normalizeParagraphs(input) {
  const normalized = String(input || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  // 中文 TXT 常用“一行一段”，没有空行。此时按空行切会把整本书挤成一段，
  // 需要看空行密度决定按行还是按空行分段。
  const rawLines = normalized.split("\n").map((line) => line.trim());
  const nonEmptyLines = rawLines.filter(Boolean);
  const blankLines = rawLines.length - nonEmptyLines.length;
  const lineMode =
    nonEmptyLines.length > 30 && blankLines / nonEmptyLines.length < 0.35;
  const blocks = lineMode ? nonEmptyLines : normalized.split(/\n{2,}/);
  const output = [];
  for (const raw of blocks) {
    const lines = raw
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean);
    if (!lines.length) continue;
    let paragraph = "";
    for (const line of lines) {
      if (!paragraph) {
        paragraph = line;
        continue;
      }
      const left = paragraph[paragraph.length - 1] || "";
      const right = line[0] || "";
      paragraph += cjk(left) || cjk(right) ? line : ` ${line}`;
    }
    paragraph = paragraph.replace(/\s+/g, " ").trim();
    if (!paragraph) continue;
    // 页码、纯符号行、仅剩的锚点文字对阅读没有价值。
    if (paragraph.length <= 3 && !/[\u4e00-\u9fffA-Za-z]{2}/.test(paragraph)) continue;
    if (/^(page\s*)?\d{1,4}$/i.test(paragraph)) continue;
    output.push(paragraph);
  }
  return output.join("\n\n");
}

export async function readPlainText(file) {
  const bytes = await fs.readFile(file);
  return normalizeParagraphs(decodeBest(bytes));
}

function palmDocDecompress(data, expectedSize) {
  const output = [];
  let index = 0;
  while (index < data.length) {
    const value = data[index++];
    if (value === 0) {
      output.push(0);
    } else if (value <= 8) {
      for (let count = 0; count < value && index < data.length; count += 1) {
        output.push(data[index++]);
      }
    } else if (value <= 0x7f) {
      output.push(value);
    } else if (value <= 0xbf) {
      if (index >= data.length) break;
      const second = data[index++];
      const pair = (value << 8) | second;
      const distance = (pair >> 3) & 0x7ff;
      const length = (pair & 0x07) + 3;
      if (!distance || distance > output.length) {
        // 损坏的回指距离：补零避免整段文本移位。
        for (let count = 0; count < length; count += 1) output.push(0);
      } else {
        for (let count = 0; count < length; count += 1) {
          output.push(output[output.length - distance]);
        }
      }
    } else {
      output.push(32);
      output.push(value ^ 0x80);
    }
    if (expectedSize && output.length >= expectedSize) {
      // 文本记录的有效正文就是 recordSize 字节；尾部是压缩器附加数据。
      output.length = expectedSize;
      break;
    }
  }
  return Buffer.from(output);
}

function recordOffsets(buffer, count) {
  const offsets = [];
  for (let index = 0; index < count; index += 1) {
    offsets.push(buffer.readUInt32BE(78 + index * 8));
  }
  offsets.push(buffer.length);
  return offsets;
}

export async function mobiToHtml(file) {
  const buffer = await fs.readFile(file);
  if (buffer.length < 100 || buffer.toString("latin1", 60, 68) !== "BOOKMOBI") {
    throw new Error("不是有效的 MOBI/AZW3 文件。");
  }
  const numRecords = buffer.readUInt16BE(76);
  const offsets = recordOffsets(buffer, numRecords);
  const record0 = buffer.subarray(offsets[0], offsets[1]);
  const compression = record0.readUInt16BE(0);
  const encryption = record0.readUInt16BE(12);
  if (encryption !== 0) throw new Error("这本书带 DRM 加密，暂时无法读取正文。");
  const recordSize = record0.readUInt16BE(10) || 4096;
  const mobiIndex = record0.indexOf(Buffer.from("MOBI"));
  if (mobiIndex < 0) throw new Error("MOBI 头缺失。");
  const encoding = record0.readUInt32BE(mobiIndex + 0x0c);
  const firstNonBook = record0.readUInt32BE(mobiIndex + 0x40);
  const textLength = record0.readUInt32BE(4);
  const textRecords = Math.min(firstNonBook - 1, numRecords - 1);
  if (compression === 17480) {
    throw new Error("这本书使用 HUFF/CDIC 压缩（常见于 AZW3），暂不支持。");
  }
  if (compression !== 1 && compression !== 2) {
    throw new Error(`未知的 MOBI 压缩方式 ${compression}。`);
  }
  const chunks = [];
  let total = 0;
  for (let index = 1; index <= textRecords && total < textLength; index += 1) {
    const raw = buffer.subarray(offsets[index], offsets[index + 1]);
    const data = compression === 2 ? palmDocDecompress(raw, recordSize) : raw;
    const slice = data.subarray(0, Math.min(recordSize, data.length));
    chunks.push(slice);
    total += slice.length;
  }
  let bytes = Buffer.concat(chunks);
  if (textLength && bytes.length > textLength) bytes = bytes.subarray(0, textLength);
  const label = encoding === 65001 ? "utf-8" : encoding === 1252 ? "windows-1252" : "utf-8";
  return new TextDecoder(label).decode(bytes);
}

export async function mobiToText(file) {
  return htmlToText(await mobiToHtml(file));
}

function resolveHref(baseFile, href) {
  const decoded = decodeURIComponent(href.split("#")[0]);
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), decoded));
}

function readAttribute(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1] || "";
}

async function epubSpine(zip) {
  try {
    const container = await zip.file("META-INF/container.xml")?.async("text");
    if (!container) return null;
    const rootfile = container.match(/<rootfile[^>]*full-path\s*=\s*"([^"]+)"/i)?.[1];
    if (!rootfile) return null;
    const opf = await zip.file(rootfile)?.async("text");
    if (!opf) return null;
    const manifest = new Map();
    for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
      const tag = match[0];
      const id = readAttribute(tag, "id");
      const href = readAttribute(tag, "href");
      if (id && href) manifest.set(id, resolveHref(rootfile, href));
    }
    const order = [];
    for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
      const idref = readAttribute(match[0], "idref");
      const target = manifest.get(idref);
      if (target) order.push(target);
    }
    return order.length ? order : null;
  } catch (error) {
    return null;
  }
}

export async function epubToText(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const spine = await epubSpine(zip);
  const names = spine ||
    Object.keys(zip.files)
      .filter((name) => /\.x?html?$/i.test(name))
      .filter((name) => !/(^|\/)(nav|toc|cover|titlepage)\.x?html?$/i.test(name))
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const sections = [];
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const html = await entry.async("text");
    if (!html) continue;
    const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
    const title = htmlToText(heading || "").split("\n")[0] || "";
    const body = htmlToText(html);
    if (!body.replace(/\s/g, "").length) continue;
    // 章节标题单独成段，阅读器的自动目录才能识别。
    sections.push(title && !body.startsWith(title) ? `${title}\n\n${body}` : body);
  }
  return normalizeParagraphs(sections.join("\n\n"));
}

export async function ebookToText(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".txt" || extension === ".md") return readPlainText(file);
  if (extension === ".epub") return epubToText(file);
  if (extension === ".mobi" || extension === ".azw3" || extension === ".azw") {
    return mobiToText(file);
  }
  throw new Error(`不支持的电子书格式：${extension}`);
}