import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

const DIR = ".cache/wordbank";
const read = (name) => {
  const file = path.join(DIR, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
};

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/* 判断语法词时忽略首尾撇号等标点（l' → l）。 */
const stopKey = (value) =>
  normalizeKey(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/* ---------- IPA ---------- */
function loadIpa(name) {
  const text = read(name);
  const exact = new Map();
  const lowerOnly = new Map();
  if (!text) {
    return { size: 0, get: () => "" };
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const rawWord = line.slice(0, tab).trim();
    const word = normalizeKey(rawWord);
    const rest = line.slice(tab + 1).trim();
    const match = rest.match(/\/([^/]+)\//);
    if (!word || !match) continue;
    const phonetic = `/${match[1].trim()}/`;
    if (!exact.has(rawWord)) exact.set(rawWord, phonetic);
    // 只收全小写的行，避免德语 "Die"(英语借词) 覆盖 "die"。
    if (rawWord === rawWord.toLowerCase() && !lowerOnly.has(word)) {
      lowerOnly.set(word, phonetic);
    }
  }
  return {
    size: lowerOnly.size,
    get(value) {
      const raw = String(value || "").trim();
      return exact.get(raw) || lowerOnly.get(normalizeKey(raw)) || "";
    },
  };
}

function loadWikipron(name) {
  const text = read(name);
  const best = new Map();
  if (!text) return { size: 0, get: () => "" };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [word, phon] = line.split("\t");
    if (!word || !phon) continue;
    if (/[‿<>]/.test(phon)) continue;
    const phones = phon.trim().split(/\s+/).filter(Boolean);
    if (!phones.length) continue;
    const key = normalizeKey(word);
    if (!key) continue;
    const current = best.get(key);
    // WikiPron 同一词会有残缺行（non = "n"），取音素最多的那条。
    if (!current || phones.length > current.count) {
      best.set(key, { count: phones.length, ipa: `/${phones.join("")}/` });
    }
  }
  return {
    size: best.size,
    get(value) {
      const row = best.get(normalizeKey(value));
      return row ? row.ipa : "";
    },
  };
}

/* ---------- frequency lists ---------- */
function loadFrequency(name) {
  const text = read(name);
  if (!text) return [];
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const word = parts[0];
    const count = Number(parts[1]) || 0;
    if (!word) continue;
    rows.push({ word, count });
  }
  return rows;
}

function loadTsvFrequency(name) {
  const text = read(name);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 2 && parts[0])
    .map((parts) => ({ word: parts[0].trim(), count: Number(parts[1]) || 0 }));
}

/* ---------- token filters ---------- */
const BAD_WORDS = new Set(["屌", "撚", "鳩", "柒", "閪", "仆街", "扑街", "on9", "on99"]);

