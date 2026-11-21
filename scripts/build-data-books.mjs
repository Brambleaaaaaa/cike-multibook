import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [, , sourceDirArg, outputDirArg] = process.argv;
if (!sourceDirArg || !outputDirArg) {
  throw new Error("Usage: node build-data-books.mjs <source-dir> <output-dir>");
}

const sourceDir = path.resolve(sourceDirArg);
const outputDir = path.resolve(outputDirArg);
await mkdir(outputDir, { recursive: true });

const clean = (value) => String(value ?? "").trim();
const normalizeId = (prefix, value, index) =>
  `${prefix}-${String(value || index)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || index}`;

function buildCet6Attachment(document) {
  const blocks = document.blocks;
  const words = [];
  const phrases = [];
  let phraseCategory = "词组";

  for (const block of blocks) {
    if (block.type === "paragraph" && clean(block.text).endsWith("类")) {
      phraseCategory = clean(block.text);
      continue;
    }
    if (block.type !== "table" || !block.rows.length) continue;
    const header = block.rows[0].map(clean);

    if (header[0] === "序号" && header[1] === "单词") {
      for (const row of block.rows.slice(1)) {
        const sourceRank = Number(clean(row[0]));
        const word = clean(row[1]);
        if (!sourceRank || !word) continue;
        words.push({
          id: normalizeId("c6a", word, sourceRank),
          sourceRank,
          word,
          meaning: clean(row[2]),
          phonetic: "",
          example: "",
          exampleZh: "",
          category: "附件核心词汇",
          level: "",
          tags: ["vocabulary"],
          source: "六级1570词汇+短语.docx",
        });
      }
    } else if (header[0] === "词组") {
      for (const row of block.rows.slice(1)) {
        const phrase = clean(row[0]);
        if (!phrase) continue;
        phrases.push({
          id: normalizeId("c6p", phrase, phrases.length + 1),
          sourceRank: phrases.length + 1,
          word: phrase,
          meaning: clean(row[1]),
          phonetic: "",
          example: "",
          exampleZh: "",
          category: phraseCategory,
          level: "",
          tags: ["phrase"],
          source: "六级1570词汇+短语.docx",
          kind: "phrase",
        });
      }
    }
  }

  const entries = [...words, ...phrases].map((entry, index) => ({
    ...entry,
    rank: index + 1,
    unit: Math.ceil((index + 1) / 40),
  }));

  return {
    meta: {
      id: "cet6-attachment-1570",
      title: "六级 1570 词 + 短语",
      subtitle: "附件原表逐项导入",
      language: "en",
      level: "CET-6",
      count: entries.length,
      wordCount: words.length,
      phraseCount: phrases.length,
      units: Math.ceil(entries.length / 40),
      unitSize: 40,
      filters: [
        { id: "all", label: "全部" },
        { id: "vocabulary", label: "核心词" },
        { id: "phrase", label: "语境词组" },
      ],
      source:
        "用户提供的《六级1570词汇+短语.docx》；结构化结果保留全部 1466 个词条与 60 个词组。",
      sourceType: "attachment",
    },
    entries,
  };
}

function parseSqlRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("INSERT INTO `words` VALUES")) continue;
    const values = [];
    const valueText = line.slice(
      line.indexOf("VALUES") + "VALUES".length,
      line.lastIndexOf(");"),
    );
    const pattern = /'((?:''|\\.|[^'])*)'|(NULL)|(-?\d+(?:\.\d+)?)/g;
    let match;
    while ((match = pattern.exec(valueText))) {
      if (match[1] !== undefined) {
        values.push(
          match[1]
            .replace(/''/g, "'")
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\"),
        );
      } else if (match[2]) {
        values.push(null);
      } else {
        values.push(Number(match[3]));
      }
    }
    if (values.length >= 7) rows.push(values);
  }
  return rows;
}

