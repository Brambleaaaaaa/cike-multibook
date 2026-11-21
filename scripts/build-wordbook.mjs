import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  root,
  "data",
  "source",
  "cet_beyond_ks3000.exa.txt",
);
const outputPath = path.join(root, "data", "words.js");
const jsonPath = path.join(root, "data", "words.json");
const csvPath = path.join(root, "data", "cet6-core-2000.csv");
const TARGET_WORDS = 2000;

function readJsonAfterHeading(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("No JSON object found in source file.");
  return JSON.parse(raw.slice(start));
}

function uniqueByWord(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = String(entry["单词"] || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const sourceRoot = readJsonAfterHeading(
  await readFile(sourcePath, "utf8"),
);
const sourceWords = sourceRoot[Object.keys(sourceRoot)[0]];

if (!Array.isArray(sourceWords) || sourceWords.length < TARGET_WORDS) {
  throw new Error("The source word list is missing or incomplete.");
}

const byFrequency = (a, b) =>
  Number(b["词频"] || 0) - Number(a["词频"] || 0) ||
  Number(a["原序号"] || 0) - Number(b["原序号"] || 0);

const syllabusWords = uniqueByWord(
  sourceWords.filter((entry) => entry["六级"] === "★"),
).sort(byFrequency);

const b2Words = uniqueByWord(
  sourceWords.filter(
    (entry) => entry["六级"] !== "★" && entry["CEFR等级"] === "B2",
  ),
).sort(byFrequency);

const relevanceSupplement = uniqueByWord(
  sourceWords.filter(
    (entry) =>
      entry["六级"] !== "★" &&
      entry["CEFR等级"] !== "B2" &&
      (entry["学术词汇"] || entry["高级词汇"]),
  ),
).sort(
  (a, b) =>
    Number(Boolean(b["高级词汇"])) - Number(Boolean(a["高级词汇"])) ||
    Number(Boolean(b["学术词汇"])) - Number(Boolean(a["学术词汇"])) ||
    Number(b["综合得分"] || 0) - Number(a["综合得分"] || 0) ||
    byFrequency(a, b),
);

const frequencySupplement = uniqueByWord(
  sourceWords.filter(
    (entry) =>
      entry["六级"] !== "★" &&
      entry["CEFR等级"] !== "B2",
  ),
).sort(
  (a, b) =>
    Number(b["词频"] || 0) - Number(a["词频"] || 0) ||
    Number(b["综合得分"] || 0) - Number(a["综合得分"] || 0),
);

const selected = uniqueByWord([
  ...syllabusWords,
  ...b2Words,
  ...relevanceSupplement,
  ...frequencySupplement,
])
  .slice(0, TARGET_WORDS)
  .sort(byFrequency);

if (selected.length !== TARGET_WORDS) {
  throw new Error(`Expected ${TARGET_WORDS} words, got ${selected.length}.`);
}

const listeningCategories = new Set([
  "人物身份与社会角色",
  "性格与品性",
  "情绪与情感",
  "心理态度与欲望",
  "动作行为",
  "手部动作",
  "移动、运输与位置变化(通用动词)",
  "交通、运输与车辆",
  "食物、饮料与饮食",
  "房间、家具与家居用品",
  "建筑、房屋与住所",
  "健康、疾病与医疗",
  "教育机构与设施",
  "学习、教学与考试",
  "管理、组织与职场行为",
  "商业、公司与经营",
  "金钱、银行与金融",
  "通讯、媒体与传播",
  "社交关系与互动",
  "时间、日期与时期",
  "空间、方向与位置",
  "旅行、休闲与运动",
  "购物、消费与服务",
]);

const readingCategories = new Set([
  "知识、学问与智慧",
  "科学、技术与发明",
  "经济、产业与财政",
  "社会、群体与制度",
  "政治、政府与制度",
  "文化、传统与习俗",
  "环境、生态与污染",
  "能源、资源与可持续发展",
  "教育机构与设施",
  "学习、教学与考试",
  "管理、组织与职场行为",
  "商业、公司与经营",
  "信念、观点与哲学思想",
  "语言、文字与符号",
  "法律、法规与司法",
  "通讯、媒体与传播",
  "农业、种植与畜牧",
  "工业、制造与工厂",
  "健康、疾病与医疗",
  "生物、动物与植物",
  "历史、地理与地理环境",
  "艺术、音乐与表演",
  "军事、战争与武器",
  "冲突、竞争与斗争",
  "犯罪、惩罚与监狱",
  "实验、研究与统计",
]);

const writingCategories = new Set([
  "抽象概念与泛指名词(其他)",
  "异同、相似与对比",
  "变化、发展与趋势",
  "原因、理由与根据",
  "结果、影响与后果",
  "数量、程度与范围",
  "整体、部分与组成",
  "信念、观点与哲学思想",
  "真伪、虚实与确定性",
  "缺点、问题与负面评价",
  "帮助、阻碍与影响",
  "领导、权力与服从",
  "政治、政府与制度",
  "经济、产业与财政",
  "社会、群体与制度",
  "文化、传统与习俗",
  "科学、技术与发明",
  "环境、生态与污染",
  "能源、资源与可持续发展",
  "教育机构与设施",
  "学习、教学与考试",
  "知识、学问与智慧",
  "商业、公司与经营",
  "法律、法规与司法",
  "冲突、竞争与斗争",
  "沟通、表达与说服",
]);

const writingSuffix =
  /(?:tion|sion|ity|ment|ness|ance|ence|ive|ous|al|ize|ise|ify)$/i;

function inferExamTags(entry) {
  const category = entry["分类名称"] || "";
  const frequency = Number(entry["词频"] || 0);
  const writingSignals =
    entry["学术词汇"] ||
    entry["高级词汇"] ||
    writingCategories.has(category) ||
    writingSuffix.test(entry["单词"] || "");

  const tags = [];
  if (
    frequency >= 20 ||
    listeningCategories.has(category)
  ) {
    tags.push("listening");
  }
  if (
    frequency >= 40 ||
    entry["学术词汇"] ||
    entry["高级词汇"] ||
    readingCategories.has(category)
  ) {
    tags.push("reading");
  }
  if (writingSignals) tags.push("writing");
  if (entry["六级"] === "★") tags.push("syllabus");
  if (frequency >= 40) tags.push("high-frequency");
  return [...new Set(tags)];
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

const words = selected.map((entry, index) => {
  const frequency = Number(entry["词频"] || 0);
  return {
    id: String(entry["单词"] || "").toLowerCase(),
    rank: index + 1,
    sourceRank: Number(entry["原序号"] || 0),
    word: cleanText(entry["单词"]),
    meaning: cleanText(entry["释义"]),
    frequency,
    band:
      frequency >= 100
        ? "高频"
        : frequency >= 40
          ? "常考"
          : frequency >= 10
            ? "进阶"
            : "拓展",
    cefr: entry["CEFR等级"] || "",
    category: entry["分类名称"] || "未分类",
    spellings: entry["其他拼写"] || null,
    academic: Boolean(entry["学术词汇"]),
    advanced: Boolean(entry["高级词汇"]),
    example: cleanText(entry["例句"]),
    exampleZh: cleanText(entry["例句翻译"]),
    exampleSource: cleanText(entry["例句来源"]),
    tags: inferExamTags(entry),
    unit: Math.ceil((index + 1) / 40),
  };
});

const tagCounts = words.reduce((counts, word) => {
  for (const tag of word.tags) counts[tag] = (counts[tag] || 0) + 1;
  return counts;
}, {});

const output = {
  meta: {
    title: "六级核心 2000 词",
    count: words.length,
    units: Math.ceil(words.length / 40),
    wordsPerUnit: 40,
    selection:
      "2016 版四六级大纲标注的六级词条，加上 B2 超课标词；若不足 2000，再按高级、学术词汇标记和真题词频补齐。",
    source:
      "exam-data/CETVocabulary · 四六级词汇词频排序数据",
    sourceUrl: "https://github.com/exam-data/CETVocabulary",
    license: "CC BY-NC-SA 4.0",
    syllabusWords: syllabusWords.length,
    b2SupplementWords: b2Words.length,
    relevanceSupplementWords: Math.max(
      0,
      words.length - syllabusWords.length - b2Words.length,
    ),
    tagCounts,
    generatedAt: new Date().toISOString(),
  },
  words,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `/* Generated by scripts/build-wordbook.mjs. Do not edit by hand. */\n` +
    `window.CET6_WORDS = ${JSON.stringify(output, null, 2)};\n`,
  "utf8",
);
await writeFile(jsonPath, JSON.stringify(output, null, 2), "utf8");

const csvColumns = [
  ["序号", (word) => word.rank],
  ["单词", (word) => word.word],
  ["中文释义", (word) => word.meaning],
  ["真题词频", (word) => word.frequency],
  ["频段", (word) => word.band],
  ["CEFR", (word) => word.cefr],
  ["分类", (word) => word.category],
  ["听力", (word) => (word.tags.includes("listening") ? "是" : "")],
  ["阅读", (word) => (word.tags.includes("reading") ? "是" : "")],
  ["写作", (word) => (word.tags.includes("writing") ? "是" : "")],
  ["六级大纲", (word) => (word.tags.includes("syllabus") ? "是" : "")],
  ["例句", (word) => word.example],
  ["例句翻译", (word) => word.exampleZh],
  ["单元", (word) => word.unit],
];

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

const csv = [
  csvColumns.map(([label]) => csvCell(label)).join(","),
  ...words.map((word) =>
    csvColumns.map(([, read]) => csvCell(read(word))).join(","),
  ),
].join("\r\n");
await writeFile(csvPath, `\ufeff${csv}\r\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: path.relative(root, outputPath),
      json: path.relative(root, jsonPath),
      csv: path.relative(root, csvPath),
      words: words.length,
      units: output.meta.units,
      tags: tagCounts,
      first: words.slice(0, 8).map((word) => word.word),
      last: words.slice(-8).map((word) => word.word),
    },
    null,
    2,
  ),
);