function validLatinToken(word) {
  const value = String(word || "").trim();
  if (value.length < 2 || value.length > 28) return false;
  if (!/^[\p{L}][\p{L}\p{M}'’ -]*$/u.test(value)) return false;
  if (/\s{2,}/.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false;
  return true;
}

function validJapanese(word) {
  const value = String(word || "").trim();
  if (!value || value.length > 12) return false;
  if (/[。、！？…「」『』（）()【】〈〉《》・〜~:：;；/\\|]/.test(value)) return false;
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return false;
  // 纯平假名多半是助词/词尾片段，除非长度 >= 2 且不是常见助词
  const particles = new Set(["の", "に", "は", "を", "が", "で", "と", "も", "や", "から", "まで", "より", "へ", "ね", "よ", "な", "か", "て", "た", "だ", "です", "ます"]);
  if (particles.has(value)) return false;
  return true;
}

function validCantonese(word) {
  const value = String(word || "").trim();
  if (!value || value.length > 8) return false;
  if (BAD_WORDS.has(value.toLowerCase())) return false;
  if (/[，。！？、：；（）「」『』…]/.test(value)) return false;
  if (!/^[\p{Script=Han}A-Za-z0-9]+$/u.test(value)) return false;
  return true;
}

/* ---------- output ---------- */
function writeBook(file, globalName, book) {
  const payload = `window.${globalName} = ${JSON.stringify(book)};`;
  fs.writeFileSync(file, payload);
  console.log(
    `${file}: ${book.entries.length} entries, ${(Buffer.byteLength(payload) / 1024 / 1024).toFixed(2)}MB`,
  );
}

const unitFor = (index, size = 50) => Math.floor(index / size) + 1;

function buildFromFreq({
  id,
  title,
  subtitle,
  language,
  level,
  file,
  globalName,
  freqFile,
  ipa,
  limit,
  tags,
  source,
  license,
  validator = validLatinToken,
}) {
  const freq = loadFrequency(freqFile);
  if (!freq.length) {
    console.log(`skip ${id}: missing ${freqFile}`);
    return;
  }
  if (!ipa.size) {
    console.log(`skip ${id}: missing IPA`);
    return;
  }
  const seen = new Set();
  const entries = [];
  for (const row of freq) {
    if (entries.length >= limit) break;
    const word = row.word.trim();
    if (!validator(word)) continue;
    const key = normalizeKey(word);
    if (seen.has(key)) continue;
    const phonetic = ipa.get(key) || "";
    if (!phonetic) continue;
    seen.add(key);
    const index = entries.length;
    entries.push({
      id: `${id}-${index + 1}`,
      word,
      phonetic,
      meaning: "",
      pos: "",
      rank: index + 1,
      unit: unitFor(index),
      level,
      band: level,
      tags: [language, ...tags],
      source,
    });
  }
  if (!entries.length) {
    console.log(`skip ${id}: no entries after filtering`);
    return;
  }
  writeBook(file, globalName, {
    meta: {
      id,
      title,
      subtitle,
      language,
      level,
      unitSize: 50,
      count: entries.length,
      filters: [
        { id: "all", label: "全部" },
        { id: level, label: level },
      ],
      source,
      license,
      sourceType: "open-data",
      lightEntries: true,
    },
    entries,
  });
}

/* ---------- 1. French: fill IPA + extend to C1/C2 ---------- */
function buildFrench() {
  const bookPath = "book-fr-a1-b2.js";
  if (!fs.existsSync(bookPath)) return;
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(bookPath, "utf8"), ctx);
  const old = ctx.window.CIKE_FR_A1_B2;
  // 允许重复执行：已经扩过一次就只取 A1–B2 的原始 5000 条作为基底。
  const baseEntries = old.entries.slice(0, 5000);
  const ipa = loadIpa("fr_FR.txt");
  console.log("fr IPA entries", ipa.size);

  let filled = 0;
  for (const entry of baseEntries) {
    if (entry.phonetic) continue;
    const phonetic = ipa.get(normalizeKey(entry.word));
    if (phonetic) {
      entry.phonetic = phonetic;
      filled += 1;
    }
  }

  // Lexique382 只取 lemma 行，按影视+书籍词频排序，跳过前 5000 个 lemma。
  const lexique = read("Lexique382.tsv.gz");
  const extra = [];
  if (lexique) {
    const text = zlib
      .gunzipSync(fs.readFileSync(path.join(DIR, "Lexique382.tsv.gz")))
      .toString("utf8");
    const lines = text.split(/\r?\n/);
    const head = lines[0].split("\t");
    const col = (name) => head.indexOf(name);
    const seen = new Set();
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i]) continue;
      const f = lines[i].split("\t");
      if (f[col("islem")] !== "1") continue;
      const lemma = (f[col("lemme")] || "").trim();
      const key = normalizeKey(lemma);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      extra.push({
        lemma,
        cat: f[col("cgram")] || "",
        freq:
          Number(f[col("freqlemfilms2")] || 0) + Number(f[col("freqlemlivres")] || 0),
      });
    }
    extra.sort((a, b) => b.freq - a.freq);
  }
  const oldKeys = new Set(baseEntries.map((e) => normalizeKey(e.word)));
  // 冠词、代词、介词、连词等语法词已经由 A1–B2 覆盖，
  // 只是词形不同（le/la/les），不该占用 C1/C2 名额。
  const FR_STOP = new Set(
    (
      "le la les un une des du de d l au aux a à et ou mais donc or ni car si ne pas plus moins tres très " +
      "que qui quoi dont ou où quand comme ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos " +
      "leur leurs je tu il elle on nous vous ils elles me te se moi toi lui y en etre être avoir faire aller " +
      "tout tous toute toutes autre autres meme même aussi bien encore deja déjà toujours jamais rien personne " +
      "quelque quelques chaque plusieurs certain certains etc " +
      "quel quelle quels quelles est-ce celui celle ceux celles ca ça cela ceci ici la-bas voici"
    ).split(/\s+/),
  );
  const tails = extra
    .filter(
      (row) =>
        validLatinToken(row.lemma) &&
        !FR_STOP.has(stopKey(row.lemma)) &&
        !/^[\p{L}]['’]$/u.test(row.lemma.trim()) &&
        !/\s/.test(row.lemma.trim()) &&
        !oldKeys.has(stopKey(row.lemma)),
    )
    .map((row) => ({ ...row, phonetic: ipa.get(normalizeKey(row.lemma)) || "" }))
    .filter((row) => row.phonetic);

  const newEntries = [];
  let rank = 5001;
  for (const row of tails) {
    if (newEntries.length >= 4000) break;
    const level = newEntries.length < 2000 ? "C1" : "C2";
    const index = newEntries.length;
    newEntries.push({
      id: `fr-${level.toLowerCase()}-${index + 1}`,
      sourceRank: rank,
      rank,
      unit: Math.floor((baseEntries.length + index) / 50) + 1,
      word: row.lemma,
      meaning: "",
      phonetic: row.phonetic,
      pos: row.cat,
      category: row.cat,
      example: "",
      exampleZh: "",
      level,
      tags: [level],
      source: "Lexique382 lemmas; IPA from open-dict-data/ipa-dict fr_FR",
    });
    rank += 1;
  }

  const entries = [...baseEntries, ...newEntries];
  const levelCounts = { A1: 1000, A2: 1000, B1: 1000, B2: 2000, C1: 2000, C2: 2000 };
  writeBook(bookPath, "CIKE_FR_A1_B2", {
    meta: {
      ...old.meta,
      title: "法语 A1 → C2",
      subtitle: "A1–B2 为原有 5000 词，C1/C2 由 Lexique382 词元续补；全册补入 IPA 音标",
      level: "A1–C2",
      count: entries.length,
      units: Math.ceil(entries.length / 50),
      unitSize: 50,
      levelCounts,
      filters: [
        { id: "all", label: "全部" },
        ...Object.keys(levelCounts).map((id) => ({ id, label: id })),
      ],
      ipaFilled: filled,
      source: "renamedquery 5000 French list + Lexique382 + ipa-dict",
      license: "Mixed: see NOTICE-WORDBANK.md",
      sourceType: "open-data",
    },
    entries,
  });
  console.log(`fr: filled IPA ${filled}, added C1/C2 ${newEntries.length}`);
}

