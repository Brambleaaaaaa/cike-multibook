import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , indexArg, rawDirArg, outputDirArg] = process.argv;
if (!indexArg || !rawDirArg || !outputDirArg) {
  throw new Error(
    "Usage: node build-typewords-offline.mjs <index.json> <raw-dir> <output-dir>",
  );
}

const index = JSON.parse(await readFile(path.resolve(indexArg), "utf8"));
const rawDir = path.resolve(rawDirArg);
const outputDir = path.resolve(outputDirArg);
await mkdir(outputDir, { recursive: true });
const files = new Set(await readdir(rawDir));
const dictionary = Object.create(null);
const catalogBooks = [];
let totalReferences = 0;

function safeFilename(id) {
  return `${String(id).replaceAll(/[\\/:*?"<>|]/g, "_")}.json`;
}

function compactMeaning(trans) {
  if (!Array.isArray(trans)) return "";
  return trans
    .map((item) => {
      if (typeof item === "string") return item;
      const pos = String(item?.pos || item?.type || "").trim();
      const cn = String(item?.cn || item?.translation || "").trim();
      return `${pos ? `${pos} ` : ""}${cn}`.trim();
    })
    .filter(Boolean)
    .join("；");
}

function compactPairs(items, englishKey, chineseKey) {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 4)
    .map((item) => [
      String(item?.[englishKey] || item?.c || item?.sentence || "").trim(),
      String(item?.[chineseKey] || item?.cn || item?.translation || "").trim(),
    ])
    .filter(([english]) => english);
}

for (let bookIndex = 0; bookIndex < index.length; bookIndex++) {
  const sourceBook = index[bookIndex];
  const filename = safeFilename(sourceBook.id);
  if (!files.has(filename)) {
    console.warn(`Missing raw wordbook ${sourceBook.id}`);
    continue;
  }
  const rawWords = JSON.parse(await readFile(path.join(rawDir, filename), "utf8"));
  const wordIds = [];
  const seenInBook = new Set();

  for (const rawWord of rawWords) {
    const word = String(rawWord?.word || "").trim();
    if (!word) continue;
    const key = word.toLocaleLowerCase("en-US");
    if (seenInBook.has(key)) continue;
    seenInBook.add(key);
    wordIds.push(key);

    if (!dictionary[key]) {
      dictionary[key] = {
        w: word,
        p0: String(rawWord.phonetic0 || "").trim(),
        p1: String(rawWord.phonetic1 || "").trim(),
        m: compactMeaning(rawWord.trans),
        s: compactPairs(rawWord.sentences, "c", "cn"),
        ph: compactPairs(rawWord.phrases, "c", "cn"),
      };
    }
  }

  totalReferences += wordIds.length;
  catalogBooks.push({
    id: String(sourceBook.id),
    name: String(sourceBook.name || sourceBook.id),
    description: String(sourceBook.description || ""),
    category: String(sourceBook.category || "其他"),
    tags: Array.isArray(sourceBook.tags) ? sourceBook.tags.map(String) : [],
    language: sourceBook.language || "en",
    translateLanguage: sourceBook.translateLanguage || "zh-CN",
    count: wordIds.length,
    words: wordIds,
  });

  if ((bookIndex + 1) % 20 === 0 || bookIndex + 1 === index.length) {
    console.log(
      `Prepared ${bookIndex + 1}/${index.length} wordbooks, ${Object.keys(dictionary).length} unique words`,
    );
  }
}

const catalog = {
  meta: {
    source: "zyronon/TypeWords",
    sourceUrl: "https://github.com/zyronon/TypeWords",
    resourceUrl: "https://files.typewords.cc/list/word.json",
    license: "GPL-3.0 for TypeWords; source word data belongs to its respective sources",
    bookCount: catalogBooks.length,
    uniqueWords: Object.keys(dictionary).length,
    totalReferences,
    downloadedAt: new Date().toISOString(),
  },
  books: catalogBooks,
};

await writeFile(
  path.join(outputDir, "typewords-catalog.js"),
  `window.TYPEWORDS_CATALOG = ${JSON.stringify(catalog)};\n`,
  "utf8",
);
await writeFile(
  path.join(outputDir, "typewords-dictionary.js"),
  `window.TYPEWORDS_DICTIONARY = ${JSON.stringify(dictionary)};\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      books: catalogBooks.length,
      uniqueWords: Object.keys(dictionary).length,
      totalReferences,
      outputDir,
    },
    null,
    2,
  ),
);