function buildEnglish10k(text) {
  const allRows = parseSqlRows(text);
  const rows = allRows.slice(0, 10000);
  const entries = rows.map((row, index) => {
    const [sourceId, word, phonetic, pos, meaning, example, exampleZh] = row;
    const posGroup = /^(n|art|pron)/i.test(pos)
      ? "noun"
      : /^(v|aux)/i.test(pos)
        ? "verb"
        : /^(adj|adv)/i.test(pos)
          ? "descriptive"
          : "other";
    return {
      id: normalizeId("en10k", word, sourceId),
      sourceRank: index + 1,
      rank: index + 1,
      unit: Math.ceil((index + 1) / 100),
      word: clean(word),
      meaning: `${clean(pos)} ${clean(meaning)}`.trim(),
      phonetic: clean(phonetic),
      example: clean(example),
      exampleZh: clean(exampleZh),
      category: clean(pos) || "英语扩展",
      level: "扩展",
      tags: [posGroup, "reading"],
      source: "Leezed525/EnglishDataBase · 10000+英语单词数据库",
    };
  });

  return {
    meta: {
      id: "english-10000",
      title: "英语万词扩展",
      subtitle: "10,000 个带音标、词性、释义和例句的扩展词",
      language: "en",
      level: "扩展",
      count: entries.length,
      units: Math.ceil(entries.length / 100),
      unitSize: 100,
      filters: [
        { id: "all", label: "全部" },
        { id: "noun", label: "名词" },
        { id: "verb", label: "动词" },
        { id: "descriptive", label: "形容词 / 副词" },
        { id: "other", label: "其他" },
      ],
      source: "Leezed525/EnglishDataBase · words.sql",
      sourceType: "open-data",
      sourceCount: allRows.length,
    },
    entries,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function levelFromFrenchRank(rank) {
  if (rank <= 1000) return "A1";
  if (rank <= 2000) return "A2";
  if (rank <= 3000) return "B1";
  return "B2";
}

function buildFrench(text) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith("rank,word_fr"));
  if (headerIndex < 0) throw new Error("French CSV header not found.");
  const rows = parseCsv(lines.slice(headerIndex).join("\n"));
  const entries = rows
    .slice(1)
    .map((row, index) => {
      const [rank, word, english, tag, phrase, phraseEnglish] = row;
      const sourceRank = Number(rank) || index + 1;
      return {
        id: normalizeId("fr", word, sourceRank),
        sourceRank,
        rank: sourceRank,
        unit: Math.ceil(sourceRank / 50),
        word: clean(word),
        meaning: clean(english),
        phonetic: "",
        example: clean(phrase),
        exampleZh: clean(phraseEnglish),
        category: clean(tag) || "French",
        level: levelFromFrenchRank(sourceRank),
        tags: [levelFromFrenchRank(sourceRank)],
        source:
          "renamedquery French 5000 list; frequency/forms derived from Lexique",
      };
    })
    .filter((entry) => entry.word)
    .sort((a, b) => a.sourceRank - b.sourceRank);

  const counts = entries.reduce((result, entry) => {
    result[entry.level] = (result[entry.level] || 0) + 1;
    return result;
  }, {});

  return {
    meta: {
      id: "french-a1-b2",
      title: "法语 A1 → B2",
      subtitle: "按词频梯度递增：A1 前 1000，A2 次 1000，B1 再 1000，B2 后 2000",
      language: "fr",
      level: "A1–B2",
      count: entries.length,
      units: Math.ceil(entries.length / 50),
      unitSize: 50,
      levelCounts: counts,
      filters: [
        { id: "all", label: "全部" },
        { id: "A1", label: "A1" },
        { id: "A2", label: "A2" },
        { id: "B1", label: "B1" },
        { id: "B2", label: "B2" },
      ],
      source: "renamedquery/5000 French frequency list",
      sourceType: "open-data",
    },
    entries,
  };
}

function buildWritingCorpus(document) {
  const pages = document.pages.map((page) => ({
    page: page.page,
    lines: page.lines,
  }));
  return {
    meta: {
      id: "cet6-writing-206",
      title: "六级写译 206 语料库",
      subtitle: "用户提供的 PDF 原文，按 55 页完整保留",
      pageCount: pages.length,
      source:
        "用户提供的《六级写译206 复旦学长语料库（最新版）(3).pdf》",
      sourceType: "attachment",
    },
    pages,
  };
}

const [cetAttachment, englishSql, frenchCsv, writingPdf] = await Promise.all([
  readFile(path.join(sourceDir, "cet6_1570.json"), "utf8").then(JSON.parse),
  readFile(path.join(sourceDir, "english_10k_exa.txt"), "utf8"),
  readFile(path.join(sourceDir, "french_5000_exa.txt"), "utf8"),
  readFile(path.join(sourceDir, "cet6_writing_206.json"), "utf8").then(
    JSON.parse,
  ),
]);

const cetBook = buildCet6Attachment(cetAttachment);
const englishBook = buildEnglish10k(englishSql);
const frenchBook = buildFrench(frenchCsv);
const writingCorpus = buildWritingCorpus(writingPdf);

await writeFile(
  path.join(outputDir, "book-cet6-attachment.js"),
  `window.CIKE_CET6_ATTACHMENT = ${JSON.stringify(cetBook)};\n`,
  "utf8",
);
await writeFile(
  path.join(outputDir, "book-en-10000.js"),
  `window.CIKE_EN_10000 = ${JSON.stringify(englishBook)};\n`,
  "utf8",
);
await writeFile(
  path.join(outputDir, "book-fr-a1-b2.js"),
  `window.CIKE_FR_A1_B2 = ${JSON.stringify(frenchBook)};\n`,
  "utf8",
);
await writeFile(
  path.join(outputDir, "writing-corpus.js"),
  `window.CIKE_WRITING_CORPUS = ${JSON.stringify(writingCorpus)};\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      cet6Attachment: {
        total: cetBook.entries.length,
        words: cetBook.meta.wordCount,
        phrases: cetBook.meta.phraseCount,
      },
      english: {
        selected: englishBook.entries.length,
        sourceRows: englishBook.meta.sourceCount,
      },
      french: {
        total: frenchBook.entries.length,
        levels: frenchBook.meta.levelCounts,
      },
      writing: {
        pages: writingCorpus.pages.length,
        lines: writingCorpus.pages.reduce(
          (sum, page) => sum + page.lines.length,
          0,
        ),
      },
      outputDir,
    },
    null,
    2,
  ),
);