/* ---------- 2. English medical ---------- */
function buildMedical() {
  const text = read("medlexicon-words.js");
  if (!text) return;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    `${text}\nthis.__out = { CATEGORIES, GROUPS, RAW_WORDS };`,
    ctx,
  );
  const { CATEGORIES, GROUPS, RAW_WORDS } = ctx.__out;
  const entries = [];
  const seen = new Set();
  RAW_WORDS.forEach((row, index) => {
    const [word, phonetic, meaning, subject, group, note] = row;
    const value = String(word || "").trim();
    if (!value || seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    const subjectName = CATEGORIES?.[subject]?.name || CATEGORIES?.[subject] || subject || "";
    const groupName = GROUPS?.[group]?.name || GROUPS?.[group] || group || "";
    entries.push({
      id: `en-med-${index + 1}`,
      word: value,
      phonetic: String(phonetic || "").trim(),
      meaning: String(meaning || "").trim(),
      pos: "",
      rank: index + 1,
      unit: unitFor(index),
      level: subjectName,
      band: subjectName,
      category: subjectName,
      tags: ["medical", subject, group].filter(Boolean),
      note: String(note || "").trim(),
      source: "MedLexicon (MIT) · 医学英语 5203 词",
    });
  });
  if (!entries.length) return;
  const subjects = [...new Set(entries.map((e) => e.category))];
  writeBook("book-en-medical.js", "CIKE_EN_MEDICAL", {
    meta: {
      id: "english-medical",
      title: "医学英语 5203",
      subtitle: "12 个学科 · 211 个分组 · 音标 + 中文释义 + 词根记忆点",
      language: "en",
      level: "MED",
      count: entries.length,
      unitSize: 50,
      filters: [{ id: "all", label: "全部" }, ...subjects.map((s) => ({ id: s, label: s }))],
      source: "Erdd-chen/Medlexicon (MIT)",
      license: "MIT",
      sourceType: "open-data",
    },
    entries,
  });
}

/* ---------- 3. Latin ---------- */
function buildLatin() {
  const text = read("la_words.json");
  if (!text) return;
  const rows = JSON.parse(text);
  const entries = [];
  const seen = new Set();
  rows
    .slice()
    .sort((a, b) => (a.r || 99999) - (b.r || 99999))
    .forEach((row) => {
      if (entries.length >= Number(process.env.LA_LIMIT || 1000)) return;
      const raw = String(row.la || "").trim();
      const word = raw.split(",")[0].trim();
      if (!word || !validLatinToken(word)) return;
      const key = normalizeKey(word);
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        id: `la-${entries.length + 1}`,
        word,
        phonetic: "",
        meaning: String(row.en || "").trim(),
        pos: String(row.pos || ""),
        rank: entries.length + 1,
        unit: unitFor(entries.length),
        level: "CORE",
        band: "CORE",
        tags: ["latin"],
        note: raw,
        source: "Diederich Basic Vocabulary (CC BY-SA 3.0) via ericianni/latin-diederich-vocab",
      });
    });
  if (!entries.length) return;
  writeBook("book-la-core.js", "CIKE_LA_CORE", {
    meta: {
      id: "latin-core",
      title: "拉丁语基础词汇",
      subtitle: "Diederich 高频词表 · 英文释义 · 词形与词性",
      language: "la",
      level: "CORE",
      count: entries.length,
      unitSize: 50,
      filters: [{ id: "all", label: "全部" }, { id: "CORE", label: "核心" }],
      source: "Diederich Basic Vocabulary (CC BY-SA 3.0)",
      license: "CC BY-SA 3.0",
      sourceType: "open-data",
      lightEntries: true,
    },
    entries,
  });
}

/* ---------- 2. Japanese: JMdict 词形 + 假名读音 → IPA ---------- */
const KANA_MORA = {
  あ: "a", い: "i", う: "ɯ", え: "e", お: "o",
  か: "ka", き: "ki", く: "kɯ", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gɯ", げ: "ge", ご: "go",
  さ: "sa", し: "ɕi", す: "sɯ", せ: "se", そ: "so",
  ざ: "za", じ: "dʑi", ず: "zɯ", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "tɕi", つ: "tsɯ", て: "te", と: "to",
  だ: "da", ぢ: "dʑi", づ: "zɯ", で: "de", ど: "do",
  な: "na", に: "ɲi", ぬ: "nɯ", ね: "ne", の: "no",
  は: "ha", ひ: "çi", ふ: "ɸɯ", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bɯ", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pɯ", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mɯ", め: "me", も: "mo",
  や: "ja", ゆ: "jɯ", よ: "jo",
  ら: "ɾa", り: "ɾi", る: "ɾɯ", れ: "ɾe", ろ: "ɾo",
  わ: "ɰa", ゐ: "i", ゑ: "e", を: "o", ん: "ɴ", ゔ: "bɯ",
  ぁ: "a", ぃ: "i", ぅ: "ɯ", ぇ: "e", ぉ: "o",
  "ゃ": "ja", "ゅ": "jɯ", "ょ": "jo",
};

const KANA_COMBO = {
  きゃ: "kʲa", きゅ: "kʲɯ", きょ: "kʲo",
  ぎゃ: "gʲa", ぎゅ: "gʲɯ", ぎょ: "gʲo",
  しゃ: "ɕa", しゅ: "ɕɯ", しょ: "ɕo",
  じゃ: "dʑa", じゅ: "dʑɯ", じょ: "dʑo",
  ちゃ: "tɕa", ちゅ: "tɕɯ", ちょ: "tɕo",
  ぢゃ: "dʑa", ぢゅ: "dʑɯ", ぢょ: "dʑo",
  にゃ: "ɲa", にゅ: "ɲɯ", にょ: "ɲo",
  ひゃ: "ça", ひゅ: "çɯ", ひょ: "ço",
  びゃ: "bʲa", びゅ: "bʲɯ", びょ: "bʲo",
  ぴゃ: "pʲa", ぴゅ: "pʲɯ", ぴょ: "pʲo",
  みゃ: "mʲa", みゅ: "mʲɯ", みょ: "mʲo",
  りゃ: "ɾʲa", りゅ: "ɾʲɯ", りょ: "ɾʲo",
  ふぁ: "ɸa", ふぃ: "ɸi", ふぇ: "ɸe", ふぉ: "ɸo",
  てぃ: "ti", でぃ: "di", とぅ: "tɯ", どぅ: "dɯ",
  うぃ: "ɰi", うぇ: "ɰe", うぉ: "ɰo",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
};

function katakanaToHiragana(value) {
  return String(value || "").replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

function kanaToIpa(reading) {
  const kana = katakanaToHiragana(reading).replace(/[・\s]/g, "");
  let out = "";
  let geminate = false;
  let lastVowel = "";
  const vowelOf = (ipa) => (ipa.match(/[aiɯeo]/g) || []).pop() || "";
  for (let i = 0; i < kana.length; i += 1) {
    const pair = kana.slice(i, i + 2);
    const mora = KANA_COMBO[pair] || KANA_MORA[kana[i]] || "";
    if (KANA_COMBO[pair]) i += 1;
    if (kana[i] === "っ") {
      geminate = true;
      continue;
    }
    if (kana[i] === "ー") {
      out += "ː";
      continue;
    }
    if (!mora) continue;
    let piece = mora;
    if (kana[i] === "ん") {
      const next = kana.slice(i + 1, i + 3);
      const nextMora = KANA_COMBO[next] || KANA_MORA[kana[i + 1]] || "";
      const head = nextMora.charAt(0);
      piece = !head ? "ɴ" : "pmb".includes(head) ? "m" : "kgŋ".includes(head) ? "ŋ" : "ɴ";
    }
    if (geminate) {
      const head = piece.match(/^[^aeiɯo]/);
      if (head) piece = head[0] + piece;
      geminate = false;
    }
    out += piece;
    const vowel = vowelOf(piece);
    if (vowel) lastVowel = vowel;
  }
  return (
    out
      .replace(/oɯ/g, "oː")
      .replace(/ɯɯ/g, "ɯː")
      .replace(/ːː+/g, "ː") || (lastVowel ? lastVowel : "")
  );
}

/* 常用核心词白名单：语料词频表对动词/形容词覆盖不足，用最小白名单保证入门词不缺。 */
const JA_CORE = new Set(
  (
    "行く 見る 食べる 飲む 話す 聞く 読む 書く 買う 売る 待つ 会う 使う 作る 思う 言う 知る 分かる " +
    "出る 入る 来る する ある いる 帰る 起きる 寝る 座る 立つ 歩く 走る 泳ぐ 遊ぶ 笑う 泣く 働く " +
    "休む 住む 持つ 取る 置く 開ける 閉める 教える 習う 洗う 着る 脱ぐ 渡す 借りる 返す 送る " +
    "いい よい 大きい 小さい 高い 安い 新しい 古い 悪い 暑い 寒い 熱い 冷たい おいしい 楽しい " +
    "面白い 忙しい 難しい 易しい 早い 遅い 近い 遠い 多い 少ない 長い 短い 明るい 暗い 強い 弱い " +
    "きれい 有名 元気 静か 賑やか 好き 嫌い 上手 下手 " +
    "人 日 年 月 時間 今日 明日 昨日 朝 昼 夜 家 学校 会社 駅 電車 車 道 店 水 食べ物 飲み物 " +
    "友達 家族 先生 学生 子供 名前 言葉 日本 日本語 仕事 勉強 電話 お金 本 手 目 頭 心 体 " +
    "天気 雨 雪 風 花 山 川 海 空 部屋 世界 国 町 村 人々"
  )
    .split(/\s+/)
    .filter(Boolean),
);

function buildJapanese() {
  const raw = read("jmdict-eng-common-3.6.2.json");
  if (!raw) {
    console.log("skip japanese-core: missing jmdict");
    return;
  }
  const dict = JSON.parse(raw);
  const freq = new Map();
  for (const row of loadFrequency("ja_full.txt")) {
    if (!freq.has(row.word)) freq.set(row.word, row.count);
  }
  const seen = new Set();
  const candidates = [];
  for (const word of dict.words || []) {
    const kanji = (word.kanji || []).filter(
      (k) => !["sK", "rK", "oK", "iK"].some((tag) => (k.tags || []).includes(tag)),
    );
    const kana = (word.kana || []).filter(
      (k) => !["sk", "rk", "ok", "ik"].some((tag) => (k.tags || []).includes(tag)),
    );
    const display =
      (kanji.find((k) => k.common) || kanji[0] || kana.find((k) => k.common) || kana[0] || {}).text || "";
    const reading =
      (kana.find((k) => k.common) || kana[0] || {}).text || "";
    if (!display || !reading) continue;
    if (!validJapanese(display)) continue;
    if (/^[ぁ-ゖ]+$/.test(display) && display.length < 2) continue;
    if (/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/.test(display)) continue;
    if (seen.has(display)) continue;
    const pos = ((word.sense || [])[0]?.partOfSpeech || []).join(", ");
    if (/(^|,\s*)(n-suf|n-pref|suf|pref)(,|$)/.test(pos)) continue;
    // 词频表按“汉字词干”切分（食べる → 食べ），因此同时匹配完整词形与词干。
    let score = 0;
    for (const form of [...kanji.map((k) => k.text), ...kana.map((k) => k.text)]) {
      score = Math.max(score, freq.get(form) || 0);
      for (let cut = 1; cut <= 3 && cut < form.length; cut += 1) {
        const stem = form.slice(0, -cut);
        if ([...stem].length < 2) break;
        if (!/[\u4e00-\u9fff]/.test(stem)) continue;
        score = Math.max(score, freq.get(stem) || 0);
      }
    }
    let charScore = 0;
    for (const char of new Set([...display])) charScore += freq.get(char) || 0;
    const kanjiCount = (display.match(/[\u4e00-\u9fff]/g) || []).length;
    const fallbackScore = Math.round(
      (charScore / Math.max(2, display.length)) * (kanjiCount >= 2 ? 1.4 : 1),
    );
    if (JA_CORE.has(display)) score += 3000;
    const glosses = (word.sense || [])
      .flatMap((sense) => (sense.gloss || []).map((g) => g.text))
      .slice(0, 2);
    const phonetic = kanaToIpa(reading);
    if (!phonetic) continue;
    if (!score && !fallbackScore) continue;
    seen.add(display);
    candidates.push({ display, reading, phonetic, glosses, pos, score, fallbackScore });
  }
  const attested = candidates
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const fallback = candidates
    .filter((row) => !row.score)
    .sort((a, b) => b.fallbackScore - a.fallbackScore);
  // 词频表覆盖有限：先用有词频证据的词，再补一批高频汉字组成的常用词（如「日本語」）。
  const chosen = [...attested.slice(0, 2300), ...fallback.slice(0, 700)];
  chosen.sort((a, b) => b.score - a.score || b.fallbackScore - a.fallbackScore);
  const entries = chosen.slice(0, 3000).map((row, index) => ({
    id: `japanese-core-${index + 1}`,
    word: row.display,
    phonetic: `/${row.phonetic}/`,
    reading: row.reading,
    meaning: row.glosses.join("; "),
    pos: row.pos,
    rank: index + 1,
    unit: unitFor(index),
    level: "3000",
    band: "3000",
    tags: ["ja", "core"],
    source: "JMdict + FrequencyWords ja 2018",
  }));
  if (!entries.length) {
    console.log("skip japanese-core: empty");
    return;
  }
  const source = "JMdict (CC BY-SA 4.0) + hermitdave/FrequencyWords ja 2018 (CC BY-SA 4.0)";
  writeBook("book-ja-core.js", "CIKE_JA_CORE", {
    meta: {
      id: "japanese-core",
      title: "日语高频 3000",
      subtitle: "按语料词频排序 · 假名读音与 IPA · JMdict 英文释义",
      language: "ja",
      level: "3000",
      unitSize: 50,
      count: entries.length,
      filters: [
        { id: "all", label: "全部" },
        { id: "3000", label: "3000" },
      ],
      source,
      license: "CC BY-SA 4.0",
      sourceType: "open-data",
      lightEntries: true,
    },
    entries,
  });
}

/* ---------- run ---------- */
buildFrench();
buildMedical();
buildLatin();

const ipaEs = loadIpa("es_ES.txt");
buildFromFreq({
  id: "spanish-core",
  title: "西语高频 3000",
  subtitle: "按语料词频排序 · IPA 音标 · 词形与发音练习",
  language: "es",
  level: "3000",
  file: "book-es-core.js",
  globalName: "CIKE_ES_CORE",
  freqFile: "es_50k.txt",
  ipa: ipaEs,
  limit: 3000,
  tags: ["core"],
  source: "hermitdave/FrequencyWords es 2018 + open-dict-data/ipa-dict es_ES",
  license: "CC BY-SA 4.0 / MIT",
});

const ipaDe = loadIpa("de.txt");
buildFromFreq({
  id: "german-core",
  title: "德语高频 3000",
  subtitle: "按语料词频排序 · IPA 音标 · 词形与发音练习",
  language: "de",
  level: "3000",
  file: "book-de-core.js",
  globalName: "CIKE_DE_CORE",
  freqFile: "de_50k.txt",
  ipa: ipaDe,
  limit: 3000,
  tags: ["core"],
  source: "hermitdave/FrequencyWords de 2018 + open-dict-data/ipa-dict de",
  license: "CC BY-SA 4.0 / MIT",
});

const ipaIt = loadWikipron("it_wikipron.tsv");
buildFromFreq({
  id: "italian-core",
  title: "意语高频 3000",
  subtitle: "按语料词频排序 · WikiPron 音标 · 词形与发音练习",
  language: "it",
  level: "3000",
  file: "book-it-core.js",
  globalName: "CIKE_IT_CORE",
  freqFile: "it_50k.txt",
  ipa: ipaIt,
  limit: 3000,
  tags: ["core"],
  source: "hermitdave/FrequencyWords it 2018 + WikiPron ita_latn_broad",
  license: "CC BY-SA 4.0 / Apache-2.0",
});

buildJapanese();

const ipaYue = loadIpa("yue.txt");
buildFromFreq({
  id: "cantonese-core",
  title: "粤语高频 2000",
  subtitle: "按语料词频排序 · 粤拼 IPA 音标 · 词形与发音练习",
  language: "yue",
  level: "2000",
  file: "book-yue-core.js",
  globalName: "CIKE_YUE_CORE",
  freqFile: "yue_freq.tsv",
  ipa: ipaYue,
  limit: 2000,
  tags: ["core"],
  validator: validCantonese,
  source: "AlienKevin/cantonese_frequency_list + open-dict-data/ipa-dict yue",
  license: "CC BY-SA 4.0",
});

/* 粤语词频文件是 TSV，loadFrequency 也能处理（空白分割）。 */
console.log("all done");