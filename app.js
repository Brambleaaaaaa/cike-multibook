(function () {
  "use strict";

  const core = window.Cet6Core;
  const writingLibrary = window.CIKE_WRITING_LIBRARY;
  const listeningLibrary = window.CIKE_LISTENING;
  const examLibrary = window.CIKE_EXAM_LIBRARY || { essays: [], translations: [] };
  const typewordsCatalog = window.TYPEWORDS_CATALOG;
  const typewordsDictionary = window.TYPEWORDS_DICTIONARY || {};
  const preloadedLibrary = window.PRELOADED_USER_LIBRARY;
  const preloadedNovels = window.PRELOADED_NOVELS_LIBRARY;
  const publicLibrary = window.PRELOADED_PUBLIC_LIBRARY;
  const frenchLookup = new Map(
    (window.CIKE_FR_A1_B2?.entries || []).map((entry) => [
      String(entry.word || "").toLowerCase(),
      entry.meaning,
    ]),
  );
  // 写译短语库本身就是按话题整理好的中英对照，直接并成一册内置词书：
  // 写作文、做翻译时不必再切到资料页逐条找。
  const writingPhraseBook =
    writingLibrary?.categories?.length
      ? {
          meta: {
            id: "writing-phrases",
            title: "写译短语 411",
            subtitle: "按话题整理的写作、翻译高频表达",
            language: "en",
            level: "写译",
            unitSize: 40,
            filters: [
              { id: "all", label: "全部" },
              ...writingLibrary.categories.map((category) => ({
                id: category.id,
                label: category.title,
              })),
            ],
            source: "内置写译短语库 · 与“写译短语”页同源",
          },
          entries: writingLibrary.categories.flatMap((category) =>
            (category.phrases || []).map((phrase, index) => ({
              id: `wph-${category.id}-${index + 1}`,
              word: phrase.en,
              meaning: phrase.zh,
              phonetic: "",
              example: "",
              exampleZh: "",
              category: category.title,
              level: category.title,
              tags: ["phrase", category.id],
            })),
          ),
        }
      : null;

  const rawBooks = [
    window.CET6_WORDS && {
      ...window.CET6_WORDS,
      meta: {
        ...window.CET6_WORDS.meta,
        id: "cet6-core",
      },
    },
    window.CIKE_CET6_ATTACHMENT,
    window.CIKE_EN_10000,
    window.CIKE_EN_MEDICAL,
    window.CIKE_FR_A1_B2,
    window.CIKE_ES_CORE,
    window.CIKE_DE_CORE,
    window.CIKE_IT_CORE,
    window.CIKE_JA_CORE,
    window.CIKE_YUE_CORE,
    window.CIKE_LA_CORE,
    ...(window.CIKE_ES_TIERS || []),
    ...(window.CIKE_DE_TIERS || []),
    ...(window.CIKE_IT_TIERS || []),
    ...(window.CIKE_FR_TIERS || []),
    ...(window.CIKE_YUE_TIERS || []),
    ...(window.CIKE_LA_TIERS || []),
    ...(window.CIKE_JA_TIERS || []),
    window.CIKE_LISTENING_WORDS,
    writingPhraseBook,
  ].filter(Boolean);
  if (!rawBooks.length || !core || !writingLibrary) {
    document.body.innerHTML =
      '<main style="padding:40px"><h1>词书加载失败</h1><p>请确认 data 目录中的词书文件完整。</p></main>';
    throw new Error("Vocabulary books, writing library, or core did not load.");
  }

  const BOOK_DEFAULTS = {
    "cet6-core": {
      title: "六级核心 2000",
      subtitle: "真题词频核心词",
      language: "en",
      level: "CET-6",
      filters: [
        { id: "all", label: "全部" },
        { id: "listening", label: "听力" },
        { id: "reading", label: "阅读" },
        { id: "writing", label: "写作" },
      ],
    },
    "listening-core": {
      title: "听力单词本",
      subtitle: "四六级听力答案词 · 场景词 · 闹钟词",
      language: "en",
      level: "CET-4/6",
      filters: [
        { id: "all", label: "全部" },
        { id: "scene", label: "场景词" },
        { id: "signal", label: "信号词" },
        { id: "synonym", label: "同义替换" },
      ],
    },
  };

  function normalizeBook(raw, defaults = {}) {
    const meta = {
      ...(raw.meta || {}),
      ...defaults,
    };
    const id = meta.id || defaults.id || "book";
    const sourceEntries = raw.words || raw.entries || [];
    const seenIds = new Set();
    const entries = sourceEntries.map((entry, index) => {
      const rawId = entry.id || String(index + 1);
      let entryId = `${id}:${rawId}`;
      if (seenIds.has(entryId)) entryId = `${entryId}-${index + 1}`;
      seenIds.add(entryId);
      return {
        ...entry,
        rawId,
        id: entryId,
        bookId: id,
        bookTitle: meta.title,
        language: meta.language || "en",
        band: entry.band || entry.level || meta.level || "学习",
        cefr: entry.cefr || entry.level || "",
        rank: entry.rank || index + 1,
        unit: entry.unit || Math.ceil((index + 1) / (meta.unitSize || 40)),
      };
    });
    return {
      meta: {
        ...meta,
        id,
        count: entries.length,
        units: Math.ceil(entries.length / (meta.unitSize || 40)),
      },
      words: entries,
    };
  }

  const books = rawBooks.map((raw) =>
    normalizeBook(raw, {
      ...(BOOK_DEFAULTS[raw.meta?.id] || {}),
      id: raw.meta?.id || "book",
    }),
  );
  const booksById = new Map(books.map((book) => [book.meta.id, book]));
  // 记录内置标题，改名后仍能“恢复默认”。
  const builtinBookTitles = new Map(
    books.map((book) => [book.meta.id, book.meta.title]),
  );
  const typewordsBooksById = new Map(
    (typewordsCatalog?.books || []).map((book) => [String(book.id), book]),
  );
  const typewordsDeckCache = new Map();
  const allWords = books.flatMap((book) => book.words);
  const allWordById = new Map(allWords.map((word) => [word.id, word]));

  // 全库词义索引：把所有词书（含 TypeWords 离线词典）汇总成一张
  // “词 → 各语言释义”的表，换词书后也能查到别处的词。
  const LANGUAGE_META = {
    en: { label: "英语", short: "EN" },
    fr: { label: "法语", short: "FR" },
    ja: { label: "日语", short: "JA" },
    de: { label: "德语", short: "DE" },
    es: { label: "西班牙语", short: "ES" },
    it: { label: "意大利语", short: "IT" },
    la: { label: "拉丁语", short: "LA" },
    yue: { label: "粤语", short: "YUE" },
    ko: { label: "韩语", short: "KO" },
    ru: { label: "俄语", short: "RU" },
    zh: { label: "中文", short: "ZH" },
  };
  const LANGUAGE_ORDER = [
    "en",
    "fr",
    "ja",
    "de",
    "es",
    "it",
    "la",
    "yue",
    "ko",
    "ru",
    "zh",
  ];

  // 词书封面上的语言标识，和 LANGUAGE_META 的中文名分开维护，避免把“日语”印成 JA 之外的写法。
  const BOOK_LANGUAGE_BADGE = {
    en: "ENGLISH",
    fr: "FRANÇAIS",
    es: "ESPAÑOL",
    de: "DEUTSCH",
    it: "ITALIANO",
    ja: "日本語",
    yue: "廣東話",
    la: "LATINA",
    zh: "中文",
  };

  function bookLanguageBadge(code) {
    return BOOK_LANGUAGE_BADGE[code] || String(code || "EN").toUpperCase();
  }

  // 离线直译用的高频功能词表：本地词书里这些词的释义往往很长或不适合逐词直译，
  // 这里给出一词一义，句子读起来才像中文。
  const OFFLINE_FUNCTION_GLOSS = {
    en: {
      a: "一个",
      an: "一个",
      the: "这个/那个",
      i: "我",
      me: "我",
      my: "我的",
      mine: "我的",
      you: "你",
      your: "你的",
      yours: "你的",
      he: "他",
      him: "他",
      his: "他的",
      she: "她",
      her: "她/她的",
      hers: "她的",
      it: "它",
      its: "它的",
      we: "我们",
      us: "我们",
      our: "我们的",
      ours: "我们的",
      they: "他们",
      them: "他们",
      their: "他们的",
      theirs: "他们的",
      this: "这个",
      these: "这些",
      that: "那个",
      those: "那些",
      is: "是",
      am: "是",
      are: "是",
      was: "是（过去式）",
      were: "是（过去式）",
      be: "是",
      been: "是（过去分词）",
      being: "正在",
      have: "有",
      has: "有",
      had: "有（过去式）",
      do: "做",
      does: "做",
      did: "做（过去式）",
      done: "做完",
      not: "不",
      no: "不/没有",
      yes: "是",
      and: "和",
      or: "或者",
      but: "但是",
      if: "如果",
      because: "因为",
      so: "所以",
      than: "比",
      then: "然后",
      also: "也",
      too: "也/太",
      very: "很",
      just: "只是",
      only: "只有",
      still: "仍然",
      now: "现在",
      of: "的",
      to: "到/去",
      in: "在…里",
      on: "在…上",
      at: "在",
      from: "从",
      by: "被/由",
      with: "和…一起",
      without: "没有",
      for: "为了",
      about: "关于",
      into: "进入",
      over: "在上方",
      under: "在下方",
      after: "之后",
      before: "之前",
      between: "在…之间",
      through: "穿过",
      during: "在…期间",
      as: "作为",
      like: "像/喜欢",
      all: "全部",
      some: "一些",
      any: "任何",
      each: "每个",
      every: "每个",
      both: "两者都",
      more: "更多",
      most: "最多",
      much: "许多",
      many: "许多",
      few: "很少",
      little: "少量",
      one: "一个",
      two: "两个",
      three: "三个",
      there: "那里",
      here: "这里",
      where: "哪里",
      when: "何时",
      why: "为什么",
      how: "怎样",
      what: "什么",
      which: "哪个",
      who: "谁",
      whom: "谁",
      whose: "谁的",
      can: "能",
      could: "能（过去式）",
      will: "将会",
      would: "会",
      should: "应该",
      may: "可能",
      might: "也许",
      must: "必须",
      shall: "将要",
      time: "时间",
      day: "天",
      night: "夜晚",
      morning: "早晨",
      evening: "傍晚",
      year: "年",
      world: "世界",
      people: "人们",
      man: "男人",
      woman: "女人",
      child: "孩子",
      thing: "东西",
      place: "地方",
      home: "家",
      house: "房子",
      life: "生活",
      story: "故事",
      word: "词",
      book: "书",
      old: "老的/旧的",
      new: "新的",
      young: "年轻的",
      big: "大的",
      small: "小的",
      good: "好的",
      bad: "坏的",
      great: "伟大的/很好的",
      long: "长的",
      short: "短的",
      high: "高的",
      low: "低的",
      quiet: "安静的",
      happy: "快乐的",
      sad: "悲伤的",
      beautiful: "美丽的",
      dark: "黑暗的",
      light: "轻的/光",
      cold: "冷的",
      warm: "温暖的",
      hot: "热的",
      early: "早的",
      late: "晚的",
      hard: "困难的/坚硬的",
      easy: "容易的",
      free: "自由的/免费的",
      full: "满的",
      empty: "空的",
      first: "第一的",
      last: "最后的",
      next: "下一个",
      same: "相同的",
      different: "不同的",
      other: "其他的",
      another: "另一个",
      real: "真实的",
      sure: "确定的",
      ready: "准备好的",
      able: "能够的",
      possible: "可能的",
      important: "重要的",
      difficult: "困难的",
      interesting: "有趣的",
      tired: "疲倦的",
      afraid: "害怕的",
      angry: "生气的",
      sorry: "抱歉的",
      nice: "好的",
      fine: "好的",
      kind: "友善的/种类",
      strong: "强壮的",
      weak: "虚弱的",
      rich: "富有的",
      poor: "贫穷的",
      right: "正确的/右边",
      wrong: "错误的",
      true: "真实的",
      own: "自己的",
      whole: "整个的",
      half: "一半",
      go: "去",
      goes: "去",
      went: "去（过去式）",
      gone: "去（过去分词）",
      come: "来",
      came: "来（过去式）",
      get: "得到",
      got: "得到（过去式）",
      make: "做",
      made: "做（过去式）",
      take: "拿",
      took: "拿（过去式）",
      give: "给",
      gave: "给（过去式）",
      see: "看见",
      saw: "看见（过去式）",
      know: "知道",
      knew: "知道（过去式）",
      think: "想",
      thought: "想（过去式）",
      say: "说",
      said: "说（过去式）",
      tell: "告诉",
      told: "告诉（过去式）",
      want: "想要",
      need: "需要",
      look: "看",
      find: "找到",
      found: "找到（过去式）",
      feel: "感觉",
      felt: "感觉（过去式）",
      keep: "保持",
      kept: "保持（过去式）",
      let: "让",
      put: "放",
      seem: "似乎",
      seemed: "似乎（过去式）",
      become: "变成",
      became: "变成（过去式）",
      leave: "离开",
      left: "离开（过去式）",
      begin: "开始",
      began: "开始（过去式）",
      run: "跑",
      ran: "跑（过去式）",
      walk: "走",
      walked: "走（过去式）",
      talk: "说话",
      talked: "说话（过去式）",
      ask: "问",
      asked: "问（过去式）",
      answer: "回答",
      read: "读",
      write: "写",
      wrote: "写（过去式）",
      hear: "听见",
      heard: "听见（过去式）",
      wait: "等待",
      waited: "等待（过去式）",
      open: "打开",
      close: "关闭",
      love: "爱",
      loved: "爱（过去式）",
      hate: "恨",
      live: "生活",
      lived: "生活（过去式）",
      die: "死",
      died: "死（过去式）",
      work: "工作",
      worked: "工作（过去式）",
      play: "玩",
      played: "玩（过去式）",
      study: "学习",
      studied: "学习（过去式）",
      learn: "学习",
      learned: "学习（过去式）",
    },
    fr: {
      le: "这个/那个（定冠词）",
      la: "这个/那个（定冠词）",
      les: "这些/那些（定冠词）",
      l: "这个/那个",
      un: "一个",
      une: "一个",
      des: "一些",
      du: "一些/的",
      de: "的/从",
      d: "的/从",
      et: "和",
      ou: "或者",
      mais: "但是",
      donc: "所以",
      car: "因为",
      que: "那个/比",
      qui: "谁/那个",
      quoi: "什么",
      dont: "其/其中",
      où: "哪里",
      je: "我",
      j: "我",
      tu: "你",
      il: "他",
      elle: "她",
      on: "我们/人们",
      nous: "我们",
      vous: "你们/您",
      ils: "他们",
      elles: "她们",
      me: "我",
      m: "我",
      te: "你",
      t: "你",
      se: "自己",
      s: "自己",
      lui: "他/她",
      leur: "他们的",
      mon: "我的",
      ma: "我的",
      mes: "我的",
      ton: "你的",
      ta: "你的",
      tes: "你的",
      son: "他的/她的",
      sa: "他的/她的",
      ses: "他的/她的",
      notre: "我们的",
      nos: "我们的",
      votre: "你们的",
      vos: "你们的",
      ce: "这个",
      cet: "这个",
      cette: "这个",
      ces: "这些",
      est: "是",
      suis: "是",
      es: "是",
      sommes: "是",
      êtes: "是",
      sont: "是",
      était: "是（过去式）",
      étaient: "是（过去式）",
      être: "是",
      ai: "有",
      as: "有",
      a: "有",
      avons: "有",
      avez: "有",
      ont: "有",
      avait: "有（过去式）",
      avoir: "有",
      ne: "不",
      n: "不",
      pas: "不",
      plus: "更多/不再",
      jamais: "从不",
      rien: "什么都没有",
      très: "很",
      bien: "好",
      tout: "全部",
      tous: "全部",
      toute: "全部",
      toutes: "全部",
      dans: "在…里",
      sur: "在…上",
      sous: "在…下",
      avec: "和…一起",
      sans: "没有",
      pour: "为了",
      par: "被/由",
      en: "在/用",
      au: "到/在",
      aux: "到/在",
      vers: "朝向",
      chez: "在…家",
      entre: "在…之间",
      pendant: "在…期间",
      après: "之后",
      avant: "之前",
    },
  };

  function languageLabel(code, short = false) {
    const meta = LANGUAGE_META[code];
    if (!meta) return short ? String(code || "").toUpperCase() : "其他语言";
    return short ? meta.short : meta.label;
  }

  function normalizeLexKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  let globalLexicon = null;
  let globalLexiconKeys = null;
  const globalLookupCache = new Map();

  function buildGlobalLexicon() {
    const index = new Map();
    const seen = new Set();
    const add = (word, language, meaning, source, extra = {}) => {
      const text = String(word || "").trim();
      const key = normalizeLexKey(text);
      const gloss = String(meaning || "").trim();
      if (!key || !gloss) return;
      const lang = LANGUAGE_META[language] ? language : "en";
      const dedupe = `${lang}|${key}|${gloss}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      const bucket = index.get(key);
      const entry = {
        word: text,
        language: lang,
        meaning: gloss,
        source: String(source || ""),
        phonetic: String(extra.phonetic || ""),
      };
      if (bucket) bucket.push(entry);
      else index.set(key, [entry]);
    };
    books.forEach((book) => {
      const language = book.meta.language || "en";
      book.words.forEach((entry) => {
        add(entry.word, language, entry.meaning, book.meta.title, {
          phonetic: entry.phonetic,
        });
      });
    });
    Object.entries(typewordsDictionary).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      add(value.w || key, "en", value.m, "TypeWords 离线词典", {
        phonetic: value.p0 || value.p1 || "",
      });
    });
    return index;
  }

  function lexicon() {
    if (!globalLexicon) globalLexicon = buildGlobalLexicon();
    return globalLexicon;
  }

  function groupLexEntries(entries, preferLanguage = "") {
    const buckets = new Map();
    entries.forEach((entry) => {
      if (!buckets.has(entry.language)) buckets.set(entry.language, []);
      buckets.get(entry.language).push(entry);
    });
    const rank = (code) => {
      const index = LANGUAGE_ORDER.indexOf(code);
      return index === -1 ? LANGUAGE_ORDER.length : index;
    };
    return [...buckets.keys()]
      .sort((a, b) => {
        if (a === preferLanguage) return -1;
        if (b === preferLanguage) return 1;
        return rank(a) - rank(b);
      })
      .map((language) => ({
        language,
        label: languageLabel(language),
        entries: buckets
          .get(language)
          .sort((a, b) => b.meaning.length - a.meaning.length),
      }));
  }

  function suggestGlobalWords(key) {
    if (!key || key.length < 2) return [];
    const lex = lexicon();
    if (!globalLexiconKeys) globalLexiconKeys = [...lex.keys()];
    const starts = [];
    const contains = [];
    for (const candidate of globalLexiconKeys) {
      if (candidate === key) continue;
      if (candidate.startsWith(key)) {
        starts.push(candidate);
        if (starts.length >= 8) break;
      } else if (contains.length < 8 && candidate.includes(key)) {
        contains.push(candidate);
      }
    }
    return [...starts, ...contains]
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 8);
  }

  function lookupGlobalWord(text, preferLanguage = "") {
    const key = normalizeLexKey(text);
    if (!key) {
      return { key: "", word: "", entries: [], groups: [], suggestions: [] };
    }
    const cacheKey = `${preferLanguage}|${key}`;
    const cached = globalLookupCache.get(cacheKey);
    if (cached) return cached;
    const entries = lexicon().get(key) || [];
    const result = {
      key,
      word: String(text || "").trim(),
      entries,
      groups: groupLexEntries(entries, preferLanguage),
      suggestions: entries.length ? [] : suggestGlobalWords(key),
    };
    if (globalLookupCache.size > 400) globalLookupCache.clear();
    globalLookupCache.set(cacheKey, result);
    return result;
  }

  function lexGloss(meaning) {
    const raw = String(meaning || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    let first = raw.split(/[;；]/)[0].trim();
    first = first.replace(
      /^(?:n|v|vt|vi|adj|adv|prep|pron|conj|art|num|int|aux|det|pro|pl)\.\s*/i,
      "",
    );
    return first.length > 44 ? `${first.slice(0, 44)}…` : first;
  }

  function hasChineseText(value) {
    return /[\u4e00-\u9fff]/.test(String(value || ""));
  }

  function bestLexEntryForToken(token, language) {
    const overrides = OFFLINE_FUNCTION_GLOSS[language] || {};
    const normalized = String(token || "").toLowerCase().replace(/[’‘]/g, "'");
    if (overrides[normalized]) {
      return {
        word: token,
        language,
        meaning: overrides[normalized],
        source: "离线高频词表",
        phonetic: "",
      };
    }
    const candidates = [...lookupGlobalWord(token, language).entries];
    const apostrophe = token.indexOf("'");
    if (apostrophe > 0 && apostrophe <= 3) {
      const tail = normalizeLexKey(token.slice(apostrophe + 1));
      candidates.push(...(lexicon().get(tail) || []));
    }
    if (/'s$/i.test(token)) {
      const stem = normalizeLexKey(token.replace(/'s$/i, ""));
      candidates.push(...(lexicon().get(stem) || []));
    }
    if (!candidates.length) return null;
    const preferred = candidates.filter((entry) => entry.language === language);
    const pool = preferred.length ? preferred : candidates;
    return pool.sort(
      (a, b) =>
        Number(hasChineseText(b.meaning)) - Number(hasChineseText(a.meaning)) ||
        b.meaning.length - a.meaning.length,
    )[0];
  }

  function tokenizeForTranslation(text) {
    return (
      String(text || "").match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu) || []
    );
  }

  // 离线词义直译：逐词查本地词库，保留原文结构，给出可读的中文词义串。
  // 它不是神经机器翻译，但完全离线、瞬时返回，够用来读懂大意。
  function offlineTranslate(text, language = "en") {
    const value = String(text || "").trim();
    if (!value) return null;
    const tokens = tokenizeForTranslation(value);
    if (!tokens.length) return null;
    const rows = [];
    const parts = [];
    let hits = 0;
    tokens.forEach((token) => {
      const entry = bestLexEntryForToken(token, language);
      if (entry) {
        hits += 1;
        const gloss = lexGloss(entry.meaning);
        parts.push(gloss || entry.meaning);
        rows.push({
          word: token,
          gloss: gloss || entry.meaning,
          language: entry.language,
          source: entry.source,
        });
      } else {
        parts.push(token);
        rows.push({ word: token, gloss: "", language: "", source: "" });
      }
    });
    const cjk = hasChineseText(value) && tokens.length <= 2;
    return {
      source: value,
      output: parts.join(cjk ? "" : " "),
      rows,
      hits,
      total: tokens.length,
      coverage: tokens.length ? Math.round((hits / tokens.length) * 100) : 0,
      language,
    };
  }

  function globalLookupMarkup(query, { compact = false } = {}) {
    const value = String(query || "").trim();
    if (value.length < 2) return "";
    const result = lookupGlobalWord(value);
    if (!result.entries.length && !result.suggestions.length) return "";
    const groupsMarkup = result.groups
      .map(
        (group) => `
        <section class="global-lookup-group">
          <header class="global-lookup-grouphead">
            <span class="global-lookup-lang">${esc(group.label)}</span>
            <small>${group.entries.length} 条释义</small>
          </header>
          ${group.entries
            .slice(0, compact ? 2 : 5)
            .map(
              (entry) => `
            <div class="global-lookup-entry">
              <div class="global-lookup-wordline">
                <strong>${esc(entry.word)}</strong>
                ${entry.phonetic ? `<span class="global-lookup-ipa">/${esc(entry.phonetic)}/</span>` : ""}
                <span class="global-lookup-source">${esc(entry.source)}</span>
                <button class="mini-sound" type="button" data-action="speak-global" data-word="${esc(entry.word)}" data-lang="${esc(entry.language)}" aria-label="朗读 ${esc(entry.word)}">${icon("volume")}</button>
              </div>
              <p>${esc(entry.meaning)}</p>
            </div>`,
            )
            .join("")}
        </section>`,
      )
      .join("");
    const suggestionsMarkup = result.suggestions.length
      ? `<div class="global-lookup-suggest">
          <span>全库没有完全匹配，试试：</span>
          ${result.suggestions
            .map(
              (word) =>
                `<button type="button" class="global-lookup-chip" data-action="search-global-word" data-word="${esc(word)}">${esc(word)}</button>`,
            )
            .join("")}
        </div>`
      : "";
    return `
      <section class="global-lookup" aria-label="全库词义">
        <header class="global-lookup-head">
          <div>
            <p class="kicker">ALL WORDBOOKS</p>
            <h2>全库释义 · ${esc(result.word)}</h2>
          </div>
          <span class="tag tag--yellow">${result.groups.length} 种语言</span>
        </header>
        ${groupsMarkup || `<p class="global-lookup-empty">本地词库暂未收录这个词。</p>`}
        ${suggestionsMarkup}
        <p class="global-lookup-hint">范围覆盖软件内所有词书与离线词典，按语言分类，切换词书不影响查词。</p>
      </section>`;
  }
  let deck = books[0];
  let words = deck.words;
  let wordById = new Map(words.map((word) => [word.id, word]));
  const STORAGE_KEY = "cike-cet6-state-v2";
  const STATE_SAVED_AT_KEY = "cike-state-saved-at";
  const STATE_BACKUP_KEY = "state-backup";
  // 个人资料和 AI 配置单独留一份轻量快照：主状态损坏或写入失败时，
  // 下次启动仍能把昵称、头像、签名和 AI 设置找回来。
  const USER_PREFS_KEY = "cike-user-prefs-v1";
  const STATE_STATUS_CODES = ["new", "learning", "mastered"];
  // 读取失败时不要用空状态覆盖磁盘上的进度。
  let stateLoadFailed = false;
  let stateCorruptSaved = false;
  const PAGE_SIZE = 50;
  const DISCOVER_DOMAINS = [
    "科学",
    "自然",
    "地理",
    "金融",
    "时尚",
    "艺术",
    "政治时讯",
    "漫画",
    "期刊",
    "小说",
  ];

  const defaultState = {
    version: 2,
    createdAt: new Date().toISOString(),
    settings: {
      activeBookId: books[0].meta.id,
      dailyGoal: 20,
      sessionSize: 20,
      accent: "en-US",
      voiceRate: 0.88,
      theme: "light",
      soundEnabled: true,
      musicVolume: 0.35,
      bgmTrack: "epiphany",
      bgmPaused: false,
      wordbookTitles: {},
      ai: {
        enabled: true,
        provider: "doubao",
        model: "",
        baseUrl: "",
        tasks: {
          define: true,
          translate: true,
          allusion: true,
          comic: true,
          grade: true,
        },
      },
    },
    progress: {},
    daily: {},
    notes: {},
    corpus: {
      page: 1,
      line: 0,
      revealed: false,
      fullPage: false,
    },
    writing: {
      language: "",
      docId: "",
      chapter: 0,
      board: 0,
      boardSize: 5,
      fontSize: 20,
      revealed: false,
      drafts: {},
      progress: {},
      exam: {
        essays: {},
        translations: {},
      },
      setup: {
        type: "sentence",
        direction: "to-zh",
        categoryId: "society",
        passageId: "education",
        source: "library",
        docId: "",
        customText: "",
        customReference: "",
        difficulty: "normal",
      },
      practice: {
        active: false,
        docId: "",
        chapter: 0,
        line: 0,
        source: "",
        reference: "",
        sourceLabel: "",
        mode: "sentence",
        direction: "to-zh",
        input: "",
        hintLevel: 0,
        submittedAt: 0,
        startedAt: 0,
        savedAt: 0,
      },
      lastResult: null,
      aiGrades: {},
      session: {
        count: 0,
        chars: 0,
        hints: 0,
        startedAt: 0,
        lastAt: 0,
      },
    },
    listening: {
      filters: { year: "all", month: "all", set: "all", section: "all" },
      progress: {},
      answers: {},
      customPapers: [],
      lastPaperId: "",
    },
    profile: {
      name: "词刻学习者",
      tag: "在纸上慢慢变厉害",
      avatar: "",
      frame: "tape",
      readingSeconds: 0,
      wordsRead: 0,
      achievements: {},
      // 成就用的轻量本地日志：只记每天读过多少秒、几点学过几次。
      readDays: {},
      readSessionMax: 0,
      studyClock: {},
      // 当天首次作答后置为当天日期，进个人页时补一次红圈描画动画。
      checkinPending: "",
      easterCat: false,
      offlineSeen: false,
    },
    reader: {
      language: "",
      filter: "all",
      activeBookId: "",
      fontSize: 19,
      page: 0,
      progress: {},
      finishedAt: {},
      notes: {},
      translations: {},
      sentenceTranslations: {},
      ocrText: {},
      ocrRegions: {},
      ocrSource: {},
      comicTranslations: {},
      showTranslations: true,
      bookmarks: {},
      annotations: {},
      drawings: {},
      doodles: {},
      wordbook: {},
      tool: "",
    },
    reviewItems: {},
    reviewMeta: {
      revealed: false,
    },
    backupMeta: {
      lastExportAt: "",
      lastName: "",
      lastSize: 0,
      history: [],
    },
    userBooks: [],
  };

  let state = loadState();
  applyWordbookTitles();
  let currentView = "home";
  let selectedTag = "all";
  let selectedUnit = "";
  let selectedMode = "mixed";
  let libraryStatus = "all";
  let libraryPage = 1;
  let libraryQuery = "";
  let libraryTranslateTimer = null;
  let libraryTranslateSerial = 0;
  let activeWordId = null;
  let session = null;
  let lastStudyConfig = null;
  let toastTimer = null;
  let typewordsCategory = "全部";
  let languageLibraryGroup = "all";
  let typewordsQuery = "";
  let pendingReaderBook = null;
  let pendingBookTarget = "reader";
  let userBooksCache = [];
  let scanPages = [];
  let scanStream = null;
  let scanBook = null;
  let scanBusy = false;
  let scannerModeActive = false;
  let scanCaptureToken = 0;
  let speechRequestSerial = 0;
  let activeSpeechRequest = null;
  let speechSafetyTimer = 0;
  let speechVoicesWarm = false;
  let onlineSpeechAudio = null;
  let onlineSpeechToken = 0;
  let onlineSpeechTimer = 0;
  let readingClockTimer = null;
  let pendingBackup = null;
  let discoverQuery = "";
  let discoverFilter = "all";
  let discoverLang = "all";
  let discoverDomain = "all";
  let discoverGenre = "all";
  let discoverSeries = "all";
  let discoverPeriodicalTheme = "all";
  let discoverPage = 1;
  let translateText = "";
  let translateSource = "auto";
  let translateResult = null;
  let translateSerial = 0;
  const PUBLIC_PAGE_SIZE = 40;
  let readerToolOpen = "";
  let readerTurn = "";
  let readerTurnGhost = "";
  let readerSwipe = null;
  let readerSuppressClickUntil = 0;
  let bookLongPressTimer = 0;
  let bookLongPressUntil = 0;
  let writingSaveTimer = null;
  // 设置里的资料改动先放草稿，点“保存设置”才写回 state。
  let profileDraft = null;

  deck = currentBook();
  words = deck.words;
  wordById = new Map(words.map((word) => [word.id, word]));
  selectedTag = deck.meta.filters?.[0]?.id || "all";

  const main = document.getElementById("main");
  const sidePanel = document.getElementById("sidePanel");
  const detailPanel = document.getElementById("detailPanel");
  const settingsDialog = document.getElementById("settingsDialog");
  const settingsForm = document.getElementById("settingsForm");
  const dailyGoalInput = document.getElementById("dailyGoalInput");
  const accentSelect = document.getElementById("accentSelect");
  const voiceRateInput = document.getElementById("voiceRateInput");
  const voiceRateOutput = document.getElementById("voiceRateOutput");
  const musicVolumeInput = document.getElementById("musicVolumeInput");
  const musicVolumeOutput = document.getElementById("musicVolumeOutput");
  const themeSelect = document.getElementById("themeSelect");
  const soundEnabledInput = document.getElementById("soundEnabledInput");
  const settingsAvatarPreview = document.getElementById("settingsAvatarPreview");
  const settingsAvatarFrame = document.getElementById("settingsAvatarFrame");
  const profileNameInput = document.getElementById("profileNameInput");
  const profileTagInput = document.getElementById("profileTagInput");
  const profileNoteInput = document.getElementById("profileNoteInput");
  const aiEnabledInput = document.getElementById("aiEnabledInput");
  const aiProviderSelect = document.getElementById("aiProviderSelect");
  const aiModelInput = document.getElementById("aiModelInput");
  const aiBaseUrlInput = document.getElementById("aiBaseUrlInput");
  const aiKeyInput = document.getElementById("aiKeyInput");
  const aiKeyHint = document.getElementById("aiKeyHint");
  const aiTaskDefine = document.getElementById("aiTaskDefine");
  const aiTaskTranslate = document.getElementById("aiTaskTranslate");
  const aiTaskAllusion = document.getElementById("aiTaskAllusion");
  const aiTaskComic = document.getElementById("aiTaskComic");
  const aiTaskGrade = document.getElementById("aiTaskGrade");
  const aiCacheHint = document.getElementById("aiCacheHint");
  const headerSearch = document.getElementById("headerSearch");
  const searchInput = document.getElementById("searchInput");
  const mistakeNavCount = document.getElementById("mistakeNavCount");
  const toast = document.getElementById("toast");

  let stateBackupTimer = 0;
  let pendingStateBackup = null;
  let stateQuotaWarned = false;

  // 进度条目约有九成体积：存成定长数组，读取时再还原成对象。
  function packStateForStorage(source) {
    if (!source || typeof source !== "object") return source;
    const packedProgress = {};
    for (const [id, record] of Object.entries(source.progress || {})) {
      if (!record || typeof record !== "object") continue;
      const status = STATE_STATUS_CODES.indexOf(record.status);
      packedProgress[id] = [
        status < 0 ? 1 : status,
        Math.max(0, Number(record.seen) || 0),
        Math.max(0, Number(record.correct) || 0),
        Math.max(0, Number(record.wrong) || 0),
        Number(record.streak) || 0,
        Number(record.ease) || 2.4,
        Number(record.interval) || 0,
        Number(record.due) || 0,
        Number(record.lastSeen) || 0,
      ];
    }
    return { ...source, progress: packedProgress, progressPacked: 1 };
  }

  function unpackStateFromStorage(parsed) {
    if (!parsed || typeof parsed !== "object" || !parsed.progressPacked) {
      return parsed;
    }
    const progress = {};
    for (const [id, value] of Object.entries(parsed.progress || {})) {
      if (!Array.isArray(value)) {
        progress[id] = value;
        continue;
      }
      progress[id] = {
        status: STATE_STATUS_CODES[Number(value[0])] || "learning",
        seen: Number(value[1]) || 0,
        correct: Number(value[2]) || 0,
        wrong: Number(value[3]) || 0,
        streak: Number(value[4]) || 0,
        ease: Number(value[5]) || 2.4,
        interval: Number(value[6]) || 0,
        due: Number(value[7]) || 0,
        lastSeen: Number(value[8]) || 0,
      };
    }
    const unpacked = { ...parsed, progress };
    delete unpacked.progressPacked;
    return unpacked;
  }

  function readUserPrefsSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(USER_PREFS_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  // 主状态是默认空档时（损坏、被清空或首次写入失败），用快照补回资料与 AI 配置。
  function applyUserPrefsSnapshot(merged) {
    const snapshot = readUserPrefsSnapshot();
    if (!snapshot || !merged) return merged;
    const profile = merged.profile || {};
    const hasProfile =
      (profile.name && profile.name !== "词刻学习者") ||
      profile.avatar ||
      (profile.tag && profile.tag !== "在纸上慢慢变厉害");
    if (!hasProfile && snapshot.profile && typeof snapshot.profile === "object") {
      merged.profile = { ...profile, ...snapshot.profile };
      if (snapshot.profile.note !== undefined) {
        merged.notes.profile = String(snapshot.profile.note || "");
      }
    }
    const ai = merged.settings?.ai;
    // 默认豆包配置（没有模型和地址）也算“未设置”，避免默认值挡住快照恢复。
    const aiIsDefault =
      !ai ||
      (String(ai.provider || "doubao") === "doubao" &&
        !String(ai.model || "").trim() &&
        !String(ai.baseUrl || "").trim());
    const snapshotAi = snapshot.ai;
    const snapshotIsCustom =
      snapshotAi &&
      typeof snapshotAi === "object" &&
      (String(snapshotAi.provider || "doubao") !== "doubao" ||
        String(snapshotAi.model || "").trim() ||
        String(snapshotAi.baseUrl || "").trim());
    if (aiIsDefault && snapshotIsCustom) {
      merged.settings.ai = { ...snapshotAi };
    }
    return merged;
  }

  function writeUserPrefsSnapshot(source) {
    try {
      const snapshot = {
        savedAt: Date.now(),
        profile: {
          avatar: String(source.profile?.avatar || ""),
          frame: String(source.profile?.frame || "tape"),
          name: String(source.profile?.name || ""),
          tag: String(source.profile?.tag || ""),
          note: String(source.notes?.profile || ""),
        },
        ai: source.settings?.ai ? { ...source.settings.ai } : null,
      };
      localStorage.setItem(USER_PREFS_KEY, JSON.stringify(snapshot));
    } catch (error) {
      // 配额不足时主状态会转存 IndexedDB，这里静默跳过即可。
    }
  }

  function loadState() {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem("cike-cet6-state-v1");
      if (!raw) return applyUserPrefsSnapshot(structuredClone(defaultState));
      const parsed = unpackStateFromStorage(JSON.parse(raw));
      return applyUserPrefsSnapshot(mergeState(defaultState, parsed));
    } catch (error) {
      stateLoadFailed = true;
      console.warn("Could not read saved study state.", error);
      return applyUserPrefsSnapshot(structuredClone(defaultState));
    }
  }

  function mergeState(base, incoming) {
    const incomingProgress = incoming?.progress || {};
    const migratedProgress = {};
    for (const [id, value] of Object.entries(incomingProgress)) {
      migratedProgress[id.includes(":") ? id : `cet6-core:${id}`] = value;
    }
    const merged = {
      ...structuredClone(base),
      ...(incoming || {}),
      settings: {
        ...base.settings,
        ...(incoming?.settings || {}),
      },
      progress: migratedProgress,
      daily: {
        ...(incoming?.daily || {}),
      },
      notes: {
        ...(incoming?.notes || {}),
      },
      corpus: {
        ...base.corpus,
        ...(incoming?.corpus || {}),
      },
      writing: {
        ...base.writing,
        ...(incoming?.writing || {}),
        drafts: {
          ...base.writing.drafts,
          ...(incoming?.writing?.drafts || {}),
        },
        progress: {
          ...base.writing.progress,
          ...(incoming?.writing?.progress || {}),
        },
        exam: {
          essays: {
            ...base.writing.exam.essays,
            ...(incoming?.writing?.exam?.essays || {}),
          },
          translations: {
            ...base.writing.exam.translations,
            ...(incoming?.writing?.exam?.translations || {}),
          },
        },
        setup: {
          ...base.writing.setup,
          ...(incoming?.writing?.setup || {}),
        },
        practice: {
          ...base.writing.practice,
          ...(incoming?.writing?.practice || {}),
        },
        aiGrades: {
          ...base.writing.aiGrades,
          ...(incoming?.writing?.aiGrades || {}),
        },
        session: {
          ...base.writing.session,
          ...(incoming?.writing?.session || {}),
        },
      },
      listening: {
        ...base.listening,
        ...(incoming?.listening || {}),
        filters: {
          ...base.listening.filters,
          ...(incoming?.listening?.filters || {}),
        },
        progress: {
          ...(incoming?.listening?.progress || {}),
        },
        answers: {
          ...(incoming?.listening?.answers || {}),
        },
        customPapers: Array.isArray(incoming?.listening?.customPapers)
          ? incoming.listening.customPapers
          : [],
      },
      profile: {
        ...base.profile,
        ...(incoming?.profile || {}),
        achievements: {
          ...base.profile.achievements,
          ...(incoming?.profile?.achievements || {}),
        },
      },
      reader: {
        ...base.reader,
        ...(incoming?.reader || {}),
        progress: {
          ...base.reader.progress,
          ...(incoming?.reader?.progress || {}),
        },
        notes: {
          ...base.reader.notes,
          ...(incoming?.reader?.notes || {}),
        },
        translations: {
          ...base.reader.translations,
          ...(incoming?.reader?.translations || {}),
        },
        sentenceTranslations: {
          ...base.reader.sentenceTranslations,
          ...(incoming?.reader?.sentenceTranslations || {}),
        },
        ocrText: {
          ...base.reader.ocrText,
          ...(incoming?.reader?.ocrText || {}),
        },
        ocrRegions: {
          ...base.reader.ocrRegions,
          ...(incoming?.reader?.ocrRegions || {}),
        },
        ocrSource: {
          ...base.reader.ocrSource,
          ...(incoming?.reader?.ocrSource || {}),
        },
        comicTranslations: {
          ...base.reader.comicTranslations,
          ...(incoming?.reader?.comicTranslations || {}),
        },
        bookmarks: {
          ...base.reader.bookmarks,
          ...(incoming?.reader?.bookmarks || {}),
        },
        annotations: {
          ...base.reader.annotations,
          ...(incoming?.reader?.annotations || {}),
        },
        drawings: {
          ...base.reader.drawings,
          ...(incoming?.reader?.drawings || {}),
        },
        doodles: {
          ...base.reader.doodles,
          ...(incoming?.reader?.doodles || {}),
        },
        wordbook: {
          ...base.reader.wordbook,
          ...(incoming?.reader?.wordbook || {}),
        },
      },
      backupMeta: {
        ...base.backupMeta,
        ...(incoming?.backupMeta || {}),
        history: Array.isArray(incoming?.backupMeta?.history)
          ? incoming.backupMeta.history.slice(0, 6)
          : [...base.backupMeta.history],
      },
      userBooks: Array.isArray(incoming?.userBooks)
        ? incoming.userBooks
        : [],
      reviewItems: {
        ...(incoming?.reviewItems || {}),
      },
      reviewMeta: {
        ...base.reviewMeta,
        ...(incoming?.reviewMeta || {}),
      },
    };

    const hasDailyGoal = Object.prototype.hasOwnProperty.call(
      incoming?.settings || {},
      "dailyGoal",
    );
    const legacySize = Math.max(
      1,
      Number(merged.settings.sessionSize || 20),
    );
    merged.settings.dailyGoal = hasDailyGoal
      ? Math.max(0, Math.floor(Number(merged.settings.dailyGoal) || 0))
      : legacySize;
    merged.settings.sessionSize = Math.max(
      1,
      Number(merged.settings.dailyGoal || legacySize || 20),
    );
    merged.settings.activeBookId = booksById.has(merged.settings.activeBookId)
      ? merged.settings.activeBookId
      : books[0].meta.id;
    merged.settings.soundEnabled = merged.settings.soundEnabled !== false;
    merged.settings.voiceRate = Math.min(
      1.15,
      Math.max(0.65, Number(merged.settings.voiceRate) || 0.88),
    );
    merged.settings.accent =
      merged.settings.accent === "en-GB" ? "en-GB" : "en-US";
    merged.settings.theme = merged.settings.theme === "dark" ? "dark" : "light";
    return merged;
  }

  function applyWordbookTitles() {
    const titles = state?.settings?.wordbookTitles || {};
    books.forEach((book) => {
      const builtin = builtinBookTitles.get(book.meta.id) || book.meta.title;
      const custom = String(titles[book.meta.id] || "").trim();
      book.meta.title = custom || builtin;
      book.meta.customTitle = Boolean(custom);
      book.words.forEach((word) => {
        word.bookTitle = book.meta.title;
      });
    });
  }

  function setWordbookTitle(bookId, title) {
    const book = booksById.get(bookId);
    if (!book) return;
    const value = String(title || "").trim().slice(0, 40);
    const titles = { ...(state.settings.wordbookTitles || {}) };
    if (value) titles[bookId] = value;
    else delete titles[bookId];
    state.settings.wordbookTitles = titles;
    applyWordbookTitles();
    saveState();
    render();
    showToast(value ? `词书已改名为「${value}」。` : "已恢复内置名称。");
  }

  function currentBook() {
    const activeId = state.settings.activeBookId;
    if (activeId?.startsWith("tw:")) {
      return getTypewordsDeck(activeId.slice(3)) || books[0];
    }
    return booksById.get(activeId) || books[0];
  }

  function activateBook(bookId) {
    const nextBook = bookId.startsWith("tw:")
      ? getTypewordsDeck(bookId.slice(3))
      : booksById.get(bookId);
    if (!nextBook) return;
    state.settings.activeBookId = bookId;
    deck = nextBook;
    words = deck.words;
    wordById = new Map(words.map((word) => [word.id, word]));
    selectedTag = deck.meta.filters?.[0]?.id || "all";
    selectedUnit = "";
    libraryQuery = "";
    libraryPage = 1;
    libraryStatus = "all";
    activeWordId = null;
    searchInput.value = "";
    saveState();
  }

  function getTypewordsDeck(sourceId) {
    const catalogBook = typewordsBooksById.get(String(sourceId));
    if (!catalogBook) return null;
    if (typewordsDeckCache.has(catalogBook.id)) {
      return typewordsDeckCache.get(catalogBook.id);
    }
    const deckId = `tw:${catalogBook.id}`;
    const entries = catalogBook.words.map((key, index) => {
      const detail = typewordsDictionary[key] || {};
      const sentence = detail.s?.[0] || [];
      const phrase = detail.ph?.[0] || [];
      return {
        id: `${deckId}:${key}`,
        rawId: key,
        word: detail.w || key,
        meaning: detail.m || "暂无释义",
        phonetic: detail.p0 || detail.p1 || "",
        example: sentence[0] || phrase[0] || "",
        exampleZh: sentence[1] || phrase[1] || "",
        category: catalogBook.category,
        level: catalogBook.name,
        tags: ["reading"],
        rank: index + 1,
        unit: Math.ceil((index + 1) / 50),
        source: "TypeWords",
      };
    });
    const normalized = normalizeBook(
      {
        meta: {
          id: deckId,
          title: catalogBook.name,
          subtitle: catalogBook.description,
          language: catalogBook.language || "en",
          level: catalogBook.category,
          category: catalogBook.category,
          source: "zyronon/TypeWords",
          sourceUrl: "https://github.com/zyronon/TypeWords",
          filters: [
            { id: "all", label: "全部" },
            { id: "reading", label: "阅读" },
          ],
          unitSize: 50,
        },
        entries,
      },
      { id: deckId },
    );
    typewordsDeckCache.set(catalogBook.id, normalized);
    return normalized;
  }

  function queueStateBackup(packed, savedAt) {
    pendingStateBackup = { packed, savedAt };
    if (stateBackupTimer) return;
    stateBackupTimer = window.setTimeout(() => {
      stateBackupTimer = 0;
      flushStateBackup();
    }, 700);
  }

  // IndexedDB 容量远大于 localStorage，作为大进度和头像的兜底副本。
  function flushStateBackup() {
    const job = pendingStateBackup;
    pendingStateBackup = null;
    if (!job || !window.CikeDB) return Promise.resolve(false);
    return window.CikeDB.set(STATE_BACKUP_KEY, {
      savedAt: job.savedAt,
      payload: job.packed,
    }).catch((error) => {
      console.warn("Could not write state backup to IndexedDB.", error);
      return false;
    });
  }

  function saveState() {
    const savedAt = Date.now();
    const packed = packStateForStorage(state);
    if (stateLoadFailed && !stateCorruptSaved) {
      // 读失败时先把原始字符串留一份，再谈覆盖。
      stateCorruptSaved = true;
      const raw = localStorage.getItem(STORAGE_KEY) || "";
      if (raw && window.CikeDB) {
        window.CikeDB
          .set("state-corrupt-backup", { savedAt, raw })
          .catch(() => {});
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(packed));
      localStorage.setItem(STATE_SAVED_AT_KEY, String(savedAt));
    } catch (error) {
      if (!stateQuotaWarned) {
        stateQuotaWarned = true;
        showToast("本地存储空间紧张，进度已转存到大容量空间。");
      }
      console.warn("localStorage save failed, keeping IndexedDB backup.", error);
    }
    queueStateBackup(packed, savedAt);
    scheduleAchievementCheck();
  }

  // 立即落盘：安卓切后台、进程被回收前的最后一道保险。
  function flushState() {
    if (stateBackupTimer) {
      window.clearTimeout(stateBackupTimer);
      stateBackupTimer = 0;
    }
    saveState();
    return flushStateBackup();
  }
  window.CikeFlushState = flushState;

  // 上次可能是 IndexedDB 写成功、localStorage 写失败，启动时把更新的那份合并回来。
  async function restoreStateFromDb() {
    if (!window.CikeDB) return false;
    let stored = null;
    try {
      stored = await window.CikeDB.get(STATE_BACKUP_KEY);
    } catch (error) {
      console.warn("Could not read state backup.", error);
      return false;
    }
    if (!stored || !stored.savedAt || !stored.payload) return false;
    const localSavedAt = Number(localStorage.getItem(STATE_SAVED_AT_KEY) || 0);
    if (Number(stored.savedAt) <= localSavedAt) return false;
    const merged = applyUserPrefsSnapshot(
      mergeState(defaultState, unpackStateFromStorage(stored.payload)),
    );
    state = merged;
    stateLoadFailed = false;
    writeUserPrefsSnapshot(state);
    applyWordbookTitles();
    deck = currentBook();
    words = deck.words;
    wordById = new Map(words.map((word) => [word.id, word]));
    selectedTag = deck.meta.filters?.[0]?.id || "all";
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored.payload));
      localStorage.setItem(STATE_SAVED_AT_KEY, String(stored.savedAt));
    } catch (error) {
      console.warn("Could not mirror restored state to localStorage.", error);
    }
    // 首屏设置面板可能已经按旧状态渲染过，这里同步一次。
    populateSettings();
    applyTheme();
    applyBgmSettings({ autoplay: false });
    return true;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name, className = "") {
    return `<svg${className ? ` class="${className}"` : ""} aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function beginButtonTask(button, label = "加载中…") {
    if (!button) return () => {};
    const snapshot = button.innerHTML;
    const restore = () => {
      button.classList.remove("is-loading", "is-done");
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = snapshot;
    };
    button.classList.add("is-loading");
    button.classList.remove("is-done");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
    return (result = "reset", doneLabel = "已完成") => {
      if (result !== "done") {
        restore();
        return;
      }
      button.classList.remove("is-loading");
      button.classList.add("is-done");
      button.removeAttribute("aria-busy");
      button.innerHTML = `${icon("check")}<span>${esc(doneLabel)}</span>`;
      button.disabled = true;
      window.setTimeout(restore, 1400);
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percent(value, total) {
    return total ? clamp(Math.round((value / total) * 100), 0, 100) : 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
  }

  function todayKey() {
    return core.localDateKey(new Date());
  }

  function todayRecord() {
    const key = todayKey();
    if (!state.daily[key]) {
      state.daily[key] = { total: 0, correct: 0, wrong: 0, new: 0 };
    }
    return state.daily[key];
  }

  function dailyGoalValue() {
    const raw = Number(state.settings?.dailyGoal);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }

  function dailyNewLearned() {
    return Math.max(0, Number(state.daily?.[todayKey()]?.new || 0));
  }

  function dailyGoalState(poolSize = words.length) {
    const total = Math.max(1, Number(poolSize) || 1);
    const goal = dailyGoalValue();
    if (!goal) {
      return { unlimited: true, limit: total, remaining: total, size: total };
    }
    const limit = Math.min(goal, total);
    const remaining = Math.max(0, limit - dailyNewLearned());
    return {
      unlimited: false,
      limit,
      remaining,
      size: remaining > 0 ? remaining : limit,
    };
  }

  function dailyPlanSize(poolSize = words.length) {
    return dailyGoalState(poolSize).size;
  }

  function dailyPlanCaption(poolSize = words.length) {
    const plan = dailyGoalState(poolSize);
    if (plan.unlimited) return `不限量 · 全部 ${plan.limit} 词`;
    const done = dailyNewLearned();
    if (!plan.remaining) return `今日 ${done} / ${plan.limit} 词 · 可继续`;
    return `今日 ${done} / ${plan.limit} 词`;
  }

  function dailyPlanButtonLabel(poolSize = words.length) {
    const plan = dailyGoalState(poolSize);
    if (plan.unlimited) return `一次学完 ${plan.size} 词`;
    if (!plan.remaining) return `再来一组 ${plan.limit} 词`;
    return `开始 ${plan.size} 词`;
  }

  function currentSummary() {
    return core.summarize(words, state.progress, state.daily);
  }

  function isDarkTheme() {
    return state.settings.theme === "dark";
  }

  function applyTheme() {
    document.documentElement.dataset.theme = isDarkTheme() ? "dark" : "light";
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function focusNextStudyAction() {
    requestAnimationFrame(() => {
      const next = document.querySelector('[data-action="next-question"]');
      if (!next) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const nav = document.querySelector(".mobile-nav");
      const safeBottom =
        nav && getComputedStyle(nav).display !== "none"
          ? window.innerHeight - nav.getBoundingClientRect().height - 24
          : window.innerHeight - 24;
      const rect = next.getBoundingClientRect();
      if (rect.bottom > safeBottom) {
        next.scrollIntoView({
          block: "center",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }
      next.focus({ preventScroll: true });
    });
  }

  let audioContext = null;
  function playSound(kind = "tap") {
    if (!state.settings.soundEnabled) return;
    const manager = window.CikeSound;
    if (manager && manager.play(kind)) return;
    playSynthSound(kind);
  }

  const SILENT_ACTIONS = new Set([
    "speak",
    "speak-quote",
    "corpus-speak",
    "speak-writing-source",
    "review-speak",
    "grade",
    "review-grade",
    "listen-check",
    "next-question",
    "confirm-backup-import",
    "type-letter",
    "submit-writing",
  ]);

  function playActionSound(action, button) {
    if (!action || SILENT_ACTIONS.has(action)) return;
    let kind = "tap";
    switch (action) {
      case "back":
      case "close-word":
      case "cancel-reader-import":
      case "cancel-backup-import":
      case "exit-study":
      case "go-home":
        kind = "back";
        break;
      case "reveal":
      case "review-reveal":
      case "toggle-writing-reveal":
      case "corpus-reveal":
        kind = "flip";
        break;
      case "type-letter":
        kind = "key";
        break;
      case "writing-hint":
        kind = "hint";
        break;
      case "submit-writing":
      case "confirm-reader-import":
        kind = "submit";
        break;
      case "writing-save-note":
      case "writing-add-review":
      case "collect-reader-word":
        kind = "note";
        break;
      case "toggle-discover-save":
      case "toggle-mastered":
        kind = "bookmark";
        break;
      case "writing-next":
      case "page-next":
      case "page-prev":
        kind = "next";
        break;
      case "reader-next":
      case "reader-prev":
        kind = "page";
        break;
      case "writing-finish":
        kind = "complete";
        break;
      case "run-pending-ocr":
        kind = "ocr-start";
        break;
      case "open-review":
      case "open-writing-home":
      case "continue-writing":
        kind = "tab";
        break;
      default:
        kind = "tap";
    }
    if (button && button.disabled) return;
    playSound(kind);
  }

  function playSynthSound(kind = "tap") {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const now = audioContext.currentTime;
      if (kind === "tap") {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(950, now);
        oscillator.frequency.exponentialRampToValueAtTime(320, now + 0.055);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.05, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.08);
        return;
      }
      const patterns = {
        correct: [
          [520, 0.09, 0.05],
          [680, 0.12, 0.06],
        ],
        wrong: [
          [210, 0.09, 0.05],
          [165, 0.13, 0.055],
        ],
        complete: [
          [440, 0.1, 0.05],
          [590, 0.1, 0.05],
          [760, 0.18, 0.06],
        ],
      };
      (patterns[kind] || patterns.tap).forEach(([frequency, duration, gain], index) => {
        const oscillator = audioContext.createOscillator();
        const volume = audioContext.createGain();
        oscillator.type = index % 2 ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.075);
        volume.gain.setValueAtTime(0.0001, now + index * 0.075);
        volume.gain.exponentialRampToValueAtTime(
          gain,
          now + index * 0.075 + 0.012,
        );
        volume.gain.exponentialRampToValueAtTime(
          0.0001,
          now + index * 0.075 + duration,
        );
        oscillator.connect(volume).connect(audioContext.destination);
        oscillator.start(now + index * 0.075);
        oscillator.stop(now + index * 0.075 + duration + 0.02);
      });
    } catch (error) {
      console.warn("Sound effect unavailable.", error);
    }
  }

  function statusFor(word) {
    const item = state.progress[word.id];
    if (!item) return { label: "未学", className: "", status: "new" };
    if (item.status === "mastered") {
      return { label: "已掌握", className: "is-mastered", status: "mastered" };
    }
    if (Number(item.wrong || 0) > 0) {
      return { label: "待回炉", className: "is-wrong", status: "wrong" };
    }
    return { label: "学习中", className: "is-learning", status: "learning" };
  }

  function tagLabel(tag) {
    const configured = deck.meta.filters?.find((filter) => filter.id === tag);
    if (configured) return configured.label;
    return {
      all: "全部",
      listening: "听力",
      reading: "阅读",
      writing: "写作",
      "high-frequency": "高频",
      syllabus: "六级大纲",
      vocabulary: "核心词",
      phrase: "词组",
    }[tag] || tag;
  }

  function kindLabel(kind) {
    return (
      {
        recognize: "看词回忆",
        listen: "听力默写",
        write: "释义默写",
        mixed: "背诵 → 拼写",
      }[kind] || kind
    );
  }

  function kindIcon(kind) {
    return (
      {
        recognize: "library",
        listen: "volume",
        write: "keyboard",
        mixed: "shuffle",
      }[kind] || "library"
    );
  }

  const NAV_FOR_VIEW = {
    home: "home",
    learning: "learning",
    review: "learning",
    study: "learning",
    corpus: "learning",
    "writing-new": "learning",
    "writing-practice": "learning",
    "writing-feedback": "learning",
    "writing-done": "learning",
    "essay-home": "learning",
    "essay-practice": "learning",
    "trans-home": "learning",
    "trans-practice": "learning",
    "listening-home": "learning",
    "listening-paper": "learning",
    "listening-result": "learning",
    "listening-import": "learning",
    "listening-analysis": "learning",
    "writing-analysis": "learning",
    translate: "learning",
    "ai-chat": "home",
    library: "library",
    typewords: "library",
    books: "books",
    "reader-import": "books",
    "scan-capture": "books",
    "scan-import": "books",
    discover: "books",
    profile: "profile",
    backup: "profile",
    stats: "profile",
    mistakes: "profile",
    "book-notes": "profile",
    wordbook: "profile",
    achievements: "profile",
    developer: "profile",
  };

  const IMMERSIVE_VIEWS = new Set([
    "study",
    "review",
    "corpus",
    "writing-new",
    "writing-practice",
    "writing-feedback",
    "writing-done",
    "essay-home",
    "essay-practice",
    "trans-home",
    "trans-practice",
    "listening-home",
    "listening-paper",
    "listening-result",
    "listening-import",
    "listening-analysis",
    "writing-analysis",
    "scan-capture",
  ]);

  const BACK_TARGET = {
    learning: "home",
    review: "learning",
    corpus: "learning",
    "writing-new": "corpus",
    "writing-practice": "corpus",
    "writing-feedback": "writing-practice",
    "writing-done": "corpus",
    "essay-home": "corpus",
    "essay-practice": "essay-home",
    "trans-home": "corpus",
    "trans-practice": "trans-home",
    "listening-home": "learning",
    "listening-paper": "listening-home",
    "listening-result": "listening-home",
    "listening-import": "listening-home",
    "listening-analysis": "listening-home",
    "writing-analysis": "essay-home",
    translate: "learning",
    "ai-chat": "home",
    library: "home",
    typewords: "library",
    books: "home",
    "reader-import": "books",
    "scan-capture": "books",
    "scan-import": "scan-capture",
    discover: "books",
    "public-library": "discover",
    profile: "home",
    backup: "profile",
    stats: "profile",
    mistakes: "profile",
    "book-notes": "profile",
    wordbook: "profile",
    achievements: "profile",
    developer: "profile",
  };

  function backButton(label = "返回") {
    return `<button class="back-button" type="button" data-action="back" aria-label="${esc(label)}">${icon("back")}<span>${esc(label)}</span></button>`;
  }

  function pageHead({ kicker = "", title, sub = "", right = "", backLabel = "返回" }) {
    return `<header class="page-head">
      <div>${backButton(backLabel)}</div>
      <div class="head-title">
        ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}
        <h1>${esc(title)}</h1>
        ${sub ? `<small>${esc(sub)}</small>` : ""}
      </div>
      <div>${right}</div>
    </header>`;
  }

  function goBack() {
    if (currentView === "essay-practice" || currentView === "trans-practice") {
      persistExamDraft();
      stopExamTimer();
      currentView = currentView === "essay-practice" ? "essay-home" : "trans-home";
      render();
      return;
    }
    if (currentView === "study") {
      session = null;
      currentView = "learning";
      render();
      return;
    }
    if (currentView === "home") {
      const confirmed = window.confirm(
        "要合上词刻吗？本地学习记录已经保存，下次打开会接着上次的位置。",
      );
      if (confirmed) {
        if (window.CikeLaunch?.reopen) {
          window.CikeLaunch.reopen();
        } else if (window.AndroidBridge?.finish) {
          window.AndroidBridge.finish();
        } else {
          showToast("学习记录已保存，可以关闭页面了。");
        }
      }
      return;
    }
    if (currentView === "writing-practice") {
      const input = String(state.writing.practice?.input || "");
      if (
        input.trim() &&
        !window.confirm("返回写译首页？已经写下的译文会保存为本地草稿。")
      ) {
        return;
      }
      state.writing.practice.savedAt = Date.now();
      saveState();
      showToast(input.trim() ? "草稿已保存。" : "已返回写译首页。");
      currentView = "corpus";
      render();
      return;
    }
    if (currentView === "listening-paper") {
      persistListenProgress();
      stopListenAudio();
      listenSession = null;
      showToast("听力进度已保存，下次可以接着做。");
      currentView = "listening-home";
      render();
      return;
    }
    if (currentView === "listening-analysis" || currentView === "writing-analysis") {
      exitAnalysis();
      return;
    }
    if (currentView === "listening-result" || currentView === "listening-import") {
      stopListenAudio();
      listenSession = null;
      currentView = "listening-home";
      render();
      return;
    }
    if (currentView === "books" && state.reader.activeBookId) {
      pauseReadingClock();
      exitReaderDrawing({ silent: true });
      state.reader.activeBookId = "";
      saveState();
      render();
      return;
    }
    if (currentView === "reader-import") {
      pendingReaderBook = null;
    }
    if (currentView === "scan-capture") {
      stopScanCamera();
      scanPages.forEach((page) => URL.revokeObjectURL(page.url));
      scanPages = [];
    }
    if (currentView === "scan-import") {
      scanBook = null;
    }
    currentView = BACK_TARGET[currentView] || "home";
    render();
    main.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function closeTransientLayers() {
    const dialog = document.querySelector("dialog[open]");
    if (dialog) {
      try {
        dialog.close();
      } catch (error) {
        dialog.removeAttribute("open");
      }
      return true;
    }
    const unlock = document.querySelector(".unlock-layer:not(.is-closing)");
    if (unlock) {
      unlock.querySelector(".unlock-close")?.click();
      return true;
    }
    if (document.getElementById("readerSelectBar")) {
      clearReaderSelection({ removeNative: true });
      return true;
    }
    if (document.getElementById("readerLookupSheet")) {
      closeReaderLookup();
      return true;
    }
    if (readerDrawMode) {
      exitReaderDrawing({ silent: true });
      renderReader();
      return true;
    }
    return false;
  }

  // 安卓返回手势：先关弹层，再逐级返回，只有停在首页时才真正退出。
  function androidBackStep() {
    if (closeTransientLayers()) return "handled";
    if (!session && currentView === "home") {
      flushState();
      return "exit";
    }
    goBack();
    return "handled";
  }
  window.CikeAndroidBack = androidBackStep;

  function setView(view) {
    if (session && view !== "study") {
      session = null;
    }
    if (currentView === "books" && view !== "books" && state.reader.activeBookId) {
      pauseReadingClock();
      exitReaderDrawing({ silent: true });
      state.reader.activeBookId = "";
    }
    currentView = view;
    if (view === "library") activeWordId = activeWordId || null;
    render();
    main.scrollIntoView({ block: "start", behavior: "instant" });
    main.focus({ preventScroll: true });
  }

  let renderedView = "";
  let bgmQuietMode = false;

  function render() {
    closeReaderFullscreen();
    if (currentView !== "scan-capture") stopScanCamera();
    if (currentView !== "essay-practice" && currentView !== "trans-practice") {
      stopExamTimer();
    }
    if (!String(currentView).startsWith("listening")) stopListenAudio();
    /* Listening pages and word study (dictation / recitation) hold the BGM at its
       exact position, then resume from there once the user leaves. */
    const quietView =
      String(currentView).startsWith("listening") || currentView === "study";
    if (quietView !== bgmQuietMode) {
      bgmQuietMode = quietView;
      if (quietView) window.CikeBgm?.suspend?.();
      else window.CikeBgm?.restore?.();
    }
    applyTheme();
    const viewChanged = renderedView !== currentView;
    renderedView = currentView;
    if (viewChanged) stopSpeech();
    if (viewChanged && !(currentView === "books" && state.reader.activeBookId)) {
      destroyReaderPdfCache();
    }
    document.body.classList.toggle(
      "is-immersive",
      IMMERSIVE_VIEWS.has(currentView) ||
        (currentView === "books" && Boolean(state.reader.activeBookId)),
    );
    document.body.classList.toggle(
      "is-reader",
      currentView === "books" && Boolean(state.reader.activeBookId),
    );
    const navView = NAV_FOR_VIEW[currentView] || currentView;
    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.dataset.view === navView;
      button.classList.toggle("is-active", active);
      if (button.closest("nav")) {
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    });

    const summary = currentSummary();
    if (mistakeNavCount) {
      mistakeNavCount.hidden = summary.mistakes === 0;
      mistakeNavCount.textContent =
        summary.mistakes > 99 ? "99+" : summary.mistakes;
    }

    if (currentView === "study") {
      renderStudy();
      renderStudyPanels();
      if (viewChanged) window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    if (currentView === "home") renderHome();
    else if (currentView === "learning") renderLearningCenter();
    else if (currentView === "library") renderLibrary();
    else if (currentView === "typewords") renderTypewordsCatalog();
    else if (currentView === "mistakes") renderMistakes();
    else if (currentView === "corpus") renderCorpus();
    else if (currentView === "writing-new") renderWritingNew();
    else if (currentView === "writing-practice") renderWritingPractice();
    else if (currentView === "writing-feedback") renderWritingFeedback();
    else if (currentView === "writing-done") renderWritingDone();
    else if (currentView === "essay-home") renderEssayHome();
    else if (currentView === "essay-practice") renderEssayPractice();
    else if (currentView === "trans-home") renderTransHome();
    else if (currentView === "trans-practice") renderTransPractice();
    else if (currentView === "listening-home") renderListeningHome();
    else if (currentView === "listening-paper") renderListeningPaper();
    else if (currentView === "listening-result") renderListeningResult();
    else if (currentView === "listening-import") renderListeningImport();
    else if (currentView === "listening-analysis" || currentView === "writing-analysis") renderAnalysis();
    else if (currentView === "translate") renderTranslate();
    else if (currentView === "books") renderBooks();
    else if (currentView === "reader-import") renderImportPreview();
    else if (currentView === "scan-capture") renderScanCapture();
    else if (currentView === "scan-import") renderScanImport();
    else if (currentView === "discover") renderDiscoverPage();
    else if (currentView === "backup") renderBackupPage();
    else if (currentView === "profile") renderProfile();
    else if (currentView === "book-notes") renderBookNotes();
    else if (currentView === "wordbook") renderWordbook();
    else if (currentView === "review") renderReview();
    else if (currentView === "stats") renderStats();
    else if (currentView === "achievements") renderAchievements();
    else if (currentView === "developer") renderDeveloper();
    else if (currentView === "ai-chat") renderAiChat();
    renderSidePanel(summary);
    renderDetailPanel(summary);
    main.classList.remove("view-enter");
    void main.offsetWidth;
    main.classList.add("view-enter");
    if (viewChanged) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function dailyQuoteWord() {
    const bilingual = words.filter((word) => word.example && word.exampleZh);
    const withExample = words.filter((word) => word.example);
    const pool = bilingual.length ? bilingual : withExample;
    if (!pool.length) return null;
    const key = todayKey().replace(/-/g, "");
    const seed = Number(key) || 1;
    return pool[seed % pool.length];
  }

  function continueStudyTarget() {
    const practice = state.writing.practice || {};
    if (practice.active && String(practice.input || "").trim()) {
      return {
        kind: "practice",
        title: "写译草稿还在纸上",
        detail: `${practice.sourceLabel || "分句翻译"} · 已写 ${String(practice.input).length} 字`,
        action: "continue-writing",
        label: "继续写译",
        tag: "写译",
        progress: 72,
      };
    }
    const setup = state.writing.setup || {};
    const doneCount = Object.keys(state.writing.progress || {}).length;
    if (doneCount > 0) {
      const isParagraph = setup.type === "paragraph";
      const label = isParagraph
        ? writingPassageById(setup.passageId)?.title || "整段翻译"
        : writingCategoryById(setup.categoryId)?.title || "分句练习";
      const total = writingPhraseTotal() + writingPassages().length;
      return {
        kind: "writing",
        title: isParagraph ? "整段翻译" : "分句拼写",
        detail: `${label} · 已练 ${formatNumber(doneCount)} 条`,
        action: "open-writing-home",
        label: "继续写译",
        tag: "写译",
        progress: percent(doneCount, Math.max(1, total)),
      };
    }
    const activeReader = readerBooks().find(
      (book) => book.id === state.reader.activeBookId,
    );
    const lastRead =
      activeReader ||
      readerBooks()
        .filter((book) => state.reader.progress?.[book.id] !== undefined)
        .sort(
          (a, b) =>
            Number(state.reader.progress[b.id] || 0) -
            Number(state.reader.progress[a.id] || 0),
        )[0];
    if (lastRead) {
      const page = Number(state.reader.progress?.[lastRead.id] || 0);
      return {
        kind: "reader",
        title: lastRead.title,
        detail: `上次读到第 ${page + 1} / ${bookPageTotal(lastRead)} 页`,
        action: "continue-reading",
        bookId: lastRead.id,
        label: "继续阅读",
        tag: "阅读",
        progress: percent(page + 1, Math.max(1, bookPageTotal(lastRead))),
      };
    }
    return {
      kind: "study",
      title: "从今天的第一组开始",
      detail: `${deck.meta.title} · ${dailyPlanCaption()}`,
      action: "start-session",
      label: dailyPlanButtonLabel(),
      tag: "背词",
      progress: percent(currentSummary().studied, words.length),
    };
  }

  function renderHome() {
    const summary = currentSummary();
    const genericDue = dueReviewItems().length;
    const today = todayRecord();
    const todayDone = Number(today.total || 0);
    const bookProgress = percent(summary.studied, words.length);
    const dueTotal = summary.due + genericDue;
    const quote = dailyQuoteWord();
    const target = continueStudyTarget();
    const planTotal = Math.max(3, Math.ceil(todayDone / 4) + 2);
    const planDone = Math.min(
      planTotal,
      Math.max(todayDone ? 1 : 0, Math.min(3, todayDone)),
    );
    const minutesLeft = Math.max(6, planTotal * 6 - todayDone);
    const trackSegments = Array.from({ length: 24 }, (_, index) => {
      const filled = (index + 1) / 24 <= bookProgress / 100;
      return `<span class="${filled ? "is-done" : ""}"></span>`;
    }).join("");
    const bgmState = window.CikeBgm?.getState?.() || { playing: false };
    const bgmSelected = String(state.settings?.bgmTrack || "");
    const bgmTracks = window.CikeBgm?.tracks || [];
    const bgmSelectedTrack = bgmTracks.find((track) => track.id === bgmSelected) || null;
    const bgmDiscLabel = bgmState.playing
      ? `暂停背景音乐${bgmSelectedTrack ? `（${bgmSelectedTrack.title}）` : ""}`
      : `播放背景音乐${bgmSelectedTrack ? `（${bgmSelectedTrack.title}）` : ""}`;

    main.innerHTML = `
      <header class="home-hero">
        ${backButton("合上")}
        <div class="home-bgm ${bgmState.playing ? "is-playing" : ""}" data-bgm-widget>
          <span class="home-bgm-notes" aria-hidden="true"><i>♪</i><i>♫</i><i>♩</i></span>
          <button class="home-bgm-disc" type="button" data-action="bgm-toggle" aria-label="${esc(bgmDiscLabel)}" title="${esc(bgmSelectedTrack ? `背景音乐 · ${bgmSelectedTrack.title}` : "背景音乐")}">
            ${icon("headphones")}
          </button>
          <button class="home-bgm-switch" type="button" data-action="bgm-list-toggle" aria-label="切换背景音乐" aria-expanded="false" aria-controls="homeBgmList">
            ${icon("more")}
          </button>
          <div class="home-bgm-list" id="homeBgmList" data-bgm-list hidden>
            <p class="home-bgm-list-head">背景音乐<small>音量在设置里调节</small></p>
            <div class="home-bgm-rows">
              ${bgmTracks
                .map((track) => {
                  const active = track.id === bgmSelected;
                  return `<button class="home-bgm-row ${active ? "is-active" : ""}" type="button" data-action="bgm-select" data-bgm-track="${esc(track.id)}" aria-pressed="${active ? "true" : "false"}">
                    <span>${esc(track.title)}</span><small>${esc(track.duration || "")}</small>
                  </button>`;
                })
                .join("")}
              <button class="home-bgm-row home-bgm-off ${bgmSelected ? "" : "is-active"}" type="button" data-action="bgm-select" data-bgm-track="" aria-pressed="${bgmSelected ? "false" : "true"}">
                <span>关闭音乐</span><small>安静一会儿</small>
              </button>
            </div>
          </div>
        </div>
        <div class="home-brandline">
          <strong>词刻 <span>CIKE</span></strong>
          <small>语言学习 · 每日记录</small>
        </div>
        <div class="home-hero-row">
          <h1>今天也学一点吧</h1>
          <span class="tape-tag ${deck.meta.language === "fr" ? "is-sky" : "is-mint"}">${bookLanguageBadge(deck.meta.language)} · ${languageLabel(deck.meta.language)}</span>
        </div>
      </header>

      <div class="home-stack">
        <section class="paper-card is-taped overview-card" aria-labelledby="overviewTitle">
          <h2 id="overviewTitle">今日学习概览</h2>
          <p class="tiny">${esc(deck.meta.title)} · ${dailyPlanCaption()}</p>
          <div class="overview-numbers">
            <span><b>${todayDone}</b>次作答</span>
            <span><b>${dueTotal}</b>待复习</span>
            <span><b>${summary.streak || 0}</b>${summary.streak ? "天连续" : "天开卷"}</span>
          </div>
          <p class="overview-plan">计划 <b>${planTotal}</b> 项 · 已完成 <b>${planDone}</b> 项 · 预计还要 <b>${minutesLeft}</b> 分钟</p>
          <div class="pencil-track" aria-label="当前词书已学 ${bookProgress}%">${trackSegments}</div>
          <div class="overview-foot">
            <span>已学 <b>${formatNumber(summary.studied)}</b> / ${formatNumber(words.length)} 词</span>
            <button class="small-paper-btn" type="button" data-view="learning">学习中心 ${icon("arrow")}</button>
          </div>
        </section>

        <section class="paper-card continue-card" aria-labelledby="continueTitle">
          <div class="continue-top">
            <div>
              <p class="kicker">继续上次</p>
              <h2 id="continueTitle">${esc(target.title)}</h2>
            </div>
            <span class="continue-lang">${esc(target.tag)}</span>
          </div>
          <p class="continue-caption">${esc(target.detail)}</p>
          <div class="segmented" aria-hidden="true">
            ${Array.from({ length: 8 }, (_, index) => `<span class="${target.progress >= ((index + 1) / 8) * 100 ? "is-done" : ""}"></span>`).join("")}
          </div>
          <button class="paper-btn is-butter" type="button" data-action="${target.action}" ${target.bookId ? `data-book-id="${esc(target.bookId)}"` : ""}>
            ${esc(target.label)} ${icon("arrow")}
          </button>
          ${
            dailyGoalValue()
              ? `<button class="text-button" style="display:block;margin:12px auto 0" type="button" data-action="start-all">不限量，一次学完整本 ${formatNumber(words.length)} 词</button>`
              : ""
          }
        </section>

        </div>

      <section class="quote-section" aria-labelledby="quoteTitle">
        <h2 id="quoteTitle">每日一句</h2>
        ${
          quote
            ? `<article class="quote-card">
                <q>${esc(quote.example)}</q>
                ${quote.exampleZh ? `<p class="quote-zh">${esc(quote.exampleZh)}</p>` : `<p class="quote-zh">当前词书只收录了这句原文，没有附中文译文。</p>`}
                <div class="quote-actions">
                  <button class="small-paper-btn" type="button" data-action="speak-quote" data-word-id="${esc(quote.id)}">${icon("volume")}朗读整句</button>
                  <button class="small-paper-btn" type="button" data-action="quote-to-review" data-word-id="${esc(quote.id)}">${icon("star")}收进复习</button>
                  <span class="quote-source">${esc(quote.word)} · ${esc(deck.meta.title)}</span>
                </div>
              </article>`
            : `<div class="paper-card empty-state">
                <h2>当前词书没有例句</h2>
                <p>换一本词书，或者在词库里挑一个词开始今天的练习。</p>
                <button class="paper-btn" type="button" data-action="start-session">开始一组单词</button>
              </div>`
        }
      </section>

      <div class="home-entries" aria-label="快捷入口">
        <button class="home-entry" type="button" data-action="open-review">${icon("clock")}智能复习</button>
        <button class="home-entry" type="button" data-action="quick-start" data-mode="listen">${icon("headphones")}听写</button>
        <button class="home-entry" type="button" data-view="corpus">${icon("pen")}写译</button>
        <button class="home-entry" type="button" data-view="books">${icon("books")}阅读</button>
        <button class="home-entry" type="button" data-view="ai-chat">${icon("speech")}AI 对话</button>
      </div>
    `;

    if (summary.mistakes) {
      main.insertAdjacentHTML(
        "beforeend",
        `<button class="text-button" style="display:block;margin:18px auto 0" type="button" data-view="mistakes">还有 ${summary.mistakes} 个错词待回炉 · 去看看</button>`,
      );
    }
  }

  function renderLearningCenter() {
    const summary = currentSummary();
    const dueCount = dueReviewItems().length;
    const todayDone = Number(state.daily[todayKey()]?.total || 0);
    const planTotal = Math.max(3, Math.ceil(todayDone / 4) + 2);
    const completed = Math.min(
      planTotal,
      Math.max(todayDone ? 1 : 0, Math.min(3, todayDone)),
    );
    const target = continueStudyTarget();
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const day = core.addDays(todayKey(), index - 6);
      const record = state.daily[day] || {};
      const date = new Date(`${day}T12:00:00`);
      return {
        day,
        label: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date),
        count: Number(record.total || 0),
      };
    });
    const weekDone = weekDays.filter((day) => day.count > 0).length;
    const minutesLeft = Math.max(6, planTotal * 6 - todayDone);

    main.innerHTML = `
      <header class="learning-head">
        ${backButton("返回首页")}
        <span class="tape-tag ${deck.meta.language === "fr" ? "is-sky" : "is-mint"}">${bookLanguageBadge(deck.meta.language)} · ${languageLabel(deck.meta.language)}</span>
        <span class="cike-brand">词刻 <b>CIKE</b></span>
        <h1>学习</h1>
        <small class="head-kicker">APPRENDRE · LEARN</small>
        <small>${esc(deck.meta.title)} · ${formatNumber(words.length)} 词</small>
      </header>

      <section class="learning-page">
        <article class="session-ticket" aria-labelledby="ticketTitle">
          <p class="kicker">SESSION DU JOUR</p>
          <h2 id="ticketTitle">今日学习票</h2>
          <div class="ticket-row">
            <b>${completed}/${planTotal}</b>
            <span class="tiny">已完成 · 还需约 ${minutesLeft} 分钟</span>
          </div>
          <div class="progress-track" aria-label="今日计划进度 ${percent(completed, planTotal)}%">
            <span style="--progress:${percent(completed, planTotal)}%"></span>
          </div>
          <div class="overview-foot">
            <span>${summary.streak ? `连续 ${summary.streak} 天` : "今天开卷"} · 今日已作答 ${todayDone} 次</span>
            <button class="small-paper-btn" type="button" data-action="start-session">${dailyPlanButtonLabel()} ${icon("arrow")}</button>
          </div>
          ${
            dailyGoalValue()
              ? `<button class="text-button" style="display:block;margin:12px auto 0" type="button" data-action="start-all">不限量，一次学完整本 ${formatNumber(words.length)} 词</button>`
              : ""
          }
        </article>

        <article class="paper-card learning-continue" style="margin-top:16px">
          <p class="kicker">继续上次</p>
          <h2>${esc(target.title)}</h2>
          <div class="continue-line">
            <p>${esc(target.detail)}</p>
            <b>${target.progress}%</b>
          </div>
          <div class="progress-track"><span style="--progress:${target.progress}%"></span></div>
          <button class="paper-btn is-butter button-wide" style="margin-top:12px" type="button" data-action="${target.action}" ${target.bookId ? `data-book-id="${esc(target.bookId)}"` : ""}>
            ${esc(target.label)} ${icon("arrow")}
          </button>
        </article>

        <div class="section-title">
          <h2>选择一张学习卡</h2>
          <span>${weekDone} 天有记录</span>
        </div>

        <div class="learning-modes">
          <article class="mode-card is-review">
            <span class="mode-icon">${icon("clock")}</span>
            <h3>智能复习</h3>
            <span class="mode-en">REVIEW · SRS</span>
            <span class="mode-status">${dueCount ? `${dueCount} 个词或收藏待复习` : "今天没有到期项目"}</span>
            <button class="paper-btn" type="button" data-action="open-review">${dueCount ? "开始复习" : "看看复习本"}</button>
          </article>

          <article class="mode-card is-listen">
            <span class="mode-icon">${icon("headphones")}</span>
            <h3>听写</h3>
            <span class="mode-en">DICTÉE · LISTEN</span>
            <span class="mode-status">先听发音，再拼出完整单词</span>
            <button class="paper-btn" type="button" data-action="quick-start" data-mode="listen">开始听写</button>
          </article>

          <article class="mode-card is-writing">
            <span class="mode-icon">${icon("pen")}</span>
            <h3>写译</h3>
            <span class="mode-en">TRADUIRE · WRITE</span>
            <span class="mode-status">${state.writing.practice?.active ? "有一份草稿在等你" : "短语拼写 · 整段翻译"}</span>
            <button class="paper-btn" type="button" data-view="corpus">进入写译</button>
          </article>

          <article class="mode-card is-listening">
            <span class="mode-icon">${icon("headphones")}</span>
            <h3>听力</h3>
            <span class="mode-en">ÉCOUTER · LISTEN</span>
            <span class="mode-status">六级真题 · 按年份练习</span>
            <button class="paper-btn" type="button" data-view="listening-home">进入听力</button>
          </article>

          </div>

        <section class="week-strip" style="margin-top:20px">
          <h2>慢慢来，也会到</h2>
          <div class="week-days">
            ${weekDays
              .map(
                (day) => `<span class="week-day ${day.count ? "is-done" : ""}">
                  <b>${day.label}</b><span>${day.count ? "✓" : "·"}</span>
                </span>`,
              )
              .join("")}
          </div>
          <div class="week-foot">
            <span>本周 ${weekDone} / 7 天有记录</span>
            <span>${weekDone >= 5 ? "节奏很好" : "每天一页就够了"}</span>
          </div>
        </section>
      </section>
    `;
  }

  function discoverBookDomain(book) {
    if (book.domain && DISCOVER_DOMAINS.includes(book.domain)) {
      return book.domain;
    }
    if (book.type === "comic") return "漫画";
    if (book.type === "ebook") return "小说";
    return "";
  }

  // 期刊元数据里只有标题，没有 series 字段。这里按刊名前缀归纳系列，
  // 只做目录归类，不改动任何书目信息。
  const PERIODICAL_SERIES_RULES = [
    [/^blackwood/i, "Blackwood's Edinburgh Magazine"],
    [/^punch\b/i, "Punch"],
    [/^chambers's journal of popular literature/i, "Chambers's Journal"],
    [/^chambers's edinburgh journal/i, "Chambers's Edinburgh Journal"],
    [/^chambers's journal/i, "Chambers's Journal"],
    [/^(the )?atlantic monthly/i, "The Atlantic Monthly"],
    [/^l'illustration/i, "L'Illustration"],
    [/^scientific american supplement/i, "Scientific American Supplement"],
    [/^scientific american/i, "Scientific American"],
    [/^harper's new monthly/i, "Harper's New Monthly Magazine"],
    [/^(the )?strand magazine/i, "The Strand Magazine"],
    [/^the cornhill/i, "The Cornhill Magazine"],
    [/^(the )?knickerbocker/i, "The Knickerbocker"],
    [/^the galaxy/i, "The Galaxy"],
    [/^scribner's/i, "Scribner's Magazine"],
    [/^lippincott's/i, "Lippincott's Magazine"],
    [/^st\. nicholas/i, "St. Nicholas Magazine"],
    [/^the century illustrated monthly/i, "The Century Illustrated Monthly"],
    [/^the argosy/i, "The Argosy"],
    [/^the idler/i, "The Idler"],
    [/^the contemporary review/i, "The Contemporary Review"],
    [/^the national geographic/i, "The National Geographic"],
    [/^the national preacher/i, "The National Preacher"],
    [/^british quarterly review/i, "British Quarterly Review"],
    [/^tom watson's/i, "Tom Watson's Magazine"],
    [/^the gentleman's/i, "The Gentleman's Magazine"],
    [/^the mentor/i, "The Mentor"],
    [/^the spectator/i, "The Spectator"],
    [/^the american quarterly review/i, "The American Quarterly Review"],
    [/^the quarterly review/i, "The Quarterly Review"],
    [/^journal of the proceedings of the linnean society/i, "Journal of the Proceedings of the Linnean Society"],
    [/^journal of the american-irish historical society/i, "Journal of the American-Irish Historical Society"],
    [/^the national$/i, "The National"],
  ];

  function periodicalSeriesName(title) {
    const text = String(title || "").replace(/\s+/g, " ").trim();
    if (!text) return "其他刊物";
    for (const [pattern, name] of PERIODICAL_SERIES_RULES) {
      if (pattern.test(text)) return name;
    }
    return (
      text
        .split(/\s*[,;]\s*/)[0]
        .replace(/\s*[-–—]\s*$/g, "")
        .replace(/\s+(?:vol\.?|volume|no\.?|number)\s*[0-9ivxlc]+.*$/i, "")
        .trim() || "其他刊物"
    );
  }

  const PERIODICAL_THEMES = [
    "科学与技术",
    "画报与幽默",
    "文学与评论",
    "地理与旅行",
    "儿童与青年",
    "时事与社会",
    "历史与思想",
    "其他期刊",
  ];

  function periodicalThemeOf(series) {
    const name = String(series || "");
    if (/^Scientific American|Linnean Society/i.test(name)) return "科学与技术";
    if (/^Punch|^L'Illustration/i.test(name)) return "画报与幽默";
    if (/^The National Geographic/i.test(name)) return "地理与旅行";
    if (/^St\. Nicholas/i.test(name)) return "儿童与青年";
    if (/^The National Preacher|Historical Society/i.test(name)) return "历史与思想";
    if (/^The Spectator|^The National$|^Tom Watson's/i.test(name)) return "时事与社会";
    if (
      /^(The Atlantic Monthly|Blackwood's|Chambers's|Harper's|The Strand|The Cornhill|The Knickerbocker|The Galaxy|The Argosy|The Idler|Scribner's|Lippincott's|The Century|The Contemporary Review|British Quarterly Review|The American Quarterly Review|The Quarterly Review|The Mentor|The Gentleman's)/i.test(
        name,
      )
    ) {
      return "文学与评论";
    }
    return "其他期刊";
  }

  // 漫画书目没有 genre 字段，按书名里的稳定词归类，仅用于主题筛选。
  const COMIC_THEMES = ["童谣与绘本", "幽默与讽刺", "诗歌与故事", "历史与纪实", "其他漫画"];

  function comicThemeOf(title) {
    const text = String(title || "");
    if (/history|war\b|raid\b|century|historical|ferry/i.test(text)) return "历史与纪实";
    if (/nursery|picture book|alphabet|rhyme|children|child|mother|daddy|aunt|nursie|cecily|bo-peep|johnny crow/i.test(text)) {
      return "童谣与绘本";
    }
    if (/comic|cartoon|caricature|funny|nonsense|snark|droll|latin grammar|ghosts/i.test(text)) {
      return "幽默与讽刺";
    }
    if (/poems?|poetry|sunsets|tale|stories/i.test(text)) return "诗歌与故事";
    return "其他漫画";
  }

  const DISCOVER_GENRES = [
    "悬疑",
    "科幻",
    "恐怖",
    "幻想",
    "冒险",
    "爱情",
    "青春",
    "成长",
    "幽默",
    "诗歌",
    "历史",
  ];

  const DISCOVER_DOMAIN_ORDER = [
    "小说",
    "漫画",
    "期刊",
    "科学",
    "自然",
    "地理",
    "金融",
    "时尚",
    "艺术",
    "政治时讯",
  ];

  function discoverPublicBookItems() {
    const rank = (domain) => {
      const index = DISCOVER_DOMAIN_ORDER.indexOf(domain);
      return index === -1 ? DISCOVER_DOMAIN_ORDER.length : index;
    };
    return (publicLibrary?.books || [])
      .slice()
      .sort((a, b) => rank(a.domain) - rank(b.domain))
      .map((book) => {
        const isPeriodical = book.type === "magazine";
        const series = isPeriodical ? periodicalSeriesName(book.title) : "";
        return {
          id: `pub:${book.id}`,
          title: book.title,
          source: `${book.author || "佚名"} · ${book.language === "fr" ? "法语" : "英语"}`,
          kind: "public",
          filter: "reading",
          domain: book.domain,
          genre:
            book.genre ||
            (book.type === "comic" ? comicThemeOf(book.title) : ""),
          series,
          periodicalTheme: isPeriodical ? periodicalThemeOf(series) : "",
          language: book.language,
          isImage: book.kind === "image",
          isPeriodical,
          detail:
            book.kind === "image"
              ? `${formatNumber(book.pages?.length || 0)} 页画面 · 公版插图 · 可整页 OCR`
              : book.type === "magazine"
                ? `${formatNumber(Math.max(1, Math.round(book.bytes / 1024)))} KB · 公版期刊 · 已离线`
                : `${formatNumber(Math.max(1, Math.round(book.bytes / 1024)))} KB · 公版 · 已离线`,
          publicId: book.id,
        };
      });
  }

  function discoverClassicItems() {
    const list = Array.isArray(window.CIKE_CLASSIC_IPS)
      ? window.CIKE_CLASSIC_IPS
      : [];
    return list.map((book) => ({
      id: book.id,
      title: book.title,
      source: `${book.author} · ${book.original || "版权作品"}`,
      kind: "classic",
      filter: "reading",
      domain: book.domain,
      genre: book.genre,
      language: book.language || "zh",
      detail: `${book.year || ""} · 版权作品 · 待导入`,
      classicId: book.id,
    }));
  }

  function discoverPeriodicalFacets() {
    const series = {};
    const themes = {};
    (publicLibrary?.books || []).forEach((book) => {
      if (book.type !== "magazine") return;
      const name = periodicalSeriesName(book.title);
      series[name] = (series[name] || 0) + 1;
      const theme = periodicalThemeOf(name);
      themes[theme] = (themes[theme] || 0) + 1;
    });
    return { series, themes };
  }

  function discoverItemMarkup(item, saved) {
    return `<article class="discover-item">
      <h2>${esc(item.title)}</h2>
      <p class="discover-source">${esc(item.source)}</p>
      <div class="discover-meta">
        ${item.domain ? `<span>${esc(item.domain)}</span>` : ""}
        ${item.genre ? `<span class="discover-genre">${esc(item.genre)}</span>` : ""}
        <span>${esc(item.detail)}</span>
        ${item.language ? `<span>${item.language === "fr" ? "法语" : item.language === "zh" ? "中文" : "英语"}</span>` : ""}
        ${item.minutes ? `<span>约 ${item.minutes} 分钟</span>` : ""}
      </div>
      <div class="discover-foot">
        <small>${
          item.kind === "classic"
            ? "版权作品 · 应用不附带正文"
            : item.kind === "public"
              ? item.isImage
                ? "画面已保存在本机"
                : item.isPeriodical
                  ? "整期正文已保存在本机"
                  : "正文已保存在本机"
              : "保存在本机的资料 · 不联网抓取"
        }</small>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          ${
            item.kind === "public"
              ? `<button class="discover-save" type="button" data-action="open-public-book" data-id="${esc(item.publicId)}">阅读</button>`
              : item.kind === "classic"
                ? `<button class="discover-save" type="button" data-action="open-classic-ip" data-id="${esc(item.classicId)}">导入阅读</button>`
                : `<button class="discover-save" type="button" data-action="open-discover-item" data-id="${esc(item.id)}">打开</button>`
          }
          <button class="discover-save ${saved.has(item.id) ? "is-saved" : ""}" type="button" data-action="toggle-discover-save" data-id="${esc(item.id)}" aria-pressed="${saved.has(item.id)}">
            ${saved.has(item.id) ? "已收进纸箱" : "收进纸箱"}
          </button>
        </span>
      </div>
    </article>`;
  }

  function renderDiscoverPage() {
    const saved = new Set(Array.isArray(state.notes.discover) ? state.notes.discover : []);
    const items = [];
    items.push(...discoverPublicBookItems());
    items.push(...discoverClassicItems());
    items.push({
      id: "writing-library",
      title: "写译短语库",
      source: "图片素材 · 按板块整理",
      kind: "writing",
      filter: "writing",
      detail: `${formatNumber(writingPhraseTotal())} 个短语/句子 · ${writingPassages().length} 段翻译`,
    });
    readerBooks().filter((book) => !book.public).forEach((book) => {
      const isComic = book.type === "comic";
      const isPeriodical = book.type === "magazine";
      items.push({
        id: `book:${book.id}`,
        title: book.title,
        source: book.builtin ? "内置资料" : book.author || book.source || "本地上传",
        kind: "reader",
        filter: book.language === "fr" ? "reading" : "reading",
        bookId: book.id,
        language: book.language,
        domain: discoverBookDomain(book),
        genre: isComic ? book.genre || comicThemeOf(book.title) : book.genre || "",
        series: isPeriodical ? periodicalSeriesName(book.title) : "",
        periodicalTheme: isPeriodical ? periodicalThemeOf(periodicalSeriesName(book.title)) : "",
        isPeriodical,
        minutes: Math.max(2, Math.round(bookPageTotal(book) * 0.8)),
        detail: `${bookPageTotal(book)} 页 · ${isComic ? "漫画" : book.type === "teaching" ? "教学资料" : "电子书"}`,
      });
    });
    if (typewordsCatalog) {
      items.push({
        id: "typewords",
        title: "语言库",
        source: "离线词书目录 · 已随应用打包",
        kind: "typewords",
        filter: "words",
        detail: `${typewordsCatalog.meta.bookCount} 本 · ${formatNumber(typewordsCatalog.meta.uniqueWords)} 个去重词条`,
      });
    }
    items.push({
      id: "wordbook-examples",
      title: "词书双语例句",
      source: "当前词书里真实附带的英中对照",
      kind: "words",
      filter: "words",
      detail: `${formatNumber(words.filter((word) => word.example && word.exampleZh).length)} 个词条带双语例句`,
    });

    const filters = [
      ["all", "全部"],
      ["writing", "写作"],
      ["reading", "阅读"],
      ["words", "词书"],
    ];
    const query = String(discoverQuery || "").trim().toLowerCase();
    const domainActive = discoverDomain !== "all";
    const genreActive = discoverGenre !== "all";
    const seriesActive = discoverSeries !== "all";
    const periodicalThemeActive = discoverPeriodicalTheme !== "all";
    const { series: seriesCounts, themes: periodicalThemeCounts } =
      discoverPeriodicalFacets();
    const seriesOrder = Object.entries(seriesCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
      .map(([name]) => name);
    const periodicalTotal = seriesOrder.reduce(
      (sum, name) => sum + Number(seriesCounts[name] || 0),
      0,
    );
    const filtered = items.filter((item) => {
      if (discoverFilter && discoverFilter !== "all" && item.filter !== discoverFilter) {
        return false;
      }
      if (
        discoverLang !== "all" &&
        String(item.language || "none") !== discoverLang
      ) {
        return false;
      }
      if (
        discoverDomain !== "all" &&
        item.domain !== discoverDomain
      ) {
        return false;
      }
      if (discoverGenre !== "all" && item.genre !== discoverGenre) {
        return false;
      }
      if (seriesActive && item.series !== discoverSeries) {
        return false;
      }
      if (periodicalThemeActive && item.periodicalTheme !== discoverPeriodicalTheme) {
        return false;
      }
      if (!query) return true;
      return `${item.title} ${item.source} ${item.detail} ${item.domain || ""} ${item.genre || ""} ${item.series || ""}`
        .toLowerCase()
        .includes(query);
    });
    // 同一系列 / 同一主题的书必须连续排在一起，分页后才不会来回串组。
    const groupMode =
      discoverDomain === "期刊"
        ? "series"
        : discoverDomain === "小说" || discoverDomain === "漫画"
          ? "genre"
          : "";
    const genreOrder = [...DISCOVER_GENRES, ...COMIC_THEMES];
    const rankOf = (list, value) => {
      const index = list.indexOf(value);
      return index === -1 ? list.length : index;
    };
    if (groupMode === "series") {
      filtered.sort(
        (a, b) =>
          rankOf(seriesOrder, a.series) - rankOf(seriesOrder, b.series) ||
          String(a.title).localeCompare(String(b.title), "en"),
      );
    } else if (groupMode === "genre") {
      filtered.sort(
        (a, b) =>
          rankOf(genreOrder, a.genre) - rankOf(genreOrder, b.genre) ||
          String(a.title).localeCompare(String(b.title), "en"),
      );
    }
    // 目录里同一系列 / 同一主题的书连续成组；选中具体筛选后不再重复组头。
    const groupFilterActive =
      groupMode === "series" ? seriesActive : genreActive;
    const grouped = Boolean(groupMode) && !groupFilterActive;
    let groupPages = [];
    if (grouped) {
      const keyOf = (item) =>
        (groupMode === "series" ? item.series : item.genre) ||
        (groupMode === "series" ? "其他刊物" : "其他");
      const order = [];
      const map = new Map();
      for (const item of filtered) {
        const key = keyOf(item);
        if (!map.has(key)) {
          map.set(key, []);
          order.push(key);
        }
        map.get(key).push(item);
      }
      // 一页只装整组；组太大时按页切段并标「续」，绝不把一组拆散到无标记。
      let page = [];
      let room = PUBLIC_PAGE_SIZE;
      for (const key of order) {
        const group = map.get(key);
        let offset = 0;
        let part = 0;
        while (offset < group.length) {
          if (room === 0) {
            groupPages.push(page);
            page = [];
            room = PUBLIC_PAGE_SIZE;
          }
          const take = Math.min(room, group.length - offset);
          part += 1;
          page.push({
            key,
            part,
            total: group.length,
            items: group.slice(offset, offset + take),
          });
          offset += take;
          room -= take;
        }
      }
      if (page.length) groupPages.push(page);
    }
    const pageCount = grouped
      ? Math.max(1, groupPages.length)
      : Math.max(1, Math.ceil(filtered.length / PUBLIC_PAGE_SIZE));
    discoverPage = clamp(Number(discoverPage) || 1, 1, pageCount);
    const pageStart = (discoverPage - 1) * PUBLIC_PAGE_SIZE;
    const visible = grouped
      ? []
      : filtered.slice(pageStart, pageStart + PUBLIC_PAGE_SIZE);
    const offlineCount = publicLibrary?.books?.length || 0;
    const domainCounts = publicLibrary?.meta?.domains || {};
    const genreCounts = {};
    items.forEach((item) => {
      if (!item.genre) return;
      if (discoverDomain !== "all" && item.domain !== discoverDomain) return;
      genreCounts[item.genre] = (genreCounts[item.genre] || 0) + 1;
    });
    const catalogCount =
      Number(publicLibrary?.catalog?.count) || offlineCount || 0;
    const itemDomainCounts = {};
    items.forEach((item) => {
      if (item.domain) {
        itemDomainCounts[item.domain] = (itemDomainCounts[item.domain] || 0) + 1;
      }
    });
    const themeOrder =
      discoverDomain === "漫画"
        ? COMIC_THEMES
        : discoverDomain === "小说"
          ? DISCOVER_GENRES
          : [...DISCOVER_GENRES, ...COMIC_THEMES];
    const themeCount =
      discoverDomain === "期刊"
        ? Object.keys(periodicalThemeCounts).filter(
            (theme) => theme && !/^其他/.test(theme),
          ).length
        : Object.keys(genreCounts).filter(
            (genre) => genre && !/^其他/.test(genre),
          ).length;

    let listHtml = "";
    if (grouped && (groupPages[discoverPage - 1] || []).length) {
      listHtml = (groupPages[discoverPage - 1] || [])
        .map(
          ({ key, part, total, items }) => `<section class="discover-group">
            <header class="discover-group-head">
              <h3>${esc(key)}${part > 1 ? "（续）" : ""}</h3>
              <span>${groupMode === "series" ? `${formatNumber(total)} 期` : `${formatNumber(total)} 册`}</span>
            </header>
            ${items.map((item) => discoverItemMarkup(item, saved)).join("")}
          </section>`,
        )
        .join("");
    } else if (!grouped && visible.length) {
      listHtml = visible
        .map((item) => discoverItemMarkup(item, saved))
        .join("");
    } else {
      const emptyHead = periodicalThemeActive
        ? `「${esc(discoverPeriodicalTheme)}」主题下还没有期刊`
        : seriesActive
          ? `「${esc(discoverSeries)}」系列下还没有期刊`
          : genreActive
            ? `「${esc(discoverGenre)}」主题下还没有离线资料`
            : domainActive
              ? `「${esc(discoverDomain)}」栏目还没有离线资料`
              : "没有匹配的资料";
      const reset = periodicalThemeActive
        ? `<button class="paper-btn" type="button" data-action="set-discover-periodical-theme" data-theme="all">看全部期刊主题</button>`
        : seriesActive
          ? `<button class="paper-btn" type="button" data-action="set-discover-series" data-series="all">看全部期刊系列</button>`
          : genreActive
            ? `<button class="paper-btn" type="button" data-action="set-discover-genre" data-genre="all">看全部主题</button>`
            : domainActive
              ? `<button class="paper-btn" type="button" data-action="set-discover-domain" data-domain="all">看全部栏目</button>`
              : `<button class="paper-btn" type="button" data-view="books">去图书页</button>`;
      listHtml = `<div class="empty-state">
        <h2>${emptyHead}</h2>
        <p>${domainActive || genreActive || seriesActive || periodicalThemeActive ? "公开资料库只列出本机真实拥有的内容，不编造来源。导入相关资料后会自动归入该栏目。" : "换一个关键词，或回到图书页上传自己的文档。"}</p>
        ${reset}
      </div>`;
    }

    main.innerHTML = `
      <header class="discover-head">
        ${backButton()}
        <div class="head-center">
          <span class="cike-brand">词刻 <b>CIKE</b></span>
        </div>
        <span class="tag tag--mint">本地</span>
      </header>
      <div class="discover-title">
        <h1>资料发现</h1>
        <p>公开资料 · 私人收藏</p>
      </div>
      <p class="discover-sub">这里只列本机真实拥有的资料与词书例句，不编造不存在的来源、链接或课程。</p>

      <div class="discover-stats">
        <div><b>${formatNumber(offlineCount)}</b><span>册藏书</span></div>
        <div><b>${formatNumber(Object.values(domainCounts).filter(Boolean).length)}</b><span>个栏目</span></div>
        <div><b>${formatNumber(themeCount)}</b><span>个主题</span></div>
        <div><b>${formatNumber(catalogCount)}</b><span>册总目录</span></div>
      </div>

      <label class="discover-search">
        ${icon("search")}
        <input id="discoverSearchInput" type="search" placeholder="搜索资料、词书或例句" value="${esc(discoverQuery)}" aria-label="搜索资料">
        <span class="offline-pill">离线</span>
      </label>

      <div class="discover-filters">
        <div class="filter-row" aria-label="资料类型">
          ${filters
            .map(
              ([id, label]) => `<button class="filter-tab ${(discoverFilter || "all") === id ? "is-active" : ""}" type="button" data-action="set-discover-filter" data-filter="${id}">${label}</button>`,
            )
            .join("")}
        </div>
        <div class="filter-row" aria-label="资料语言">
          ${[
            ["all", "全部语言"],
            ["en", "英语"],
            ["fr", "法语"],
            ["zh", "中文"],
            ["none", "词书 / 语料"],
          ]
            .map(
              ([id, label]) => `<button class="filter-tab ${discoverLang === id ? "is-active" : ""}" type="button" data-action="set-discover-lang" data-lang="${id}">${label}</button>`,
            )
            .join("")}
        </div>
      <p class="discover-filter-label">公开资料库栏目</p>
        <div class="filter-row" aria-label="公开资料库栏目">
          ${["all", ...DISCOVER_DOMAIN_ORDER.filter((id) => itemDomainCounts[id])]
            .map(
              (id) => `<button class="filter-tab ${discoverDomain === id ? "is-active" : ""}" type="button" data-action="set-discover-domain" data-domain="${id}">${id === "all" ? `全部栏目 ${formatNumber(offlineCount)}` : `${id} ${formatNumber(itemDomainCounts[id] || domainCounts[id] || 0)}`}</button>`,
            )
            .join("")}
        </div>
        ${
          discoverDomain === "期刊"
            ? `<p class="discover-filter-label">期刊系列</p>
              <div class="filter-row" aria-label="期刊系列">
                ${["all", ...seriesOrder]
                  .map(
                    (id) => `<button class="filter-tab ${discoverSeries === id ? "is-active" : ""}" type="button" data-action="set-discover-series" data-series="${esc(id)}">${id === "all" ? `全部系列 ${formatNumber(periodicalTotal)}` : `${esc(id)} ${formatNumber(seriesCounts[id] || 0)}`}</button>`,
                  )
                  .join("")}
              </div>
              <p class="discover-filter-label">期刊主题</p>
              <div class="filter-row" aria-label="期刊主题">
                ${["all", ...PERIODICAL_THEMES.filter((theme) => periodicalThemeCounts[theme])]
                  .map(
                    (id) => `<button class="filter-tab ${discoverPeriodicalTheme === id ? "is-active" : ""}" type="button" data-action="set-discover-periodical-theme" data-theme="${esc(id)}">${id === "all" ? `全部主题 ${formatNumber(periodicalTotal)}` : `${esc(id)} ${formatNumber(periodicalThemeCounts[id] || 0)}`}</button>`,
                  )
                  .join("")}
              </div>`
            : ""
        }
        ${
          discoverDomain === "all" ||
          discoverDomain === "小说" ||
          (discoverDomain === "漫画" && themeCount > 0)
            ? `<p class="discover-filter-label">${discoverDomain === "小说" ? "小说主题" : discoverDomain === "漫画" ? "漫画主题" : "小说 / 漫画主题"}</p>
              <div class="filter-row" aria-label="小说与漫画主题">
                ${["all", ...themeOrder.filter((genre) => genreCounts[genre])]
                  .map(
                    (id) => `<button class="filter-tab ${discoverGenre === id ? "is-active" : ""}" type="button" data-action="set-discover-genre" data-genre="${esc(id)}">${id === "all" ? "全部主题" : `${esc(id)} ${formatNumber(genreCounts[id] || 0)}`}</button>`,
                  )
                  .join("")}
              </div>`
            : ""
        }
      </div>

      <div class="discover-list">${listHtml}</div>

      ${
        pageCount > 1
          ? `<div class="filter-row discover-pager" style="justify-content:center;margin-top:14px">
              <button class="filter-tab" type="button" data-action="set-discover-page" data-page="${discoverPage - 1}" ${discoverPage <= 1 ? "disabled" : ""}>上一页</button>
              <span class="filter-tab is-active">第 ${discoverPage} / ${pageCount} 页</span>
              <button class="filter-tab" type="button" data-action="set-discover-page" data-page="${discoverPage + 1}" ${discoverPage >= pageCount ? "disabled" : ""}>下一页</button>
            </div>`
          : ""
      }
      <p class="discover-summary">馆藏 ${formatNumber(offlineCount)} 册已离线 · 目录共 ${formatNumber(catalogCount)} 册 · 当前筛选 ${formatNumber(filtered.length)} 条 · 纸箱里已收 ${saved.size} 份记录。</p>
    `;
  }


  async function ensurePublicBookPages(book) {
    if (!book || book.kind !== "txt" || !book.assetPath) return book;
    if (Array.isArray(book.pages) && book.pages.length) return book;
    const response = await fetch(book.assetPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const pages = splitPlainTextIntoPages(text);
    if (!pages.length) throw new Error("正文为空");
    book.pages = pages;
    return book;
  }

  async function openPublicBook(bookId, button) {
    const book = (publicLibrary?.books || []).find((item) => item.id === bookId);
    if (!book) {
      showToast("找不到这本书的本地正文。");
      return;
    }
    const finish = button ? beginButtonTask(button, "正在读取…") : null;
    try {
      await ensurePublicBookPages(book);
    } catch (error) {
      finish?.();
      showToast(`读取失败：${error.message}`);
      return;
    }
    finish?.("done", "已打开");
    exitReaderDrawing({ silent: true });
    state.reader.language = book.language || "en";
    state.reader.activeBookId = book.id;
    state.reader.page = Number(state.reader.progress?.[book.id] || 0);
    startReadingClock();
    currentView = "books";
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderBackupPage() {
    const bookCount = readerBooks().length;
    const savedItems = Object.keys(state.reviewItems || {}).length;
    const meta = state.backupMeta || {};
    const history = Array.isArray(meta.history) ? meta.history : [];
    const staged = pendingBackup;

    main.innerHTML = `
      <header class="backup-head">
        ${backButton()}
        <p class="kicker" style="margin:0">PAPER ARCHIVE</p>
        <h1>本地备份</h1>
        <small>不上传 · 只写进你自己的文件</small>
      </header>

      <div class="backup-box-art" aria-hidden="true">
        <span class="box-paper"></span>
        <span class="box-paper"></span>
        <span class="box-paper"></span>
        <span class="box-body"></span>
      </div>
      <p class="backup-box-caption">把词书、复习、写译、笔记和阅读记录装进一只纸箱。</p>

      <section class="backup-panel">
        <h2>导出</h2>
        <p>基础备份是一个 JSON 文件；完整备份会把上传的 PDF、图片和资料一起打包成 ZIP。</p>
        <div class="backup-main-row">
          <button class="paper-btn" type="button" data-action="export-basic">${icon("download")}导出基础备份</button>
          <div class="backup-stamp">
            <b>${formatNumber(words.length)} 词</b>
            <span>${bookCount} 本资料</span>
          </div>
        </div>
        <div class="backup-chips">
          <span class="backup-chip">复习 <b>${savedItems}</b></span>
          <span class="backup-chip">笔记 <b>${Object.keys(state.notes || {}).length}</b></span>
          <span class="backup-chip">上次导出 <b>${meta.lastExportAt ? esc(new Date(meta.lastExportAt).toLocaleString("zh-CN")) : "—"}</b></span>
        </div>
        <div style="margin-top:10px">
          <button class="paper-btn button-wide" type="button" data-action="export-full">${icon("download")}导出完整备份（含资料文件）</button>
        </div>
      </section>

      <section class="backup-panel">
        <h2>恢复</h2>
        <p>先选中备份文件，摊开看清内容，再决定替换还是合并。不会直接覆盖当前数据。</p>
        <div class="import-file-row">
          ${icon("folder")}
          <div>
            <strong>${staged ? esc(staged.name) : "选择一个备份文件"}</strong>
            <small>${staged ? `${formatNumber(staged.size)} 字节 · ${staged.kind === "zip" ? "完整备份" : "基础备份"}` : "支持词刻导出的 JSON 或 ZIP"}</small>
          </div>
          <button class="paper-btn" type="button" data-action="import-backup">选择文件</button>
        </div>

        ${
          staged
            ? `<div class="import-preview">
                <strong>备份内容预览</strong>
                <ul>
                  <li>导出时间：${staged.exportedAt ? esc(new Date(staged.exportedAt).toLocaleString("zh-CN")) : "未标注"}</li>
                  <li>学习进度：${formatNumber(staged.summary.progress || 0)} 个词条</li>
                  <li>复习收藏：${formatNumber(staged.summary.review || 0)} 条</li>
                  <li>本地资料：${formatNumber(staged.summary.books || 0)} 本${staged.kind === "zip" ? ` · ${formatNumber(staged.summary.files || 0)} 个文件` : ""}</li>
                  <li>笔记：${formatNumber(staged.summary.notes || 0)} 条</li>
                </ul>
              </div>
              <div class="import-actions">
                <button class="paper-btn" type="button" data-action="cancel-backup-import">取消</button>
                <button class="paper-btn is-danger" type="button" data-action="confirm-backup-import" data-mode="merge">合并到当前</button>
                <button class="paper-btn" type="button" data-action="confirm-backup-import" data-mode="replace" style="background:var(--butter)">替换全部</button>
              </div>`
            : `<p class="import-steps">文件只在本机读取；完整备份会先校验每个文件的 SHA-256。</p>`
        }
        <input id="backupImportInput" type="file" accept=".json,.zip,application/json,application/zip" hidden>
      </section>

      <section class="backup-panel">
        <h2>导出记录</h2>
        ${
          history.length
            ? `<div class="backup-history">
                ${history
                  .map(
                    (row) => `<div class="backup-history-row">
                      <span>${esc(row.name || "词刻备份")}<small>${esc(new Date(row.at).toLocaleString("zh-CN"))} · ${formatNumber(row.size || 0)} 字节</small></span>
                      <span class="tag">${row.kind === "zip" ? "ZIP" : "JSON"}</span>
                    </div>`,
                  )
                  .join("")}
              </div>`
            : `<p class="import-steps">还没有导出记录。这里只记录本机导出过的文件名和时间，不保存文件内容。</p>`
        }
      </section>

      <div class="backup-danger">
        <button class="text-button danger" type="button" data-action="reset-progress">清空本机学习记录</button>
      </div>
      <p class="backup-foot">建议先导出一次，再清空。清空前会再次确认。</p>
    `;
  }

  async function stageBackupFile(file) {
    if (!file) return;
    try {
      const isZip =
        file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
      if (isZip) {
        if (!window.JSZip) throw new Error("ZIP 组件不可用。");
        const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
        const manifestFile = zip.file("manifest.json");
        if (!manifestFile) throw new Error("备份中没有 manifest.json。");
        const manifest = JSON.parse(await manifestFile.async("text"));
        if (manifest.format !== "cike-full-backup") {
          throw new Error("不是词刻完整备份格式。");
        }
        pendingBackup = {
          file,
          name: file.name,
          size: file.size,
          kind: "zip",
          exportedAt: manifest.exportedAt || "",
          summary: {
            progress: Object.keys(manifest.state?.progress || {}).length,
            review: Object.keys(manifest.state?.reviewItems || {}).length,
            books: Array.isArray(manifest.files) ? manifest.files.length : 0,
            files: Array.isArray(manifest.files) ? manifest.files.length : 0,
            notes: Object.keys(manifest.state?.notes || {}).length,
          },
        };
      } else {
        const text = await file.text();
        const payload = JSON.parse(text);
        const imported = payload?.state || payload;
        if (!imported || typeof imported !== "object" || !imported.progress) {
          throw new Error("不是词刻的基础备份。");
        }
        pendingBackup = {
          file,
          name: file.name,
          size: file.size,
          kind: "json",
          exportedAt: payload?.exportedAt || "",
          summary: {
            progress: Object.keys(imported.progress || {}).length,
            review: Object.keys(imported.reviewItems || {}).length,
            books: Array.isArray(imported.userBooks) ? imported.userBooks.length : 0,
            files: 0,
            notes: Object.keys(imported.notes || {}).length,
          },
        };
      }
      renderBackupPage();
    } catch (error) {
      console.error(error);
      showToast(`无法读取备份：${error.message}`);
    }
  }

  function recordBackupExport(name, size, kind) {
    const at = new Date().toISOString();
    const history = Array.isArray(state.backupMeta?.history)
      ? state.backupMeta.history
      : [];
    state.backupMeta = {
      lastExportAt: at,
      lastName: name,
      lastSize: Number(size || 0),
      history: [{ name, size: Number(size || 0), kind, at }, ...history].slice(0, 6),
    };
    saveState();
  }

  function renderBookShelf() {
    const typewordsActive = deck.meta.id.startsWith("tw:");
    return `<div class="book-shelf" aria-label="选择词书">
      ${books
        .map(
          (book) => `<button class="book-card ${book.meta.id === deck.meta.id ? "is-active" : ""}" type="button" data-action="switch-book" data-book-id="${esc(book.meta.id)}">
            <span>${bookLanguageBadge(book.meta.language)} · ${esc(book.meta.level || "")}</span>
            <strong>${esc(book.meta.title)}</strong>
            <span>${formatNumber(book.words.length)} 词 · ${esc(book.meta.subtitle || "")}</span>
          </button>`,
        )
        .join("")}
      ${
        typewordsCatalog
          ? `<button class="book-card ${typewordsActive ? "is-active" : ""}" type="button" data-action="open-typewords">
              <span>LANGUAGE LIBRARY · 离线</span>
              <strong>${typewordsActive ? esc(deck.meta.title) : "语言库"}</strong>
              <span>${typewordsActive ? `${formatNumber(words.length)} 词 · 当前使用中` : `${formatNumber(typewordsCatalog.meta.bookCount)} 本英语考试词书 · 全部语言已归档`}</span>
            </button>`
          : ""
      }
    </div>`;
  }

  const LANGUAGE_LIBRARY_GROUPS = [
    { id: "all", label: "全部" },
    { id: "basic", label: "基础" },
    { id: "exam", label: "考试" },
    { id: "advanced", label: "进阶" },
    { id: "pro", label: "专业" },
  ];

  function languageLibraryGroupOf(entry) {
    if (entry.kind === "builtin") {
      const id = entry.key;
      if (id === "english-medical") return "pro";
      if (/-medical$|-tech$|-law$|-finance$|-science$/.test(id)) return "pro";
      if (id === "english-10000") return "advanced";
      if (id === "cet6-core" || id === "cet6-attachment" || id === "listening-core") return "exam";
      if (entry.lang === "en") return "basic";
      const tag = String(entry.tag || "");
      if (/专业/.test(tag)) return "pro";
      if (/进阶|拓展|6000|10000|C1|C2/.test(tag)) return "advanced";
      return "basic";
    }
    if (entry.category === "代码练习") return "pro";
    if (entry.category === "青少年英语") return "basic";
    if (entry.category === "中国考试" || entry.category === "国际考试") return "exam";
    return "basic";
  }

  function languageLibraryEntries() {
    const list = [];
    for (const book of books) {
      const meta = book.meta;
      list.push({
        key: meta.id,
        kind: "builtin",
        lang: meta.language || "en",
        title: meta.title,
        desc: meta.subtitle || "",
        count: book.words.length,
        tag: meta.level || "词书",
        category: meta.level || "",
      });
    }
    for (const book of typewordsCatalog?.books || []) {
      list.push({
        key: `tw:${book.id}`,
        kind: "tw",
        lang: book.language || "en",
        title: book.name,
        desc: book.description || (book.tags || []).join(" · "),
        count: book.count,
        tag: book.category,
        category: book.category,
      });
    }
    return list;
  }

  function renderTypewordsCatalog() {
    const entries = languageLibraryEntries();
    const available = new Set(entries.map((entry) => entry.lang));
    const languages = [
      { code: "全部", label: "全部" },
      ...LANGUAGE_ORDER.filter((code) => available.has(code)).map((code) => ({
        code,
        label: LANGUAGE_META[code]?.label || code.toUpperCase(),
      })),
    ];
    const query = typewordsQuery.trim().toLowerCase();
    const activeLang = languages.some((item) => item.code === typewordsCategory)
      ? typewordsCategory
      : "全部";
    const langEntries = entries.filter((entry) => activeLang === "全部" || entry.lang === activeLang);
    const groups = LANGUAGE_LIBRARY_GROUPS.filter(
      (group) =>
        group.id === "all" ||
        langEntries.some((entry) => languageLibraryGroupOf(entry) === group.id),
    );
    const activeGroup = groups.some((group) => group.id === languageLibraryGroup)
      ? languageLibraryGroup
      : "all";
    const filtered = langEntries.filter((entry) => {
      if (activeGroup !== "all" && languageLibraryGroupOf(entry) !== activeGroup) return false;
      if (!query) return true;
      return (
        entry.title.toLowerCase().includes(query) ||
        String(entry.desc || "").toLowerCase().includes(query) ||
        String(entry.tag || "").toLowerCase().includes(query)
      );
    });
    const totalWords = entries.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
    const activeDeck = deck.meta.id;
    const isActive = (entry) =>
      activeDeck === (entry.kind === "tw" ? entry.key : entry.key) ||
      (entry.kind === "tw" && activeDeck === `tw:${String(entry.key).slice(3)}`);
    main.innerHTML = `
      ${pageHead({
        kicker: "LANGUAGE LIBRARY · 语言库",
        title: "语言库",
        sub: `${formatNumber(entries.length)} 部词书 · ${formatNumber(totalWords)} 条词条，按语言归档。当前：${deck.meta.title}`,
        backLabel: "词库",
      })}
      <div class="filter-bar language-library-bar">
        <div class="filter-tabs language-tabs">
          ${languages.map((item) => `<button class="filter-tab ${activeLang === item.code ? "is-active" : ""}" type="button" data-action="set-typewords-category" data-category="${esc(item.code)}">${esc(item.label)}</button>`).join("")}
        </div>
        <label class="sr-only" for="typewordsSearch">搜索词书</label>
        <input id="typewordsSearch" class="typewords-search" type="search" placeholder="搜索词书或词库" value="${esc(typewordsQuery)}">
      </div>
      ${
        groups.length > 1
          ? `<div class="language-group-chips">
              ${groups.map((group) => `<button class="direction-chip ${activeGroup === group.id ? "is-active" : ""}" type="button" data-action="set-language-group" data-group="${esc(group.id)}">${esc(group.label)}</button>`).join("")}
            </div>`
          : ""
      }
      <div class="typewords-grid">
        ${filtered.map((entry) => `
          <button class="typewords-card ${isActive(entry) ? "is-active" : ""}" type="button" data-action="switch-book" data-book-id="${esc(entry.key)}" aria-pressed="${isActive(entry)}">
            ${isActive(entry) ? `<span class="typewords-current-tag">当前</span>` : ""}
            <span class="typewords-category">${esc(bookLanguageBadge(entry.lang))} · ${esc(entry.tag)}</span>
            <strong>${esc(entry.title)}</strong>
            <p>${esc(entry.desc || "离线词书")}</p>
            <span>${formatNumber(entry.count)} 词</span>
          </button>
        `).join("")}
      </div>
      ${filtered.length ? "" : `<div class="empty-state"><h2>没有匹配的词书</h2><p>换一个语言、分类或关键词。</p></div>`}
    `;
  }

  function modeButton(mode, iconName, label) {
    return `<button class="mode-option ${selectedMode === mode ? "is-selected" : ""}" type="button" data-action="pick-mode" data-mode="${mode}" aria-pressed="${selectedMode === mode}">
      ${icon(iconName)}${label}
    </button>`;
  }

  function previewWordRow(item) {
    const word = item.word;
    const status = statusFor(word);
    return `<li>
      <button class="word-row" type="button" data-action="show-word" data-word-id="${esc(word.id)}">
        <span class="word-main">${esc(word.word)}</span>
        <span class="word-meaning">${esc(wordMeaning(word))}</span>
        <span class="word-meta">
          <span class="status-dot ${status.className}"></span>${esc(status.label)}
        </span>
      </button>
    </li>`;
  }

  function emptyInline(message) {
    return `<li><p style="margin:14px 0;color:var(--ink-faint);font-size:12px">${esc(message)}</p></li>`;
  }

  function filteredLibraryWords() {
    let filtered = core.filterWords(words, {
      tag: selectedTag,
      unit: selectedUnit || null,
      query: libraryQuery,
    });
    if (libraryStatus !== "all") {
      filtered = filtered.filter((word) => statusFor(word).status === libraryStatus);
    }
    return filtered;
  }

  function translateDetectLanguage(text) {
    const value = String(text || "");
    if (/[\u3040-\u30ff]/.test(value)) return "ja";
    if (/[\u4e00-\u9fff]/.test(value)) return "zh";
    if (/[äöüß]/i.test(value)) return "de";
    if (/[ñ¿¡]/i.test(value)) return "es";
    if (/[àâçéèêëîïôûùüÿœ]/i.test(value)) return "fr";
    return "en";
  }

  function translateSourceLanguage() {
    if (translateSource !== "auto") return translateSource;
    return translateDetectLanguage(translateText);
  }

  function runTranslate() {
    const text = translateText.trim();
    if (!text) {
      showToast("先输入要翻译的内容。");
      return;
    }
    const language = translateSourceLanguage();
    const tokens = tokenizeForTranslation(text);
    const wordMode = tokens.length === 1 && !/\s/.test(text);
    translateResult = {
      source: text,
      language,
      wordMode,
      offline: wordMode ? null : offlineTranslate(text, language),
    };
    render();
    if (!wordMode) {
      const serial = ++translateSerial;
      fetchSmartTranslation(text, language).then((result) => {
        if (serial !== translateSerial) return;
        const node = document.getElementById("translateOnline");
        if (!node) return;
        const label =
          result.source === "ai-cache"
            ? "AI 整句翻译 · 本机缓存"
            : result.source === "ai"
              ? "AI 整句翻译"
              : "在线整句翻译";
        node.innerHTML = result.text
          ? `<p class="reader-lookup-label">${label}</p><p class="translate-online-text">${esc(result.text)}</p>`
          : `<p class="translate-online-fail">AI 与线上翻译暂不可用，离线直译已显示在上方。</p>`;
      });
    }
  }

  async function fetchSmartTranslation(text, language) {
    const value = String(text || "").trim();
    if (!value) return { text: "", source: "" };
    if (aiReady("translate") && value.length <= 240) {
      try {
        const result = await window.CikeAI.translate(value, language, "中文");
        if (result.data) {
          return {
            text: result.data,
            source: result.cached ? "ai-cache" : "ai",
          };
        }
      } catch (error) {
        // Fall back to the free providers below.
      }
    }
    const fallback = await fetchOnlineTranslation(value, language);
    return { text: fallback, source: fallback ? "online" : "" };
  }

  // 搜索框即翻译入口：单词走全库释义，句子直接给出译文。
  function isSearchSentence(value) {
    const text = String(value || "").trim();
    if (text.length < 2) return false;
    const tokens = tokenizeForTranslation(text);
    return tokens.length >= 2 || /[。！？!?]$/.test(text);
  }

  async function fetchSearchTranslation(text, language) {
    if (hasChineseText(text)) {
      if (!window.CikeAI?.can?.("chat")) return "";
      const result = await window.CikeAI.chat([
        {
          role: "user",
          content: `把下面的中文翻译成简洁、地道的英文，只输出译文：\n${text}`,
        },
      ]);
      return String(result?.answer || "").trim();
    }
    return fetchParagraphTranslation(text, language);
  }

  function scheduleLibraryTranslation() {
    window.clearTimeout(libraryTranslateTimer);
    const text = libraryQuery.trim();
    if (!isSearchSentence(text)) return;
    libraryTranslateTimer = window.setTimeout(() => {
      hydrateLibraryTranslation(text);
    }, 550);
  }

  async function hydrateLibraryTranslation(text) {
    const serial = ++libraryTranslateSerial;
    const node = document.getElementById("libraryTranslateBody");
    if (!node) return;
    const language = translateDetectLanguage(text);
    let translated = "";
    try {
      translated = await fetchSearchTranslation(text, language);
    } catch (error) {
      translated = "";
    }
    if (serial !== libraryTranslateSerial) return;
    const target = document.getElementById("libraryTranslateBody");
    if (!target || libraryQuery.trim() !== text) return;
    target.innerHTML = translated
      ? `<p class="library-translate-output">${esc(translated)}</p>`
      : `<p class="library-translate-fail">完整译文暂不可用${
          hasChineseText(text) ? "，请先在设置里配置 AI。" : "，可稍后再试，离线直译已显示在上方。"
        }</p>`;
  }

  function renderTranslate() {
    const language = translateSourceLanguage();
    const result = translateResult;
    const offline = result && !result.wordMode ? result.offline : null;
    main.innerHTML = `
      <header class="translate-head">
        ${backButton("返回学习")}
        <p class="kicker">OFFLINE DICTIONARY · 本地词库</p>
        <h1>翻译</h1>
        <p class="page-lede">内置离线词典覆盖软件内所有词书，按语言分组。断网也能查词、读懂句子大意；联网时再补上整句机器翻译。</p>
      </header>

      <section class="translate-board">
        <div class="filter-tabs translate-source-tabs" role="group" aria-label="源语言">
          ${[
            ["auto", "自动识别"],
            ["en", "英语"],
            ["fr", "法语"],
          ]
            .map(
              ([id, label]) =>
                `<button class="filter-tab ${translateSource === id ? "is-active" : ""}" type="button" data-action="translate-source" data-source="${id}" aria-pressed="${translateSource === id}">${label}</button>`,
            )
            .join("")}
        </div>
        <label class="sr-only" for="translateInput">输入要翻译的文字</label>
        <textarea id="translateInput" class="translate-input" rows="5" placeholder="输入单词或句子，例如 serendipity / It was a quiet morning.">${esc(translateText)}</textarea>
        <div class="translate-actions">
          <span class="translate-detect">${translateSource === "auto" ? `自动识别：${languageLabel(language)}` : `按${languageLabel(language)}查词`}</span>
          <button class="paper-btn" type="button" data-action="clear-translate">清空</button>
          <button class="paper-btn is-butter" type="button" data-action="run-translate">离线翻译</button>
        </div>
      </section>

      ${
        !result
          ? `<div class="translate-empty">
              <h2>断网也能查</h2>
              <p>输入一个词，会列出所有词书里的释义；输入一句话，会按本地词典逐词给出中文词义。</p>
            </div>`
          : result.wordMode
            ? globalLookupMarkup(result.source, { compact: false }) ||
              `<div class="empty-state"><h2>本地词库暂未收录</h2><p>换一个拼写，或联网使用阅读页的整句翻译。</p></div>`
            : `<section class="translate-result">
                <header class="translate-result-head">
                  <div>
                    <p class="kicker">OFFLINE GLOSS</p>
                    <h2>离线词义直译</h2>
                  </div>
                  <span class="tag tag--yellow">命中 ${offline ? offline.hits : 0}/${offline ? offline.total : 0} 词${offline ? ` · ${offline.coverage}%` : ""}</span>
                </header>
                ${
                  offline
                    ? `<p class="translate-output">${esc(offline.output)}</p>
                       <div class="translate-rows">
                         ${offline.rows
                           .slice(0, 30)
                           .map(
                             (row) =>
                               `<span class="${row.gloss ? "" : "is-miss"}"><b>${esc(row.word)}</b>${esc(row.gloss || "未收录")}</span>`,
                           )
                           .join("")}
                       </div>`
                    : `<p class="translate-output translate-output--empty">没有可识别的文字。</p>`
                }
                <div id="translateOnline"><p class="translate-online-wait">正在尝试在线整句翻译…</p></div>
                <p class="translate-note">离线结果按本地词库逐词释义，完全在本机运行；完整译文由在线服务补充。</p>
              </section>`
      }
    `;
  }

  function renderLibrary() {
    const filtered = filteredLibraryWords();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    libraryPage = clamp(libraryPage, 1, pages);
    const start = (libraryPage - 1) * PAGE_SIZE;
    const pageWords = filtered.slice(start, start + PAGE_SIZE);
    const activeWord = activeWordId ? wordById.get(activeWordId) : null;
    const summary = currentSummary();
    const dueWords = words
      .filter((word) => {
        const item = state.progress[word.id];
        return item && item.status !== "mastered" && core.isDue(item);
      })
      .slice(0, 3);
    const searchValue = libraryQuery.trim();
    const sentenceQuery = isSearchSentence(searchValue);
    const globalMarkup = searchValue.length >= 2 ? globalLookupMarkup(searchValue) : "";
    const searchLanguage = translateDetectLanguage(searchValue);
    const offlineGloss =
      sentenceQuery && !hasChineseText(searchValue)
        ? offlineTranslate(searchValue, searchLanguage)
        : null;

    main.innerHTML = `
      <header class="library-head">
        <div>
          <h1>词<span>库</span></h1>
          <span class="library-cike">CIKE</span>
        </div>
        <div class="library-side">
          <span class="tape-tag is-mint">${bookLanguageBadge(deck.meta.language)} · ${languageLabel(deck.meta.language)}</span>
          <span class="tag tag--yellow">${searchValue ? `本词书 ${formatNumber(filtered.length)} 条` : `${formatNumber(filtered.length)} 个结果`}</span>
        </div>
      </header>

      <label class="library-search-mobile">
        ${icon("search")}
        <input id="librarySearchInput" type="search" placeholder="搜全库单词 / 整句翻译" value="${esc(libraryQuery)}" aria-label="搜索全部词书">
      </label>

      ${
        searchValue.length >= 2
          ? `<div class="library-search-results">
              ${globalMarkup}
              ${
                sentenceQuery
                  ? `<article class="paper-card library-translate" aria-labelledby="libraryTranslateTitle">
                      <header class="library-translate-head">
                        <div>
                          <p class="kicker">SEARCH · TRANSLATE</p>
                          <h2 id="libraryTranslateTitle">整句翻译</h2>
                        </div>
                        <span class="tag tag--yellow">${hasChineseText(searchValue) ? "中文 → 英文" : `${languageLabel(searchLanguage)} → 中文`}</span>
                      </header>
                      <p class="library-translate-source">${esc(searchValue)}</p>
                      ${
                        offlineGloss
                          ? `<p class="library-translate-offline"><span>离线直译</span>${esc(offlineGloss.output)}</p>`
                          : ""
                      }
                      <div id="libraryTranslateBody" class="library-translate-body">
                        <p class="library-translate-wait">正在补全完整译文…</p>
                      </div>
                    </article>`
                  : globalMarkup
                    ? ""
                    : `<article class="paper-card library-translate is-empty">
                        <p class="kicker">ALL WORDBOOKS</p>
                        <h2>全库没有「${esc(searchValue)}」</h2>
                        <p class="library-translate-tip">换个拼写试试，或者直接输入一整句——搜索框会给出译文。</p>
                      </article>`
              }
            </div>`
          : ""
      }

      <section class="book-summary" aria-labelledby="bookSummaryTitle">
        <p class="kicker">CURRENT BOOK</p>
        <div class="book-summary-title">
          <h2 id="bookSummaryTitle">${esc(deck.meta.title)}</h2>
          <button class="text-button" type="button" data-action="open-wordbook-rename" data-book-id="${esc(deck.meta.id)}">
            ${icon("pen")}改名
          </button>
        </div>
        <p class="book-sub">${esc(deck.meta.level || "")}${deck.meta.subtitle ? ` · ${esc(deck.meta.subtitle)}` : ""}</p>
        <div class="book-summary-stats">
          <div><small>已学</small><b>${formatNumber(summary.studied)}</b></div>
          <div><small>到期复习</small><b>${formatNumber(summary.due)}</b></div>
          <div><small>正确率</small><b>${summary.accuracy}%</b></div>
        </div>
        <div class="progress-track"><span style="--progress:${percent(summary.studied, words.length)}%"></span></div>
        <div class="book-actions">
          <button class="paper-btn is-mint book-start" type="button" data-action="start-session">
            ${dailyPlanButtonLabel()} ${icon("arrow")}
          </button>
          <button class="paper-btn is-ghost book-switch-entry" type="button" data-action="open-typewords">
            ${icon("library")}<span>选择词本</span>
            <small>${formatNumber(books.length + (typewordsCatalog?.books?.length || 0))} 本</small>
            ${icon("arrow")}
          </button>
        </div>
        <p class="book-switch-hint">其他词书都在语言库，按语言、考试与专业分类归档。</p>
      </section>

      ${
        dueWords.length
          ? `<div class="section-title"><h2>今天到期</h2><span>${formatNumber(summary.due)} 词</span></div>
             <div class="due-list">
               ${dueWords
                 .map(
                   (word) => `<div class="due-word">
                     <button type="button" class="due-word-main" data-action="show-word" data-word-id="${esc(word.id)}" style="all:unset;cursor:pointer;text-align:left">
                       <strong>${esc(word.word)}</strong>
                       <small>${esc(wordMeaning(word))}</small>
                     </button>
                     <button class="mini-sound" type="button" data-action="speak" data-word-id="${esc(word.id)}" aria-label="朗读 ${esc(word.word)}">${icon("volume")}</button>
                     <span class="tag">${esc(word.band)}</span>
                   </div>`,
                 )
                 .join("")}
             </div>`
          : `<div class="library-stats" style="margin-top:14px">
              <div><small>已学</small><b>${formatNumber(summary.studied)}</b></div>
              <div><small>待回炉</small><b>${formatNumber(summary.mistakes)}</b></div>
              <div><small>连续</small><b>${summary.streak || 0}<small> 天</small></b></div>
            </div>`
      }

      ${
        activeWord
          ? `<section class="paper-card is-taped" aria-labelledby="wordFocusTitle" style="margin-top:16px">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
                <div>
                  <p class="kicker">#${activeWord.rank} · ${esc(activeWord.category || activeWord.level || "词条")}</p>
                  <h2 id="wordFocusTitle" style="margin:2px 0 4px">${esc(activeWord.word)}</h2>
                  <p class="tiny">${esc(wordMeaning(activeWord))}</p>
                </div>
                <button class="icon-button" type="button" data-action="close-word" aria-label="关闭词条详情">${icon("close")}</button>
              </div>
              ${
                activeWord.example
                  ? `<div class="study-example" style="margin:12px 0 4px;text-align:left;max-width:none">${esc(activeWord.example)}
                      ${activeWord.exampleZh ? `<span class="study-example-zh">${esc(activeWord.exampleZh)}</span>` : ""}
                    </div>`
                  : ""
              }
              <div class="study-actions" style="justify-content:flex-start;margin-top:14px">
                <button class="paper-btn" type="button" data-action="speak" data-word-id="${esc(activeWord.id)}">${icon("volume")}朗读</button>
                <button class="paper-btn" type="button" data-action="study-word" data-word-id="${esc(activeWord.id)}">${icon("keyboard")}练这个词</button>
                <button class="paper-btn" type="button" data-action="toggle-mastered" data-word-id="${esc(activeWord.id)}">${icon("check")}${state.progress[activeWord.id]?.status === "mastered" ? "取消掌握" : "已掌握"}</button>
              </div>
            </section>`
          : ""
      }

      <div class="library-tools">
        <div class="filter-tabs" aria-label="词库筛选">
          ${(deck.meta.filters || [{ id: "all", label: "全部" }])
            .map(
              (filter) => `<button class="filter-tab ${selectedTag === filter.id ? "is-active" : ""}" type="button" data-action="set-tag" data-tag="${esc(filter.id)}" aria-pressed="${selectedTag === filter.id}">${esc(filter.label)}</button>`,
            )
            .join("")}
        </div>
        <div class="select-row">
          <label class="sr-only" for="unitFilter">按单元筛选</label>
          <select id="unitFilter">
            <option value="">全部单元</option>
            ${Array.from({ length: deck.meta.units }, (_, index) => `<option value="${index + 1}" ${String(index + 1) === String(selectedUnit) ? "selected" : ""}>第 ${index + 1} 单元</option>`).join("")}
          </select>
          <label class="sr-only" for="statusFilter">按学习状态筛选</label>
          <select id="statusFilter">
            <option value="all" ${libraryStatus === "all" ? "selected" : ""}>全部状态</option>
            <option value="new" ${libraryStatus === "new" ? "selected" : ""}>未学习</option>
            <option value="learning" ${libraryStatus === "learning" ? "selected" : ""}>学习中</option>
            <option value="wrong" ${libraryStatus === "wrong" ? "selected" : ""}>待回炉</option>
            <option value="mastered" ${libraryStatus === "mastered" ? "selected" : ""}>已掌握</option>
          </select>
          <button class="filter-tab" type="button" data-action="clear-filters">清筛选</button>
        </div>
        <span class="library-count">${formatNumber(start + (pageWords.length ? 1 : 0))}–${formatNumber(start + pageWords.length)} / ${formatNumber(filtered.length)}</span>
      </div>

      ${
        pageWords.length
          ? `<div class="word-table">${pageWords.map(libraryWordRow).join("")}</div>`
          : `<div class="empty-state">
              <h2>${libraryQuery.trim() ? "本词书没有，全库也许有" : "没有找到符合条件的词"}</h2>
              <p>${
                libraryQuery.trim()
                  ? "上方已按语言列出所有词书里的匹配结果；当前词书里没有，不代表软件里没有。"
                  : "换一个筛选条件，或者清空搜索词再看一次。"
              }</p>
              <button class="paper-btn" type="button" data-action="clear-filters">清空筛选</button>
            </div>`
      }

      <footer class="pagination">
        <p>第 ${libraryPage} / ${pages} 页</p>
        <div class="pagination-actions">
          <button class="paper-btn" type="button" data-action="page-prev" ${libraryPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="paper-btn" type="button" data-action="page-next" ${libraryPage >= pages ? "disabled" : ""}>下一页</button>
        </div>
      </footer>
    `;
    scheduleLibraryTranslation();
  }

  function libraryWordRow(word) {
    const status = statusFor(word);
    const marker = word.frequency
      ? `${word.frequency}次`
      : word.level || `U${word.unit}`;
    const primaryTag = word.tags?.find((tag) => tag !== "reading") || "reading";
    return `<div class="word-row-wrap">
      <button class="word-row" type="button" data-action="show-word" data-word-id="${esc(word.id)}">
        <span class="word-rank">${String(word.rank).padStart(4, "0")}</span>
        <span class="word-main">${esc(word.word)}</span>
        <span class="word-meaning">${esc(wordMeaning(word))}</span>
        <span class="word-meta">
          <span class="status-dot ${status.className}"></span>
          <span>${esc(marker)}</span>
        </span>
        <span class="tag ${primaryTag === "writing" ? "is-writing" : primaryTag === "listening" ? "is-listening" : ""}">
          ${esc(tagLabel(primaryTag)).slice(0, 3)}
        </span>
      </button>
      <button class="word-speak listen-trigger" type="button" data-action="speak" data-word-id="${esc(word.id)}" aria-label="播放 ${esc(word.word)} 的发音" title="播放发音">${icon("volume")}</button>
    </div>`;
  }

  function mistakeWords() {
    return words
      .filter((word) => {
        const item = state.progress[word.id];
        return item && Number(item.wrong || 0) > 0 && item.status !== "mastered";
      })
      .sort((a, b) => {
        const ap = state.progress[a.id];
        const bp = state.progress[b.id];
        return (
          Number(bp.wrong) - Number(ap.wrong) ||
          Number(ap.due) - Number(bp.due) ||
          a.rank - b.rank
        );
      });
  }

  function renderMistakes() {
    const mistakes = mistakeWords();
    main.innerHTML = `
      <header>
        <h1>错词回炉</h1>
        <p class="page-lede">拼错一次并不等于没学会。这里集中安排最容易再次出错的词，答对后仍保留记录，直到你把它标记为掌握。</p>
      </header>
      ${
        mistakes.length
          ? `<section class="task-board">
              <div class="task-topline">
                <span class="task-date">当前待回炉</span>
                <span class="task-stamp">${mistakes.length} 词</span>
              </div>
              <h2>先处理最容易混的词</h2>
              <p>按错误次数和到期时间排序。每次只取一组，别把错词变成一次性的清单。</p>
              <div class="task-actions" style="margin-top:22px">
                <button class="button button-primary" type="button" data-action="start-mistakes">${icon("shuffle")}开始错词复习</button>
              </div>
            </section>
            <div class="section-heading">
              <div><h2>全部错词</h2><p>点击词条查看详情</p></div>
              <button class="text-button" type="button" data-action="export-mistakes">导出错词</button>
            </div>
            <div class="word-table">
              ${mistakes.map(mistakeRow).join("")}
            </div>`
          : `<div class="empty-state">
              ${icon("check")}
              <h2>错词本是空的</h2>
              <p>开始一次默写后，拼错的词会自动进入这里，并把复习安排提前。</p>
              <button class="button button-primary" type="button" data-action="start-session">${icon("play")}开始今日学习</button>
            </div>`
      }
    `;
  }

  function mistakeRow(word) {
    const item = state.progress[word.id];
    return `<div class="word-row-wrap">
      <button class="word-row" type="button" data-action="show-word" data-word-id="${esc(word.id)}">
        <span class="word-rank">${Number(item.wrong)}×</span>
        <span class="word-main">${esc(word.word)}</span>
        <span class="word-meaning">${esc(wordMeaning(word))}</span>
        <span class="word-meta">${icon("volume")}${esc(word.band)}</span>
        <span class="tag is-writing">回炉</span>
      </button>
      <button class="word-speak listen-trigger" type="button" data-action="speak" data-word-id="${esc(word.id)}" aria-label="播放 ${esc(word.word)} 的发音" title="播放发音">${icon("volume")}</button>
    </div>`;
  }

  function writingLanguage() {
    return "en";
  }

  function writingCategories() {
    return writingLibrary?.categories || [];
  }

  function writingPassages() {
    return writingLibrary?.passages || [];
  }

  function writingCategoryById(id) {
    return (
      writingCategories().find((category) => category.id === id) ||
      writingCategories()[0] ||
      null
    );
  }

  function writingPassageById(id) {
    return (
      writingPassages().find((passage) => passage.id === id) ||
      writingPassages()[0] ||
      null
    );
  }

  function writingPhraseTotal() {
    return writingCategories().reduce(
      (sum, category) => sum + category.phrases.length,
      0,
    );
  }

  function writingDoneCount(prefix) {
    return Object.keys(state.writing.progress || {}).filter((key) =>
      key.startsWith(prefix),
    ).length;
  }

  function writingCategoryStats(category) {
    const done = Math.min(
      category.phrases.length,
      writingDoneCount(`phrase:${category.id}:`),
    );
    return {
      total: category.phrases.length,
      done,
      progress: percent(done, Math.max(1, category.phrases.length)),
    };
  }

  function writingPassageStats(passage) {
    const done = Math.min(1, writingDoneCount(`passage:${passage.id}:`));
    return { total: 1, done, progress: done ? 100 : 0 };
  }

  function writingDocsForLanguage() {
    return [];
  }

  function writingDirectionLabel(direction, language = writingLanguage()) {
    const target = language === "fr" ? "法" : "英";
    return direction === "from-zh" ? `中译${target}` : `${target}译中`;
  }

  function writingFlatLines(doc) {
    const rows = [];
    writingChapters(doc).forEach((chapter, chapterIndex) => {
      chapter.lines.forEach((line, lineIndex) => {
        if (!String(line).trim()) return;
        rows.push({
          chapterIndex,
          lineIndex,
          chapterTitle: chapter.title,
          line: String(line).trim(),
          lines: chapter.lines,
        });
      });
    });
    return rows;
  }

  function writingDocStats(doc) {
    const flat = writingFlatLines(doc);
    const prefix = `${doc.id}:`;
    const done = Object.keys(state.writing.progress || {}).filter((key) =>
      key.startsWith(prefix),
    ).length;
    return {
      total: flat.length,
      done: Math.min(flat.length, done),
      progress: percent(done, Math.max(1, flat.length)),
    };
  }

  function writingBookPair(cursor = 0, direction = "to-zh") {
    const candidates = words.filter((word) => word.example && word.exampleZh);
    if (!candidates.length) return null;
    const index = Math.abs(Number(cursor) || 0) % candidates.length;
    const word = candidates[index];
    const fromChinese = direction === "from-zh";
    return {
      source: fromChinese ? word.exampleZh : word.example,
      reference: fromChinese ? word.example : word.exampleZh,
      sourceLabel: `词书双语例句 · ${word.word}`,
      docId: "",
      chapter: 0,
      line: index,
      cursor: index,
      referenceAvailable: true,
      direction,
      language: word.language || "en",
    };
  }

  function writingSourceFromSetup(cursor = 0) {
    const setup = state.writing.setup || {};
    if (setup.type === "paragraph") {
      const passage = writingPassageById(setup.passageId);
      if (!passage) return null;
      const fromChinese = setup.direction === "from-zh";
      return {
        source: fromChinese ? passage.zh : passage.en,
        reference: fromChinese ? passage.en : passage.zh,
        sourceLabel: `整段翻译 · ${passage.title}`,
        docId: `passage:${passage.id}`,
        chapter: 0,
        line: 0,
        cursor: 0,
        referenceAvailable: true,
        direction: fromChinese ? "from-zh" : "to-zh",
        language: "en",
        kind: "paragraph",
        itemLabel: passage.title,
        total: writingPassages().length,
      };
    }
    const category = writingCategoryById(setup.categoryId);
    if (!category || !category.phrases.length) return null;
    const index =
      Math.abs(Number(cursor) || 0) % category.phrases.length;
    const phrase = category.phrases[index];
    return {
      source: phrase.zh,
      reference: phrase.en,
      sourceLabel: `${category.title} · 分句拼写`,
      docId: `phrase:${category.id}`,
      chapter: 0,
      line: index,
      cursor: index,
      referenceAvailable: true,
      direction: "from-zh",
      language: "en",
      kind: "phrase",
      itemLabel: `第 ${index + 1} / ${category.phrases.length} 个`,
      total: category.phrases.length,
      index,
    };
  }

  function writingDraftState(practice = state.writing.practice) {
    if (!practice || !practice.active) return "";
    const typed = String(practice.input || "").trim();
    if (!typed) return "还没有开始写，输入会自动保存。";
    return `草稿已保存 · ${typed.length} 字`;
  }

  function startWritingPractice({ keepSession = false, cursor = null } = {}) {
    const practice = state.writing.practice || {};
    const source = writingSourceFromSetup(
      cursor === null ? Number(practice.cursor || 0) : cursor,
    );
    if (!source) {
      showToast("还没有可练习的内容。先选择一个板块，或换一段翻译。");
      return;
    }
    const now = Date.now();
    if (!keepSession) {
      state.writing.session = {
        count: 0,
        chars: 0,
        hints: 0,
        reviewAdded: 0,
        startedAt: now,
        lastAt: 0,
      };
      cursor = 0;
      state.writing.setup.cursor = 0;
    }
    const resolved = writingSourceFromSetup(cursor);
    if (!resolved) return;
    state.writing.practice = {
      active: true,
      docId: resolved.docId,
      chapter: resolved.chapter,
      line: resolved.line,
      cursor: resolved.cursor,
      source: resolved.source,
      reference: resolved.reference || "",
      referenceAvailable: Boolean(resolved.referenceAvailable),
      sourceLabel: resolved.sourceLabel,
      mode: state.writing.setup.type,
      kind: resolved.kind || "paragraph",
      itemLabel: resolved.itemLabel || "",
      total: resolved.total || 0,
      index: resolved.index ?? null,
      direction: resolved.direction,
      language: resolved.language,
      input: "",
      hintLevel: 0,
      submittedAt: 0,
      startedAt: now,
      savedAt: now,
    };
    if (resolved.docId) {
      state.writing.docId = resolved.docId;
      state.writing.chapter = resolved.chapter;
      state.writing.board = 0;
    }
    saveState();
    currentView = "writing-practice";
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function writingHints(source, language = writingLanguage()) {
    const latinWords = String(source).match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g) || [];
    if (language === "fr" || latinWords.length >= 3) {
      const keywords = [...new Set(latinWords.filter((word) => word.length > 3))].slice(
        0,
        6,
      );
      return [
        `原文共 ${latinWords.length} 个词。先找出主语、谓语和连接词，把主干单独拎出来。`,
        `可以先处理这些关键词：${keywords.join("、") || "短句中的实词"}。`,
        "先直译主干，再调整语序和冠词/介词；不要逐词硬搬。",
      ];
    }
    const length = String(source).replace(/\s/g, "").length;
    return [
      `原文共 ${length} 个字。先按逗号、句号切成两到三个意群。`,
      "找出重复出现或带转折的词，它们通常是句子骨架。",
      "先写主干，再补修饰；最后读一遍，确认它像一句完整的话。",
    ];
  }

  function phraseHints(reference) {
    const words = String(reference || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const initials = words
      .map((word) => (word[0] ? word[0].toUpperCase() : ""))
      .join(" ");
    return [
      `标准短语共 ${words.length} 个词，先把主干词语按顺序想出来。`,
      `首字母：${initials || "—"}`,
      `最后一个词是“${words.at(-1) || ""}”。`,
    ];
  }

  function normalizeSpelling(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[.!?。！？]+$/g, "")
      .trim();
  }

  function evaluatePhrase(reference, answer) {
    const ref = String(reference || "").trim();
    const ans = String(answer || "").trim();
    const normRef = normalizeSpelling(ref);
    const normAns = normalizeSpelling(ans);
    const items = [];
    if (!ans) {
      items.push({
        title: "拼写",
        status: "improve",
        note: "还没有写下英文。先按中文提示拼出完整短语，再提交。",
      });
      return { items, strict: true, correct: false };
    }
    const correct = Boolean(normRef) && normAns === normRef;
    items.push({
      title: "拼写核对",
      status: correct ? "good" : "improve",
      note: correct
        ? "和标准短语一致，可以直接进入下一次。"
        : "和标准短语还有出入，对照标准答案再逐词读一遍。",
    });
    const refWords = ref.split(/\s+/).filter(Boolean).length;
    const ansWords = ans.split(/\s+/).filter(Boolean).length;
    items.push({
      title: "词数",
      status: refWords === ansWords ? "good" : "improve",
      note: `标准短语 ${refWords} 个词，你写了 ${ansWords} 个。`,
    });
    const refSet = new Set(normRef.split(" ").filter(Boolean));
    const ansSet = new Set(normAns.split(" ").filter(Boolean));
    const missing = [...refSet].filter((word) => !ansSet.has(word));
    const extra = [...ansSet].filter((word) => !refSet.has(word));
    if (missing.length || extra.length) {
      items.push({
        title: "词形对照",
        status: "improve",
        note: `${missing.length ? `缺少：${missing.slice(0, 6).join("、")}。` : ""}${
          extra.length ? `多写：${extra.slice(0, 6).join("、")}。` : ""
        }`,
      });
    }
    if (correct && ans !== ref) {
      items.push({
        title: "大小写与标点",
        status: "improve",
        note: "拼写正确，注意大小写、撇号或标点与原文一致。",
      });
    }
    return { items, strict: true, correct };
  }

  function evaluateWriting(source, answer, reference, direction) {
    const items = [];
    const src = String(source || "").trim();
    const ans = String(answer || "").trim();
    const zhTarget = direction !== "from-zh";
    const zhChars = (ans.match(/[\u4e00-\u9fff]/g) || []).length;
    const latinWords = (ans.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g) || []).length;
    const srcLength = src.replace(/\s/g, "").length;
    const ansLength = ans.replace(/\s/g, "").length;
    const ratio = srcLength ? ansLength / srcLength : 0;

    if (!ans) {
      items.push({
        title: "译文",
        status: "improve",
        note: "还没有写下译文。先按自己的理解写一句，再提交检查。",
      });
      return { items, zhTarget, ratio };
    }

    if (ratio < 0.35) {
      items.push({
        title: "完整度",
        status: "improve",
        note: "译文明显短于原文，可能有分句或修饰成分没有译到。",
      });
    } else if (ratio > 3.2) {
      items.push({
        title: "完整度",
        status: "improve",
        note: "译文比原文长很多，检查是否加入了原文没有的信息。",
      });
    } else {
      items.push({
        title: "完整度",
        status: "good",
        note: "译文长度与原文大致相称，先把整句意思交代完整。",
      });
    }

    if (zhTarget && latinWords >= 3 && latinWords > zhChars / 2) {
      items.push({
        title: "翻译方向",
        status: "improve",
        note: "目标语言是中文，但译文里还有较多英文词，检查是否写反了方向。",
      });
    } else if (!zhTarget && zhChars >= 4) {
      items.push({
        title: "翻译方向",
        status: "improve",
        note: "目标语言是外语，但译文里还有较多中文，检查是否写反了方向。",
      });
    } else {
      items.push({
        title: "翻译方向",
        status: "good",
        note: zhTarget
          ? "译文以中文表达，方向正确。"
          : "译文以外语表达，方向正确。",
      });
    }

    if (core.normalizeAnswer(ans) === core.normalizeAnswer(src)) {
      items.push({
        title: "照抄检查",
        status: "improve",
        note: "译文与原文完全一样，这更像抄写而不是翻译。",
      });
    }

    const endPunctuation = zhTarget ? /[。！？…；]/ : /[.!?]/;
    if (!endPunctuation.test(ans)) {
      items.push({
        title: "收句",
        status: "improve",
        note: "句末还缺一个标点，补上后再读一遍语气是否完整。",
      });
    } else {
      items.push({
        title: "收句",
        status: "good",
        note: "句末标点完整，句子有明确的收束。",
      });
    }

    if (reference) {
      const ref = String(reference).trim();
      let overlap = 0;
      if (zhTarget) {
        const bigrams = (text) =>
          new Set(
            Array.from({ length: Math.max(0, text.length - 1) }, (_, index) =>
              text.slice(index, index + 2),
            ),
          );
        const a = bigrams(ans.replace(/\s/g, ""));
        const b = bigrams(ref.replace(/\s/g, ""));
        const shared = [...a].filter((item) => b.has(item)).length;
        overlap = a.size + b.size ? Math.round((2 * shared) / (a.size + b.size) * 100) : 0;
      } else {
        const tokens = (text) =>
          new Set(
            (text.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'’-]*/g) || []).filter(
              (token) => token.length > 2,
            ),
          );
        const a = tokens(ans);
        const b = tokens(ref);
        const shared = [...a].filter((item) => b.has(item)).length;
        overlap = a.size + b.size ? Math.round((2 * shared) / (a.size + b.size) * 100) : 0;
      }
      items.push({
        title: "参考重合度",
        status: overlap >= 35 ? "good" : "improve",
        note: `与随原文提供的参考译文重合约 ${overlap}%。这只比较字词，不代表正确率。`,
      });
    }

    return { items, zhTarget, ratio };
  }

  function renderCorpus() {
    const practice = state.writing.practice || {};
    const setup = state.writing.setup || {};
    const direction = setup.direction === "from-zh" ? "from-zh" : "to-zh";
    const categories = writingCategories();
    const passages = writingPassages();
    const phraseTotal = writingPhraseTotal();
    const hasPractice = Boolean(practice.active);

    main.innerHTML = `
      <header class="writing-hero">
        ${backButton()}
        <div class="writing-hero-row">
          <div>
            <h1>写译</h1>
            <p class="writing-sub">短语拼写 · 整段翻译</p>
          </div>
        </div>
      </header>

      ${
        hasPractice
          ? `<section class="writing-continue" aria-labelledby="writingContinueTitle">
              <p class="kicker">CONTINUER · 继续上次</p>
              <h2 id="writingContinueTitle">${esc(practice.sourceLabel || "写译练习")}</h2>
              <div class="continue-meta">
                <span>${esc(practice.itemLabel || "继续练习")}</span>
                <span>已写 <b>${String(practice.input || "").length}</b> 字</span>
                <span>${practice.direction === "from-zh" ? "中译英" : "英译中"}</span>
              </div>
              <p class="tiny">${esc(String(practice.source || "").slice(0, 76))}${String(practice.source || "").length > 76 ? "…" : ""}</p>
              <button class="paper-btn is-ink" type="button" data-action="continue-writing">继续这次练习 ${icon("arrow")}</button>
              <svg class="continue-doodle" viewBox="0 0 120 120" aria-hidden="true">
                <path d="M18 84c14-26 34-44 60-52M64 24l16 6-5 17M22 46c8 8 12 18 12 30M40 30l2 14" />
              </svg>
            </section>`
          : ""
      }

      <section class="paper-card is-mint">
        <p class="kicker">PHRASES · 分句练习</p>
        <h2 style="margin:2px 0 6px;font-size:27px">看中文，拼出英文</h2>
        <p class="tiny" style="margin:0 0 12px">${formatNumber(phraseTotal)} 个短语和短句，一个短语或一个句子算一次。按板块选择，逐条拼写。</p>
        <button class="paper-btn is-butter" type="button" data-view="writing-new">选择板块开始 ${icon("arrow")}</button>
      </section>

      <section class="paper-card is-sky" style="margin-top:12px">
        <p class="kicker">PARAGRAPH · 整段翻译</p>
        <h2 style="margin:2px 0 6px;font-size:27px">英译中 / 中译英</h2>
        <p class="tiny" style="margin:0 0 10px">${formatNumber(passages.length)} 段论证示例。看英文写中文，或看中文写英文。</p>
        <div class="direction-chips" aria-label="整段翻译方向" style="margin-bottom:10px">
          ${["to-zh", "from-zh"]
            .map(
              (value) => `<button class="direction-chip ${direction === value ? "is-active" : ""}" type="button" data-action="set-writing-direction" data-direction="${value}">${value === "to-zh" ? "英译中" : "中译英"}</button>`,
            )
            .join("")}
        </div>
        <button class="paper-btn is-butter" type="button" data-action="open-paragraph-setup">选择段落开始 ${icon("arrow")}</button>
      </section>

      <section class="paper-card is-rose" style="margin-top:12px">
        <p class="kicker">ESSAY · 作文真题</p>
        <h2 style="margin:2px 0 6px;font-size:27px">六级作文历年真题</h2>
        <p class="tiny" style="margin:0 0 12px">${formatNumber(examEssays().length)} 道真题，按年份和套数练习。计时、字数统计，提交前不显示参考。</p>
        <button class="paper-btn is-ink" type="button" data-view="essay-home">进入作文真题 ${icon("arrow")}</button>
      </section>

      <section class="paper-card is-butter" style="margin-top:12px">
        <p class="kicker">TRANSLATION · 翻译真题</p>
        <h2 style="margin:2px 0 6px;font-size:27px">六级翻译历年真题</h2>
        <p class="tiny" style="margin:0 0 12px">${formatNumber(examTranslations().length)} 段中文原文，整段翻译成英文。提交后显示参考译文或“本题未提供参考答案”。</p>
        <button class="paper-btn is-ink" type="button" data-view="trans-home">进入翻译真题 ${icon("arrow")}</button>
      </section>

      <div class="section-title">
        <h2>分句板块</h2>
        <span>${categories.length} 个板块 · ${formatNumber(phraseTotal)} 条</span>
      </div>

      ${
        categories.length
          ? `<div class="writing-recent">
              ${categories
                .map((category) => {
                  const stats = writingCategoryStats(category);
                  return `<button class="recent-row" type="button" data-action="start-writing-category" data-category-id="${esc(category.id)}">
                    <span>
                      <strong>${esc(category.title)}</strong>
                      <small>${esc(category.subtitle)} · ${formatNumber(stats.total)} 条</small>
                    </span>
                    <span class="recent-progress">${stats.done}/${stats.total}</span>
                    <span class="recent-arrow" aria-hidden="true">›</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : `<div class="recent-empty">写译素材还没有载入。</div>`
      }

      <div class="section-title">
        <h2>整段翻译</h2>
        <span>${passages.length} 段 · 当前${direction === "from-zh" ? "中译英" : "英译中"}</span>
      </div>

      ${
        passages.length
          ? `<div class="writing-recent">
              ${passages
                .map((passage) => {
                  const stats = writingPassageStats(passage);
                  const words = passage.en.split(/\s+/).filter(Boolean).length;
                  return `<button class="recent-row" type="button" data-action="start-writing-passage" data-passage-id="${esc(passage.id)}">
                    <span>
                      <strong>${esc(passage.title)}</strong>
                      <small>${passage.zh.length} 字中文 · 约 ${words} 个英文词</small>
                    </span>
                    <span class="recent-progress">${stats.done ? "已完成" : "未开始"}</span>
                    <span class="recent-arrow" aria-hidden="true">›</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : `<div class="recent-empty">还没有整段翻译素材。</div>`
      }
    `;
  }

  // ---------- 六级作文 / 翻译真题 ----------

  let essayYearFilter = "all";
  let transYearFilter = "all";
  let examActive = null;
  let examTimerHandle = null;
  let examSaveTimer = null;

  function examEssays() {
    return Array.isArray(examLibrary.essays) ? examLibrary.essays : [];
  }

  function examTranslations() {
    return Array.isArray(examLibrary.translations) ? examLibrary.translations : [];
  }

  function essayById(id) {
    return examEssays().find((item) => item.id === id) || null;
  }

  function translationById(id) {
    return examTranslations().find((item) => item.id === id) || null;
  }

  function examBucket(kind) {
    const exam = state.writing.exam || (state.writing.exam = { essays: {}, translations: {} });
    if (!exam.essays) exam.essays = {};
    if (!exam.translations) exam.translations = {};
    return kind === "essay" ? exam.essays : exam.translations;
  }

  function examEnsure(kind, id) {
    const bucket = examBucket(kind);
    if (!bucket[id]) bucket[id] = { text: "", seconds: 0, submitted: false };
    return bucket[id];
  }

  function examDraft(kind, id) {
    return examBucket(kind)[id] || { text: "", seconds: 0, submitted: false };
  }

  function countEnglishWords(text) {
    return String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }

  function examYears(items) {
    return [...new Set(items.map((item) => item.year))].sort((a, b) => b - a);
  }

  function examStatusLabel(draft) {
    if (draft.submitted) return "已完成";
    if (String(draft.text || "").trim()) return "有草稿";
    return "未开始";
  }

  /* ---------- AI 写译批改 ---------- */

  const AI_GRADE_LABELS = {
    phrase: "分句拼写",
    paragraph: "整段翻译",
    translation: "六级翻译真题",
    essay: "六级作文真题",
  };

  const AI_ERROR_LABELS = {
    translation: "误译",
    omission: "漏译",
    spelling: "拼写",
    grammar: "语法",
    logic: "逻辑衔接",
    "word-choice": "用词",
    punctuation: "标点",
  };

  let aiGradeBusyKey = "";
  let aiGradeError = "";

  function textSignature(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}-${(hash >>> 0).toString(36)}`;
  }

  function aiGradeKey(kind, id, answer) {
    return `${kind || "paragraph"}:${id || "practice"}:${textSignature(answer)}`;
  }

  function aiGradeReady() {
    return Boolean(window.CikeAI?.can?.("grade"));
  }

  function writingGradeFor(result) {
    if (!result) return null;
    const key =
      result.aiGradeKey ||
      aiGradeKey(result.kind, result.docId || result.sourceLabel || "practice", result.answer);
    return state.writing.aiGrades?.[key] || result.aiGrade || null;
  }

  function examGradeFor(kind, id) {
    const draft = examDraft(kind, id);
    if (draft.aiGradeKey) return state.writing.aiGrades?.[draft.aiGradeKey] || null;
    return null;
  }

  function gradeScoreText(score) {
    const value = Number(score) || 0;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function aiGradePanel({
    kind,
    scope,
    examKind = "",
    examId = "",
    grade = null,
    label = "",
    answer = "",
    busy = false,
  }) {
    const key = scope === "writing" ? "writing" : `${examKind}:${examId}`;
    const isBusy = busy || aiGradeBusyKey === key;
    const title = label || AI_GRADE_LABELS[kind] || "写译练习";
    const ready = aiGradeReady();
    const hasGrade = Boolean(grade);
    const error = aiGradeError && !hasGrade && !isBusy ? aiGradeError : "";
    const actionAttrs =
      scope === "writing"
        ? `data-scope="writing"`
        : `data-scope="exam" data-kind="${esc(examKind)}" data-id="${esc(examId)}"`;

    return `<section class="ai-grade-card ${hasGrade ? "is-graded" : ""} ${isBusy ? "is-loading" : ""}" data-label="AI 批改">
      <header class="ai-grade-head">
        <div>
          <p class="kicker">AI REVIEW · 四六级标准</p>
          <h3>AI 专业批改</h3>
          <p class="ai-grade-sub">按${kind === "phrase" ? "拼写准确度" : "六级 15 分制"}评分，逐项指出误译、漏译、拼写、语法和逻辑问题。</p>
        </div>
        ${
          hasGrade
            ? `<div class="ai-grade-score">
                <b>${gradeScoreText(grade.score)}</b><span>/ ${gradeScoreText(grade.maxScore || (kind === "phrase" ? 100 : 15))}</span>
                <em>${esc(grade.band || "")}</em>
              </div>`
            : ""
        }
      </header>
      ${
        isBusy
          ? `<div class="ai-grade-wait"><span class="ai-typing"><i></i><i></i><i></i></span><p>正在对照标准答案批改，通常需要 5–20 秒。</p></div>`
          : hasGrade
            ? `<div class="ai-grade-body">
                ${grade.summary ? `<p class="ai-grade-summary">${esc(grade.summary)}</p>` : ""}
                ${
                  Array.isArray(grade.dimensions) && grade.dimensions.length
                    ? `<div class="ai-grade-dims">
                        ${grade.dimensions
                          .map(
                            (item) => `<article class="ai-grade-dim">
                              <div><strong>${esc(item.name)}</strong><span>${gradeScoreText(item.score)} / ${gradeScoreText(item.max)}</span></div>
                              <div class="ai-grade-dim-track"><span style="--progress:${percent(item.score, Math.max(1, item.max))}%"></span></div>
                              ${item.comment ? `<p>${esc(item.comment)}</p>` : ""}
                            </article>`,
                          )
                          .join("")}
                      </div>`
                    : ""
                }
                ${
                  Array.isArray(grade.errors) && grade.errors.length
                    ? `<div class="ai-grade-errors">
                        <h4>问题清单 <span>${grade.errors.length} 处</span></h4>
                        ${grade.errors
                          .map(
                            (item) => `<article class="ai-grade-error is-${esc(item.type)}">
                              <span class="ai-grade-type">${esc(AI_ERROR_LABELS[item.type] || item.type)}</span>
                              <p class="ai-grade-fix">${item.original ? `<s>${esc(item.original)}</s>` : ""}${item.original && item.suggestion ? " → " : ""}${item.suggestion ? `<b>${esc(item.suggestion)}</b>` : ""}</p>
                              ${item.explanation ? `<p class="ai-grade-why">${esc(item.explanation)}</p>` : ""}
                            </article>`,
                          )
                          .join("")}
                      </div>`
                    : `<p class="ai-grade-clean">没有发现明显错误。可以继续做下一步的润色练习。</p>`
                }
                ${
                  grade.polished
                    ? `<div class="ai-grade-polished">
                        <h4>AI 润色版 <span>保留你的原意</span></h4>
                        <p>${esc(grade.polished).replace(/\n/g, "<br>")}</p>
                      </div>`
                    : ""
                }
                ${
                  (Array.isArray(grade.highlights) && grade.highlights.length) ||
                  (Array.isArray(grade.nextSteps) && grade.nextSteps.length)
                    ? `<div class="ai-grade-lists">
                        ${
                          Array.isArray(grade.highlights) && grade.highlights.length
                            ? `<div><h4>值得保留</h4><ul>${grade.highlights.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`
                            : ""
                        }
                        ${
                          Array.isArray(grade.nextSteps) && grade.nextSteps.length
                            ? `<div><h4>下一步</h4><ul>${grade.nextSteps.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`
                            : ""
                        }
                      </div>`
                    : ""
                }
                <div class="ai-grade-actions">
                  <button class="paper-btn is-butter" type="button" data-action="ask-ai-grade" ${actionAttrs}>${icon("speech")}继续追问 / 查典故</button>
                  <button class="paper-btn" type="button" data-action="run-ai-grade" ${actionAttrs}>重新批改</button>
                </div>
              </div>`
            : error
              ? `<div class="ai-grade-error-state"><p>${esc(error)}</p><button class="paper-btn is-butter" type="button" data-action="run-ai-grade" ${actionAttrs}>再试一次</button></div>`
              : `<div class="ai-grade-start">
                  <p>AI 只负责批改和润色，标准答案与本地词典仍是第一依据。</p>
                  ${
                    ready
                      ? `<button class="paper-btn is-butter" type="button" data-action="run-ai-grade" ${actionAttrs}>让 AI 按四六级标准打分 ${icon("arrow")}</button>`
                      : `<p class="tiny">需要先在设置里保存 API Key，并勾选“写译批改”。</p><button class="paper-btn" type="button" data-action="open-settings">去设置 AI 接口</button>`
                  }
                </div>`
      }
    </section>`;
  }

  async function runAiGrade(scope, kind, id) {
    if (!aiGradeReady()) {
      showToast("先在设置里保存 API Key，并勾选“写译批改”。");
      return;
    }
    let payload;
    let key;
    if (scope === "writing") {
      const result = state.writing.lastResult;
      if (!result) return;
      key = aiGradeKey(
        result.kind,
        result.docId || result.sourceLabel || "practice",
        result.answer,
      );
      payload = {
        kind: result.kind,
        source: result.source,
        reference: result.reference,
        answer: result.answer,
        direction: result.direction,
      };
    } else {
      const draft = examEnsure(kind, id);
      if (!String(draft.text || "").trim()) {
        showToast("先写一点内容再批改。");
        return;
      }
      const item = kind === "essay" ? essayById(id) : translationById(id);
      key = aiGradeKey(kind, id, draft.text);
      payload = {
        kind,
        source: kind === "essay" ? item?.prompt || "" : item?.source || "",
        reference: item?.reference || "",
        answer: draft.text,
        direction: "from-zh",
      };
    }
    aiGradeBusyKey = scope === "writing" ? "writing" : `${kind}:${id}`;
    aiGradeError = "";
    render();
    try {
      const { data } = await window.CikeAI.grade(payload.kind, payload);
      const stored = { ...data, gradedAt: Date.now() };
      state.writing.aiGrades[key] = stored;
      if (scope === "writing" && state.writing.lastResult) {
        state.writing.lastResult.aiGrade = stored;
        state.writing.lastResult.aiGradeKey = key;
      } else {
        const draft = examEnsure(kind, id);
        draft.aiGradeKey = key;
      }
      saveState();
    } catch (error) {
      aiGradeError = error?.message || "批改失败，请稍后再试。";
      showToast(aiGradeError);
    } finally {
      aiGradeBusyKey = "";
      render();
    }
  }

  function askAiAboutGrade(scope, kind, id) {
    let label = AI_GRADE_LABELS[kind] || "写译练习";
    let source = "";
    let reference = "";
    let answer = "";
    let grade = null;
    if (scope === "writing") {
      const result = state.writing.lastResult;
      if (!result) return;
      label = AI_GRADE_LABELS[result.kind] || label;
      source = result.source;
      reference = result.reference;
      answer = result.answer;
      grade = writingGradeFor(result);
    } else {
      const draft = examDraft(kind, id);
      const item = kind === "essay" ? essayById(id) : translationById(id);
      source = kind === "essay" ? item?.prompt || "" : item?.source || "";
      reference = item?.reference || "";
      answer = draft.text;
      grade = examGradeFor(kind, id);
      label = AI_GRADE_LABELS[kind] || label;
    }
    const scoreLine = grade
      ? `AI 暂评 ${gradeScoreText(grade.score)} / ${gradeScoreText(grade.maxScore)}（${grade.band}）。`
      : "还没有生成 AI 评分。";
    const prompt = `请继续点评我这次${label}。
题目/原文：${source || "（无）"}
标准答案/参考译文：${reference || "（未提供）"}
我的答案：${answer}
${scoreLine}
请先指出最该优先修改的三处，再解释为什么。之后可以继续回答我关于用词、语法、句子逻辑、相关典故或文化背景的问题；如果我要润色，请在保留原意的前提下给出完整改写。`;
    aiChatContext = `写译批改 · ${label}`;
    aiChatDraft = "";
    setView("ai-chat");
    if (window.CikeAI?.can?.("chat")) {
      sendAiChat(prompt);
    } else {
      aiChatDraft = prompt;
      renderAiChat();
      showToast("先在设置里启用 AI 助手并保存 Key。");
    }
  }

  function stopExamTimer() {
    if (examTimerHandle) clearInterval(examTimerHandle);
    examTimerHandle = null;
  }

  function startExamTimer() {
    stopExamTimer();
    if (!examActive) return;
    const { kind, id } = examActive;
    const draft = examEnsure(kind, id);
    if (draft.submitted) return;
    const startSeconds = Number(draft.seconds || 0);
    const startedAt = Date.now();
    let lastSaved = startSeconds;
    examTimerHandle = setInterval(() => {
      const seconds = startSeconds + Math.floor((Date.now() - startedAt) / 1000);
      draft.seconds = seconds;
      const label = document.getElementById("examTimer");
      if (label) label.textContent = formatClock(seconds);
      if (seconds - lastSaved >= 5) {
        lastSaved = seconds;
        saveState();
      }
    }, 1000);
  }

  function persistExamDraft() {
    if (!examActive) return;
    const draft = examDraft(examActive.kind, examActive.id);
    if (examTimerHandle) draft.seconds = Number(draft.seconds || 0);
    saveState();
  }

  function examReferenceBlock(title, text, note) {
    const body = String(text || "").trim();
    return `<section class="paper-card is-mint exam-reference">
      <p class="kicker">RÉFÉRENCE · 参考</p>
      <h3 style="margin:2px 0 8px">${esc(title)}</h3>
      <p class="exam-reference-text">${body ? esc(body) : "本题未提供参考答案"}</p>
      ${note ? `<p class="tiny">${esc(note)}</p>` : ""}
    </section>`;
  }

  function renderEssayHome() {
    const items = examEssays();
    const years = examYears(items);
    const list = items.filter(
      (item) => essayYearFilter === "all" || String(item.year) === essayYearFilter,
    );
    main.innerHTML = `
      <header class="practice-head">
        <div>${backButton("返回写译")}</div>
        <div class="practice-title">
          <strong>作文真题</strong>
          <small>CET-6 · 按年份练习</small>
        </div>
        <span class="tag tag--yellow">作文</span>
      </header>

      <section class="exam-filter">
        <label for="essayYear">年份</label>
        <select id="essayYear">
          <option value="all" ${essayYearFilter === "all" ? "selected" : ""}>全部年份</option>
          ${years
            .map((year) => `<option value="${year}" ${essayYearFilter === String(year) ? "selected" : ""}>${year} 年</option>`)
            .join("")}
        </select>
        <span class="tiny">${list.length} 套</span>
      </section>

      ${
        list.length
          ? `<div class="writing-recent">
              ${list
                .map((essay) => {
                  const draft = examDraft("essay", essay.id);
                  return `<button class="recent-row" type="button" data-action="open-essay" data-id="${esc(essay.id)}">
                    <span>
                      <strong>${esc(essay.title)}</strong>
                      <small>建议 ${essay.minutes || 30} 分钟 · ${essay.minWords || 150}–${essay.maxWords || 200} 词${hasWritingAnalysis(essay, "essay") ? " · 含解析" : ""}</small>
                    </span>
                    <span class="recent-progress">${examStatusLabel(draft)}</span>
                    <span class="recent-arrow" aria-hidden="true">›</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : `<div class="recent-empty">这个年份还没有作文真题。</div>`
      }
    `;
  }

  function renderEssayPractice() {
    const essay = examActive && examActive.kind === "essay" ? essayById(examActive.id) : null;
    if (!essay) {
      currentView = "essay-home";
      render();
      return;
    }
    const draft = examEnsure("essay", essay.id);
    const words = countEnglishWords(draft.text);
    const minWords = essay.minWords || 150;
    const maxWords = essay.maxWords || 200;
    const minutes = essay.minutes || 30;
    const overLimit = words > maxWords;

    main.innerHTML = `
      <header class="practice-head">
        <div>${backButton("返回作文真题")}</div>
        <div class="practice-title">
          <strong>作文真题</strong>
          <small>${esc(essay.title)}</small>
        </div>
        <span class="tag tag--yellow">作文</span>
      </header>

      <section class="paper-card is-rose">
        <p class="kicker">PROMPT · 题目</p>
        <p class="essay-prompt">${esc(essay.prompt)}</p>
        <div class="exam-bar">
          <span>建议 ${minutes} 分钟</span>
          <span>${minWords}–${maxWords} 词</span>
          <span>计时 <b id="examTimer">${formatClock(draft.seconds || 0)}</b></span>
          <span>已写 <b id="examWords" class="${overLimit ? "is-over" : ""}">${words}</b> 词</span>
          ${
            hasWritingAnalysis(essay, "essay")
              ? `<button class="small-paper-btn" type="button" data-action="analysis-open" data-kind="essay" data-id="${esc(essay.id)}">${icon("note")}看解析</button>`
              : ""
          }
        </div>
      </section>

      <section class="translation-paper">
        <div class="translation-paper-head">
          <div>
            <h2>我的作文</h2>
            <p>先写完整，再检查结构和用词。内容会自动保存。</p>
          </div>
          <div class="translation-tools">
            <button type="button" data-action="clear-essay">${icon("trash")}清空</button>
          </div>
        </div>
        <textarea id="essayInput" class="translation-input" rows="14" placeholder="写下你的作文…" ${draft.submitted ? "readonly" : ""}>${esc(draft.text)}</textarea>
        ${
          draft.submitted
            ? `<div class="exam-actions">
                <span class="tiny">已提交 · 用时 ${formatClock(draft.seconds || 0)}</span>
                <button class="paper-btn is-ink" type="button" data-action="retry-essay">重新写一次</button>
              </div>`
            : `<div class="exam-actions">
                <span class="tiny">提交后才能看到参考答案。</span>
                <button class="paper-btn is-butter" type="button" data-action="submit-essay">提交作文 ${icon("arrow")}</button>
              </div>`
        }
      </section>

      ${
        draft.submitted
          ? `${examReferenceBlock(
              "参考范文",
              essay.reference ||
                (hasWritingAnalysis(essay, "essay")
                  ? "参考范文与逐句解析已收录，点击上方“看解析”查看原版解析。"
                  : ""),
              essay.reference ? "参考范文来自随题资料。" : "",
            )}
            ${aiGradePanel({
              kind: "essay",
              scope: "exam",
              examKind: "essay",
              examId: essay.id,
              grade: examGradeFor("essay", essay.id),
              label: essay.title,
              answer: draft.text,
              busy: aiGradeBusyKey === `essay:${essay.id}`,
            })}`
          : ""
      }
    `;
    if (!draft.submitted) startExamTimer();
  }

  function renderTransHome() {
    const items = examTranslations();
    const years = examYears(items);
    const list = items.filter(
      (item) => transYearFilter === "all" || String(item.year) === transYearFilter,
    );
    main.innerHTML = `
      <header class="practice-head">
        <div>${backButton("返回写译")}</div>
        <div class="practice-title">
          <strong>翻译真题</strong>
          <small>CET-6 · 整段中译英</small>
        </div>
        <span class="tag tag--yellow">翻译</span>
      </header>

      <section class="exam-filter">
        <label for="transYear">年份</label>
        <select id="transYear">
          <option value="all" ${transYearFilter === "all" ? "selected" : ""}>全部年份</option>
          ${years
            .map((year) => `<option value="${year}" ${transYearFilter === String(year) ? "selected" : ""}>${year} 年</option>`)
            .join("")}
        </select>
        <span class="tiny">${list.length} 套</span>
      </section>

      ${
        list.length
          ? `<div class="writing-recent">
              ${list
                .map((item) => {
                  const draft = examDraft("translation", item.id);
                  const preview = String(item.source || "").slice(0, 34);
                  return `<button class="recent-row" type="button" data-action="open-translation" data-id="${esc(item.id)}">
                    <span>
                      <strong>${esc(item.title)}</strong>
                      <small>${esc(preview)}${String(item.source || "").length > 34 ? "…" : ""}${hasWritingAnalysis(item, "translation") ? " · 含解析" : ""}</small>
                    </span>
                    <span class="recent-progress">${examStatusLabel(draft)}</span>
                    <span class="recent-arrow" aria-hidden="true">›</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : `<div class="recent-empty">这个年份还没有翻译真题。</div>`
      }
    `;
  }

  function renderTransPractice() {
    const item =
      examActive && examActive.kind === "translation"
        ? translationById(examActive.id)
        : null;
    if (!item) {
      currentView = "trans-home";
      render();
      return;
    }
    const draft = examEnsure("translation", item.id);
    const words = countEnglishWords(draft.text);
    const hasSource = Boolean(String(item.source || "").trim());

    main.innerHTML = `
      <header class="practice-head">
        <div>${backButton("返回翻译真题")}</div>
        <div class="practice-title">
          <strong>翻译真题</strong>
          <small>${esc(item.title)}</small>
        </div>
        <span class="tag tag--yellow">中译英</span>
      </header>

      <article class="source-quote">
        <q>${hasSource ? esc(item.source) : "这道题的中文原文还在核对，暂时无法练习。"}</q>
        <div class="source-tools">
          <span class="tiny">整段翻译，不要拆句。</span>
          ${item.sourceNote ? `<span class="tiny source-note">${esc(item.sourceNote)}</span>` : ""}
        </div>
      </article>

      <section class="translation-paper">
        <div class="translation-paper-head">
          <div>
            <h2>我的译文</h2>
            <p>把整段中文译成英文，内容会自动保存。</p>
          </div>
          <div class="translation-tools">
            <button type="button" data-action="clear-translation">${icon("trash")}清空</button>
          </div>
        </div>
        <div class="exam-bar">
          <span>计时 <b id="examTimer">${formatClock(draft.seconds || 0)}</b></span>
          <span>已写 <b id="examWords">${words}</b> 词</span>
          ${
            hasWritingAnalysis(item, "translation")
              ? `<button class="small-paper-btn" type="button" data-action="analysis-open" data-kind="translation" data-id="${esc(item.id)}">${icon("note")}看解析</button>`
              : ""
          }
        </div>
        <textarea id="transInput" class="translation-input" rows="12" placeholder="写下你的英文译文…" ${draft.submitted || !hasSource ? "readonly" : ""}>${esc(draft.text)}</textarea>
        ${
          draft.submitted
            ? `<div class="exam-actions">
                <span class="tiny">已提交 · 用时 ${formatClock(draft.seconds || 0)}</span>
                <button class="paper-btn is-ink" type="button" data-action="retry-translation">重新写一次</button>
              </div>`
            : `<div class="exam-actions">
                <span class="tiny">提交后才能看到参考译文。</span>
                <button class="paper-btn is-butter" type="button" data-action="submit-translation" ${hasSource ? "" : "disabled"}>提交译文 ${icon("arrow")}</button>
              </div>`
        }
      </section>

      ${
        draft.submitted
          ? `${examReferenceBlock(
                "参考译文",
                item.reference ||
                  (hasWritingAnalysis(item, "translation")
                    ? "参考译文与逐句解析已收录，点击上方“看解析”查看原版解析。"
                    : ""),
                item.referenceSource || "",
              )}
            ${aiGradePanel({
              kind: "translation",
              scope: "exam",
              examKind: "translation",
              examId: item.id,
              grade: examGradeFor("translation", item.id),
              label: item.title,
              answer: draft.text,
              busy: aiGradeBusyKey === `translation:${item.id}`,
            })}`
          : ""
      }
    `;
    if (!draft.submitted && hasSource) startExamTimer();
  }

  // ---------- 六级听力真题 ----------

  let listenSession = null;
  let listenImportDraft = null;
  let listenAudioEl = null;
  let listenAudioUrl = "";
  let listenAudioObjectUrl = false;
  let listenAudioPaperId = "";
  let listenPlaying = false;
  let listenAudioIds = null;

  function listenPapers() {
    const builtin = Array.isArray(listeningLibrary?.papers) ? listeningLibrary.papers : [];
    const custom = Array.isArray(state.listening?.customPapers) ? state.listening.customPapers : [];
    return builtin.concat(custom);
  }

  function listenPaper(id) {
    return listenPapers().find((paper) => paper.id === id) || null;
  }

  function listenAnswerMap(paper) {
    const extra = state.listening?.answers?.[paper.id] || {};
    const map = {};
    for (const q of paper.questions || []) {
      const value = extra[String(q.n)] || q.answer || "";
      if (value) map[q.n] = value;
    }
    return map;
  }

  function listenProgressOf(id) {
    return state.listening?.progress?.[id] || null;
  }

  function listenSectionQuestions(paper, section) {
    return (paper.questions || []).filter(
      (q) => section === "all" || q.section === section,
    );
  }

  function listenGroupOf(paper, number) {
    return (paper.groups || []).find((g) => number >= g.from && number <= g.to) || null;
  }

  function listenGroupLabel(paper, group) {
    if (!group) return "整卷音频";
    const index = (paper.groups || []).indexOf(group);
    const sectionName = group.type || "听力";
    return `Section ${group.section} · ${sectionName} ${index + 1} · 第 ${group.from}-${group.to} 题`;
  }

  function listenBundledAudioSrc(paper) {
    return paper && paper.audioFile ? `./audio/listening/${paper.id}.mp3` : "";
  }

  function hasListenAudio(paper) {
    if (!paper) return false;
    if (listenBundledAudioSrc(paper)) return true;
    return Boolean(listenAudioIds && listenAudioIds.has(paper.id));
  }

  function listenFilteredPapers() {
    const f = state.listening.filters;
    return listenPapers()
      .filter((paper) => {
        if (f.year !== "all" && String(paper.year) !== f.year) return false;
        if (f.month !== "all" && String(paper.month) !== f.month) return false;
        if (f.set !== "all" && String(paper.set) !== f.set) return false;
        return true;
      })
      .sort((a, b) => b.year - a.year || b.month - a.month || a.set - b.set);
  }

  async function refreshListenAudio() {
    try {
      const rows = window.CikeDB ? await window.CikeDB.getAllAudioMeta() : [];
      listenAudioIds = new Set(rows.map((row) => row.id));
    } catch {
      listenAudioIds = new Set();
    }
    if (currentView === "listening-home" || currentView === "listening-import") render();
  }

  function listenContinueTarget() {
    const entries = Object.entries(state.listening.progress || {});
    const active = entries
      .filter(([id, item]) => item && !item.submitted && listenPaper(id))
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    if (active.length) {
      return { paper: listenPaper(active[0][0]), progress: active[0][1], started: true };
    }
    const lastId = state.listening.lastPaperId;
    if (lastId && listenPaper(lastId)) {
      return { paper: listenPaper(lastId), progress: listenProgressOf(lastId), started: false };
    }
    return null;
  }

  function renderListeningHome() {
    if (!listenAudioIds) refreshListenAudio();
    const filters = state.listening.filters;
    const all = listenPapers();
    const years = [...new Set(all.map((paper) => paper.year))].sort((a, b) => b - a);
    const months = [
      ...new Set(
        all
          .filter((paper) => filters.year === "all" || String(paper.year) === filters.year)
          .map((paper) => paper.month),
      ),
    ].sort((a, b) => b - a);
    const sets = [
      ...new Set(
        all
          .filter(
            (paper) =>
              (filters.year === "all" || String(paper.year) === filters.year) &&
              (filters.month === "all" || String(paper.month) === filters.month),
          )
          .map((paper) => paper.set),
      ),
    ].sort((a, b) => a - b);
    const list = listenFilteredPapers();
    const continueTarget = listenContinueTarget();
    const audioDone = all.filter((paper) => hasListenAudio(paper)).length;
    const answerDone = all.filter((paper) => {
      const known = Object.keys(listenAnswerMap(paper)).length;
      return known === paper.questions.length;
    }).length;
    const submitted = Object.values(state.listening.progress || {}).filter(
      (item) => item?.submitted,
    ).length;

    main.innerHTML = `
      <header class="listen-head">
        ${backButton("返回学习")}
        <div class="listen-head-row">
          <div>
            <span class="tape-tag is-butter">CET-6 · 六级</span>
            <h1>听力</h1>
            <p class="listen-sub">六级真题 · 按年份练习</p>
          </div>
          <button class="small-paper-btn" type="button" data-view="listening-import">${icon("upload")}导入资料</button>
        </div>
      </header>

      <section class="listen-stats">
        <div><b>${all.length}</b><span>套真题</span></div>
        <div><b>${submitted}</b><span>套已完成</span></div>
        <div><b>${audioDone}</b><span>套音频</span></div>
        <div><b>${answerDone}</b><span>套答案齐全</span></div>
      </section>

      ${
        continueTarget
          ? `<article class="paper-card is-butter listen-continue">
              <p class="kicker">CONTINUER · 继续上次</p>
              <h2>${esc(continueTarget.paper.title)}</h2>
              <div class="continue-line">
                <p>${
                  continueTarget.progress
                    ? `第 ${Number(continueTarget.progress.index || 0) + 1} 题 · 已作答 ${Number(continueTarget.progress.answered || 0)} 题`
                    : "还没有开始，从第一题听起"
                }</p>
                <b>${listenProgressOf(continueTarget.paper.id)?.submitted ? "已完成" : "未完成"}</b>
              </div>
              <div class="listen-continue-actions">
                <button class="paper-btn is-ink" type="button" data-action="listen-start" data-paper-id="${esc(continueTarget.paper.id)}" data-section="${esc(continueTarget.progress?.section || "all")}">
                  ${continueTarget.started ? "继续作答" : "开始作答"} ${icon("arrow")}
                </button>
                ${
                  continueTarget.progress
                    ? `<button class="text-button" type="button" data-action="listen-restart" data-paper-id="${esc(continueTarget.paper.id)}">重新开始</button>`
                    : ""
                }
              </div>
            </article>`
          : `<article class="paper-card is-butter listen-continue">
              <p class="kicker">COMMENCER · 开始</p>
              <h2>从一套真题开始</h2>
              <p class="tiny" style="margin:4px 0 0">43 套真题音频已内置，直接按套作答。答案缺失的题目会显示“本题未提供答案”，不计分。</p>
            </article>`
      }

      <section class="section-title">
        <h2>练习筛选</h2>
        <span>${list.length} 套</span>
      </section>

      <div class="listen-filters">
        <label class="listen-filter">
          <span>年份</span>
          <select id="listenFilterYear">
            <option value="all">全部</option>
            ${years.map((year) => `<option value="${year}" ${filters.year === String(year) ? "selected" : ""}>${year}</option>`).join("")}
          </select>
        </label>
        <label class="listen-filter">
          <span>月份</span>
          <select id="listenFilterMonth">
            <option value="all">全部</option>
            ${months.map((month) => `<option value="${month}" ${filters.month === String(month) ? "selected" : ""}>${month} 月</option>`).join("")}
          </select>
        </label>
        <label class="listen-filter">
          <span>套题</span>
          <select id="listenFilterSet">
            <option value="all">全部</option>
            ${sets.map((set) => `<option value="${set}" ${filters.set === String(set) ? "selected" : ""}>第 ${set} 套</option>`).join("")}
          </select>
        </label>
        <label class="listen-filter">
          <span>题型</span>
          <select id="listenFilterSection">
            ${[
              ["all", "全部题型"],
              ["A", "Section A"],
              ["B", "Section B"],
              ["C", "Section C"],
            ]
              .map(([value, label]) => `<option value="${value}" ${filters.section === value ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </label>
      </div>

      ${
        list.length
          ? `<div class="listen-paper-list">
              ${list
                .map((paper) => {
                  const progress = listenProgressOf(paper.id);
                  const known = Object.keys(listenAnswerMap(paper)).length;
                  const audio = hasListenAudio(paper);
                  const answered = progress ? Number(progress.answered || 0) : 0;
                  return `<article class="listen-paper-row">
                    <div class="listen-paper-top">
                      <div>
                        <strong>${esc(paper.title)}</strong>
                        <small>${paper.questions.length} 题 · ${paper.groups.length} 段音频</small>
                      </div>
                      <span class="listen-badge ${progress?.submitted ? "is-done" : progress ? "is-active" : ""}">${
                        progress?.submitted ? "已完成" : progress ? "进行中" : "未开始"
                      }</span>
                    </div>
                    <div class="listen-paper-meta">
                      <span class="${audio ? "is-ok" : "is-wait"}">${audio ? "音频已导入" : "音频待导入"}</span>
                      <span class="${known === paper.questions.length ? "is-ok" : known ? "is-wait" : "is-off"}">${
                        known ? `答案 ${known}/${paper.questions.length}` : "答案待确认"
                      }</span>
                      ${progress?.submitted ? `<span>得分 ${progress.correct}/${progress.total}</span>` : ""}
                      ${progress && !progress.submitted ? `<span>已答 ${answered}/${paper.questions.length}</span>` : ""}
                    </div>
                    <div class="listen-paper-actions">
                      <button class="paper-btn ${progress?.submitted ? "is-ghost" : "is-butter"}" type="button" data-action="listen-start" data-paper-id="${esc(paper.id)}" data-section="${esc(filters.section)}">
                        ${progress?.submitted ? "再练一次" : progress ? "继续作答" : "开始作答"}
                      </button>
                      ${
                        progress?.submitted
                          ? `<button class="small-paper-btn" type="button" data-action="listen-view-result" data-paper-id="${esc(paper.id)}">看成绩</button>`
                          : ""
                      }
                      ${
                        hasListenAnalysis(paper)
                          ? `<button class="text-button" type="button" data-action="listen-analysis-open" data-paper-id="${esc(paper.id)}">看解析</button>`
                          : ""
                      }
                    </div>
                  </article>`;
                })
                .join("")}
            </div>`
          : `<div class="recent-empty">没有符合条件的套题。</div>`
      }
    `;
  }

  function stopListenAudio() {
    if (listenAudioEl) {
      listenAudioEl.pause();
      try {
        listenAudioEl.removeAttribute("src");
        listenAudioEl.load();
      } catch {
        /* ignore */
      }
    }
    if (listenAudioUrl && listenAudioObjectUrl) URL.revokeObjectURL(listenAudioUrl);
    listenAudioEl = null;
    listenAudioUrl = "";
    listenAudioObjectUrl = false;
    listenAudioPaperId = "";
    listenPlaying = false;
  }

  function formatClock(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const whole = Math.floor(value);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }

  function updateListenTime() {
    const node = document.getElementById("listenTime");
    if (!node || !listenAudioEl) return;
    node.textContent = `${formatClock(listenAudioEl.currentTime)} / ${formatClock(listenAudioEl.duration)}`;
    const group = listenSession?.currentGroupEnd;
    if (group && listenAudioEl.currentTime >= group) {
      listenAudioEl.pause();
      listenAudioEl.currentTime = group;
    }
  }

  function updateListenPlayButton() {
    const node = document.getElementById("listenPlay");
    if (!node) return;
    node.dataset.playing = listenPlaying ? "true" : "false";
    const label = node.querySelector("span");
    if (label) label.textContent = listenPlaying ? "暂停" : "播放";
  }

  function syncListenGroup() {
    const session = listenSession;
    if (!session) return null;
    const paper = listenPaper(session.paperId);
    const question = session.questions[session.index];
    if (!paper || !question) return null;
    const group = listenGroupOf(paper, question.n);
    const key = group ? group.id : "all";
    if (session.groupKey !== key) {
      session.groupKey = key;
      session.currentGroupEnd = group && Number(group.audioEnd) > 0 ? Number(group.audioEnd) : 0;
      if (listenAudioEl) listenAudioEl.pause();
    }
    return group;
  }

  async function ensureListenAudio(paper) {
    if (listenAudioEl && listenAudioPaperId === paper.id) return listenAudioEl;
    stopListenAudio();
    const blob = window.CikeDB ? await window.CikeDB.getAudio(paper.id) : null;
    let src = "";
    if (blob) {
      listenAudioUrl = URL.createObjectURL(blob);
      listenAudioObjectUrl = true;
      src = listenAudioUrl;
    } else {
      src = listenBundledAudioSrc(paper);
      if (!src) return null;
      listenAudioUrl = src;
      listenAudioObjectUrl = false;
    }
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.playbackRate = listenSession?.rate || 1;
    audio.addEventListener("timeupdate", updateListenTime);
    audio.addEventListener("play", () => {
      listenPlaying = true;
      updateListenPlayButton();
    });
    audio.addEventListener("pause", () => {
      listenPlaying = false;
      updateListenPlayButton();
    });
    audio.addEventListener("ended", () => {
      listenPlaying = false;
      updateListenPlayButton();
    });
    listenAudioEl = audio;
    listenAudioPaperId = paper.id;
    return audio;
  }

  function listenGroupStart(group) {
    const start = Number(group?.audioStart);
    return Number.isFinite(start) && start > 0 ? start : 0;
  }

  async function toggleListenAudio() {
    if (!listenSession) return;
    const paper = listenPaper(listenSession.paperId);
    if (!paper) return;
    const audio = await ensureListenAudio(paper);
    if (!audio) {
      showToast(
        hasListenAudio(paper)
          ? "音频读取失败，请在导入页重新选择。"
          : "这套题还没有导入音频，先到导入页添加 MP3。",
      );
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    const group = syncListenGroup();
    const start = listenGroupStart(group);
    if (!Number.isFinite(audio.currentTime) || audio.currentTime < 0.2 || audio.currentTime >= (audio.duration || Infinity) - 0.3) {
      audio.currentTime = start;
    }
    audio.playbackRate = listenSession.rate || 1;
    try {
      await audio.play();
    } catch {
      showToast("播放被浏览器拦住了，再点一次播放试试。");
    }
  }

  async function replayListenQuestion() {
    if (!listenSession) return;
    const paper = listenPaper(listenSession.paperId);
    if (!paper) return;
    const audio = await ensureListenAudio(paper);
    if (!audio) {
      showToast("这套题还没有导入音频。");
      return;
    }
    const group = syncListenGroup();
    audio.currentTime = listenGroupStart(group);
    audio.playbackRate = listenSession.rate || 1;
    try {
      await audio.play();
    } catch {
      showToast("播放被浏览器拦住了，再点一次播放试试。");
    }
  }

  function setListenRate(rate) {
    if (!listenSession) return;
    listenSession.rate = rate;
    if (listenAudioEl) listenAudioEl.playbackRate = rate;
    renderListeningPaper();
  }

  function persistListenProgress(extra = {}) {
    const session = listenSession;
    if (!session) return;
    const existing = state.listening.progress[session.paperId] || {};
    const answered = session.questions.filter((q) => session.answers[q.n]).length;
    state.listening.progress[session.paperId] = {
      ...existing,
      section: session.section,
      index: session.index,
      answers: { ...session.answers },
      startedAt: existing.startedAt || session.startedAt,
      updatedAt: Date.now(),
      elapsed: Math.round((Date.now() - session.startedAt) / 1000),
      answered,
      ...extra,
    };
    state.listening.lastPaperId = session.paperId;
    saveState();
  }

  function startListeningPaper(paperId, section = "all", { fresh = false } = {}) {
    const paper = listenPaper(paperId);
    if (!paper) return;
    const questions = listenSectionQuestions(paper, section);
    if (!questions.length) {
      showToast("这个题型下没有题目。");
      return;
    }
    const saved = listenProgressOf(paperId);
    const resume = !fresh && saved && !saved.submitted && saved.section === section;
    listenSession = {
      paperId,
      section,
      questions,
      index: resume ? Math.min(Number(saved.index || 0), questions.length - 1) : 0,
      answers: resume ? { ...(saved.answers || {}) } : {},
      startedAt: resume ? saved.startedAt || Date.now() : Date.now(),
      rate: 1,
      groupKey: "",
      currentGroupEnd: 0,
      submitted: false,
    };
    persistListenProgress();
    stopListenAudio();
    currentView = "listening-paper";
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function goListen(index) {
    if (!listenSession) return;
    listenSession.index = clamp(index, 0, listenSession.questions.length - 1);
    listenSession.cardOpen = false;
    syncListenGroup();
    persistListenProgress();
    render();
    main.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function selectListenOption(letter) {
    if (!listenSession) return;
    const question = listenSession.questions[listenSession.index];
    if (!question) return;
    listenSession.answers[question.n] = letter;
    persistListenProgress();
    render();
  }

  function submitListeningPaper() {
    const session = listenSession;
    if (!session) return;
    const paper = listenPaper(session.paperId);
    if (!paper) return;
    const key = listenAnswerMap(paper);
    const unanswered = session.questions.filter((q) => !session.answers[q.n]);
    if (unanswered.length) {
      showToast(`还有 ${unanswered.length} 题没有作答。`);
      return;
    }
    let correct = 0;
    let wrong = 0;
    let pending = 0;
    for (const q of session.questions) {
      const right = key[q.n];
      if (!right) pending += 1;
      else if (session.answers[q.n] === right) correct += 1;
      else wrong += 1;
    }
    const total = correct + wrong;
    const rate = total ? Math.round((correct / total) * 100) : 0;
    persistListenProgress({
      submitted: true,
      submittedAt: Date.now(),
      finishedAt: Date.now(),
      correct,
      wrong,
      pending,
      total: session.questions.length,
      scored: total,
      rate,
    });
    session.submitted = true;
    stopListenAudio();
    currentView = "listening-result";
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function openListeningResult(paperId) {
    const paper = listenPaper(paperId);
    const progress = listenProgressOf(paperId);
    if (!paper || !progress) return;
    listenSession = {
      paperId,
      section: progress.section || "all",
      questions: listenSectionQuestions(paper, progress.section || "all"),
      index: 0,
      answers: { ...(progress.answers || {}) },
      startedAt: progress.startedAt || Date.now(),
      rate: 1,
      groupKey: "",
      currentGroupEnd: 0,
      submitted: true,
    };
    currentView = "listening-result";
    render();
  }

  function renderListeningPaper() {
    const session = listenSession;
    if (!session) {
      currentView = "listening-home";
      renderListeningHome();
      return;
    }
    const paper = listenPaper(session.paperId);
    if (!paper) {
      currentView = "listening-home";
      renderListeningHome();
      return;
    }
    const question = session.questions[session.index];
    const group = listenGroupOf(paper, question.n);
    const answer = session.answers[question.n] || "";
    const answered = session.questions.filter((q) => session.answers[q.n]).length;
    const isLast = session.index === session.questions.length - 1;
    const audioReady = hasListenAudio(paper);
    const sectionLabel =
      session.section === "all" ? "全部题型" : `Section ${session.section}`;
    const groupNote =
      group && (Number(group.audioStart) > 0 || Number(group.audioEnd) > 0)
        ? `本段音频 ${formatClock(group.audioStart || 0)} - ${formatClock(group.audioEnd || 0)}`
        : "整卷音频连续播放；本题分段尚未标注";
    const hasSegment = Boolean(group && Number(group.audioStart) > 0);

    main.innerHTML = `
      <header class="listen-paper-head">
        ${backButton("听力")}
        <div>
          <p class="kicker">ÉCOUTER · 作答</p>
          <h1>${esc(paper.title)}</h1>
          <small>${esc(sectionLabel)} · 第 ${session.index + 1} / ${session.questions.length} 题</small>
        </div>
      </header>

      <div class="listen-question-progress" aria-label="答题进度 ${percent(answered, session.questions.length)}%">
        <span style="--progress:${percent(answered, session.questions.length)}%"></span>
      </div>

      <section class="listen-player">
        <div class="listen-player-row">
          <button class="listen-play" id="listenPlay" type="button" data-action="listen-toggle" data-playing="false">
            ${icon("play")}<span>播放</span>
          </button>
          <button class="small-paper-btn" type="button" data-action="listen-replay">${icon("refresh")}${hasSegment ? "重听本题" : "从头重听"}</button>
          <button class="small-paper-btn" type="button" data-action="listen-card">答题卡 ${answered}/${session.questions.length}</button>
          ${hasListenAnalysis(paper) ? `<button class="small-paper-btn" type="button" data-action="listen-analysis-open" data-paper-id="${esc(paper.id)}">${icon("note")}查看解析</button>` : ""}
        </div>
        <div class="listen-player-meta">
          <span>${esc(listenGroupLabel(paper, group))}</span>
          <span id="listenTime">0:00 / 0:00</span>
        </div>
        <div class="listen-rate-row" aria-label="播放速度">
          <span>速度</span>
          ${[0.8, 1, 1.25]
            .map(
              (rate) => `<button class="listen-rate ${session.rate === rate ? "is-active" : ""}" type="button" data-action="listen-rate" data-rate="${rate}">${rate === 1 ? "1.0" : String(rate)}×</button>`,
            )
            .join("")}
        </div>
        ${
          audioReady
            ? `<p class="listen-group-note">${esc(groupNote)}</p>`
            : `<div class="listen-missing">${icon("headphones")}<span>音频待导入。先到导入页选择这套题的 MP3，导入后即可离线播放。</span>
                <button class="small-paper-btn" type="button" data-view="listening-import">去导入</button></div>`
        }
      </section>

      <section class="listen-question">
        <div class="listen-question-head">
          <span class="listen-number">${question.n}</span>
          <div>
            <p class="kicker">QUESTION ${question.n}</p>
            <h2>${esc(question.stem || "本题未提供题干，请根据音频作答。")}</h2>
          </div>
        </div>
        <div class="listen-options" role="radiogroup" aria-label="第 ${question.n} 题选项">
          ${["A", "B", "C", "D"]
            .map((letter) => {
              const selected = answer === letter;
              return `<button class="listen-option ${selected ? "is-selected" : ""}" type="button" role="radio" aria-checked="${selected}" data-action="listen-select" data-letter="${letter}">
                <span class="listen-option-key">${letter}</span>
                <span class="listen-option-text">${esc(question.options?.[letter] || "（此题选项缺失）")}</span>
                <span class="listen-option-check">${selected ? icon("check") : ""}</span>
              </button>`;
            })
            .join("")}
        </div>
      </section>

      ${
        session.cardOpen
          ? `<section class="listen-card-sheet">
              <div class="listen-card-head">
                <h2>答题卡</h2>
                <button class="text-button" type="button" data-action="listen-card">收起</button>
              </div>
              <div class="listen-card-grid">
                ${session.questions
                  .map(
                    (item, index) => `<button class="listen-card-cell ${session.answers[item.n] ? "is-answered" : ""} ${index === session.index ? "is-current" : ""}" type="button" data-action="listen-jump" data-index="${index}">${item.n}</button>`,
                  )
                  .join("")}
              </div>
            </section>`
          : ""
      }

      <div class="listen-footer">
        <button class="paper-btn is-ghost" type="button" data-action="listen-prev" ${session.index === 0 ? "disabled" : ""}>上一题</button>
        ${
          isLast
            ? `<button class="paper-btn is-butter" type="button" data-action="listen-submit" ${answered === session.questions.length ? "" : "disabled"}>
                ${answered === session.questions.length ? "交卷看成绩" : `还有 ${session.questions.length - answered} 题未答`}
              </button>`
            : `<button class="paper-btn is-ink" type="button" data-action="listen-next" ${answer ? "" : "disabled"}>下一题 ${icon("arrow")}</button>`
        }
      </div>
    `;
    syncListenGroup();
    updateListenPlayButton();
  }

  function renderListeningResult() {
    const session = listenSession;
    if (!session) {
      currentView = "listening-home";
      renderListeningHome();
      return;
    }
    const paper = listenPaper(session.paperId);
    if (!paper) {
      currentView = "listening-home";
      renderListeningHome();
      return;
    }
    const progress = listenProgressOf(paper.id) || {};
    const key = listenAnswerMap(paper);
    const rows = session.questions.map((q) => {
      const right = key[q.n] || "";
      const mine = session.answers[q.n] || "";
      const stateName = !right ? "pending" : mine === right ? "correct" : "wrong";
      return { q, right, mine, stateName };
    });
    const correct = rows.filter((row) => row.stateName === "correct").length;
    const wrong = rows.filter((row) => row.stateName === "wrong").length;
    const pending = rows.filter((row) => row.stateName === "pending").length;
    const scored = correct + wrong;
    const rate = scored ? Math.round((correct / scored) * 100) : 0;
    const spent = progress.elapsed ? `${Math.max(1, Math.round(progress.elapsed / 60))} 分钟` : "未记录";
    const sectionLabel = session.section === "all" ? "全部题型" : `Section ${session.section}`;

    main.innerHTML = `
      <header class="listen-result-head">
        ${backButton("听力")}
        <p class="kicker">RÉSULTAT · 成绩</p>
        <h1>${esc(paper.title)}</h1>
        <small>${esc(sectionLabel)}</small>
      </header>

      <section class="listen-score-card">
        <div class="listen-score-main">
          <b>${correct}</b>
          <span>/ ${scored || 0} 题计分</span>
        </div>
        <div class="listen-score-meta">
          <span>正确率 <b>${scored ? rate + "%" : "—"}</b></span>
          <span>错误 <b>${wrong}</b></span>
          <span>待确认答案 <b>${pending}</b></span>
          <span>用时 <b>${spent}</b></span>
        </div>
        <div class="listen-score-bar"><span style="width:${scored ? rate : 0}%"></span></div>
        ${pending ? `<p class="listen-group-note">有 ${pending} 题没有可确认的参考答案，按“本题未提供答案”处理，不计入正确率。</p>` : ""}
      </section>

      <div class="listen-result-actions">
        <button class="paper-btn is-butter" type="button" data-action="listen-replay-paper" data-paper-id="${esc(paper.id)}">重听整套</button>
        ${hasListenAnalysis(paper) ? `<button class="paper-btn is-ink" type="button" data-action="listen-analysis-open" data-paper-id="${esc(paper.id)}">查看解析</button>` : ""}
        <button class="paper-btn is-ghost" type="button" data-action="listen-home">返回听力首页</button>
      </div>

      <div class="section-title">
        <h2>逐题回看</h2>
        <span>${rows.length} 题</span>
      </div>

      <div class="listen-review-list">
        ${rows
          .map(
            ({ q, right, mine, stateName }) => `<article class="listen-review-row is-${stateName}">
              <div class="listen-review-top">
                <span class="listen-number">${q.n}</span>
                <strong>${esc(q.stem || "本题未提供题干")}</strong>
                <span class="listen-badge ${stateName === "correct" ? "is-done" : stateName === "wrong" ? "is-wrong" : ""}">${
                  stateName === "correct" ? "正确" : stateName === "wrong" ? "错误" : "待确认"
                }</span>
              </div>
              <div class="listen-review-answers">
                <span>你的选择：<b>${mine || "未作答"}</b></span>
                <span>${
                  right
                    ? `参考答案：<b>${right}</b>`
                    : "参考答案：<b>本题未提供答案</b>"
                }</span>
              </div>
              ${
                right && q.options?.[right]
                  ? `<p class="listen-review-option">${right}) ${esc(q.options[right])}</p>`
                  : ""
              }
            </article>`,
          )
          .join("")}
      </div>
    `;
  }

  // ---------- 解析查看器（听力 / 作文 / 翻译共用，PDF 逐页渲染图） ----------

  const ANALYSIS_KINDS = {
    listening: {
      dir: "listening",
      kicker: "CORRIGÉ · 听力解析",
      manifest: () => window.CIKE_LISTENING_ANALYSIS?.papers,
    },
    essay: {
      dir: "writing",
      kicker: "CORRIGÉ · 作文解析",
      manifest: () => window.CIKE_WRITING_ANALYSIS?.papers,
    },
    translation: {
      dir: "writing",
      kicker: "CORRIGÉ · 翻译解析",
      manifest: () => window.CIKE_WRITING_ANALYSIS?.papers,
    },
  };

  const analysisState = {
    kind: "",
    key: "",
    title: "",
    returnView: "",
    page: 1,
    zoom: false,
    observer: null,
  };

  function analysisManifest(kind) {
    const papers = ANALYSIS_KINDS[kind]?.manifest();
    return papers && typeof papers === "object" ? papers : {};
  }

  function analysisOf(kind, key) {
    return key ? analysisManifest(kind)[key] || null : null;
  }

  function analysisSrc(kind, key, page) {
    const dir = ANALYSIS_KINDS[kind]?.dir || "listening";
    return `./analysis/${dir}/${key}/p${String(page).padStart(3, "0")}.webp`;
  }

  function hasListenAnalysis(paper) {
    return Boolean(paper && analysisOf("listening", paper.id));
  }

  function writingAnalysisKey(item, kind) {
    if (!item) return "";
    return `${kind === "essay" ? "essay" : "trans"}-${item.year}-${String(item.month).padStart(2, "0")}`;
  }

  function hasWritingAnalysis(item, kind) {
    return Boolean(item && analysisOf(kind, writingAnalysisKey(item, kind)));
  }

  function analysisStoredPage(kind, key, total) {
    let page = 1;
    try {
      const storageKey =
        kind === "listening"
          ? `cike.listenAnalysis.${key}`
          : `cike.analysis.${kind}.${key}`;
      page = Number(localStorage.getItem(storageKey) || 1);
    } catch {
      page = 1;
    }
    return clamp(Number.isFinite(page) ? page : 1, 1, total);
  }

  function saveAnalysisPage(kind, key, page) {
    try {
      const storageKey =
        kind === "listening"
          ? `cike.listenAnalysis.${key}`
          : `cike.analysis.${kind}.${key}`;
      localStorage.setItem(storageKey, String(page));
    } catch {
      /* 本地存储不可用时忽略 */
    }
  }

  function openAnalysis(kind, key, { title, returnView }) {
    const info = analysisOf(kind, key);
    if (!info) {
      showToast("本套解析暂未收录。");
      return;
    }
    analysisState.kind = kind;
    analysisState.key = key;
    analysisState.title = title || "";
    analysisState.returnView = returnView || "";
    analysisState.page = analysisStoredPage(kind, key, info.pages);
    analysisState.zoom = false;
    currentView = kind === "listening" ? "listening-analysis" : "writing-analysis";
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function openListeningAnalysis(paperId) {
    const paper = listenPaper(paperId);
    if (!paper) {
      showToast("本套解析暂未收录。");
      return;
    }
    openAnalysis("listening", paperId, {
      title: paper.title,
      returnView:
        currentView === "listening-paper" || currentView === "listening-result"
          ? currentView
          : "listening-home",
    });
  }

  function openWritingAnalysis(kind, id) {
    const item = kind === "essay" ? essayById(id) : translationById(id);
    if (!item) {
      showToast("本套解析暂未收录。");
      return;
    }
    const practiceView = kind === "essay" ? "essay-practice" : "trans-practice";
    const homeView = kind === "essay" ? "essay-home" : "trans-home";
    openAnalysis(kind, writingAnalysisKey(item, kind), {
      title: item.title,
      returnView: currentView === practiceView ? practiceView : homeView,
    });
  }

  function exitAnalysis() {
    const { kind, key, returnView } = analysisState;
    if (analysisState.observer) {
      analysisState.observer.disconnect();
      analysisState.observer = null;
    }
    analysisState.kind = "";
    analysisState.key = "";
    if (kind === "listening") {
      if (returnView === "listening-paper" && listenSession?.paperId === key) {
        currentView = "listening-paper";
        render();
        return;
      }
      if (returnView === "listening-result" && listenSession?.paperId === key) {
        currentView = "listening-result";
        render();
        return;
      }
      currentView = "listening-home";
      render();
      return;
    }
    if (returnView === "essay-practice" && examActive?.kind === "essay") {
      currentView = "essay-practice";
      render();
      return;
    }
    if (returnView === "trans-practice" && examActive?.kind === "translation") {
      currentView = "trans-practice";
      render();
      return;
    }
    currentView = kind === "essay" ? "essay-home" : "trans-home";
    render();
  }

  function syncAnalysisNav(page) {
    if (!analysisState.key) return;
    analysisState.page = page;
    saveAnalysisPage(analysisState.kind, analysisState.key, page);
    const now = document.getElementById("analysisNow");
    if (now) now.textContent = String(page);
    const jump = document.getElementById("analysisJump");
    if (jump) jump.value = String(page);
    const info = analysisOf(analysisState.kind, analysisState.key);
    const prev = document.querySelector('[data-action="analysis-prev"]');
    const next = document.querySelector('[data-action="analysis-next"]');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= (info?.pages || 1);
  }

  function analysisGo(page) {
    const info = analysisOf(analysisState.kind, analysisState.key);
    if (!info) return;
    const target = clamp(Number(page) || 1, 1, info.pages);
    const el = document.getElementById(`analysisPage${target}`);
    if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
    syncAnalysisNav(target);
    requestAnimationFrame(() => syncAnalysisNav(target));
  }

  function toggleAnalysisZoom() {
    analysisState.zoom = !analysisState.zoom;
    const view = document.getElementById("analysisView");
    if (view) view.classList.toggle("is-zoomed", analysisState.zoom);
    const button = document.getElementById("analysisZoomBtn");
    if (button) button.textContent = analysisState.zoom ? "适应宽度" : "放大";
    showToast(
      analysisState.zoom ? "已放大，可左右拖动查看。" : "已恢复适应屏幕宽度。",
    );
  }

  function setupAnalysisView(startPage) {
    if (analysisState.observer) {
      analysisState.observer.disconnect();
      analysisState.observer = null;
    }
    const view = document.getElementById("analysisView");
    if (!view) return;
    const pages = [...view.querySelectorAll(".listen-analysis-page")];
    if ("IntersectionObserver" in window) {
      analysisState.observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (visible) syncAnalysisNav(Number(visible.target.dataset.page));
        },
        { rootMargin: "-38% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
      );
      pages.forEach((page) => analysisState.observer.observe(page));
    }
    const target = pages[startPage - 1];
    if (target && startPage > 1) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: "start", behavior: "instant" });
        syncAnalysisNav(startPage);
      });
    }
  }

  function renderAnalysis() {
    const { kind, key, title } = analysisState;
    const info = analysisOf(kind, key);
    if (!info) {
      currentView =
        kind === "essay" ? "essay-home" : kind === "translation" ? "trans-home" : "listening-home";
      render();
      return;
    }
    const total = info.pages;
    const page = clamp(analysisState.page || 1, 1, total);
    const heights = Array.isArray(info.heights) ? info.heights : [];
    const kicker = ANALYSIS_KINDS[kind]?.kicker || "CORRIGÉ · 解析";

    main.innerHTML = `
      <header class="listen-analysis-head">
        ${backButton("返回")}
        <p class="kicker">${kicker}</p>
        <h1>${esc(title)}</h1>
        <small>共 ${total} 页 · 原解析逐页渲染，中文不会乱码</small>
      </header>

      <div class="listen-analysis-bar" id="analysisBar">
        <button class="analysis-nav-btn" type="button" data-action="analysis-prev" ${page <= 1 ? "disabled" : ""}>${icon("back")}上一页</button>
        <span class="analysis-page-count">第 <b id="analysisNow">${page}</b> / ${total} 页</span>
        <button class="analysis-nav-btn" type="button" data-action="analysis-next" ${page >= total ? "disabled" : ""}>下一页${icon("arrow")}</button>
        <label class="analysis-jump">跳至
          <select id="analysisJump" aria-label="跳转到解析页">
            ${Array.from({ length: total }, (_, index) => `<option value="${index + 1}" ${index + 1 === page ? "selected" : ""}>${index + 1}</option>`).join("")}
          </select>
        </label>
        <button class="analysis-nav-btn is-zoom" type="button" id="analysisZoomBtn" data-action="analysis-zoom">${analysisState.zoom ? "适应宽度" : "放大"}</button>
      </div>

      <div class="listen-analysis-view ${analysisState.zoom ? "is-zoomed" : ""}" id="analysisView">
        ${Array.from({ length: total }, (_, index) => {
          const number = index + 1;
          const height = heights[index] || "";
          return `<figure class="listen-analysis-page" id="analysisPage${number}" data-page="${number}">
            <img src="${analysisSrc(kind, key, number)}" alt="${esc(title)} 解析第 ${number} 页" width="${info.width || 1100}" ${height ? `height="${height}"` : ""} loading="${number <= 2 ? "eager" : "lazy"}" decoding="async" />
            <figcaption>第 ${number} 页 / ${total}</figcaption>
          </figure>`;
        }).join("")}
      </div>

      <p class="listen-analysis-tip">解析内容来自原版 PDF，按页渲染为图片以避免字体缺失造成乱码；点击“放大”后可左右拖动查看小字。</p>
    `;
    setupAnalysisView(page);
  }

  function parseListenAudioName(name) {
    const base = name.replace(/\.(mp3|m4a|wav|ogg|aac)$/i, "");
    const match = base.match(/(20\d{2})\s*[年.\-_/]\s*(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    let set = 1;
    const setMatch = base.match(/第\s*(\d)\s*套/);
    const fullMatch = base.match(/全\s*(\d)\s*套/);
    if (setMatch) set = Number(setMatch[1]);
    if (fullMatch) set = Number(fullMatch[1]);
    return { year, month, set };
  }

  function parseListenNameCode(name) {
    const match = String(name || "").match(
      /(20\d{2})\s*[年.\-_/]\s*(\d{1,2})\s*月?.*?(?:第\s*(\d)\s*套|全\s*(\d)\s*套|只考\s*(\d)\s*套)/,
    );
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      set: Number(match[3] || match[4] || match[5] || 1),
    };
  }

  function matchListenPaperByAudio(name) {
    const code = parseListenAudioName(name);
    if (!code) return null;
    return (
      listenPapers().find(
        (paper) =>
          paper.year === code.year &&
          paper.month === code.month &&
          paper.set === code.set,
      ) || null
    );
  }

  function parseListenAnswers(text) {
    const map = {};
    const re = /(\d{1,2})\s*[.、,，:：\s\-]\s*([A-D])\b/g;
    let match;
    while ((match = re.exec(String(text || "").toUpperCase()))) {
      const n = Number(match[1]);
      if (n >= 1 && n <= 25) map[n] = match[2];
    }
    return map;
  }

  function parseListenQuestionText(text, fallbackCode) {
    const cleaned = String(text || "").replace(/\r/g, "");
    const codeMatch = cleaned.match(/(\d{4})\s+(\d{2})\s+(\d)/);
    const code = codeMatch
      ? { year: Number(codeMatch[1]), month: Number(codeMatch[2]), set: Number(codeMatch[3]) }
      : fallbackCode;
    if (!code) throw new Error("无法识别年份、月份和套数，请先补充。");

    const lines = cleaned
      .split(/\n/)
      .map((line) =>
        line
          .replace(/\f/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    let section = "A";
    const groups = [];
    const questions = [];
    let current = null;
    let currentOption = "";

    const pushText = (value) => {
      if (!current || !currentOption) return;
      const piece = String(value || "").trim();
      if (!piece) return;
      current.options[currentOption] = current.options[currentOption]
        ? `${current.options[currentOption]} ${piece}`
        : piece;
    };

    for (const line of lines) {
      const sectionMatch = line.match(/^Section\s+([ABC])/i);
      if (sectionMatch) {
        section = sectionMatch[1].toUpperCase();
        current = null;
        currentOption = "";
        continue;
      }
      const groupMatch = line.match(
        /^Questions?\s+(\d{1,2})\s+to\s+(\d{1,2})\s+are based on the\s+(.*)$/i,
      );
      if (groupMatch) {
        const from = Number(groupMatch[1]);
        const to = Number(groupMatch[2]);
        const descriptor = groupMatch[3].replace(/\.$/, "").trim();
        const low = descriptor.toLowerCase();
        const type = low.includes("conversation")
          ? "长对话"
          : low.includes("recording") || low.includes("lecture")
            ? "讲座"
            : "听力篇章";
        groups.push({
          id: `g${groups.length + 1}`,
          section,
          from,
          to,
          type,
          descriptor,
          audioStart: null,
          audioEnd: null,
        });
        continue;
      }
      const start = line.match(/^(\d{1,2})\.\s*([A-D])\)?\s*(.*)$/);
      if (start) {
        current = {
          n: Number(start[1]),
          section,
          stem: "",
          options: { A: "", B: "", C: "", D: "" },
          answer: null,
          audioStart: null,
          audioEnd: null,
        };
        questions.push(current);
        currentOption = start[2];
        pushText(start[3]);
        continue;
      }
      if (!current) continue;
      const optionLine = line.match(/^([A-D])\)\s*(.*)$/);
      if (optionLine) {
        currentOption = optionLine[1];
        pushText(optionLine[2]);
        continue;
      }
      pushText(line);
    }

    if (!questions.length) throw new Error("没有从文件里读到题目序号和选项。");
    if (!groups.length) {
      groups.push({
        id: "g1",
        section: "A",
        from: 1,
        to: 8,
        type: "长对话",
        descriptor: "",
        audioStart: null,
        audioEnd: null,
      });
      groups.push({
        id: "g2",
        section: "B",
        from: 9,
        to: 15,
        type: "听力篇章",
        descriptor: "",
        audioStart: null,
        audioEnd: null,
      });
      groups.push({
        id: "g3",
        section: "C",
        from: 16,
        to: 25,
        type: "讲座",
        descriptor: "",
        audioStart: null,
        audioEnd: null,
      });
    }
    return {
      id: `cet6-${code.year}-${String(code.month).padStart(2, "0")}-set${code.set}`,
      year: code.year,
      month: code.month,
      set: code.set,
      title: `${code.year}年${code.month}月 六级听力 第${code.set}套`,
      audioFile: null,
      audioBytes: 0,
      source: "用户导入",
      groups,
      questions: questions.sort((a, b) => a.n - b.n),
    };
  }

  function renderListeningImport() {
    const draft = listenImportDraft || { audio: [], answers: null, paper: null };
    const papers = listenPapers();
    const answerPaperId =
      draft.answerPaperId || papers[0]?.id || "";
    const audioRows = draft.audio || [];

    main.innerHTML = `
      <header class="listen-head">
        ${backButton("听力")}
        <div class="listen-head-row">
          <div>
            <span class="tape-tag is-mint">IMPORTER · 导入</span>
            <h1>听力资料</h1>
            <p class="listen-sub">音频、答案、题库都保存在本机</p>
          </div>
        </div>
      </header>

      <section class="paper-card is-sky">
        <p class="kicker">AUDIO · 音频</p>
        <h2>导入 MP3</h2>
        <p class="tiny" style="margin:2px 0 12px">43 套真题音频已随程序内置。这里可以补充或替换 MP3：文件名含“年份 + 月份 + 第几套”会自动匹配，导入后存进浏览器数据库。</p>
        <button class="paper-btn is-butter" type="button" data-action="listen-pick-audio">${icon("upload")}选择 MP3（可多选）</button>
        <input id="listenAudioInput" type="file" accept=".mp3,.m4a,.wav,.ogg,.aac,audio/*" multiple hidden />
        ${
          audioRows.length
            ? `<div class="listen-import-table">
                ${audioRows
                  .map(
                    (row, index) => `<div class="listen-import-row">
                      <div>
                        <strong>${esc(row.name)}</strong>
                        <small>${(row.size / 1024 / 1024).toFixed(1)} MB</small>
                      </div>
                      <select data-listen-audio-map="${index}" aria-label="匹配套题">
                        <option value="">不导入</option>
                        ${papers
                          .map(
                            (paper) => `<option value="${esc(paper.id)}" ${row.paperId === paper.id ? "selected" : ""}>${esc(paper.title)}</option>`,
                          )
                          .join("")}
                      </select>
                      <span class="listen-import-state ${row.paperId ? "is-ok" : "is-wait"}">${row.paperId ? "已匹配" : "待匹配"}</span>
                    </div>`,
                  )
                  .join("")}
              </div>
              <button class="paper-btn is-ink" style="margin-top:10px" type="button" data-action="listen-save-audio" ${audioRows.some((row) => row.paperId) ? "" : "disabled"}>保存到本地音频库</button>`
            : ""
        }
      </section>

      <section class="paper-card is-mint" style="margin-top:14px">
        <p class="kicker">RÉPONSES · 答案</p>
        <h2>补录答案</h2>
        <p class="tiny" style="margin:2px 0 10px">支持“1.D 2.A 3.B”或每行“1 D”。保存前先预览，只保存你确认的答案。</p>
        <label class="listen-filter" style="margin-bottom:10px">
          <span>套题</span>
          <select id="listenAnswerPaper">
            ${papers
              .map(
                (paper) => `<option value="${esc(paper.id)}" ${answerPaperId === paper.id ? "selected" : ""}>${esc(paper.title)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <textarea id="listenAnswerText" rows="4" placeholder="1.D 2.A 3.B 4.C ...">${esc(draft.answerText || "")}</textarea>
        <div class="listen-import-actions">
          <button class="paper-btn is-ghost" type="button" data-action="listen-preview-answers">预览</button>
          <button class="paper-btn is-ink" type="button" data-action="listen-save-answers" ${draft.answerPreview ? "" : "disabled"}>保存答案</button>
        </div>
        ${
          draft.answerPreview
            ? `<div class="listen-answer-preview">
                ${draft.answerPreview
                  .map(
                    (item) => `<span class="${item.letter ? "is-ok" : "is-wait"}">${item.n}${item.letter ? "." + item.letter : " · 缺"}</span>`,
                  )
                  .join("")}
              </div>`
            : ""
        }
      </section>

      <section class="paper-card is-butter" style="margin-top:14px">
        <p class="kicker">SUJETS · 题库</p>
        <h2>导入题目</h2>
        <p class="tiny" style="margin:2px 0 10px">支持带 A) B) C) D) 选项的 PDF、TXT 或 JSON。解析后会先给你看预览，确认才写入本地题库。</p>
        <button class="paper-btn is-ghost" type="button" data-action="listen-pick-questions">${icon("folder")}选择题目文件</button>
        <input id="listenQuestionInput" type="file" accept=".pdf,.txt,.json" hidden />
        ${
          draft.paper
            ? `<div class="listen-import-preview">
                <div class="listen-import-row">
                  <div>
                    <strong>${esc(draft.paper.paper.title)}</strong>
                    <small>${draft.paper.paper.questions.length} 题 · ${draft.paper.paper.groups.length} 段 · 来源 ${esc(draft.paper.sourceName)}</small>
                  </div>
                  <span class="listen-import-state is-wait">待确认</span>
                </div>
                <div class="listen-answer-preview">
                  ${draft.paper.paper.questions
                    .slice(0, 25)
                    .map((q) => `<span class="${q.options.A && q.options.D ? "is-ok" : "is-wait"}">${q.n}</span>`)
                    .join("")}
                </div>
                <button class="paper-btn is-ink" style="margin-top:10px" type="button" data-action="listen-save-paper">确认写入题库</button>
              </div>`
            : ""
        }
      </section>
    `;
  }

  function renderWritingNew() {
    const setup = state.writing.setup || {};
    const type = setup.type === "paragraph" ? "paragraph" : "sentence";
    const direction = setup.direction === "from-zh" ? "from-zh" : "to-zh";
    const categories = writingCategories();
    const passages = writingPassages();
    const selectedCategory = writingCategoryById(setup.categoryId);
    const selectedPassage = writingPassageById(setup.passageId);
    const canStart =
      type === "paragraph"
        ? Boolean(selectedPassage)
        : Boolean(selectedCategory && selectedCategory.phrases.length);

    main.innerHTML = `
      <header class="new-training-head">
        <div style="display:flex;justify-content:flex-start">${backButton("返回写译首页")}</div>
        <span class="cike-brand" style="text-align:center">词刻 <b>CIKE</b></span>
        <p class="kicker" style="text-align:center">NOUVELLE PAGE</p>
        <h1>新建训练</h1>
        <p>分句拼写，或整段翻译。</p>
      </header>

      <section class="form-section">
        <h2>练习类型</h2>
        <p>分句练习只写一个短语或句子；整段翻译用图片里的论证段落。</p>
        <div class="choice-row">
          <button class="choice-tile ${type === "sentence" ? "is-active" : ""}" type="button" data-action="set-writing-type" data-type="sentence">
            <strong>分句练习</strong>
            <small>一次一个短语/句子 · 看中文拼英文</small>
          </button>
          <button class="choice-tile is-sky ${type === "paragraph" ? "is-active" : ""}" type="button" data-action="set-writing-type" data-type="paragraph">
            <strong>整段翻译</strong>
            <small>一段中英对照 · 可选方向</small>
          </button>
        </div>
      </section>

      ${
        type === "sentence"
          ? `<section class="form-section">
              <h2>选择板块</h2>
              <p>${categories.length} 个板块，${formatNumber(writingPhraseTotal())} 条短语和短句。</p>
              <div class="doc-picker">
                ${categories
                  .map((category) => {
                    const stats = writingCategoryStats(category);
                    return `<button class="doc-picker-row ${selectedCategory?.id === category.id ? "is-active" : ""}" type="button" data-action="set-writing-category" data-category-id="${esc(category.id)}">
                      <span><strong>${esc(category.title)}</strong><br><small>${esc(category.subtitle)} · ${stats.done}/${stats.total}</small></span>
                      <span>${selectedCategory?.id === category.id ? "✓" : "›"}</span>
                    </button>`;
                  })
                  .join("")}
              </div>
              <p class="tiny" style="margin-top:10px">分句练习固定为看中文、拼英文，一个短语或一个句子算一次。</p>
            </section>`
          : `<section class="form-section">
              <h2>选择段落</h2>
              <p>${passages.length} 段论证示例，每段都带中英对照。</p>
              <div class="doc-picker">
                ${passages
                  .map(
                    (passage) => `<button class="doc-picker-row ${selectedPassage?.id === passage.id ? "is-active" : ""}" type="button" data-action="set-writing-passage" data-passage-id="${esc(passage.id)}">
                      <span><strong>${esc(passage.title)}</strong><br><small>${passage.zh.length} 字中文 · ${passage.en.split(/\s+/).filter(Boolean).length} 个英文词</small></span>
                      <span>${selectedPassage?.id === passage.id ? "✓" : "›"}</span>
                    </button>`,
                  )
                  .join("")}
              </div>
            </section>

            <section class="form-section">
              <h2>翻译方向</h2>
              <p>英译中看英文写中文；中译英看中文写英文。</p>
              <div class="choice-row">
                ${["to-zh", "from-zh"]
                  .map(
                    (value) => `<button class="choice-tile ${direction === value ? "is-active" : ""}" type="button" data-action="set-writing-direction" data-direction="${value}">
                      <strong>${value === "to-zh" ? "英译中" : "中译英"}</strong>
                      <small>${value === "to-zh" ? "看英文，写中文" : "看中文，写英文"}</small>
                    </button>`,
                  )
                  .join("")}
              </div>
            </section>`
      }

      <section class="form-section">
        <h2>难度</h2>
        <p>轻松模式多给提示，挑战模式先让你自己写完。</p>
        <div class="choice-row">
          ${[
            ["easy", "轻松"],
            ["normal", "标准"],
            ["hard", "挑战"],
          ]
            .map(
              ([value, label]) => `<button class="choice-tile ${setup.difficulty === value ? "is-active" : ""}" type="button" data-action="set-writing-difficulty" data-difficulty="${value}">${label}</button>`,
            )
            .join("")}
        </div>
      </section>

      <div class="start-training-wrap">
        <button class="paper-btn is-butter" type="button" data-action="start-writing-practice" ${canStart ? "" : "disabled"}>
          开始${type === "paragraph" ? "整段翻译" : "分句练习"} ${icon("arrow")}
        </button>
        <p>${
          type === "paragraph"
            ? direction === "from-zh"
              ? "中文原文会先出现，英文译文由你来写。"
              : "英文原文会先出现，中文译文由你来写。"
            : "中文提示会先出现，写出完整的英文短语或句子。"
        }</p>
        <button class="draft-link" type="button" data-action="save-writing-setup">保存这份设置</button>
      </div>
    `;
  }

  function renderWritingPractice() {
    const practice = state.writing.practice || {};
    if (!practice.active) {
      currentView = "corpus";
      renderCorpus();
      return;
    }
    const isPhrase = practice.kind === "phrase";
    const hints = isPhrase
      ? phraseHints(practice.reference)
      : writingHints(practice.source || "", practice.language || writingLanguage());
    const hintCount = setupHintCount(practice);
    const input = String(practice.input || "");
    const source = String(practice.source || "");
    const reference = String(practice.reference || "");
    const wordCount = input.replace(/\s/g, "").length;
    const targetLength = isPhrase
      ? Math.max(1, reference.length)
      : Math.max(12, source.length);

    main.innerHTML = `
      <header class="practice-head">
        <div>${backButton()}</div>
        <div class="practice-title">
          <strong>${isPhrase ? "分句练习" : "整段翻译"}</strong>
          <small>${esc(practice.sourceLabel || "写译练习")}</small>
        </div>
        <span class="tag tag--yellow">${isPhrase ? "拼写" : practice.direction === "from-zh" ? "中译英" : "英译中"}</span>
      </header>

      <div class="practice-progress">
        <div class="practice-progress-label">
          <span>${isPhrase ? esc(practice.itemLabel || "本次练习") : `本次第 ${Number(state.writing.session?.count || 0) + 1} 段`}</span>
          <span>${isPhrase ? "看中文 · 拼英文" : practice.direction === "from-zh" ? "看中文 · 写英文" : "看英文 · 写中文"}</span>
        </div>
        <div class="progress-track"><span style="--progress:${percent(wordCount, targetLength)}%"></span></div>
      </div>

      <article class="source-quote">
        <q>${esc(source || "这一页没有可读取的原文。")}</q>
        <div class="source-tools">
          <button type="button" data-action="speak-writing-source">${icon("volume")}${isPhrase ? "听英文" : "朗读"}</button>
          <button type="button" data-action="writing-hint">${icon("lightbulb")}给点提示</button>
        </div>
      </article>

      <section class="translation-paper">
        <div class="translation-paper-head">
          <div>
            <h2>${isPhrase ? "我的拼写" : "我的翻译"}</h2>
            <p>${isPhrase ? "按标准短语逐词写完整，大小写和撇号也留意。" : "先用完整句子写下来，不急着完美。"}</p>
          </div>
          <div class="translation-tools">
            <button type="button" data-action="clear-writing-input">${icon("trash")}清空</button>
            <button type="button" data-action="writing-hint">${icon("lightbulb")}提示</button>
          </div>
        </div>
        <textarea id="writingPracticeInput" class="translation-input" rows="${isPhrase ? 4 : 9}" placeholder="${
          isPhrase
            ? "输入完整的英文短语或句子…"
            : practice.direction === "from-zh"
              ? "写下你的英文译文…"
              : "写下你的中文译文…"
        }">${esc(input)}</textarea>
        <p class="draft-state ${input.trim() ? "is-saved" : ""}">${esc(writingDraftState(practice))}</p>
        <div class="hint-row">
          ${Array.from({ length: hintCount }, (_, index) => `<span class="hint-chip">提示 ${index + 1} · ${esc(hints[index])}</span>`).join("")}
          ${hintCount === 0 ? `<span class="tiny">卡住时点“提示”，一次只揭开一条。</span>` : ""}
        </div>
      </section>

      <div class="practice-submit">
        <button class="paper-btn is-submit" type="button" data-action="submit-writing" ${input.trim() ? "" : "disabled"}>
          ${isPhrase ? "提交核对" : "提交检查"} ${icon("check")}
        </button>
        <p class="tiny" style="text-align:center;margin:0">提交后才会显示${isPhrase ? "标准短语" : "参考译文"}和评价。</p>
      </div>
    `;

    requestAnimationFrame(() => {
      const field = document.getElementById("writingPracticeInput");
      if (!field) return;
      if (document.activeElement === field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    });
  }

  function setupHintCount(practice) {
    const max = practice.mode === "paragraph" ? 3 : 3;
    return clamp(Number(practice.hintLevel || 0), 0, max);
  }

  function renderWritingFeedback() {
    const result = state.writing.lastResult;
    if (!result) {
      currentView = "corpus";
      renderCorpus();
      return;
    }
    const isPhrase = result.kind === "phrase";
    const evaluation =
      result.evaluation ||
      (isPhrase
        ? evaluatePhrase(result.reference, result.answer)
        : evaluateWriting(result.source, result.answer, result.reference, result.direction));
    const reference = String(result.reference || "").trim();

    main.innerHTML = `
      <header class="feedback-head">
        <div>${backButton()}</div>
        <div class="feedback-title">
          <strong>${isPhrase ? "拼写反馈" : "翻译反馈"}</strong>
          <small>${isPhrase ? "对照标准短语，看看差在哪" : "纸上的答案已经交上来了"}</small>
        </div>
        <span class="tag tag--mint">已提交</span>
      </header>

      <div class="feedback-stack">
        <article class="feedback-paper" data-label="${isPhrase ? "中文提示" : "原句"}">
          <p class="feedback-source">${esc(result.source || "")}</p>
        </article>
        <article class="feedback-paper" data-label="${isPhrase ? "我的拼写" : "我的翻译"}">
          <p class="feedback-answer">${esc(result.answer || "")}</p>
          <p class="feedback-note">${esc(result.sourceLabel || "")} · ${isPhrase ? "看中文拼英文" : result.direction === "from-zh" ? "中译英" : "英译中"}</p>
        </article>
        ${
          reference
            ? `<article class="feedback-paper is-reference" data-label="${isPhrase ? "标准短语" : "参考译文"}">
                <p class="feedback-answer">${esc(reference)}</p>
                <p class="feedback-note">${isPhrase ? "来自图片短语库，按要求逐条保留。" : "这份参考译文随原文一起提供，未被改写或补写。"}</p>
                <span class="feedback-stamp">${isPhrase ? (evaluation.correct ? "拼写正确" : "标准答案") : "随文提供"}</span>
              </article>`
            : `<article class="feedback-paper is-reference" data-label="参考译文">
                <p class="feedback-note">这份资料只包含原文，没有附参考译文。为了避免误导，本次不生成或补写参考译文。下面的检查只依据本地规则与原文结构。</p>
              </article>`
        }

        <section class="teacher-note">
          <h2>${isPhrase ? "拼写核对" : "本地规则检查"}</h2>
          <p>${isPhrase ? "对照的是图片里的标准短语，大小写和标点不计入拼写对错。" : "这不是权威批改，只帮你发现明显的漏译、方向和完整度问题。"}</p>
          <div class="eval-list">
            ${evaluation.items
              .map(
                (item) => `<article class="eval-row">
                  <strong>${esc(item.title)}</strong>
                  <span class="eval-stamp ${item.status === "good" ? "is-good" : "is-improve"}">${item.status === "good" ? (isPhrase ? "对上了" : "看着不错") : "再改一处"}</span>
                  <p>${esc(item.note)}</p>
                </article>`,
              )
              .join("")}
          </div>
        </section>

        ${aiGradePanel({
          kind: result.kind || "paragraph",
          scope: "writing",
          grade: writingGradeFor(result),
          label: `${result.sourceLabel || ""}${result.itemLabel ? ` · ${result.itemLabel}` : ""}`,
          answer: result.answer || "",
          busy: aiGradeBusyKey === "writing",
        })}
      </div>

      <div class="feedback-actions">
        <button class="paper-btn is-next" type="button" data-action="writing-next">${isPhrase ? "下一个" : "下一段"} ${icon("arrow")}</button>
        <button class="paper-btn" type="button" data-action="writing-rewrite">${isPhrase ? "重拼这个" : "重写本段"}</button>
      </div>
      <div class="feedback-secondary">
        <button class="paper-btn" type="button" data-action="writing-add-review">${icon("star")}加入智能复习</button>
        <button class="paper-btn" type="button" data-action="writing-save-note">${icon("note")}保存到笔记</button>
      </div>
      <button class="text-button" style="display:block;margin:14px auto 0" type="button" data-action="writing-finish">结束本次 · 看完成页</button>
    `;
  }

  function renderWritingDone() {
    const result = state.writing.lastResult;
    const session = state.writing.session || {};
    if (!result) {
      currentView = "corpus";
      renderCorpus();
      return;
    }
    const elapsed = Math.max(
      1,
      Math.round(
        ((session.lastAt || Date.now()) - (session.startedAt || Date.now())) / 60000,
      ),
    );

    main.innerHTML = `
      <header class="done-head">
        <div>${backButton()}</div>
        <div class="done-title">本次完成</div>
        <span class="draft-saved">草稿已保存</span>
      </header>

      <section class="done-hero">
        <h1>${result.kind === "phrase" ? "这一组练完了" : "这一段写完了"}</h1>
        <p>${esc(result.sourceLabel || "写译练习")} · 慢慢来，也算数。</p>
      </section>

      <div class="done-stats">
        <article class="done-stat">${icon("pen")}<span><small>完成条数</small><b>${formatNumber(session.count || 1)}</b></span></article>
        <article class="done-stat">${icon("keyboard")}<span><small>写下字数</small><b>${formatNumber(session.chars || String(result.answer || "").length)}</b></span></article>
        <article class="done-stat">${icon("lightbulb")}<span><small>使用提示</small><b>${formatNumber(session.hints || result.hintLevel || 0)}</b></span></article>
        <article class="done-stat">${icon("star")}<span><small>加入复习卡</small><b>${formatNumber(session.reviewAdded || 0)}</b></span></article>
        <article class="done-stat">${icon("clock")}<span><small>大约用时</small><b>${elapsed}<small> 分钟</small></b></span></article>
      </div>

      <section class="review-highlight">
        <h2>最后一次练习留在纸上</h2>
        <span class="hl-label">${result.kind === "phrase" ? "中文提示" : "原句"}</span>
        <p class="hl-source">${esc(result.source || "")}</p>
        <p class="hl-answer">${esc(result.answer || "")}</p>
      </section>

      <div class="done-actions">
        <button class="paper-btn is-ink" type="button" data-action="writing-next">${result.kind === "phrase" ? "继续下一个" : "继续下一段"} ${icon("arrow")}</button>
        <button class="paper-btn" type="button" data-view="corpus">回到写译首页</button>
        <button class="paper-btn" type="button" data-action="open-review">${icon("clock")}去智能复习</button>
      </div>
      <button class="text-button done-back" type="button" data-view="learning">回到学习中心</button>
    `;
  }

  function builtInReaderBooks() {
    return [];
  }

  function preloadedBooks() {
    return [
      ...(preloadedLibrary?.books || []),
      ...(preloadedNovels?.books || []),
    ].filter((book) => book && book.available !== false);
  }

  function readerBooks() {
    const uploaded = userBooksCache.length
      ? userBooksCache
      : (state.userBooks || []).filter((book) => Array.isArray(book.pages));
    return [
      ...builtInReaderBooks(),
      ...preloadedBooks(),
      ...(publicLibrary?.books || []).filter((book) => Array.isArray(book.pages) && book.pages.length),
      ...uploaded,
    ];
  }

  function bookPageTotal(book) {
    if (!book) return 0;
    if (Array.isArray(book.pages) && book.pages.length) return book.pages.length;
    return Number(book.pageCount) || 0;
  }

  // 预置小说以纯文本资源懒加载：首屏只读目录，打开某本书时才展开分页。
  async function ensureBookPages(book) {
    if (!book) return book;
    if (Array.isArray(book.pages) && book.pages.length) return book;
    if (book.kind !== "txt" || !book.assetPath) return book;
    if (book.pagesPromise) return book.pagesPromise;
    book.pagesPromise = (async () => {
      const response = await fetch(book.assetPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const pages = splitPlainTextIntoPages(text);
      if (!pages.length) throw new Error("正文为空");
      book.pages = pages;
      book.pageCount = pages.length;
      return book;
    })().finally(() => {
      book.pagesPromise = null;
    });
    return book.pagesPromise;
  }

  function renderBooks() {
    if (state.reader.activeBookId) {
      renderReader();
      return;
    }
    const language = ["en", "fr", "zh"].includes(state.reader.language)
      ? state.reader.language
      : "en";
    const shelf = readerBooks().filter(
      (book) => book.language === language && !(book.public && book.kind === "image"),
    );
    const books = shelf.filter(
      (book) => state.reader.filter === "all" || book.type === state.reader.filter,
    );
    const typeLabels = {
      all: "全部",
      ebook: "电子书",
      comic: "漫画",
      magazine: "杂志",
      teaching: "教学资料",
    };
    const lastRead = shelf
      .filter((book) => state.reader.progress?.[book.id] !== undefined)
      .sort(
        (a, b) =>
          Number(state.reader.progress[b.id] || 0) -
          Number(state.reader.progress[a.id] || 0),
      )[0];
    main.innerHTML = `
      <header class="books-head">
        ${backButton()}
        <div class="books-head-title"><h1>图书</h1></div>
        <div class="books-actions">
          <button class="discover-entry" type="button" data-view="discover" aria-label="去资料发现">${icon("search")}<span>资料发现</span></button>
          <button class="add-book" type="button" data-action="upload-book">＋ 加书</button>
        </div>
      </header>

      <div class="filter-scroll" aria-label="阅读语言">
        ${[
          ["en", "英语"],
          ["fr", "法语"],
          ["zh", "中文"],
        ]
          .map(
            ([id, label]) => `<button class="filter-tab ${language === id ? "is-active" : ""}" type="button" data-action="set-reader-language" data-language="${id}">${label} · ${readerBooks().filter((book) => book.language === id).length} 本</button>`,
          )
          .join("")}
      </div>

      <div class="filter-scroll" aria-label="资料类型">
        ${Object.entries(typeLabels)
          .map(
            ([id, label]) => `<button class="filter-tab ${state.reader.filter === id ? "is-active" : ""}" type="button" data-action="set-book-filter" data-filter="${id}">${label}</button>`,
          )
          .join("")}
      </div>

      ${
        lastRead
          ? `<section class="book-continue">
              ${readerCoverMarkup(lastRead, { style: "min-height:112px" })}
              <div>
                <p class="kicker" style="margin:0">继续阅读</p>
                <h2>${esc(lastRead.title)}</h2>
                <p>上次读到第 ${Number(state.reader.progress[lastRead.id] || 0) + 1} / ${bookPageTotal(lastRead)} 页</p>
                <button class="paper-btn" type="button" data-action="continue-reading" data-book-id="${esc(lastRead.id)}">继续读 ${icon("arrow")}</button>
              </div>
            </section>`
          : ""
      }

      ${
        books.length
          ? `<div class="reader-shelf">${books.map(renderReaderBookCard).join("")}</div>`
          : `<div class="empty-state">
              <h2>还没有${languageLabel(language)}资料</h2>
              <p>上传自己的 TXT、Markdown、PDF 或 Word 文档后，会在本机解析、分页并保存阅读进度。不会伪造不存在的预置内容。</p>
              <button class="paper-btn is-butter" type="button" data-action="upload-book">${icon("upload")}上传资料</button>
            </div>`
      }

      <input id="bookUpload" type="file" accept=".txt,.md,.markdown,.pdf,.docx,.epub,image/*" hidden>
      <input id="scanUpload" type="file" accept="image/*" capture="environment" hidden>

      <dialog class="settings-dialog add-book-dialog" id="addBookDialog">
        <div class="settings-sheet add-book-sheet">
          <header class="dialog-header">
            <div>
              <h2>加一本书</h2>
              <p>资料只在本机解析，不上传服务器。</p>
            </div>
            <button type="button" class="icon-button" data-action="close-add-book" aria-label="关闭">${icon("close")}</button>
          </header>
          <div class="add-book-options">
            <button class="add-book-option" type="button" data-action="add-book-local">
              ${icon("upload")}
              <span><strong>本地上传</strong><small>TXT · EPUB · PDF · Word · 图片</small></span>
              ${icon("arrow")}
            </button>
            <button class="add-book-option" type="button" data-action="add-book-scan">
              ${icon("camera")}
              <span><strong>扫描上传</strong><small>拍下纸页，OCR 后存成一本 PDF</small></span>
              ${icon("arrow")}
            </button>
          </div>
          <p class="tiny add-book-note">扫描时会依次识别每一页，可以先改名、删除或重试，再确认导入。</p>
        </div>
      </dialog>
    `;
  }

  function readerCoverMarkup(book, { style = "" } = {}) {
    const url = readerCoverUrl(book);
    const attrs = `data-cover-id="${esc(book.id)}"${style ? ` style="${style}"` : ""}`;
    if (url) {
      return `<span class="reader-cover has-image" ${attrs}>
        <img src="${url}" alt="${esc(book.title)} 封面" loading="lazy" decoding="async">
      </span>`;
    }
    const coverClass = `cover-${(book.title.charCodeAt(0) || 0) % 4}`;
    return `<span class="reader-cover ${coverClass}" ${attrs}>
      <span>${languageLabel(book.language, true)}</span>
      <strong>${esc(book.title)}</strong>
      <small>${book.type === "comic" ? "COMIC" : book.type === "magazine" ? "MAGAZINE" : "READER"}</small>
    </span>`;
  }

  function renderReaderBookCard(book) {
    const progress = state.reader.progress?.[book.id] || 0;
    const percentRead = percent(progress, bookPageTotal(book));
    const card = `<button class="reader-book-card" type="button" data-action="open-reader" data-book-id="${esc(book.id)}">
      ${readerCoverMarkup(book)}
      <span class="reader-book-copy">
        <strong>${esc(book.title)}</strong>
        <small>${esc(book.author || book.source || "本地资料")} · ${bookPageTotal(book)} 页</small>
        <span class="mini-progress"><span style="width:${percentRead}%"></span></span>
        <small>${percentRead}% · ${progress ? `第 ${progress + 1} 页` : "尚未开始"}</small>
      </span>
    </button>`;
    if (!isManagedBook(book.id)) return card;
    return `<div class="reader-book-slot">
      ${card}
      <button class="book-admin-trigger" type="button" data-action="manage-book" data-book-id="${esc(book.id)}" aria-label="管理《${esc(book.title)}》" title="管理这本书">${icon("more")}</button>
    </div>`;
  }

  function isManagedBook(bookId) {
    return (
      userBooksCache.some((book) => book.id === bookId) ||
      (state.userBooks || []).some((book) => book.id === bookId)
    );
  }

  function findManagedBook(bookId) {
    return (
      userBooksCache.find((book) => book.id === bookId) ||
      readerBooks().find((book) => book.id === bookId) ||
      null
    );
  }

  function bookAdminDialogMarkup(book) {
    const typeLabel =
      book.type === "comic"
        ? "漫画"
        : book.type === "magazine"
          ? "杂志"
          : book.type === "teaching"
            ? "教学资料"
            : "电子书";
    return `<dialog class="settings-dialog book-admin-dialog" id="bookAdminDialog">
      <form method="dialog" class="settings-sheet book-admin-sheet" id="bookAdminForm">
        <header class="dialog-header">
          <div>
            <h2>管理图书</h2>
            <p>只改动本机上的这本书，不会动到原文件。</p>
          </div>
          <button type="button" class="icon-button" data-action="close-book-admin" aria-label="关闭">${icon("close")}</button>
        </header>
        <div class="book-admin-preview">
          ${readerCoverMarkup(book)}
          <div class="book-admin-meta">
            <strong>${esc(book.source || "本地资料")}</strong>
            <span>${bookPageTotal(book)} 页 · ${languageLabel(book.language)} · ${typeLabel}</span>
            <span>${esc(book.author || "未填写作者")}</span>
          </div>
        </div>
        <div class="settings-grid">
          <label class="field">
            <span>书名</span>
            <input id="bookAdminTitle" name="title" type="text" maxlength="80" value="${esc(book.title)}" required>
            <small class="field-hint">书架卡片和智能复习的来源都会同步更新。</small>
          </label>
          <label class="field">
            <span>作者 <small>可留空</small></span>
            <input id="bookAdminAuthor" name="author" type="text" maxlength="60" value="${esc(book.author || "")}" placeholder="例如：Jane Austen">
          </label>
        </div>
        <footer class="dialog-footer book-admin-footer">
          <button type="button" class="text-button danger" data-action="delete-book" data-book-id="${esc(book.id)}">${icon("trash")}删除本地图书</button>
          <div class="book-admin-actions">
            <button type="button" class="button button-secondary" data-action="close-book-admin">取消</button>
            <button type="submit" class="button button-primary" data-action="save-book-admin" data-book-id="${esc(book.id)}">保存修改</button>
          </div>
        </footer>
      </form>
    </dialog>`;
  }

  function openBookAdmin(bookId) {
    const book = findManagedBook(bookId);
    if (!book) {
      showToast("这本书不在本地书库中。");
      return;
    }
    document.getElementById("bookAdminDialog")?.remove();
    document.body.insertAdjacentHTML("beforeend", bookAdminDialogMarkup(book));
    const dialog = document.getElementById("bookAdminDialog");
    const openedAt = Date.now();
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && Date.now() - openedAt > 600) closeBookAdmin();
    });
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      const saveButton = dialog.querySelector('[data-action="save-book-admin"]');
      if (saveButton && !saveButton.disabled) saveBookAdmin(saveButton);
    });
    dialog.showModal();
    requestAnimationFrame(() => {
      const input = document.getElementById("bookAdminTitle");
      input?.focus();
      input?.select();
    });
  }

  function closeBookAdmin() {
    const dialog = document.getElementById("bookAdminDialog");
    if (!dialog) return;
    if (dialog.open) dialog.close();
    else dialog.remove();
  }

  function wordbookRenameMarkup(book) {
    const builtin = builtinBookTitles.get(book.meta.id) || book.meta.title;
    const current = String(state.settings.wordbookTitles?.[book.meta.id] || "");
    return `<dialog class="settings-dialog book-admin-dialog" id="wordbookRenameDialog">
      <form method="dialog" class="settings-sheet book-admin-sheet" id="wordbookRenameForm">
        <header class="dialog-header">
          <div>
            <h2>词书改名</h2>
            <p>只改当前设备上显示的名称，词条内容不变。</p>
          </div>
          <button type="button" class="icon-button" data-action="close-wordbook-rename" aria-label="关闭">${icon("close")}</button>
        </header>
        <div class="settings-grid">
          <label class="field">
            <span>显示名称</span>
            <input id="wordbookRenameInput" name="title" type="text" maxlength="40" value="${esc(current)}" placeholder="${esc(builtin)}">
            <small class="field-hint">留空即恢复内置名称「${esc(builtin)}」。</small>
          </label>
        </div>
        <footer class="dialog-footer book-admin-footer">
          <button type="button" class="text-button" data-action="reset-wordbook-title" data-book-id="${esc(book.meta.id)}">恢复内置名称</button>
          <div class="book-admin-actions">
            <button type="button" class="button button-secondary" data-action="close-wordbook-rename">取消</button>
            <button type="submit" class="button button-primary" data-action="save-wordbook-title" data-book-id="${esc(book.meta.id)}">保存</button>
          </div>
        </footer>
      </form>
    </dialog>`;
  }

  function openWordbookRename(bookId) {
    const book = booksById.get(bookId);
    if (!book) {
      showToast("这本词书不在内置书库中。");
      return;
    }
    document.getElementById("wordbookRenameDialog")?.remove();
    document.body.insertAdjacentHTML("beforeend", wordbookRenameMarkup(book));
    const dialog = document.getElementById("wordbookRenameDialog");
    const openedAt = Date.now();
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && Date.now() - openedAt > 600) closeWordbookRename();
    });
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      const saveButton = dialog.querySelector('[data-action="save-wordbook-title"]');
      if (saveButton) saveWordbookTitle(saveButton.dataset.bookId);
    });
    dialog.showModal();
    requestAnimationFrame(() => {
      const input = document.getElementById("wordbookRenameInput");
      input?.focus();
      input?.select();
    });
  }

  function closeWordbookRename() {
    const dialog = document.getElementById("wordbookRenameDialog");
    if (!dialog) return;
    if (dialog.open) dialog.close();
    else dialog.remove();
  }

  function saveWordbookTitle(bookId) {
    const input = document.getElementById("wordbookRenameInput");
    const value = String(input?.value || "").trim();
    closeWordbookRename();
    setWordbookTitle(bookId, value);
  }

  function resetWordbookTitle(bookId) {
    closeWordbookRename();
    setWordbookTitle(bookId, "");
  }

  async function saveBookAdmin(button) {
    const bookId = button.dataset.bookId;
    const book = userBooksCache.find((item) => item.id === bookId);
    const dialog = document.getElementById("bookAdminDialog");
    if (!book || !dialog) return;
    const title = String(document.getElementById("bookAdminTitle")?.value || "").trim();
    const author = String(document.getElementById("bookAdminAuthor")?.value || "").trim();
    if (!title) {
      showToast("书名不能为空。");
      document.getElementById("bookAdminTitle")?.focus();
      return;
    }
    const finishButton = beginButtonTask(button, "正在保存…");
    const previousTitle = book.title;
    book.title = title;
    book.author = author;
    if (previousTitle !== title && book.coverSource === "generated") {
      const cover = await makeTypographicCover(book).catch(() => null);
      if (cover) {
        forgetReaderCoverUrl(book.id);
        book.coverData = cover;
      }
    }
    try {
      await window.CikeDB.putBook(book);
    } catch (error) {
      book.title = previousTitle;
      finishButton();
      showToast(error.message || "保存失败，请重试。");
      return;
    }
    state.userBooks = (state.userBooks || []).map((item) =>
      item.id === book.id
        ? { ...item, title, author, pageCount: bookPageTotal(book) }
        : item,
    );
    Object.values(state.reviewItems || {}).forEach((item) => {
      if (item && String(item.id).startsWith(`reader-word:${book.id}:`)) {
        item.source = title;
      }
    });
    saveState();
    closeBookAdmin();
    render();
    showToast(previousTitle === title ? "图书信息已更新。" : "书名已更新，封面同步重绘。");
  }

  async function deleteManagedBook(button) {
    const bookId = button.dataset.bookId;
    const book = findManagedBook(bookId);
    if (!book) return;
    const confirmed = window.confirm(
      `确定删除《${book.title}》吗？\n\n会同时清理这本书的阅读进度、页边笔记、收藏页码、生词复习和写译练习记录。这个操作无法撤销，建议先在设置里导出完整备份。`,
    );
    if (!confirmed) return;
    const finishButton = beginButtonTask(button, "正在删除…");
    try {
      await window.CikeDB.deleteBook(bookId);
    } catch (error) {
      finishButton();
      showToast(error.message || "删除失败，请重试。");
      return;
    }
    userBooksCache = userBooksCache.filter((item) => item.id !== bookId);
    state.userBooks = (state.userBooks || []).filter((item) => item.id !== bookId);
    delete state.reader.progress?.[bookId];
    for (const key of Object.keys(state.reader.notes || {})) {
      if (key === bookId || key.startsWith(`${bookId}:`)) delete state.reader.notes[key];
    }
    for (const key of Object.keys(state.reader.translations || {})) {
      if (key === bookId || key.startsWith(`${bookId}:`)) delete state.reader.translations[key];
    }
    for (const key of Object.keys(state.reader.sentenceTranslations || {})) {
      if (key === bookId || key.startsWith(`${bookId}:`)) delete state.reader.sentenceTranslations[key];
    }
    if (state.reader.bookmarks) delete state.reader.bookmarks[bookId];
    for (const [key, item] of Object.entries(state.reviewItems || {})) {
      if (item && key.startsWith(`reader-word:${bookId}:`)) {
        delete state.reviewItems[key];
        delete state.progress?.[`review:${key}`];
      }
    }
    if (state.writing.docId === bookId) {
      state.writing.docId = "";
      state.writing.chapter = 0;
      state.writing.board = 0;
    }
    if (state.writing.setup?.docId === bookId) state.writing.setup.docId = "";
    if (state.writing.practice?.docId === bookId) {
      state.writing.practice.active = false;
      state.writing.practice.docId = "";
    }
    for (const key of Object.keys(state.writing.progress || {})) {
      if (key.startsWith(`${bookId}:`)) delete state.writing.progress[key];
    }
    if (state.reader.activeBookId === bookId) {
      state.reader.activeBookId = "";
      state.reader.page = 0;
    }
    if (pendingReaderBook?.id === bookId) {
      pendingReaderBook = null;
      pendingBookTarget = "reader";
    }
    forgetReaderCoverUrl(bookId);
    const imageUrl = readerImageUrls.get(bookId);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    readerImageUrls.delete(bookId);
    saveState();
    closeBookAdmin();
    render();
    showToast(`《${book.title}》已从本机删除。`);
  }

  const readerImageUrls = new Map();

  function readerImageUrl(book, page) {
    if (page?.image) return `${book.assetBase || ""}${page.image}`;
    if (!book.imageData) return "";
    const cached = readerImageUrls.get(book.id);
    if (cached) return cached;
    const url = URL.createObjectURL(book.imageData);
    readerImageUrls.set(book.id, url);
    return url;
  }

  const readerCoverUrls = new Map();

  function readerCoverUrl(book) {
    if (!book || !book.coverData) return "";
    const cached = readerCoverUrls.get(book.id);
    if (cached) return cached;
    const url = URL.createObjectURL(book.coverData);
    readerCoverUrls.set(book.id, url);
    return url;
  }

  function forgetReaderCoverUrl(id) {
    const url = readerCoverUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    readerCoverUrls.delete(id);
  }

  function applyCoverToDom(book) {
    const url = readerCoverUrl(book);
    if (!url) return;
    document
      .querySelectorAll(`[data-cover-id="${String(book.id).replace(/"/g, '\\"')}"]`)
      .forEach((node) => {
        node.classList.add("has-image");
        node.style.minHeight = "";
        node.innerHTML = `<img src="${url}" alt="${esc(book.title)} 封面" loading="lazy" decoding="async">`;
      });
  }

  const readerChapterCache = new Map();

  function readerChapterSignature(book) {
    const pages = book.pages || [];
    const first = String(pages[0]?.text || "");
    const last = String(pages[pages.length - 1]?.text || "");
    return `${book.id}:${pages.length}:${first.length}:${last.length}`;
  }

  function cleanChapterTitle(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^[\s"'“”«»\-–—:：.]+|[\s"'“”«»\-–—:：.]+$/g, "")
      .slice(0, 80);
  }

  const CHAPTER_KEYWORD_RE =
    /^(chapter|chapitre|part|partie|book|livre|prologue|epilogue|introduction|préface|preface|avant-propos|afterword|conclusion)\b[\s.:\-–—]*(.*)$/i;
  const CHAPTER_CN_RE =
    /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节篇卷部])\s*(.*)$/;

  function detectChapterHeading(text) {
    const lines = String(text || "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    for (let index = 0; index < Math.min(lines.length, 12); index += 1) {
      const line = lines[index].trim();
      if (!line || line.length > 90) continue;
      if ((line.match(/\b(chapter|chapitre|part|partie)\b/gi) || []).length > 2) {
        continue;
      }
      const keyword = line.match(CHAPTER_KEYWORD_RE);
      if (keyword) {
        const head = cleanChapterTitle(keyword[1]);
        const rest = cleanChapterTitle(keyword[2]);
        const numeral = rest.match(/^([ivxlcdm]+|\d+)\b[\s.:\-–—·]*/i);
        if (numeral) {
          // "CHAPTER I. Down the Rabbit-Hole" 只保留 "Chapter I" 会丢掉真正的章名，
          // 目录看起来就全是重复的 Chapter I。这里把序号后面的副标题一起带上。
          const label = `${head} ${numeral[1].toUpperCase()}`;
          const subtitle = cleanChapterTitle(rest.slice(numeral[0].length))
            .split(/[.!?。！？]/)[0]
            .trim();
          if (subtitle && subtitle.length <= 48) {
            return `${label} · ${subtitle}`;
          }
          return label;
        }
        if (rest) {
          // OCR 行有时把正文接在标题后面，只保留短标题。
          const short = rest.split(/[.!?。！？]/)[0].trim();
          if (short && short.length <= 42) return `${head} · ${short}`;
        }
        return head;
      }
      const cn = line.match(CHAPTER_CN_RE);
      if (cn) {
        const tail = cleanChapterTitle(cn[2]).split(/[。！？.!?]/)[0];
        return tail && tail.length <= 24 ? `${cn[1]} ${tail}` : cn[1];
      }
    }
    return "";
  }

  function explicitChapterEntries(book) {
    const pages = book.pages || [];
    if (!pages.some((page) => String(page.chapterTitle || "").trim())) return [];
    const entries = [];
    pages.forEach((page, index) => {
      const title = cleanChapterTitle(page.chapterTitle);
      if (!title) return;
      const previous = entries.at(-1);
      if (previous && previous.title === title) {
        previous.end = index;
        return;
      }
      entries.push({ start: index, end: index, title });
    });
    if (entries.length < 2) return [];
    entries.forEach((entry, index) => {
      entry.end = (entries[index + 1]?.start ?? pages.length) - 1;
    });
    if (entries[0].start > 0) {
      entries.unshift({ start: 0, end: entries[0].start - 1, title: "卷首" });
    }
    return entries;
  }

  function detectedChapterEntries(book) {
    const pages = book.pages || [];
    const raw = [];
    pages.forEach((page, index) => {
      const text = String(page.text || "");
      if (!text.trim()) return;
      const headingCount = (
        text.match(/\b(chapter|chapitre|part|partie|prologue|epilogue)\b/gi) ||
        []
      ).length;
      // 目录页会连续出现很多章名，跳过，避免把目录本身当成章节。
      if (headingCount >= 3) return;
      const heading = detectChapterHeading(text);
      if (heading) raw.push({ start: index, end: index, title: heading });
    });
    const entries = [];
    for (const item of raw) {
      const previous = entries.at(-1);
      if (
        previous &&
        previous.title.toLowerCase() === item.title.toLowerCase() &&
        item.start - previous.start <= 2
      ) {
        previous.end = item.start;
        continue;
      }
      entries.push({ ...item });
    }
    if (entries.length < 2) return [];
    entries.forEach((entry, index) => {
      entry.end = (entries[index + 1]?.start ?? pages.length) - 1;
    });
    if (entries[0].start > 0) {
      entries.unshift({ start: 0, end: entries[0].start - 1, title: "卷首" });
    }
    return entries;
  }

  function readerChapters(book) {
    const key = readerChapterSignature(book);
    if (readerChapterCache.has(key)) return readerChapterCache.get(key);
    const explicit = explicitChapterEntries(book);
    const entries = explicit.length >= 2 ? explicit : detectedChapterEntries(book);
    readerChapterCache.set(key, entries);
    return entries;
  }

  function readerPageLabel(page, pageIndex, book) {
    const chapter = String(page?.chapterTitle || "").trim();
    if (chapter && chapter !== book.title) return chapter;
    const title = String(page?.title || "").trim();
    if (
      title &&
      !/^第\s*\d+\s*页$/.test(title) &&
      !/^page\s*\d+$/i.test(title)
    ) {
      return title;
    }
    const detected = readerChapters(book).find(
      (entry) => pageIndex >= entry.start && pageIndex <= entry.end,
    );
    if (detected && detected.title !== "卷首") return detected.title;
    return "";
  }

  const READER_PARA_MAX = 280;

  function readerSplitSentences(text) {
    const result = [];
    const source = String(text || "");
    const pattern = /[^.!?。！？]+[.!?。！？]+["'”’)\]]*/g;
    let match;
    let last = 0;
    while ((match = pattern.exec(source))) {
      const sentence = match[0].trim();
      if (sentence) result.push(sentence);
      last = pattern.lastIndex;
    }
    const tail = source.slice(last).trim();
    if (tail) result.push(tail);
    return result;
  }

  // PDF / OCR / 旧 TXT 里偶尔混进 UTF-8 被当作 Latin-1 解码的“Ã©”一类乱码，
  // 以及零宽字符和控制符。统一在进入分段前洗干净，正文与译文都不再带脏字符。
  const MOJIBAKE_HINT_RE = /[ÃÂÐÑ][\u0080-\u00BF]/;

  function repairMojibakeText(value) {
    const text = String(value || "");
    if (!MOJIBAKE_HINT_RE.test(text)) return text;
    try {
      if (Array.from(text).some((ch) => ch.codePointAt(0) > 0xff)) return text;
      const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      return text;
    }
  }

  function sanitizeBookText(value) {
    let text = repairMojibakeText(String(value || ""));
    if (typeof text.normalize === "function") text = text.normalize("NFC");
    return text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\uFFFD/g, "");
  }

  function readerParagraphBlocks(text) {
    const raw = sanitizeBookText(text)
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .flatMap((chunk) => {
        const lines = chunk
          .split("\n")
          .map((line) => line.replace(/[ \t]+/g, " ").trim())
          .filter(Boolean);
        const merged = [];
        let current = "";
        for (const line of lines) {
          if (!current) {
            current = line;
            continue;
          }
          // A single newline inside a paragraph is usually a hard wrap.
          // Only start a new paragraph when the previous line looks finished.
          if (/[.!?。！？:：;；"'”’)\]]$/.test(current)) {
            merged.push(current);
            current = line;
          } else {
            current = `${current} ${line}`;
          }
        }
        if (current) merged.push(current);
        return merged;
      });
    const blocks = [];
    for (const paragraph of raw) {
      if (paragraph.length <= READER_PARA_MAX) {
        blocks.push(paragraph);
        continue;
      }
      const normalized = paragraph.replace(/\s+/g, " ").trim();
      let current = "";
      for (const sentence of readerSplitSentences(normalized)) {
        if (sentence.length > READER_PARA_MAX) {
          if (current) {
            blocks.push(current.trim());
            current = "";
          }
          let piece = "";
          for (const word of sentence.split(" ")) {
            if ((piece ? `${piece} ${word}` : word).length > READER_PARA_MAX) {
              blocks.push(piece);
              piece = word;
            } else {
              piece = piece ? `${piece} ${word}` : word;
            }
          }
          if (piece) current = piece;
          continue;
        }
        const merged = current ? `${current} ${sentence}` : sentence;
        if (merged.length > READER_PARA_MAX) {
          if (current) blocks.push(current.trim());
          current = sentence;
        } else {
          current = merged;
        }
      }
      if (current.trim()) blocks.push(current.trim());
    }
    return blocks;
  }

  // 段落译文按“书 + 页 + 段落内容”取键。只按段号存会在重新分页、
// 重新分段后把旧译文贴到新段落上，看起来就是整页错位串行。
  function readerParagraphKey(book, pageIndex, index, block) {
    let hash = 2166136261;
    const text = String(block || "");
    for (let at = 0; at < text.length; at += 1) {
      hash ^= text.charCodeAt(at);
      hash = Math.imul(hash, 16777619);
    }
    return `${book.id}:${pageIndex}:${(hash >>> 0).toString(36)}:p${index}`;
  }

  function readerParagraphs(text, book = null, pageIndex = 0) {
    const blocks = readerParagraphBlocks(text);
    if (!blocks.length) {
      return `<p class="reader-empty-copy">本页没有可显示的文字。</p>`;
    }
    return blocks
      .map((block, index) => {
        const key = book ? readerParagraphKey(book, pageIndex, index, block) : "";
        const translation = key
          ? state.reader.sentenceTranslations?.[key] || ""
          : "";
        return `<div class="reader-para" data-para-index="${index}">
          <p class="reader-para-source" data-para-index="${index}">${esc(block)}</p>
          <p class="reader-para-zh" data-para-key="${esc(key)}" data-para-source="${esc(block)}">${esc(translation)}</p>
        </div>`;
      })
      .join("");
  }

  const READER_TOC_FRONT_RE =
    /^(卷首|扉页|序|序言|序章|前言|引子|楔子|preface|foreword|prologue|introduction|avant[- ]propos)$/i;
  // 版权页、封面、目录本身不该占一个章节编号；保留内容页，剔除杂项。
  const READER_TOC_SKIP_RE =
    /^(cover|front cover|back cover|title page|copyright|contents|table of contents|dedication|acknowledg(e)?ments?|about the author|index|colophon|also by\b.*)$/i;
  // "By Sophie Kinsella" 是作者署名，不该占一节；但 "By the River"
  // 这种真实章节名不能误杀，所以要求后面至少两个大写开头的词。
  const READER_TOC_BYLINE_RE = /^[Bb]y\s+(?:[A-ZÀ-ÖØ-Þ][\w'’-]*\s*){2,}$/;

  function readerTocSkipTitle(title) {
    const text = String(title || "").trim();
    if (!text) return false;
    return READER_TOC_SKIP_RE.test(text) || READER_TOC_BYLINE_RE.test(text);
  }

  const TOC_CN_DIGITS = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3,
    四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const TOC_CN_UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

  // 中文序号常见“第十二章”，统一折算成数字后再拼目录，
  // 让中英混排的书也能对齐同一套 01/02/03 编号。
  function readerTocCnNumber(value) {
    const source = String(value || "").trim();
    if (!source) return 0;
    if (/^\d+$/.test(source)) return Number(source);
    let total = 0;
    let section = 0;
    let digit = 0;
    for (const char of source) {
      if (Object.prototype.hasOwnProperty.call(TOC_CN_DIGITS, char)) {
        digit = TOC_CN_DIGITS[char];
        continue;
      }
      const unit = TOC_CN_UNITS[char];
      if (!unit) return 0;
      if (unit === 10000) {
        section = (section + digit) * unit;
        total += section;
        section = 0;
      } else {
        section += (digit || (unit === 10 ? 1 : 0)) * unit;
      }
      digit = 0;
    }
    return total + section + digit;
  }

  function readerTocChapterTitle(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    // “部分”是双字单位，必须排在单字“部”之前，否则会被拆成“第 1 部 · 分”。
    const cnMatch = text.match(
      /^第\s*(\d+|[零〇一二两三四五六七八九十百千万]+)\s*(部分|章|回|节|篇|卷|部)\s*[·.:：、,，\-–—]*\s*(.*)$/,
    );
    if (cnMatch) {
      const number = readerTocCnNumber(cnMatch[1]);
      if (number) {
        const tail = cnMatch[3].replace(/\s+/g, " ").trim();
        return tail
          ? `第 ${number} ${cnMatch[2]} · ${tail}`
          : `第 ${number} ${cnMatch[2]}`;
      }
    }
    if (/^\d+$/.test(text)) return `第 ${Number(text)} 章`;
    if (/^[IVXLCDM]+$/i.test(text)) return `第 ${readerRomanToNumber(text)} 章`;
    // 西里尔字母的“Глава”不是 ASCII 词，单独先认一遍。
    const cyrillicMatch = text.match(
      /^Глава\s*([IVXLCDM]+|\d+)\s*[.:·\-–—]*\s*(.*)$/i,
    );
    if (cyrillicMatch) {
      const number = readerTocNumberValue(cyrillicMatch[1]);
      if (number) {
        const tail = cyrillicMatch[2].replace(/\s+/g, " ").trim();
        return tail ? `第 ${number} 章 · ${tail}` : `第 ${number} 章`;
      }
    }
    // 统一成中文目录口径：章节词 + 阿拉伯数字，长目录一眼能扫。
    const prefixMatch = text.match(
      /^(chapter|chapitre|capitolo|capítulo|capitulo|kapitel|part|partie|teil|book|livre|tome|act|scene|stave|letter)\b[\s.:·\-–—]*(.*)$/i,
    );
    if (prefixMatch) {
      const word = prefixMatch[1].toLowerCase();
      const unit = /^(part|partie|teil)$/.test(word)
        ? "部分"
        : /^(book|livre|tome)$/.test(word)
          ? "卷"
          : word === "act"
            ? "幕"
            : word === "scene"
              ? "场"
              : word === "stave"
                ? "节"
                : word === "letter"
                  ? "信"
                  : "章";
      const numberMatch = prefixMatch[2].match(
        new RegExp(`^(${TOC_NUMBER_TOKEN})\\b[\\s.:·\\-–—]*(.*)$`, "i"),
      );
      const number = numberMatch
        ? readerTocNumberValue(numberMatch[1])
        : 0;
      if (number) {
        const tail = numberMatch[2].replace(/\s+/g, " ").trim();
        return tail ? `第 ${number} ${unit} · ${tail}` : `第 ${number} ${unit}`;
      }
    }
    return text;
  }

  function readerTocNumber(index) {
    return String(index + 1).padStart(2, "0");
  }

  // 公版书的章节标题常见两种毛病：整行大写（CHAPTER I. DOWN THE RABBIT-HOLE）
  // 和序号大小写不一（chapter i）。这里统一成 "Chapter I · 副标题"，
  // 只处理能确定是章节前缀或全大写的部分，中文标题原样保留。
  const TOC_TITLE_SMALL_WORDS = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for",
    "in", "of", "on", "or", "the", "to", "with",
  ]);

  // 目录里的序号常写成英文单词（Part One / Chapter Twelve），
  // 不转成数字就会出现 "Part · One" 这种半截标题。
  const TOC_NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7,
    huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
    quatorze: 14, quinze: 15, seize: 16,
    // 意大利语 / 西班牙语 / 德语：公版书目录里也常见这些写法。
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
    siete: 7, ocho: 8, nueve: 9, dieci: 10, undici: 11, dodici: 12,
    eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6,
    sieben: 7, acht: 8, neun: 9, zehn: 10,
  };
  // 罗马数字用严格写法，否则 "Civil" 这类普通单词会被当成序号。
  const TOC_ROMAN_TOKEN =
    "(?=[MDCLXVI])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})";
  const TOC_TENS_WORDS = [
    "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety",
  ];
  // 复合数词（Twenty-one）要放在单词之前，否则只会吃掉 "Twenty"。
  const TOC_NUMBER_TOKEN =
    `(?:\\d+|${TOC_ROMAN_TOKEN}|(?:${TOC_TENS_WORDS.join("|")})[- ](?:one|two|three|four|five|six|seven|eight|nine)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|dieci|undici|dodici|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|un|une|deux|trois|quatre|cinq|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize)`;
  const TOC_NUMBER_RE = new RegExp(`^(${TOC_NUMBER_TOKEN})\\b`, "i");
  const TOC_COMPOUND_RE = new RegExp(
    `^(${TOC_TENS_WORDS.join("|")})[- ](one|two|three|four|five|six|seven|eight|nine)$`,
    "i",
  );

  function readerRomanToNumber(value) {
    const table = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const text = String(value || "").toUpperCase();
    let total = 0;
    for (let at = 0; at < text.length; at += 1) {
      const current = table[text[at]] || 0;
      const next = table[text[at + 1]] || 0;
      total += current < next ? -current : current;
    }
    return total;
  }

  function readerTocNumberValue(token) {
    const text = String(token || "").trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) return Number(text);
    if (/^[IVXLCDM]+$/i.test(text)) return readerRomanToNumber(text);
    const compound = text.match(TOC_COMPOUND_RE);
    if (compound) {
      return (
        (TOC_NUMBER_WORDS[compound[1].toLowerCase()] || 0) +
        (TOC_NUMBER_WORDS[compound[2].toLowerCase()] || 0)
      );
    }
    return TOC_NUMBER_WORDS[text.toLowerCase()] || 0;
  }

  function readerTocTitleCase(text) {
    return text
      .toLowerCase()
      .split(/(\s+)/)
      .map((word, index) => {
        if (!word.trim()) return word;
        const bare = word.replace(/[^a-z]/g, "");
        if (index > 0 && TOC_TITLE_SMALL_WORDS.has(bare)) return word;
        return word.replace(/[a-z]/, (letter) => letter.toUpperCase());
      })
      .join("");
  }

  function readerTocPrettyTitle(value) {
    const text = cleanChapterTitle(value);
    if (!text) return "";
    const prefixMatch = text.match(
      /^(CHAPTER|BOOK|PART|ACT|SCENE|STAVE|LETTER|CHAPITRE|LIVRE|PARTIE)\b/i,
    );
    const prefix = prefixMatch
      ? prefixMatch[1][0].toUpperCase() + prefixMatch[1].slice(1).toLowerCase()
      : "";
    let rest = prefix ? text.slice(prefixMatch[0].length) : text;
    rest = rest.replace(/^[\s.:\-–—·]+/, "");
    const numeralMatch = rest.match(TOC_NUMBER_RE);
    const numeral = numeralMatch
      ? String(readerTocNumberValue(numeralMatch[1]) || numeralMatch[1])
      : "";
    let tail = numeral ? rest.slice(numeralMatch[0].length) : rest;
    tail = tail.replace(/^[\s.:\-–—·]+/, "");
    const letters = tail.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 3 && letters === letters.toUpperCase()) {
      tail = readerTocTitleCase(tail);
    }
    const head = [prefix, numeral].filter(Boolean).join(" ");
    if (!head) return tail || text;
    return tail ? `${head} · ${tail}` : head;
  }

  function readerOutlineEntries(book) {
    const total = Math.max(1, book.pages.length);
    const source = Array.isArray(book.toc) ? book.toc : [];
    const entries = [];
    const seen = new Set();
    for (const raw of source) {
      const start = clamp(Math.round(Number(raw.start) || 0), 0, total - 1);
      const title = readerTocChapterTitle(readerTocPrettyTitle(raw.title));
      if (!title) continue;
      if (readerTocSkipTitle(title)) continue;
      // 同一页上常有“Part One / Chapter One”两条，都是有效导航，
      // 只去重完全重复的条目，别把章节条目挤掉。
      const key = `${start}:${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ start, title, depth: Math.max(0, Number(raw.depth) || 0) });
    }
    if (entries.length < 2) return [];
    entries.sort((a, b) => a.start - b.start || a.depth - b.depth);
    entries.forEach((entry, index) => {
      entry.end = (entries[index + 1]?.start ?? total) - 1;
    });
    if (entries[0].start > 0) {
      entries.unshift({ start: 0, end: entries[0].start - 1, title: "卷首", depth: 0 });
    }
    return entries;
  }

  const READER_TOC_DIVIDER_RE = /^第\s*\d+\s*(?:部分|卷|幕)/;

  // 目录对所有书统一成同一套结构：能认出真章节就用真章节，
  // 认不出就按固定篇幅切节。每条都带编号、标题和页码范围，
  // 避免同一本书在不同页数下换一套排版。
  function readerTocDecorateEntries(entries) {
    const output = [];
    let count = 0;
    for (const entry of entries) {
      const raw = readerTocChapterTitle(readerTocPrettyTitle(entry.title));
      const front =
        entry.start === 0 && (!raw || READER_TOC_FRONT_RE.test(raw));
      if (front) {
        output.push({ ...entry, title: raw || "卷首", no: "", kind: "front" });
        continue;
      }
      // 部/卷/幕 是结构性分隔条，不占编号；其余条目一律连续编号。
      if (READER_TOC_DIVIDER_RE.test(raw)) {
        output.push({ ...entry, title: raw, no: "", kind: "divider" });
        continue;
      }
      count += 1;
      output.push({
        ...entry,
        title: raw || `第 ${count} 章`,
        no: readerTocNumber(count - 1),
        kind: "chapter",
      });
    }
    return output;
  }

  function readerTocModel(book) {
    const total = Math.max(1, book.pages.length);
    const outline = readerOutlineEntries(book);
    let chapters = outline.length >= 2 ? outline : readerChapters(book);
    if (chapters.length >= 2) {
      const filtered = chapters.filter(
        (entry) => !readerTocSkipTitle(readerTocPrettyTitle(entry.title)),
      );
      if (filtered.length >= 2) chapters = filtered;
    }
    // 只认“分得开”的章节：如果某一章占了半本书，多半是把目录页或版权页
    // 误当成章节了，这种时候宁可按篇幅切节，也不要给出一个骗人的目录。
    const longest = chapters.reduce(
      (max, entry) => Math.max(max, entry.end - entry.start + 1),
      0,
    );
    // 必须有至少两个真正可阅读的编号单元，否则整本书只剩分隔条，退回分节。
    const numbered = chapters.filter((entry) => {
      const raw = readerTocChapterTitle(readerTocPrettyTitle(entry.title));
      if (entry.start === 0 && (!raw || READER_TOC_FRONT_RE.test(raw))) return false;
      return !READER_TOC_DIVIDER_RE.test(raw);
    });
    if (
      chapters.length >= 2 &&
      longest <= Math.max(24, Math.round(total * 0.5)) &&
      numbered.length >= 2
    ) {
      return { mode: "chapter", entries: readerTocDecorateEntries(chapters) };
    }
    const size = total > 400 ? 25 : total > 160 ? 20 : 10;
    const entries = [];
    for (let index = 0; index < total; index += size) {
      const end = Math.min(total, index + size) - 1;
      entries.push({
        start: index,
        end,
        depth: 0,
        no: readerTocNumber(entries.length),
        title: `第 ${entries.length + 1} 节`,
        kind: "section",
      });
    }
    return { mode: "section", entries };
  }

  function readerTocRangeLabel(entry) {
    return entry.end > entry.start
      ? `第 ${entry.start + 1}–${entry.end + 1} 页`
      : `第 ${entry.start + 1} 页`;
  }

  function readerTocRowMarkup(entry, pageIndex) {
    const active = pageIndex >= entry.start && pageIndex <= entry.end;
    const depth = Math.min(3, Math.max(0, Number(entry.depth) || 0));
    const kind = ["front", "divider", "chapter", "section"].includes(entry.kind)
      ? entry.kind
      : "chapter";
    const classes = [
      "reader-toc-item",
      `reader-toc-item--${kind}`,
      depth ? `reader-toc-item--depth-${depth}` : "",
      active ? "is-active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // 分隔条只做层级标题，不带页码范围：它常和第一章同页，标出来反而像重复。
    const range = kind === "divider" ? "" : readerTocRangeLabel(entry);
    return `<button class="${classes}" type="button" data-action="reader-goto" data-page="${entry.start}"${active ? ' aria-current="page"' : ""}>
      <span class="reader-toc-no">${esc(entry.no || "")}</span>
      <span class="reader-toc-body">
        <span class="reader-toc-title">${esc(entry.title)}</span>
        ${range ? `<span class="reader-toc-sub">${esc(range)}</span>` : ""}
      </span>
      ${active ? `<span class="reader-toc-flag">当前</span>` : ""}
    </button>`;
  }

  function readerTocModeLabel(book, model) {
    if (book.kind === "pdf" && model.mode === "chapter") {
      return `PDF 书签 · 共 ${model.entries.length} 项`;
    }
    if (model.mode === "chapter") {
      const count = model.entries.filter((entry) => entry.kind === "chapter").length;
      return `共 ${count} 章`;
    }
    return `共 ${model.entries.length} 节`;
  }

  function readerTocPanel(book, pageIndex) {
    const total = Math.max(1, book.pages.length);
    const model = readerTocModel(book);
    const progress = percent(pageIndex + 1, total);
    const author = cleanChapterTitle(book.author || "");
    return `
      <div class="reader-toc-book">
        <p class="reader-toc-book-title">${esc(book.title || "未命名图书")}</p>
        <p class="reader-toc-book-meta">${esc(author || "佚名")} · 全书 ${total} 页</p>
      </div>
      <div class="reader-toc-progress">
        <div class="reader-toc-progress-line">
          <span id="readerTocPageLabel">第 ${pageIndex + 1} / ${total} 页</span>
          <span id="readerTocPercentLabel">${progress}%</span>
        </div>
        <div class="reader-toc-progress-track" aria-hidden="true"><i id="readerTocProgressFill" style="width:${progress}%"></i></div>
      </div>
      <div class="reader-toc-summary">
        <span id="readerTocMeta">${readerTocModeLabel(book, model)}</span>
        <span id="readerTocHint">${book.kind === "pdf" ? "正在读取 PDF 书签…" : "点章节即可跳转"}</span>
      </div>
      <div class="reader-toc-list" id="readerTocList">
        ${model.entries
          .map((entry) => readerTocRowMarkup(entry, pageIndex))
          .join("") || `<p class="reader-empty-copy">这本书还没有可用的目录。</p>`}
      </div>`;
  }

  function scrollReaderTocActive() {
    const list = document.getElementById("readerTocList");
    const active = list?.querySelector(".reader-toc-item.is-active");
    if (!list || !active) return;
    const body = list.closest(".reader-drawer-body");
    if (!body) return;
    const bodyRect = body.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top >= bodyRect.top + 8 && activeRect.bottom <= bodyRect.bottom - 8) {
      return;
    }
    body.scrollTop +=
      activeRect.top - bodyRect.top - body.clientHeight / 2 + activeRect.height / 2;
  }

  const readerPdfTocCache = new Map();

  async function loadReaderPdfOutline(book) {
    const key = `${book.id}:${book.pages.length}`;
    if (readerPdfTocCache.has(key)) return readerPdfTocCache.get(key);
    const task = (async () => {
      const pdfjs = await import("./vendor/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
      const pdfDocument = await loadReaderPdfDocument(book, pdfjs);
      const outline = await pdfDocument.getOutline();
      if (!Array.isArray(outline) || !outline.length) return [];
      const entries = [];
      const walk = async (items, depth) => {
        for (const item of items) {
          let pageIndex = null;
          try {
            let destination = item.dest;
            if (typeof destination === "string") {
              destination = await pdfDocument.getDestination(destination);
            }
            if (Array.isArray(destination) && destination[0]) {
              pageIndex = await pdfDocument.getPageIndex(destination[0]);
            }
          } catch (error) {
            pageIndex = null;
          }
          if (
            Number.isInteger(pageIndex) &&
            pageIndex >= 0 &&
            pageIndex < book.pages.length
          ) {
            entries.push({
              start: pageIndex,
              end: pageIndex,
              title: cleanChapterTitle(item.title) || `第 ${pageIndex + 1} 页`,
              depth,
            });
          }
          if (Array.isArray(item.items) && item.items.length) {
            await walk(item.items, depth + 1);
          }
        }
      };
      await walk(outline, 0);
      entries.sort((a, b) => a.start - b.start);
      entries.forEach((entry, index) => {
        entry.end = (entries[index + 1]?.start ?? book.pages.length) - 1;
      });
      return entries.filter((entry) => entry.end >= entry.start);
    })();
    readerPdfTocCache.set(key, task);
    return task;
  }

  async function hydrateReaderPdfToc(book, pageIndex) {
    const hint = document.getElementById("readerTocHint");
    const list = document.getElementById("readerTocList");
    if (!hint || !list) return;
    hint.textContent = "正在读取 PDF 书签…";
    try {
      const entries = await loadReaderPdfOutline(book);
      if (!hint.isConnected || !list.isConnected) return;
      if (entries.length < 2) {
        hint.textContent = "这本 PDF 没有内嵌书签，可按页面顺序浏览";
        return;
      }
      // 漫画 PDF 常把每一页都做成书签，或者书签标题就是页码。
      // 这种目录有几百条、全是“1/2/3”，换成按篇幅分节更好用。
      const rawTitles = entries.map((entry) => String(entry.title || "").trim());
      const numeric = rawTitles.filter((title) => /^\d+$/.test(title)).length;
      if (
        numeric / entries.length > 0.8 ||
        entries.length > Math.max(80, book.pages.length * 0.4)
      ) {
        hint.textContent = "这本 PDF 的书签只是页码，已按篇幅分节";
        return;
      }
      const seen = new Set();
      const filtered = [];
      for (const entry of entries) {
        const title = readerTocChapterTitle(readerTocPrettyTitle(entry.title));
        if (!title || readerTocSkipTitle(title)) continue;
        const key = `${entry.start}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        filtered.push({ ...entry, title });
      }
      if (filtered.length < 2) {
        hint.textContent = "这本 PDF 的书签只是封面版权页，已按页浏览";
        return;
      }
      const decorated = readerTocDecorateEntries(filtered);
      if (!decorated.some((entry) => entry.kind === "chapter")) {
        hint.textContent = "这本 PDF 的书签只是封面版权页，已按页浏览";
        return;
      }
      list.innerHTML = decorated
        .map((entry) => readerTocRowMarkup(entry, pageIndex))
        .join("");
      hint.textContent = "轻点条目跳转";
      const meta = document.getElementById("readerTocMeta");
      if (meta) {
        const count = decorated.filter((entry) => entry.kind === "chapter").length;
        meta.textContent = `PDF 书签 · 共 ${count} 章`;
      }
      scrollReaderTocActive();
    } catch (error) {
      if (hint.isConnected) {
        hint.textContent = "PDF 书签读取失败，可继续按页浏览";
      }
    }
  }

  /* ---------- 阅读标注 / 单词库 / 涂鸦 ---------- */

  const READER_NOTE_COLORS = [
    { id: "red", value: "#e05a4e", label: "红色" },
    { id: "yellow", value: "#f2c94c", label: "黄色" },
    { id: "blue", value: "#4a90d9", label: "蓝色" },
    { id: "green", value: "#4caf83", label: "绿色" },
    { id: "pink", value: "#e58fb1", label: "粉色" },
  ];

  let readerSelectionText = "";
  let readerSelectionWord = false;
  let readerSelectionTimer = 0;
  let readerLookup = null;
  let readerLookupSerial = 0;
  let readerDrawMode = false;
  let readerDrawTool = "pen";
  let readerDrawColor = READER_NOTE_COLORS[1].value;
  let readerStroke = null;
  let readerTranslationToken = 0;
  const translationCache = new Map();

  function activeReaderBook() {
    return (
      readerBooks().find((item) => item.id === state.reader.activeBookId) || null
    );
  }

  function readerPageIndex(book) {
    return clamp(Number(state.reader.page || 0), 0, Math.max(0, book.pages.length - 1));
  }

  function readerAnnotationsFor(bookId, pageIndex) {
    return Object.values(state.reader.annotations || {})
      .filter(
        (item) =>
          item &&
          item.bookId === bookId &&
          (pageIndex === undefined || Number(item.page) === Number(pageIndex)),
      )
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function readerAnnotationsMarkup(book, pageIndex) {
    const items = readerAnnotationsFor(book.id, pageIndex);
    if (!items.length) return "";
    return `<div class="reader-annotation-stack">
      ${items
        .map(
          (item) => `<article class="reader-annotation-card" style="--annotation-color:${esc(item.color || READER_NOTE_COLORS[1].value)}">
            <p class="reader-annotation-quote">${esc(item.quote || "")}</p>
            ${item.note ? `<p class="reader-annotation-note">${esc(item.note)}</p>` : ""}
            <div class="reader-annotation-foot">
              <span>${esc(
                new Date(item.createdAt || Date.now()).toLocaleDateString("zh-CN"),
              )}</span>
              <button type="button" data-action="delete-reader-annotation" data-annotation-id="${esc(item.id)}">删除</button>
            </div>
          </article>`,
        )
        .join("")}
    </div>`;
  }

  function addReaderAnnotation({ quote, note, color }) {
    const book = activeReaderBook();
    if (!book) return "";
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.reader.annotations = state.reader.annotations || {};
    state.reader.annotations[id] = {
      id,
      bookId: book.id,
      bookTitle: book.title,
      page: readerPageIndex(book),
      language: book.language || "en",
      quote: String(quote || "").replace(/\s+/g, " ").trim().slice(0, 600),
      note: String(note || "").trim().slice(0, 2000),
      color: color || READER_NOTE_COLORS[1].value,
      createdAt: new Date().toISOString(),
    };
    saveState();
    return id;
  }

  function deleteReaderAnnotation(id) {
    if (!id || !state.reader.annotations?.[id]) return;
    delete state.reader.annotations[id];
    saveState();
  }

  function lookupReaderWord(word, language) {
    const result = lookupGlobalWord(word, language);
    const first = result.entries.slice().sort(
      (a, b) =>
        Number(hasChineseText(b.meaning)) - Number(hasChineseText(a.meaning)) ||
        b.meaning.length - a.meaning.length,
    )[0];
    return first ? lexGloss(first.meaning) || first.meaning : "";
  }

  function normalizeWordbookKey(word, language) {
    return `${language === "fr" ? "fr" : "en"}:${String(word || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()}`;
  }

  function addReaderWordToWordbook(word, meaning, language) {
    const book = activeReaderBook();
    const clean = String(word || "").replace(/\s+/g, " ").trim();
    if (!clean) return false;
    const key = normalizeWordbookKey(clean, language);
    const existed = Boolean(state.reader.wordbook?.[key]);
    state.reader.wordbook = state.reader.wordbook || {};
    state.reader.wordbook[key] = {
      ...(state.reader.wordbook[key] || {}),
      id: key,
      word: clean,
      meaning: String(meaning || state.reader.wordbook?.[key]?.meaning || "").trim(),
      language: language === "fr" ? "fr" : "en",
      bookId: book?.id || "",
      bookTitle: book?.title || "阅读",
      page: book ? readerPageIndex(book) : 0,
      createdAt: state.reader.wordbook?.[key]?.createdAt || new Date().toISOString(),
    };
    saveState();
    showToast(
      existed
        ? `“${clean}”已经在单词库里。`
        : `“${clean}”已加入单词库，可在个人页查看。`,
    );
    return !existed;
  }

  function readerSelectionIsWord(text) {
    const value = String(text || "").trim();
    if (!value || value.length > 48) return false;
    return /^[\p{L}\p{M}][\p{L}\p{M}'’\-]*$/u.test(value);
  }

  function currentReaderSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    const anchor = selection.anchorNode;
    const element =
      anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
    if (!element?.closest?.(".reader-paper")) return "";
    return String(selection).replace(/\s+/g, " ").trim().slice(0, 600);
  }

  function readerSelectionContext() {
    try {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element =
        anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      const block = element?.closest?.("p, li, blockquote, h1, h2, h3, h4, .reader-page-text");
      const text = String(block?.innerText || block?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 900);
    } catch (error) {
      return "";
    }
  }

  function scheduleReaderSelectionMenu() {
    clearTimeout(readerSelectionTimer);
    readerSelectionTimer = window.setTimeout(() => {
      const text = currentReaderSelection();
      if (!text) return;
      if (readerDrawMode) return;
      readerSelectionText = text;
      readerSelectionWord = readerSelectionIsWord(text);
      renderReaderSelectionBar();
    }, 140);
  }

  function renderReaderSelectionBar() {
    document.getElementById("readerSelectBar")?.remove();
    if (!readerSelectionText) return;
    const bar = document.createElement("div");
    bar.id = "readerSelectBar";
    bar.className = "reader-select-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "选中文字操作");
    bar.innerHTML = `
      <p class="reader-select-quote">“${esc(readerSelectionText)}”</p>
      <div class="reader-select-actions">
        <button type="button" data-action="reader-lookup-open">${readerSelectionWord ? "翻译单词" : "翻译语句"}</button>
        ${
          readerSelectionWord
            ? `<button type="button" data-action="reader-add-word">加入单词库</button>`
            : ""
        }
        <button class="reader-ask-ai" type="button" data-action="reader-ask-ai">问问 AI</button>
        <button type="button" data-action="reader-annotate-open">标注笔记</button>
        <button type="button" data-action="reader-draw-start">涂鸦</button>
        <button type="button" data-action="reader-select-speak">朗读</button>
        <button class="reader-select-close" type="button" data-action="reader-select-close" aria-label="关闭">×</button>
      </div>`;
    document.body.appendChild(bar);
    bar.addEventListener("pointerdown", (event) => {
      /* Keep the native text selection alive while tapping toolbar buttons. */
      event.preventDefault();
    });
    requestAnimationFrame(() => bar.classList.add("is-visible"));
  }

  function clearReaderSelection({ removeNative = false } = {}) {
    clearTimeout(readerSelectionTimer);
    readerSelectionText = "";
    readerSelectionWord = false;
    document.getElementById("readerSelectBar")?.remove();
    if (removeNative) {
      try {
        window.getSelection()?.removeAllRanges();
      } catch (error) {
        // Some WebViews throw while the selection is being finalized.
      }
    }
  }

  function readerLookupLanguage() {
    const language = String(activeReaderBook()?.language || "en").toLowerCase();
    return ["en", "fr", "de", "es", "it", "ja", "la", "yue", "zh"].includes(
      language,
    )
      ? language
      : "en";
  }

  function translateEntities(value) {
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }

  const onlineGetPending = new Map();
  let onlineGetSeq = 0;

  function bridgeHttpGet(url, timeout = 9000) {
    return new Promise((resolve, reject) => {
      const id = `net-${Date.now()}-${++onlineGetSeq}`;
      const timer = window.setTimeout(() => {
        onlineGetPending.delete(id);
        reject(new Error("在线翻译请求超时。"));
      }, timeout);
      onlineGetPending.set(id, { resolve, reject, timer });
      try {
        window.AndroidBridge.httpGet(id, url);
      } catch (error) {
        window.clearTimeout(timer);
        onlineGetPending.delete(id);
        reject(error);
      }
    });
  }

  window.CikeOnline = {
    onResult(id, payload) {
      const pending = onlineGetPending.get(String(id));
      if (!pending) return;
      window.clearTimeout(pending.timer);
      onlineGetPending.delete(String(id));
      let result;
      try {
        result = typeof payload === "string" ? JSON.parse(payload) : payload;
      } catch (error) {
        pending.reject(new Error("在线翻译返回了无法解析的结果。"));
        return;
      }
      if (result?.ok) {
        pending.resolve(result);
        return;
      }
      pending.reject(new Error(result?.error || `HTTP ${result?.status || 0}`));
    },
  };

  async function fetchJsonOnline(url, timeout = 9000) {
    if (window.AndroidBridge?.httpGet) {
      const result = await bridgeHttpGet(url, timeout);
      return JSON.parse(result.body || "{}");
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  function bridgeHttpPost(url, body, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const id = `net-${Date.now()}-${++onlineGetSeq}`;
      const timer = window.setTimeout(() => {
        onlineGetPending.delete(id);
        reject(new Error("在线翻译请求超时。"));
      }, timeout);
      onlineGetPending.set(id, { resolve, reject, timer });
      try {
        window.AndroidBridge.httpPost(id, url, JSON.stringify(body));
      } catch (error) {
        window.clearTimeout(timer);
        onlineGetPending.delete(id);
        reject(error);
      }
    });
  }

  const TRANSMART_LANGS = new Set([
    "en",
    "fr",
    "de",
    "es",
    "it",
    "ja",
    "ko",
    "ru",
    "pt",
    "zh",
  ]);

  // 腾讯 Transmart 公开接口：不依赖 Key，国内可直连，整句翻译比单词接口更稳。
  async function fetchTransmartTranslation(value, language) {
    const sourceLang = TRANSMART_LANGS.has(language) ? language : "auto";
    if (sourceLang === "zh") return "";
    const body = {
      header: {
        fn: "auto_translation",
        client_key: "browser-chrome-120.0.0.0-Windows_10",
      },
      type: "plain",
      model_category: "normal",
      source: { lang: sourceLang, text_list: [value] },
      target: { lang: "zh" },
    };
    let data;
    if (window.AndroidBridge?.httpPost) {
      const result = await bridgeHttpPost(
        "https://transmart.qq.com/api/imt",
        body,
        12000,
      );
      data = JSON.parse(result.body || "{}");
    } else {
      const response = await fetch("https://transmart.qq.com/api/imt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    }
    const list = data?.auto_translation;
    if (!Array.isArray(list) || !list.length) return "";
    return list.map((part) => String(part || "")).join("");
  }

  async function fetchOnlineTranslation(text, language) {
    const value = String(text || "").trim();
    if (!value) return "";
    const cacheKey = `${language}:${value}`;
    if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
    const source = language === "fr" ? "fr" : "en";
    const normalize = (translated) =>
      sanitizeBookText(translateEntities(String(translated || "")))
        .replace(/\s+/g, " ")
        .trim();

    try {
      const translated = normalize(await fetchTransmartTranslation(value, language));
      if (translated) {
        translationCache.set(cacheKey, translated);
        return translated;
      }
    } catch (error) {
      // 腾讯接口不可用时继续尝试后面的免费接口。
    }

    const attempts = [
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        value.slice(0, 500),
      )}&langpair=${source}|zh-CN`,
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=zh-CN&dt=t&q=${encodeURIComponent(
        value.slice(0, 500),
      )}`,
    ];
    for (const url of attempts) {
      try {
        const data = await fetchJsonOnline(url, 9000);
        let translated = "";
        if (data?.responseData?.translatedText) {
          translated = String(data.responseData.translatedText);
        } else if (Array.isArray(data?.[0])) {
          translated = data[0]
            .map((part) => (Array.isArray(part) ? part[0] : ""))
            .join("");
        }
        translated = normalize(translated);
        if (translated && !/^MYMEMORY WARNING/i.test(translated)) {
          translationCache.set(cacheKey, translated);
          return translated;
        }
      } catch (error) {
        // Try the next provider.
      }
    }
    translationCache.set(cacheKey, "");
    return "";
  }

  function splitTranslationChunks(value, limit) {
    const sentences =
      value.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*/g) || [value];
    const chunks = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > limit) {
        chunks.push(current);
        current = "";
      }
      current += sentence;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  async function fetchParagraphTranslation(text, language) {
    const value = String(text || "").trim();
    if (!value) return "";
    // 优先走已配置的 AI：整段上下文更完整；没配置或失败时再退回免费接口。
    const useAi = aiReady("translate");
    const chunks = splitTranslationChunks(value, useAi ? 900 : 460);
    const translated = [];
    for (const chunk of chunks) {
      let part = "";
      if (useAi) {
        try {
          const result = await window.CikeAI.translate(chunk, language, "中文");
          part = String(result?.data || "").trim();
        } catch (error) {
          part = "";
        }
      }
      if (!part) part = await fetchOnlineTranslation(chunk, language);
      if (!part) return "";
      translated.push(part);
    }
    return translated.join("");
  }

  async function hydrateReaderParagraphTranslations(book, pageIndex) {
    if (state.reader.showTranslations === false) return;
    const stage = document.getElementById("readerStage");
    if (!stage) return;
    const token = ++readerTranslationToken;
    const pending = Array.from(stage.querySelectorAll(".reader-para-zh")).filter(
      (node) => !node.textContent.trim(),
    );
    if (!pending.length) return;
    let dirty = false;
    let failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        if (token !== readerTranslationToken) return;
        const node = pending[cursor];
        cursor += 1;
        const source = node.dataset.paraSource || "";
        if (!source) continue;
        try {
          const translated = await fetchParagraphTranslation(source, book.language);
          if (token !== readerTranslationToken) return;
          if (translated) {
            node.textContent = translated;
            node.classList.remove("is-failed", "is-offline");
            const key = node.dataset.paraKey;
            if (key) state.reader.sentenceTranslations[key] = translated;
            dirty = true;
          } else {
            failed += 1;
            node.textContent = "暂无完整译文，可稍后重试";
            node.classList.add("is-failed");
          }
        } catch (error) {
          failed += 1;
          node.textContent = "暂无完整译文，可稍后重试";
          node.classList.add("is-failed");
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (token !== readerTranslationToken) return;
    if (dirty) {
      saveState();
      scheduleReaderDoodleRepaint();
    }
    if (!dirty && failed) showToast("当前网络无法获取译文，可稍后重试。");
  }

  function openReaderLookup(mode = "translate") {
    const text = readerSelectionText;
    if (!text) return;
    const language = readerLookupLanguage();
    const isWord = readerSelectionWord;
    const resolution = isWord ? lookupGlobalWord(text, language) : null;
    const local = resolution
      ? resolution.groups
          .flatMap((group) => group.entries)
          .map((entry) => lexGloss(entry.meaning) || entry.meaning)
          .find(Boolean) || ""
      : "";
    const serial = ++readerLookupSerial;
    readerLookup = {
      serial,
      text,
      isWord,
      language,
      local,
      resolution,
      online: "",
      onlineSource: "",
      loading: !isWord,
      failed: false,
      ai: { status: "idle" },
      allusion: { status: "idle" },
      noteMode: mode === "note",
      note: "",
      color: readerDrawColor || READER_NOTE_COLORS[1].value,
    };
    renderReaderLookup();
    if (!isWord) {
      translateReaderLookupText(serial);
    } else {
      readerLookup.loading = false;
      loadReaderLookupAI();
    }
  }

  async function translateReaderLookupText(serial) {
    const entry = readerLookup;
    if (!entry || entry.serial !== serial) return;
    let translated = "";
    let source = "";
    if (aiReady("translate") && entry.text.length <= 240) {
      try {
        const result = await window.CikeAI.translate(
          entry.text,
          entry.language,
          "中文",
        );
        translated = result.data;
        source = result.cached ? "ai-cache" : "ai";
      } catch (error) {
        if (readerLookup?.serial === serial) {
          readerLookup.aiError = error.message;
        }
      }
    }
    if (!translated) {
      translated = await fetchOnlineTranslation(entry.text, entry.language);
      source = translated ? "online" : "";
    }
    if (!readerLookup || readerLookup.serial !== serial) return;
    readerLookup.loading = false;
    readerLookup.online = translated;
    readerLookup.onlineSource = source;
    readerLookup.failed = !translated;
    renderReaderLookup();
  }

  async function loadReaderLookupAI() {
    if (!readerLookup || !readerLookup.isWord) return;
    if (!aiReady("define")) return;
    const serial = readerLookup.serial;
    readerLookup.ai = { status: "loading" };
    renderReaderLookup();
    try {
      const result = await window.CikeAI.defineWord(
        readerLookup.text,
        readerLookup.language,
      );
      if (!readerLookup || readerLookup.serial !== serial) return;
      readerLookup.ai = {
        status: result.data.definitions.length ? "ok" : "empty",
        data: result.data,
        cached: result.cached,
      };
    } catch (error) {
      if (!readerLookup || readerLookup.serial !== serial) return;
      readerLookup.ai = { status: "error", error: error.message };
    }
    renderReaderLookup();
  }

  async function loadReaderLookupAllusion() {
    if (!readerLookup || !readerLookup.isWord) return;
    if (!aiReady("allusion")) return;
    const serial = readerLookup.serial;
    readerLookup.allusion = { status: "loading" };
    renderReaderLookup();
    try {
      const result = await window.CikeAI.allusion(
        readerLookup.text,
        readerLookup.language,
      );
      if (!readerLookup || readerLookup.serial !== serial) return;
      readerLookup.allusion = {
        status: "ok",
        data: result.data,
        cached: result.cached,
      };
    } catch (error) {
      if (!readerLookup || readerLookup.serial !== serial) return;
      readerLookup.allusion = { status: "error", error: error.message };
    }
    renderReaderLookup();
  }

  function readerLookupAiMarkup(entry) {
    const ai = entry.ai;
    if (!ai || ai.status === "idle") return "";
    if (ai.status === "loading") {
      return `<section class="reader-ai-card is-loading">
        <p class="reader-ai-tag">AI 释义</p>
        <p class="reader-ai-loading">正在补全释义…</p>
      </section>`;
    }
    if (ai.status === "error") {
      return `<section class="reader-ai-card">
        <p class="reader-ai-tag">AI 释义</p>
        <p class="reader-ai-error">${esc(ai.error)}</p>
        <button class="text-button" type="button" data-action="reader-lookup-ai-retry">重试 AI 释义</button>
      </section>`;
    }
    if (ai.status === "empty") {
      return `<section class="reader-ai-card">
        <p class="reader-ai-tag">AI 释义</p>
        <p class="reader-ai-empty">AI 也无法确认这个词在${aiLanguageLabel(entry.language)}里的释义，没有编造内容。</p>
      </section>`;
    }
    const data = ai.data;
    return `<section class="reader-ai-card">
      <p class="reader-ai-tag">AI 释义${ai.cached ? " · 本机缓存" : ""}</p>
      ${
        data.ipa || (data.pos && data.pos !== "unknown")
          ? `<div class="reader-ai-head">
              ${data.ipa ? `<span class="reader-ai-ipa">${esc(data.ipa)}</span>` : ""}
              ${data.pos && data.pos !== "unknown" ? `<span class="reader-ai-pos">${esc(data.pos)}</span>` : ""}
            </div>`
          : ""
      }
      <ol class="reader-ai-defs">${data.definitions.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>
      ${
        data.example
          ? `<div class="reader-ai-example">
              <p>${esc(data.example.sentence)}</p>
              ${data.example.translation ? `<p class="reader-ai-example-zh">${esc(data.example.translation)}</p>` : ""}
            </div>`
          : ""
      }
      ${data.etymology ? `<p class="reader-ai-etymology">词源 · ${esc(data.etymology)}</p>` : ""}
    </section>`;
  }

  function readerLookupAllusionMarkup(entry) {
    const item = entry.allusion;
    if (!item || item.status === "idle") return "";
    if (item.status === "loading") {
      return `<section class="reader-ai-card is-loading">
        <p class="reader-ai-tag">典故考据</p>
        <p class="reader-ai-loading">正在核对出处…</p>
      </section>`;
    }
    if (item.status === "error") {
      return `<section class="reader-ai-card">
        <p class="reader-ai-tag">典故考据</p>
        <p class="reader-ai-error">${esc(item.error)}</p>
        <button class="text-button" type="button" data-action="reader-lookup-allusion">重试</button>
      </section>`;
    }
    const data = item.data;
    const labels = {
      high: "出处已确认",
      medium: "较可信",
      low: "仅供参考",
      unknown: "AI 未能确认确切出处",
    };
    const label = labels[data.confidence] || labels.unknown;
    return `<section class="reader-ai-card reader-ai-allusion reader-ai-conf--${esc(data.confidence || "unknown")}">
      <p class="reader-ai-tag">典故考据${item.cached ? " · 本机缓存" : ""}<span class="reader-ai-conf">${esc(label)}</span></p>
      ${data.meaning ? `<p class="reader-ai-meaning">${esc(data.meaning)}</p>` : ""}
      <p class="reader-ai-source">出处：${data.source === "unknown" ? "未确认" : esc(data.source)}</p>
      ${data.quote ? `<blockquote class="reader-ai-quote">${esc(data.quote)}</blockquote>` : ""}
      ${data.explanation ? `<p class="reader-ai-etymology">${esc(data.explanation)}</p>` : ""}
    </section>`;
  }

  function closeReaderLookup() {
    readerLookup = null;
    document.getElementById("readerLookupSheet")?.remove();
    document.getElementById("readerLookupScrim")?.remove();
  }

  function readerLookupGroupsMarkup(entry) {
    const groups = entry.resolution?.groups || [];
    if (!groups.length) {
      const suggestions = entry.resolution?.suggestions || [];
      return `
        <div class="reader-lookup-empty">
          <p>本地词库暂未收录“${esc(entry.text)}”。</p>
          ${
            suggestions.length
              ? `<div class="global-lookup-suggest">
                  <span>相近词：</span>
                  ${suggestions
                    .map(
                      (word) =>
                        `<button type="button" class="global-lookup-chip" data-action="reader-lookup-suggest" data-word="${esc(word)}">${esc(word)}</button>`,
                    )
                    .join("")}
                </div>`
              : ""
          }
        </div>`;
    }
    return `
      <div class="reader-lookup-groups">
        ${groups
          .map(
            (group) => `
          <section class="reader-lookup-group">
            <header class="reader-lookup-grouphead">
              <span class="reader-lookup-lang">${esc(group.label)}</span>
              <small>${group.entries.length} 条</small>
            </header>
            ${group.entries
              .slice(0, 4)
              .map(
                (item) => `
              <article class="reader-lookup-entry">
                <div class="reader-lookup-entry-head">
                  <strong>${esc(item.word)}</strong>
                  ${item.phonetic ? `<span class="reader-lookup-ipa">/${esc(item.phonetic)}/</span>` : ""}
                  <span class="reader-lookup-source">${esc(item.source)}</span>
                </div>
                <p>${esc(item.meaning)}</p>
              </article>`,
              )
              .join("")}
          </section>`,
          )
          .join("")}
      </div>
      <p class="reader-lookup-hint">已汇总全库 ${groups.length} 种语言的释义，切换词书也能查。</p>`;
  }

  function renderReaderLookup() {
    if (!readerLookup) return;
    document.body.classList.add("reader-lookup-open");
    document.getElementById("readerLookupScrim")?.remove();
    const existing = document.getElementById("readerLookupSheet");
    const scrim = document.createElement("div");
    scrim.id = "readerLookupScrim";
    scrim.className = "reader-lookup-scrim";
    scrim.dataset.action = "reader-lookup-close";
    document.body.appendChild(scrim);
    if (!existing) {
      const sheet = document.createElement("section");
      sheet.id = "readerLookupSheet";
      sheet.className = "reader-lookup-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      document.body.appendChild(sheet);
    }
    const sheet = document.getElementById("readerLookupSheet");
    const entry = readerLookup;
    sheet.innerHTML = `
      <header class="reader-lookup-head">
        <div>
          <p class="kicker">${entry.isWord ? "WORD" : "PASSAGE"} · ${esc(
            languageLabel(entry.language),
          )}</p>
          <h2>${entry.noteMode ? "标注这段文字" : entry.isWord ? "单词" : "语句翻译"}</h2>
        </div>
        <button class="reader-drawer-close" type="button" data-action="reader-lookup-close" aria-label="关闭">${icon("close")}</button>
      </header>
      <blockquote class="reader-lookup-quote">${esc(entry.text)}</blockquote>
      ${
        entry.noteMode
          ? `<div class="reader-lookup-note">
              <label class="field">
                <span>笔记（会保存到个人页 · 图书笔记）</span>
                <textarea id="readerLookupNote" rows="4" placeholder="写下你的想法…">${esc(entry.note || "")}</textarea>
              </label>
              <div class="reader-note-colors" role="group" aria-label="笔记颜色">
                ${READER_NOTE_COLORS.map(
                  (color) =>
                    `<button class="reader-note-color ${
                      entry.color === color.value ? "is-active" : ""
                    }" type="button" data-action="reader-lookup-color" data-color="${color.value}" aria-label="${color.label}" style="--swatch:${color.value}"></button>`,
                ).join("")}
              </div>
              <div class="reader-lookup-actions">
                <button class="paper-btn is-butter" type="button" data-action="reader-lookup-save-note">保存笔记</button>
                <button class="text-button" type="button" data-action="reader-lookup-cancel-note">返回翻译</button>
              </div>
            </div>`
          : `<div class="reader-lookup-result">
              ${
                entry.isWord
                  ? `<div class="reader-lookup-wordline"><strong>${esc(entry.text)}</strong><button class="text-button" type="button" data-action="reader-lookup-speak">${icon("volume")}朗读</button></div>
                     ${readerLookupAiMarkup(entry)}
                     ${readerLookupGroupsMarkup(entry)}
                     ${readerLookupAllusionMarkup(entry)}`
                  : `<p class="reader-lookup-label">${entry.onlineSource === "ai" || entry.onlineSource === "ai-cache" ? "AI 译文" : "译文"}</p>
                     ${
                       entry.online
                         ? `<p class="reader-lookup-translation">${esc(entry.online)}</p>
                            <p class="reader-lookup-online-tag">${
                              entry.onlineSource === "ai-cache"
                                ? "AI 译文 · 本机缓存"
                                : entry.onlineSource === "ai" ? "AI 译文" : "在线整句翻译"
                            }</p>`
                         : entry.loading
                           ? `<p class="reader-lookup-translation is-loading">${
                               aiReady("translate") ? "AI 翻译中…" : "在线翻译连接中…"
                             }</p>`
                           : `<p class="reader-lookup-translation reader-lookup-translation--muted">暂时没有取到译文，请检查网络后重试。</p>`
                     }`
              }
              <div class="reader-lookup-actions">
                <button class="paper-btn" type="button" data-action="reader-lookup-speak">${icon("volume")}朗读</button>
                ${entry.isWord ? `<button class="paper-btn is-butter" type="button" data-action="reader-lookup-add-word">加入单词库</button>` : ""}
                ${entry.isWord && aiReady("allusion") ? `<button class="paper-btn" type="button" data-action="reader-lookup-allusion">${icon("search")}查典故</button>` : ""}
                <button class="paper-btn" type="button" data-action="reader-lookup-note">标注笔记</button>
              </div>
              <p class="reader-lookup-hint">${entry.isWord ? "释义来自全库词书；AI 释义首次生成后写入本机缓存。" : "只显示整句 / 整段译文，不再逐词列释义。"}</p>
            </div>`
      }`;
    if (entry.noteMode) {
      requestAnimationFrame(() => {
        const field = document.getElementById("readerLookupNote");
        field?.focus();
        field?.addEventListener("input", () => {
          if (readerLookup) readerLookup.note = field.value;
        });
      });
    }
  }

  function saveReaderLookupNote() {
    if (!readerLookup) return;
    const note = document.getElementById("readerLookupNote")?.value || "";
    addReaderAnnotation({
      quote: readerLookup.text,
      note,
      color: readerLookup.color,
    });
    closeReaderLookup();
    clearReaderSelection({ removeNative: true });
    showToast(note.trim() ? "笔记已保存，可在个人页的图书笔记里查看。" : "摘录已保存，可在个人页的图书笔记里查看。");
    renderReader();
  }

  function drawingKey(book) {
    return `${book.id}:${readerPageIndex(book)}`;
  }

  function drawingStrokes(book) {
    const key = drawingKey(book);
    return Array.isArray(state.reader.drawings?.[key])
      ? state.reader.drawings[key]
      : [];
  }

  function saveDrawingStrokes(book, strokes) {
    state.reader.drawings = state.reader.drawings || {};
    state.reader.drawings[drawingKey(book)] = strokes.slice(-300);
    saveState();
  }

  const readerAnimatedDoodles = new Set();
  let readerDoodleSerial = 0;
  let readerDoodleRepaintTimer = 0;

  function readerDoodlesFor(book) {
    const key = drawingKey(book);
    return Array.isArray(state.reader.doodles?.[key])
      ? state.reader.doodles[key]
      : [];
  }

  function saveReaderDoodles(book, doodles) {
    state.reader.doodles = state.reader.doodles || {};
    state.reader.doodles[drawingKey(book)] = doodles.slice(-120);
    saveState();
  }

  function captureReaderSelectionSegments() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return [];
    const range = selection.getRangeAt(0);
    const paper = document.querySelector(".reader-paper");
    if (!paper || !paper.contains(range.commonAncestorContainer)) return [];
    const segments = [];
    paper.querySelectorAll(".reader-para-source[data-para-index]").forEach((node) => {
      const paraIndex = Number(node.dataset.paraIndex);
      if (!Number.isInteger(paraIndex) || !range.intersectsNode(node)) return;
      const textNode = node.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
      const full = textNode.nodeValue || "";
      if (!full) return;
      let start = 0;
      let end = full.length;
      try {
        if (node.contains(range.startContainer)) {
          const before = document.createRange();
          before.selectNodeContents(node);
          before.setEnd(range.startContainer, range.startOffset);
          start = Math.min(before.toString().length, full.length);
        }
        if (node.contains(range.endContainer)) {
          const upto = document.createRange();
          upto.selectNodeContents(node);
          upto.setEnd(range.endContainer, range.endOffset);
          end = Math.min(upto.toString().length, full.length);
        }
      } catch (error) {
        return;
      }
      if (end <= start) return;
      segments.push({
        paraIndex,
        start,
        end,
        text: full.slice(start, end),
      });
    });
    return segments;
  }

  function createReaderDoodleFromSelection(segments) {
    const book = activeReaderBook();
    if (!book || !segments?.length) return null;
    const quote = segments
      .map((segment) => segment.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!quote) return null;
    readerDoodleSerial += 1;
    const doodle = {
      id: `doodle-${Date.now()}-${readerDoodleSerial.toString(36)}`,
      quote: quote.slice(0, 600),
      color: readerDrawColor || READER_NOTE_COLORS[1].value,
      createdAt: new Date().toISOString(),
      segments,
    };
    saveReaderDoodles(book, [...readerDoodlesFor(book), doodle]);
    return doodle;
  }

  function paintReaderDoodles() {
    const paper = document.querySelector(".reader-paper");
    const book = activeReaderBook();
    if (!paper || !book) return;
    paper.querySelector(".reader-doodle-layer")?.remove();
    if (book.kind === "image" || book.kind === "pdf") return;
    const doodles = readerDoodlesFor(book);
    if (!doodles.length) return;
    const box = paper.getBoundingClientRect();
    if (box.width < 10) return;
    const offsetX = box.left + paper.clientLeft;
    const offsetY = box.top + paper.clientTop;
    const layer = document.createElement("div");
    layer.className = "reader-doodle-layer";
    layer.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "reader-doodle-svg");
    svg.setAttribute("viewBox", `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
    svg.setAttribute("preserveAspectRatio", "none");
    let painted = 0;
    doodles.forEach((doodle) => {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "reader-doodle");
      const fresh = !readerAnimatedDoodles.has(doodle.id);
      if (fresh) group.classList.add("is-fresh");
      group.style.setProperty("--doodle", doodle.color || READER_NOTE_COLORS[1].value);
      (doodle.segments || []).forEach((segment) => {
        const node = paper.querySelector(
          `.reader-para-source[data-para-index="${Number(segment.paraIndex)}"]`,
        );
        const textNode = node?.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
        const length = (textNode.nodeValue || "").length;
        const start = clamp(Number(segment.start) || 0, 0, length);
        const end = clamp(Number(segment.end) || 0, start, length);
        if (end <= start) return;
        const range = document.createRange();
        try {
          range.setStart(textNode, start);
          range.setEnd(textNode, end);
        } catch (error) {
          return;
        }
        Array.from(range.getClientRects()).forEach((rect) => {
          if (rect.width < 2 || rect.height < 4) return;
          const x = rect.left - offsetX;
          const y = rect.top - offsetY;
          const w = rect.width;
          const h = rect.height;
          const mark = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
          );
          mark.setAttribute("class", "reader-doodle-highlight");
          mark.setAttribute("x", x.toFixed(1));
          mark.setAttribute("y", y.toFixed(1));
          mark.setAttribute("width", w.toFixed(1));
          mark.setAttribute("height", h.toFixed(1));
          mark.setAttribute("rx", "5");
          group.appendChild(mark);
          const stroke = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          stroke.setAttribute("class", "reader-doodle-stroke");
          stroke.setAttribute("pathLength", "100");
          const baseY = (y + h - 2.5).toFixed(1);
          const step = Math.max(10, w / 6);
          const wave = Math.min(3, h / 9);
          stroke.setAttribute(
            "d",
            `M${x.toFixed(1)} ${baseY} q${(step / 2).toFixed(1)} -${wave.toFixed(1)} ${step.toFixed(1)} 0 t${step.toFixed(1)} 0 t${step.toFixed(1)} 0 t${step.toFixed(1)} 0 t${step.toFixed(1)} 0 t${step.toFixed(1)} 0`,
          );
          group.appendChild(stroke);
          painted += 1;
        });
      });
      if (group.childNodes.length) svg.appendChild(group);
      if (fresh) readerAnimatedDoodles.add(doodle.id);
    });
    if (!painted) return;
    layer.appendChild(svg);
    paper.appendChild(layer);
  }

  function scheduleReaderDoodleRepaint() {
    window.clearTimeout(readerDoodleRepaintTimer);
    readerDoodleRepaintTimer = window.setTimeout(() => {
      if (document.querySelector(".reader-paper")) paintReaderDoodles();
    }, 60);
  }

  window.addEventListener("resize", () => {
    if (!document.querySelector(".reader-paper")) return;
    scheduleReaderDoodleRepaint();
    if (readerDrawMode) {
      window.clearTimeout(readerDoodleRepaintTimer);
      requestAnimationFrame(mountReaderDrawing);
    }
  });

  function removeLastReaderDoodle(book) {
    const doodles = readerDoodlesFor(book);
    if (!doodles.length) return false;
    const removed = doodles[doodles.length - 1];
    saveReaderDoodles(book, doodles.slice(0, -1));
    if (removed?.id) readerAnimatedDoodles.delete(removed.id);
    paintReaderDoodles();
    return true;
  }

  function startReaderDrawing() {
    closeReaderLookup();
    const segments = captureReaderSelectionSegments();
    const doodle = createReaderDoodleFromSelection(segments);
    clearReaderSelection({ removeNative: true });
    readerDrawMode = true;
    readerDrawTool = "pen";
    readerToolOpen = "";
    renderReader();
    if (doodle) showToast("已圈出选中的句子，可以继续涂鸦。");
  }

  function exitReaderDrawing({ silent = false } = {}) {
    if (!readerDrawMode) return;
    readerDrawMode = false;
    readerStroke = null;
    document.querySelector(".reader-draw-canvas")?.remove();
    document.getElementById("readerDrawBar")?.remove();
    document.querySelector(".reader-paper")?.classList.remove("is-drawing");
    saveState();
    if (!silent) showToast("涂鸦已保存。");
  }

  function redrawReaderStrokes(canvas, strokes, current, options = {}) {
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const paint = (stroke, alpha = 1) => {
      const points = stroke?.points || [];
      if (!points.length) return;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.strokeStyle = stroke.color || readerDrawColor;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = Math.max(1.5, Number(stroke.width || 3)) * dpr;
      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(
          points[0][0] * canvas.width,
          points[0][1] * canvas.height,
          ctx.lineWidth / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = point[0] * canvas.width;
        const y = point[1] * canvas.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    strokes.forEach((stroke) => paint(stroke));
    if (options.ghost) paint(options.ghost, options.ghostAlpha ?? 0.55);
    if (current) paint(current);
  }

  function mountReaderDrawing() {
    if (!readerDrawMode) return;
    const book = activeReaderBook();
    const paper = document.querySelector(".reader-paper");
    if (!book || !paper) return;
    document.getElementById("readerDrawBar")?.remove();
    document.querySelector(".reader-draw-canvas")?.remove();
    const rect = paper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.className = "reader-draw-canvas";
    canvas.classList.toggle("is-eraser", readerDrawTool === "eraser");
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    paper.classList.add("is-drawing");
    paper.appendChild(canvas);
    const strokes = drawingStrokes(book);
    redrawReaderStrokes(canvas, strokes, null);
    let eraseAnimationToken = 0;

    const pointFromEvent = (event) => {
      const box = canvas.getBoundingClientRect();
      return [
        clamp((event.clientX - box.left) / Math.max(1, box.width), 0, 1),
        clamp((event.clientY - box.top) / Math.max(1, box.height), 0, 1),
      ];
    };

    const pulseAt = (point) => {
      const pulse = document.createElement("span");
      pulse.className = "reader-erase-pulse";
      pulse.style.left = `${point[0] * 100}%`;
      pulse.style.top = `${point[1] * 100}%`;
      paper.appendChild(pulse);
      window.setTimeout(() => pulse.remove(), 460);
    };

    const animateErase = (removed) => {
      if (!removed) return;
      const token = ++eraseAnimationToken;
      const start = performance.now();
      const frame = (now) => {
        if (token !== eraseAnimationToken) return;
        const progress = Math.min(1, (now - start) / 200);
        redrawReaderStrokes(canvas, drawingStrokes(book), null, {
          ghost: removed,
          ghostAlpha: 1 - progress,
        });
        if (progress < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };

    const eraseAt = (point) => {
      const list = drawingStrokes(book);
      let bestIndex = -1;
      let bestDistance = Infinity;
      list.forEach((stroke, strokeIndex) => {
        (stroke.points || []).forEach((candidate) => {
          const dx = (candidate[0] - point[0]) * Math.max(1, rect.width);
          const dy = (candidate[1] - point[1]) * Math.max(1, rect.height);
          const distance = Math.hypot(dx, dy);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = strokeIndex;
          }
        });
      });
      if (bestIndex >= 0 && bestDistance <= 22) {
        const removed = list[bestIndex];
        const next = list.slice();
        next.splice(bestIndex, 1);
        saveDrawingStrokes(book, next);
        animateErase(removed);
        pulseAt(point);
        return true;
      }
      return false;
    };

    let erasePointer = null;
    let lastErasePoint = null;

    canvas.addEventListener("pointerdown", (event) => {
      if (!readerDrawMode) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.setPointerCapture?.(event.pointerId);
      const point = pointFromEvent(event);
      if (readerDrawTool === "eraser") {
        erasePointer = event.pointerId;
        lastErasePoint = point;
        eraseAt(point);
        return;
      }
      eraseAnimationToken += 1;
      readerStroke = {
        color: readerDrawColor,
        width: 3,
        points: [point],
      };
      redrawReaderStrokes(canvas, drawingStrokes(book), readerStroke);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!readerDrawMode) return;
      if (readerDrawTool === "eraser") {
        if (erasePointer !== event.pointerId) return;
        event.preventDefault();
        const point = pointFromEvent(event);
        if (
          lastErasePoint &&
          Math.hypot(
            point[0] - lastErasePoint[0],
            point[1] - lastErasePoint[1],
          ) < 0.006
        ) {
          return;
        }
        lastErasePoint = point;
        eraseAt(point);
        return;
      }
      if (!readerStroke) return;
      event.preventDefault();
      const point = pointFromEvent(event);
      const points = readerStroke.points;
      const previous = points[points.length - 1];
      if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.002) {
        return;
      }
      points.push(point);
      redrawReaderStrokes(canvas, drawingStrokes(book), readerStroke);
    });

    const releaseErase = () => {
      erasePointer = null;
      lastErasePoint = null;
    };

    const finishStroke = (event) => {
      releaseErase();
      if (!readerStroke) return;
      event?.preventDefault?.();
      const stroke = readerStroke;
      readerStroke = null;
      const strokes = drawingStrokes(book);
      strokes.push(stroke);
      saveDrawingStrokes(book, strokes);
      redrawReaderStrokes(canvas, drawingStrokes(book), null);
    };
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", (event) => {
      releaseErase();
      finishStroke(event);
    });
    canvas.addEventListener("pointerleave", (event) => {
      if (event.buttons === 0) {
        releaseErase();
        finishStroke(event);
      }
    });

    const bar = document.createElement("div");
    bar.id = "readerDrawBar";
    bar.className = "reader-draw-bar";
    bar.innerHTML = `
      <div class="reader-draw-colors" role="group" aria-label="画笔颜色">
        ${READER_NOTE_COLORS.map(
          (color) =>
            `<button class="reader-note-color ${
              readerDrawColor === color.value ? "is-active" : ""
            }" type="button" data-action="reader-draw-color" data-color="${color.value}" aria-label="${color.label}" style="--swatch:${color.value}"></button>`,
        ).join("")}
      </div>
      <div class="reader-draw-tools">
        <button class="${readerDrawTool === "eraser" ? "is-active" : ""}" type="button" data-action="reader-draw-eraser" aria-pressed="${readerDrawTool === "eraser"}">${icon("eraser")}<span>橡皮</span></button>
        <button type="button" data-action="reader-draw-undo">${icon("undo")}<span>撤销</span></button>
        <button type="button" data-action="reader-draw-clear">${icon("trash")}<span>清空</span></button>
        <button class="is-primary" type="button" data-action="reader-draw-exit">${icon("check")}<span>完成</span></button>
      </div>`;
    document.body.appendChild(bar);
  }

  function turnReaderPage(delta) {
    const book = readerBooks().find(
      (item) => item.id === state.reader.activeBookId,
    );
    if (!book) return;
    const current = clamp(Number(state.reader.page || 0), 0, book.pages.length - 1);
    const next = clamp(current + delta, 0, book.pages.length - 1);
    if (next === current) return;
    stopSpeech();
    const page = book.pages[current];
    state.profile.wordsRead =
      Number(state.profile.wordsRead || 0) +
      String(page?.text || "").replace(/\s/g, "").length;
    // 文本页把旧纸页留存成幽灵层，翻过去的那一刻能看到整页掀走；
    // PDF / 图片页的 canvas 无法克隆，改用光影扫过。
    const oldSheet = document.querySelector("#readerStage .reader-sheet");
    readerTurnGhost =
      oldSheet && book.kind !== "pdf" && book.kind !== "image"
        ? `<div class="reader-turn-ghost is-${delta > 0 ? "next" : "prev"}" aria-hidden="true">${oldSheet.outerHTML}</div>`
        : "";
    state.reader.page = next;
    state.reader.progress[book.id] = next;
    readerTurn = delta > 0 ? "next" : "prev";
    exitReaderDrawing({ silent: true });
    saveState();
    renderReader();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  let visualTranslateSerial = 0;

  const COMIC_TYPE_LABELS = {
    dialogue: "对白",
    narration: "旁白",
    sfx: "音效",
    uncertain: "存疑",
  };

  function readerComicTypeLabel(type) {
    return COMIC_TYPE_LABELS[type] || COMIC_TYPE_LABELS.uncertain;
  }

  function readerComicPanel(book, pageIndex) {
    const items = state.reader.comicTranslations?.[book.id]?.[pageIndex];
    if (!Array.isArray(items) || !items.length) return "";
    const uncertainCount = items.filter(
      (item) => item.type === "uncertain",
    ).length;
    return `<section class="reader-comic-block" aria-label="漫画逐格译文">
      <div class="reader-comic-head">
        <strong>逐格译文</strong>
        <small>${items.length} 个文本区${
          uncertainCount ? ` · ${uncertainCount} 处存疑` : ""
        }</small>
      </div>
      <div class="reader-comic-list">
        ${items
          .map((item, index) => {
            const type = COMIC_TYPE_LABELS[item.type]
              ? item.type
              : "uncertain";
            return `<article class="reader-comic-item is-${type}">
              <header class="reader-comic-item-head">
                <span class="reader-comic-badge">${esc(readerComicTypeLabel(type))}</span>
                ${
                  item.speaker_hint
                    ? `<span class="reader-comic-speaker">${esc(item.speaker_hint)}</span>`
                    : ""
                }
                <button type="button" class="reader-comic-flag ${
                  type === "uncertain" ? "is-active" : ""
                }" data-action="reader-comic-uncertain" data-index="${index}">${
                  type === "uncertain" ? "已标存疑" : "标记存疑"
                }</button>
              </header>
              <p class="reader-comic-src">${esc(item.original_text || "")}</p>
              <label class="reader-comic-edit-row">
                <span class="sr-only">修改译文</span>
                <textarea class="reader-comic-edit" rows="2" data-comic-index="${index}" spellcheck="false">${esc(item.translation || "")}</textarea>
              </label>
            </article>`;
          })
          .join("")}
      </div>
    </section>`;
  }

  let readerComicBusy = false;

  async function readerComicTranslate(button) {
    const book = activeReaderBook();
    const pageIndex = state.reader.page;
    const page = book?.pages?.[pageIndex];
    if (!book || !page || readerComicBusy) return;
    if (!aiReady("comic")) {
      showToast("先在设置里启用 AI 助手并保存 Key，漫画翻译会复用同一套模型。");
      return;
    }
    const existing = state.reader.comicTranslations?.[book.id]?.[pageIndex];
    if (
      Array.isArray(existing) &&
      existing.some((item) => item.edited) &&
      !window.confirm("这一页有手动改过的译文，重新翻译会覆盖，继续吗？")
    ) {
      return;
    }
    const stored = state.reader.ocrRegions?.[book.id]?.[pageIndex];
    let regions = Array.isArray(stored) ? stored : [];
    if (!regions.length) {
      // 没有坐标时退回按段落顺序翻译，至少不让整页翻译功能失效。
      regions = readerParagraphBlocks(String(page.text || "").trim()).map(
        (text) => ({ text, box: null, type: "" }),
      );
    }
    if (!regions.length) {
      showToast("这一页还没有识别出文字，先识别本页。");
      return;
    }
    readerComicBusy = true;
    const finish = beginButtonTask(button, "逐格翻译中…");
    try {
      const result = await window.CikeAI.translateComicPage(
        regions,
        book.language || "en",
        "中文",
      );
      state.reader.comicTranslations ||= {};
      state.reader.comicTranslations[book.id] ||= {};
      state.reader.comicTranslations[book.id][pageIndex] = result.data;
      saveState();
      finish("done", "已翻译");
      playSound("ocr-done");
      readerToolOpen = "translate-page";
      renderReader();
      if (result.cached) showToast("这一页命中本机缓存，直接复用。");
    } catch (error) {
      finish();
      showToast(`漫画翻译失败：${error.message}`);
    } finally {
      readerComicBusy = false;
    }
  }

  function readerVisualPageTranslation(book, page, pageIndex) {
    const text = String(page?.text || "").trim();
    const regionCount = Array.isArray(
      state.reader.ocrRegions?.[book.id]?.[pageIndex],
    )
      ? state.reader.ocrRegions[book.id][pageIndex].length
      : 0;
    if (!text) {
      return `<p class="reader-empty-copy">这一页还没有可翻译的文字。先识别这一页，识别结果会保存在这本书里，下次打开还能用。</p>
        <div class="reader-page-ocr-row">
          <button class="paper-btn is-ink" type="button" data-action="reader-page-ocr">${icon("search")}识别本页文字</button>
          <small>${ocrServiceUrl() ? "检测服务 + 离线 OCR 兜底" : "本地离线 OCR · 英语 / 法语"}</small>
        </div>`;
    }
    // 图片 / PDF 页之前只给一整段译文，漫画对白一多就整页串行。
    // 这里沿用正文的分段规则，逐段给出“原文 + 译文”，顺序不会错开。
    const blocks = readerParagraphBlocks(text);
    const comic = readerComicPanel(book, pageIndex);
    // 逐格译文已经带原文和坐标，再叠一份整段对照只会重复占屏。
    const pairs = comic
      ? ""
      : `<div class="reader-page-pairs">
        ${blocks
          .map((block, index) => {
            const key = readerParagraphKey(book, pageIndex, index, block);
            const stored = state.reader.sentenceTranslations?.[key] || "";
            return `<div class="reader-page-pair">
              <p class="reader-page-pair-src">${esc(block)}</p>
              <p class="reader-page-pair-zh" data-para-key="${esc(key)}" data-para-source="${esc(block)}">${esc(stored)}</p>
            </div>`;
          })
          .join("")}
      </div>`;
    return `<div class="reader-page-translate">
      <div class="reader-page-translate-head">
        <span class="reader-toc-flag">第 ${pageIndex + 1} 页</span>
        <small>${comic ? "逐格对照" : `按段对照 · 共 ${blocks.length} 段`}</small>
      </div>
      <div class="reader-comic-tools">
        <button class="paper-btn is-ink" type="button" data-action="reader-comic-translate">${icon("speech")}${comic ? "重新逐格翻译" : "漫画逐格翻译"}</button>
        <small>${regionCount ? `${regionCount} 个文字区 · 带坐标翻译` : "没有坐标，按段落顺序翻译"}</small>
      </div>
      ${comic}
      ${pairs}
    </div>`;
  }

  // OCR 结果自带“块 → 段 → 行”的层级。按原图的段落结构重建，再丢掉
  // 低置信度和字母占比过低的噪声行，避免漫画装饰字被拼成一句假正文。
  const OCR_MIN_CONFIDENCE = 45;

  function ocrParagraphClean(value) {
    return sanitizeBookText(value)
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function ocrParagraphConfidence(paragraph) {
    if (typeof paragraph?.confidence === "number") return paragraph.confidence;
    const lines = paragraph?.lines || [];
    let weight = 0;
    let score = 0;
    for (const line of lines) {
      const length = String(line.text || "").trim().length;
      if (!length || typeof line.confidence !== "number") continue;
      weight += length;
      score += line.confidence * length;
    }
    return weight ? score / weight : null;
  }

  function ocrKeepParagraph(text, confidence) {
    if (!text) return false;
    const letters =
      text.match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF]/g) ||
      [];
    const visible = text.replace(/\s/g, "");
    if (!visible.length || letters.length < 2) return false;
    if (letters.length / visible.length < 0.4) return false;
    if (
      typeof confidence === "number" &&
      confidence > 0 &&
      confidence < OCR_MIN_CONFIDENCE
    ) {
      return false;
    }
    return true;
  }

  function ocrResultToParagraphs(result) {
    const data = result?.data || {};
    let paragraphs = [];
    for (const block of data.blocks || []) {
      paragraphs.push(...(block.paragraphs || []));
    }
    if (!paragraphs.length) paragraphs = data.paragraphs || [];
    if (!paragraphs.length && data.lines?.length) {
      // 旧版只返回行级结果时，按行间距把相邻行并回段落。
      let current = [];
      let lastBottom = null;
      for (const line of data.lines) {
        const top = line.bbox?.y0;
        if (
          lastBottom != null &&
          Number.isFinite(top) &&
          top - lastBottom > 14
        ) {
          paragraphs.push({ lines: current });
          current = [];
        }
        current.push(line);
        if (Number.isFinite(line.bbox?.y1)) lastBottom = line.bbox.y1;
      }
      if (current.length) paragraphs.push({ lines: current });
    }
    const output = [];
    if (paragraphs.length) {
      const push = (text) => {
        if (!text || !ocrKeepParagraph(text, null)) return;
        if (output[output.length - 1] === text) return;
        output.push(text);
      };
      // 逐行先过滤：一段里常混着对白和装饰字，别让一行噪声拖垮整段。
      // 保留下来的行再按垂直间距二次切分，漫画对白能一格格分开。
      for (const paragraph of paragraphs) {
        const lineItems = paragraph.lines || [];
        if (lineItems.length) {
          const groups = [];
          let current = [];
          let lastBottom = null;
          for (const line of lineItems) {
            const lineText = ocrParagraphClean(line.text);
            if (!ocrKeepParagraph(lineText, line.confidence)) continue;
            const top = line.bbox?.y0;
            if (
              lastBottom != null &&
              Number.isFinite(top) &&
              top - lastBottom > 16
            ) {
              groups.push(current);
              current = [];
            }
            current.push(lineText);
            if (Number.isFinite(line.bbox?.y1)) lastBottom = line.bbox.y1;
          }
          if (current.length) groups.push(current);
          for (const group of groups) push(group.join(" "));
          continue;
        }
        const text = ocrParagraphClean(paragraph.text || "");
        if (!ocrKeepParagraph(text, ocrParagraphConfidence(paragraph))) continue;
        push(text);
      }
      // 有结构化结果却一段都没留下，说明这页确实没有可读文字；
      // 不要退回整页原始文本，否则噪声又会被当成正文。
      return output.join("\n\n");
    }

    // 没有结构化数据时退回整页文本：先按空行分段，再按句子长度再分。
    const plain = sanitizeBookText(data.text || "").replace(/\r\n?/g, "\n");
    const confidence =
      typeof data.confidence === "number" ? data.confidence : null;
    const chunks = plain
      .split(/\n{2,}/)
      .map(ocrParagraphClean)
      .filter(
        (chunk) => chunk && ocrKeepParagraph(chunk, confidence),
      );
    if (chunks.length > 1) return chunks.join("\n\n");
    const sentences = readerSplitSentences(chunks[0] || "");
    const blocks = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > 220) {
        blocks.push(current);
        current = "";
      }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) blocks.push(current);
    return blocks.join("\n\n");
  }

  let readerOcrBusy = false;

  function ocrResultToRegions(result) {
    const data = result?.data || {};
    const lines = [];
    const collect = (paragraph) => {
      for (const line of paragraph?.lines || []) lines.push(line);
    };
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) collect(paragraph);
    }
    if (!lines.length) {
      for (const paragraph of data.paragraphs || []) collect(paragraph);
    }
    if (!lines.length && Array.isArray(data.lines)) lines.push(...data.lines);
    const regions = [];
    for (const line of lines) {
      const text = ocrParagraphClean(line.text);
      if (!ocrKeepParagraph(text, line.confidence)) continue;
      const raw = line.bbox;
      const box = raw
        ? [raw.x0, raw.y0, raw.x1, raw.y1].map((value) =>
            Math.round(Number(value) || 0),
          )
        : null;
      regions.push({
        text,
        box,
        confidence:
          typeof line.confidence === "number"
            ? Math.round(line.confidence)
            : null,
        type: "",
      });
    }
    return regions;
  }

  function ocrRegionsToText(regions) {
    const blocks = [];
    let current = [];
    let lastBox = null;
    const flush = () => {
      if (current.length) blocks.push(current.join(" "));
      current = [];
    };
    for (const region of regions) {
      const text = ocrParagraphClean(region.text || "");
      if (!text) continue;
      const box = Array.isArray(region.box) ? region.box : null;
      if (!box) {
        flush();
        blocks.push(text);
        lastBox = null;
        continue;
      }
      if (current.length && lastBox) {
        const gap = box[1] - lastBox[3];
        const overlap =
          Math.min(box[2], lastBox[2]) - Math.max(box[0], lastBox[0]);
        // 纵向断开或横向不重叠，说明已经换了一格/一栏。
        if (gap > 18 || overlap <= 0) flush();
      }
      current.push(text);
      lastBox = box;
    }
    flush();
    return blocks.join("\n\n");
  }

  function ocrServiceUrl() {
    return String(state.settings.ocrServiceUrl || "")
      .trim()
      .replace(/\/+$/, "");
  }

  async function readerPageImage(book, page) {
    if (book.kind === "pdf") {
      const canvas = document.querySelector(".reader-pdf-canvas");
      if (!canvas) throw new Error("PDF 这一页还没渲染完，稍后再试。");
      return canvas.toDataURL("image/jpeg", 0.86);
    }
    if (book.kind === "image") {
      const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error("图片读取失败"));
        node.src = readerImageUrl(book, page);
      });
      const canvas = document.createElement("canvas");
      const longest = Math.max(image.naturalWidth || 1, image.naturalHeight || 1);
      const scale = Math.min(1, 1800 / longest);
      canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.86);
    }
    throw new Error("这一页没有可识别的图像。");
  }

  function ocrRegionUsable(text) {
    if (!text) return false;
    const letters =
      text.match(
        /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF]/g,
      ) || [];
    const visible = text.replace(/\s/g, "");
    return (
      visible.length > 0 &&
      letters.length >= 2 &&
      letters.length / visible.length >= 0.35
    );
  }

  function normalizeServiceRegions(raw) {
    return (Array.isArray(raw) ? raw : [])
      .map((item) => {
        const text = ocrParagraphClean(
          item?.text || item?.original_text || "",
        );
        if (!ocrRegionUsable(text)) return null;
        const label = String(item?.type || item?.class || "").toLowerCase();
        let type = "";
        if (label === "text_bubble" || label === "bubble" || label === "dialogue") {
          type = "dialogue";
        } else if (label === "text_free" || label === "narration") {
          type = "narration";
        } else if (label === "sfx") {
          type = "sfx";
        }
        const rawBox = Array.isArray(item?.box) ? item.box : item?.bbox;
        const box =
          Array.isArray(rawBox) && rawBox.length === 4
            ? rawBox.map((value) => Math.round(Number(value) || 0))
            : null;
        const confidence =
          typeof item?.confidence === "number"
            ? Math.round(item.confidence)
            : null;
        return {
          text,
          box,
          confidence,
          type,
          // 检测/识别服务给的置信度偏低时先标记存疑，交给用户确认。
          uncertain: confidence != null && confidence < 60,
        };
      })
      .filter(Boolean);
  }

  async function readerPageOcrService(book, page) {
    const base = ocrServiceUrl();
    if (!base) return null;
    const image = await readerPageImage(book, page);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${base}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          mime: "image/jpeg",
          language: book.language || "en",
          page: state.reader.page,
        }),
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`识别服务返回 HTTP ${response.status}`);
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (error) {
        throw new Error("识别服务返回的不是 JSON");
      }
      const regions = normalizeServiceRegions(
        Array.isArray(payload) ? payload : payload?.regions,
      );
      if (!regions.length) throw new Error("识别服务没有返回可用的文本区");
      return regions;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function readerPageOcr(button) {
    const book = activeReaderBook();
    const pageIndex = state.reader.page;
    const page = book?.pages?.[pageIndex];
    if (!book || !page || readerOcrBusy) return;
    const serviceUrl = ocrServiceUrl();
    if (!serviceUrl && !window.Tesseract) {
      showToast("离线 OCR 引擎不可用，请确认 vendor/tessdata 已随应用打包。");
      return;
    }
    readerOcrBusy = true;
    const finish = beginButtonTask(button, "正在识别…");
    const setLabel = (label) => {
      const node = button?.querySelector("span:last-child");
      if (node) node.textContent = label;
    };
    let worker;
    try {
      let regions = [];
      let text = "";
      let source = "tesseract";
      if (serviceUrl) {
        setLabel("正在检测文本框…");
        try {
          regions = await readerPageOcrService(book, page);
          text = ocrRegionsToText(regions);
          source = "service";
        } catch (serviceError) {
          const reason =
            serviceError?.name === "AbortError"
              ? "识别服务超时"
              : /failed to fetch/i.test(String(serviceError?.message))
                ? "识别服务连接失败"
                : serviceError.message;
          showToast(`${reason}，已回退离线 OCR。`);
        }
      }
      if (!regions.length) {
        if (!window.Tesseract) {
          throw new Error("识别服务不可用，离线 OCR 引擎也没有加载");
        }
        let image = null;
        if (book.kind === "image") {
          image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("图片读取失败"));
            img.src = readerImageUrl(book, page);
          });
        } else if (book.kind === "pdf") {
          const canvas = document.querySelector(".reader-pdf-canvas");
          if (!canvas) throw new Error("PDF 这一页还没渲染完，稍后再试。");
          image = canvas;
        }
        if (!image) throw new Error("这一页没有可识别的图像。");
        worker = await window.Tesseract.createWorker(
          book.language === "fr" ? "fra" : "eng",
          1,
          {
            workerPath: "./vendor/worker.min.js",
            corePath: "./vendor/",
            langPath: "./vendor/tessdata/",
            logger: (message) => {
              if (message.status === "recognizing text") {
                setLabel(`识别中 ${Math.round((message.progress || 0) * 100)}%`);
              }
            },
          },
        );
        const result = await worker.recognize(image, {}, { blocks: true, text: true });
        text = ocrResultToParagraphs(result);
        regions = ocrResultToRegions(result);
        source = "tesseract";
      }
      if (!text) throw new Error("这一页没有识别出可读的段落");
      state.reader.ocrText ||= {};
      state.reader.ocrText[book.id] ||= {};
      state.reader.ocrText[book.id][pageIndex] = text;
      if (regions.length) {
        state.reader.ocrRegions ||= {};
        state.reader.ocrRegions[book.id] ||= {};
        state.reader.ocrRegions[book.id][pageIndex] = regions;
      }
      state.reader.ocrSource ||= {};
      state.reader.ocrSource[book.id] ||= {};
      state.reader.ocrSource[book.id][pageIndex] = source;
      page.text = text;
      saveState();
      finish("done", "已识别");
      playSound("ocr-done");
      readerToolOpen = "translate-page";
      renderReader();
    } catch (error) {
      finish();
      showToast(`识别失败：${error.message}`);
    } finally {
      readerOcrBusy = false;
      await worker?.terminate?.();
    }
  }

  function hydrateVisualPageTranslation(book, page, pageIndex) {
    const text = String(page?.text || "").trim();
    if (!text) return;
    const serial = ++visualTranslateSerial;
    const pending = Array.from(
      document.querySelectorAll(".reader-page-pair-zh"),
    ).filter((node) => !node.textContent.trim());
    if (!pending.length) return;
    let cursor = 0;
    let dirty = false;
    const worker = async () => {
      while (cursor < pending.length) {
        if (serial !== visualTranslateSerial) return;
        const node = pending[cursor];
        cursor += 1;
        const source = node.dataset.paraSource || "";
        if (!source) continue;
        try {
          const translated = await fetchParagraphTranslation(
            source,
            book.language || "en",
          );
          if (serial !== visualTranslateSerial) return;
          if (translated) {
            node.textContent = translated;
            node.classList.remove("is-failed", "is-offline");
            const key = node.dataset.paraKey;
            if (key) {
              state.reader.sentenceTranslations[key] = translated;
              dirty = true;
            }
          } else {
            node.textContent = "暂无完整译文，可稍后重试";
            node.classList.add("is-failed");
          }
        } catch (error) {
          node.textContent = "暂无完整译文，可稍后重试";
          node.classList.add("is-failed");
        }
      }
    };
    Promise.all([worker(), worker(), worker()]).then(() => {
      if (serial === visualTranslateSerial && dirty) saveState();
    });
  }

  function renderReader() {
    const book = readerBooks().find((item) => item.id === state.reader.activeBookId);
    if (!book) {
      state.reader.activeBookId = "";
      renderBooks();
      return;
    }
    if (!Array.isArray(book.pages) || !book.pages.length) {
      if (book.assetPath) {
        main.innerHTML = `<div class="empty-state">
          <h2>正在展开《${esc(book.title)}》</h2>
          <p>第一次打开会把整本正文切成分页，稍等片刻。</p>
        </div>`;
        const loadingId = book.id;
        ensureBookPages(book)
          .then(() => {
            if (state.reader.activeBookId === loadingId) renderReader();
          })
          .catch((error) => {
            showToast(`打开失败：${error.message}`);
            state.reader.activeBookId = "";
            renderBooks();
          });
        return;
      }
      state.reader.activeBookId = "";
      renderBooks();
      return;
    }
    startReadingClock();
    const pageIndex = clamp(Number(state.reader.page || 0), 0, book.pages.length - 1);
    state.reader.page = pageIndex;
    state.reader.progress[book.id] = pageIndex;
    // 第一次翻到最后一页就记下完成日期，用于“今年读完 12 本”这类成就。
    if (pageIndex >= Math.max(0, book.pages.length - 1)) {
      state.reader.finishedAt = state.reader.finishedAt || {};
      if (!state.reader.finishedAt[book.id]) {
        state.reader.finishedAt[book.id] = new Date().toISOString();
        saveState();
      }
    }
    const page = book.pages[pageIndex];
    const storedOcr = state.reader.ocrText?.[book.id]?.[pageIndex];
    if (storedOcr && !String(page.text || "").trim()) page.text = storedOcr;
    const noteKey = `${book.id}:${pageIndex}`;
    const note = state.reader.notes?.[noteKey] || "";
    const tokens = readerTokens(page.text, book.language);
    state.profile.readingSeconds ||= 0;
    if (!renderReader.openedAt) renderReader.openedAt = Date.now();
    const openTool = readerToolOpen || "";
    const bookmarkList = Array.isArray(state.reader.bookmarks?.[book.id])
      ? state.reader.bookmarks[book.id]
      : [];
    const isBookmarked = bookmarkList.includes(pageIndex);
    const visualBook = book.kind === "image" || book.kind === "pdf";
    const chapter = readerPageLabel(page, pageIndex, book);
    const turnDirection = readerTurn;
    const turnClass = turnDirection ? `is-turn-${turnDirection}` : "";
    const turnGhost = readerTurnGhost;
    readerTurnGhost = "";
    readerTurn = "";

    const drawerTitles = {
      toc: "目录",
      tokens: "生词与语句",
      note: "本页笔记",
      bookmark: "收藏页",
      font: "字号与排版",
      menu: "更多",
      "translate-page": "本页译文",
    };

    const panels = {
      toc: readerTocPanel(book, pageIndex),
      tokens: `
        <p class="reader-drawer-hint">点击词条收进智能复习；只收藏你主动点的那一个。</p>
        <div class="token-list">
          ${tokens
            .slice(0, 24)
            .map(
              (token) => `<button type="button" title="${esc(token.meaning)}" data-action="collect-reader-word" data-word="${esc(token.word)}" data-meaning="${esc(token.meaning)}"><strong>${esc(token.word)}</strong>${token.meaning ? `<small>${esc(token.meaning)}</small>` : ""}</button>`,
            )
            .join("") || `<p class="reader-empty-copy">本页暂未匹配到词典里的词。</p>`}
        </div>`,
      note: `<textarea id="readerNote" class="reader-note" rows="6" placeholder="划线般的想法，停在这一页…">${esc(note)}</textarea>`,
      bookmark: bookmarkList.length
        ? `<div class="bookmark-list">${bookmarkList
            .map((bookmarkPage) => {
              const marked = book.pages[bookmarkPage] || {};
              return `<button class="paper-btn ${bookmarkPage === pageIndex ? "is-active" : ""}" type="button" data-action="reader-goto" data-page="${bookmarkPage}">第 ${bookmarkPage + 1} 页 · ${esc(marked.title || "收藏页")}</button>`;
            })
            .join("")}</div>`
        : `<p class="reader-empty-copy">还没有收藏页。点下方“收藏”就能把这一页记下来，之后从这里翻回去。</p>`,
      font: `
        <div class="reader-font-panel">
          <span>字号</span>
          <input id="readerFontSize" type="range" min="15" max="27" step="1" value="${state.reader.fontSize}">
          <span id="readerFontSizeLabel">${state.reader.fontSize}px</span>
        </div>
        <p class="reader-drawer-hint">正文会随字号重新排版，长按可以选择文字。</p>`,
      menu: `
        <div class="reader-menu-list">
          <button type="button" data-action="reader-tool" data-tool="toc">${icon("folder")}<span>目录</span><small>跳章、跳页</small></button>
          <button type="button" data-action="reader-tool" data-tool="bookmark">${icon("bookmark")}<span>收藏页</span><small>${bookmarkList.length} 个书签</small></button>
          <button type="button" data-action="reader-tool" data-tool="tokens">${icon("note")}<span>生词与语句</span><small>收词进复习</small></button>
          ${
            visualBook
              ? `<button type="button" data-action="reader-page-translate">${icon("speech")}<span>本页译文</span><small>图片 / PDF · 自动分段</small></button>`
              : `<button type="button" class="${state.reader.showTranslations === false ? "" : "is-active"}" data-action="reader-tool" data-tool="translate">${icon("speech")}<span>译文</span><small>${state.reader.showTranslations === false ? "已隐藏" : "跟随段落"}</small></button>`
          }
          <button type="button" data-action="reader-tool" data-tool="note">${icon("pen")}<span>本页笔记</span><small>${note ? "已写" : "未写"}</small></button>
          <button type="button" data-action="reader-tool" data-tool="font">${icon("settings")}<span>字号与排版</span><small>${state.reader.fontSize}px</small></button>
        </div>`,
      "translate-page": readerVisualPageTranslation(book, page, pageIndex),
    };

    main.innerHTML = `
      <header class="reader-bar">
        <button class="reader-bar-btn" type="button" data-action="close-reader" aria-label="返回书架">${icon("back")}</button>
        <span class="reader-bar-caption">${book.language === "fr" ? "LECTURE · FRANÇAIS" : book.language === "zh" ? "阅读 · 中文" : "READING · ENGLISH"}</span>
        <div class="reader-bar-actions">
          <button class="reader-bar-btn is-aa" type="button" data-action="reader-tool" data-tool="font" aria-label="字号与排版">Aa</button>
          <button class="reader-bar-btn ${isBookmarked ? "is-active" : ""}" type="button" data-action="reader-bookmark" aria-label="${isBookmarked ? "取消收藏本页" : "收藏本页"}" aria-pressed="${isBookmarked}">${icon("bookmark")}</button>
          <button class="reader-bar-btn" type="button" data-action="reader-tool" data-tool="menu" aria-label="更多工具">${icon("more")}</button>
        </div>
      </header>

      <div class="reader-stage ${visualBook ? "is-visual" : "is-text"} ${turnClass} ${state.reader.showTranslations === false ? "is-translation-hidden" : ""}" id="readerStage" style="--reader-font-size:${state.reader.fontSize}px">
        ${turnGhost}
        ${turnDirection ? `<div class="reader-turn-sweep is-${turnDirection}" aria-hidden="true"></div>` : ""}
        ${
          visualBook
            ? `<button class="reader-edge is-prev" type="button" data-action="reader-prev" ${pageIndex === 0 ? "disabled" : ""} aria-label="上一页">${icon("back")}<span>前一页</span></button>
               <button class="reader-edge is-next" type="button" data-action="reader-next" ${pageIndex >= book.pages.length - 1 ? "disabled" : ""} aria-label="下一页">${icon("arrow")}<span>后一页</span></button>`
            : ""
        }
        <article class="reader-sheet">
          <header class="reader-sheet-head">
            ${
              visualBook
                ? `<p class="reader-brand">词刻 CIKE</p>
                   <p class="reader-sheet-sub">${esc(book.title)}${readerPageLabel(page, pageIndex, book) ? ` · ${esc(readerPageLabel(page, pageIndex, book))}` : ""}</p>`
                : `<p class="reader-sheet-kicker">正在阅读</p>
                   <h1 class="reader-sheet-title">${esc(book.title)}${chapter ? ` · ${esc(chapter)}` : ""}</h1>
                   <p class="reader-brand">词刻 CIKE</p>`
            }
          </header>
          <div class="reader-paper">
            ${
              book.kind === "image"
                ? `<img class="reader-page-image" alt="${esc(page.title)}" src="${esc(readerImageUrl(book, page))}" data-action="reader-fullscreen" title="轻点全屏查看">`
                : book.kind === "pdf"
                  ? `<div class="reader-page-pdf" id="readerPdfPage"><p>正在渲染 PDF 第 ${pageIndex + 1} 页…</p></div>`
                  : readerParagraphs(page.text, book, pageIndex)
            }
          </div>
          ${readerAnnotationsMarkup(book, pageIndex)}
          ${note ? `<aside class="reader-sticky-note">${esc(note)}</aside>` : ""}
          ${visualBook ? `<p class="reader-zoom-hint">轻点画面全屏查看，可放大阅读。</p>` : ""}
        </article>
      </div>

      <nav class="reader-dock" aria-label="阅读工具">
        <button class="reader-dock-btn" type="button" data-action="reader-tool" data-tool="toc">${icon("folder")}<span>目录</span></button>
        ${
          visualBook
            ? `<button class="reader-dock-btn" type="button" data-action="reader-page-translate">${icon("speech")}<span>译文</span></button>`
            : `<button class="reader-dock-btn ${state.reader.showTranslations === false ? "" : "is-active"}" type="button" data-action="reader-tool" data-tool="translate" aria-pressed="${state.reader.showTranslations === false ? "false" : "true"}">${icon("speech")}<span>译文</span></button>`
        }
        <button class="reader-dock-btn" type="button" data-action="reader-tool" data-tool="speak">${icon("volume")}<span>朗读</span></button>
        <button class="reader-dock-btn" type="button" data-action="reader-tool" data-tool="note">${icon("note")}<span>笔记</span></button>
        <button class="reader-dock-btn ${isBookmarked ? "is-active" : ""}" type="button" data-action="reader-bookmark" aria-pressed="${isBookmarked}">${icon("bookmark")}<span>${isBookmarked ? "已收藏" : "收藏"}</span></button>
        <div class="reader-dock-pager">
          <button type="button" data-action="reader-prev" ${pageIndex === 0 ? "disabled" : ""} aria-label="上一页">${icon("back")}</button>
          <span>${pageIndex + 1} / ${book.pages.length}</span>
          <button type="button" data-action="reader-next" ${pageIndex >= book.pages.length - 1 ? "disabled" : ""} aria-label="下一页">${icon("arrow")}</button>
        </div>
      </nav>

      ${
        openTool
          ? `<div class="reader-drawer-scrim" data-action="reader-close-tool"></div>
             <section class="reader-drawer" role="dialog" aria-modal="true" aria-label="${drawerTitles[openTool] || "阅读工具"}">
               <header class="reader-drawer-head">
                 <strong>${drawerTitles[openTool] || "阅读工具"}</strong>
                 <button class="reader-drawer-close" type="button" data-action="reader-close-tool" aria-label="关闭">${icon("close")}</button>
               </header>
               <div class="reader-drawer-body">${panels[openTool] || ""}</div>
             </section>`
          : ""
      }
    `;
    if (book.kind === "pdf") {
      renderPdfReaderPage(book, pageIndex);
      if (openTool === "toc") hydrateReaderPdfToc(book, pageIndex);
    } else if (book.kind !== "image" && book.language !== "zh") {
      hydrateReaderParagraphTranslations(book, pageIndex);
    }
    if (
      visualBook &&
      openTool === "translate-page" &&
      book.language !== "zh" &&
      !Array.isArray(state.reader.comicTranslations?.[book.id]?.[pageIndex])
    ) {
      hydrateVisualPageTranslation(book, page, pageIndex);
    }
    requestAnimationFrame(() => {
      paintReaderDoodles();
      if (readerDrawMode) mountReaderDrawing();
      if (openTool === "toc") scrollReaderTocActive();
      if (turnGhost) {
        const ghost = document.querySelector(".reader-turn-ghost");
        if (ghost) window.setTimeout(() => ghost.remove(), 460);
      }
      const sweep = document.querySelector(".reader-turn-sweep");
      if (sweep) window.setTimeout(() => sweep.remove(), 460);
    });
  }

  let readerPdfCache = { key: "", task: null, document: null };
  let readerPdfRenderTask = null;
  let readerPdfPageToken = 0;

  function destroyReaderPdfCache() {
    if (readerPdfRenderTask) {
      try {
        readerPdfRenderTask.cancel();
      } catch (error) {
        // The render may already be finished.
      }
      readerPdfRenderTask = null;
    }
    const document = readerPdfCache.document;
    readerPdfCache = { key: "", task: null, document: null };
    if (document) {
      try {
        const closing = document.destroy();
        if (closing && typeof closing.catch === "function") {
          closing.catch(() => {});
        }
      } catch (error) {
        // The document may already be closed.
      }
    }
  }

  function readerPdfSize(pdfData) {
    if (!pdfData) return 0;
    if (typeof pdfData.size === "number") return pdfData.size;
    if (typeof pdfData.byteLength === "number") return pdfData.byteLength;
    return 0;
  }

  async function loadReaderPdfDocument(book, pdfjs) {
    if (!book.pdfData && book.assetPath) {
      const response = await fetch(book.assetPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      book.pdfData = await response.blob();
    }
    if (!book.pdfData) throw new Error("找不到 PDF 文件");
    const key = `${book.id || "book"}:${readerPdfSize(book.pdfData)}`;
    if (readerPdfCache.key !== key) {
      destroyReaderPdfCache();
      readerPdfCache.key = key;
    } else if (readerPdfCache.document) {
      return readerPdfCache.document;
    } else if (readerPdfCache.task) {
      return readerPdfCache.task;
    }
    const task = (async () => {
      const data =
        book.pdfData instanceof Blob
          ? new Uint8Array(await book.pdfData.arrayBuffer())
          : new Uint8Array(book.pdfData);
      return pdfjs.getDocument({ data, wasmUrl: "./vendor/wasm/" }).promise;
    })()
      .then((document) => {
        if (readerPdfCache.key === key) {
          readerPdfCache.document = document;
          readerPdfCache.task = null;
        }
        return document;
      })
      .catch((error) => {
        if (readerPdfCache.key === key) readerPdfCache.task = null;
        throw error;
      });
    readerPdfCache.task = task;
    return task;
  }

  async function renderPdfReaderPage(book, pageIndex) {
    const host = document.getElementById("readerPdfPage");
    if (!host) return;
    const token = ++readerPdfPageToken;
    try {
      const pdfjs = await import("./vendor/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
      const pdfDocument = await loadReaderPdfDocument(book, pdfjs);
      if (token !== readerPdfPageToken || !host.isConnected) return;
      const page = await pdfDocument.getPage(pageIndex + 1);
      if (token !== readerPdfPageToken || !host.isConnected) return;
      // Some comic pages are very large. Capping the canvas avoids blank
      // renders on devices with a limited WebView canvas size.
      const baseViewport = page.getViewport({ scale: 1 });
      const maxDimension = 4096;
      const scale = Math.min(
        1.45,
        maxDimension / Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = "reader-pdf-canvas";
      canvas.dataset.action = "reader-fullscreen";
      canvas.title = "轻点全屏查看";
      host.replaceChildren(canvas);
      if (readerPdfRenderTask) {
        try {
          readerPdfRenderTask.cancel();
        } catch (error) {
          // A previous render may already be done.
        }
      }
      const renderTask = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
      });
      readerPdfRenderTask = renderTask;
      await renderTask.promise;
      readerPdfRenderTask = null;
      page.cleanup();
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      if (readerDrawMode) requestAnimationFrame(mountReaderDrawing);
    } catch (error) {
      if (error?.name === "RenderingCancelledException") return;
      if (token !== readerPdfPageToken || !host.isConnected) return;
      const missing = /404|Failed to fetch/i.test(String(error.message));
      host.innerHTML = missing
        ? `<div class="reader-missing-asset">
             <p class="reader-empty-copy">这本 PDF 的原文件不在应用里，所以画面读不出来。</p>
             <p class="reader-empty-copy">在「图书导入」里重新选一次这个 PDF，就能恢复图片阅读和整页 OCR 翻译。</p>
             <button class="paper-btn" type="button" data-view="reader-import">去重新导入</button>
           </div>`
        : `<p class="reader-empty-copy">PDF 页面渲染失败：${esc(error.message)}</p>`;
    }
  }

  function openReaderFullscreen() {
    const book = readerBooks().find(
      (item) => item.id === state.reader.activeBookId,
    );
    if (!book) return;
    document.getElementById("readerFullscreen")?.remove();
    const pageIndex = clamp(state.reader.page, 0, book.pages.length - 1);
    const overlay = document.createElement("div");
    overlay.id = "readerFullscreen";
    overlay.className = "reader-fullscreen";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `全屏查看第 ${pageIndex + 1} 页`);
    overlay.innerHTML = `
      <div class="reader-fullscreen-bar">
        <span>第 ${pageIndex + 1} / ${book.pages.length} 页</span>
        <div class="reader-fullscreen-tools">
          <button type="button" data-zoom="out" aria-label="缩小">−</button>
          <button type="button" data-zoom="in" aria-label="放大">＋</button>
          <button type="button" data-action="close-reader-fullscreen">关闭</button>
        </div>
      </div>
      <div class="reader-fullscreen-stage"></div>`;
    const stage = overlay.querySelector(".reader-fullscreen-stage");
    if (book.kind === "image") {
      const img = document.createElement("img");
      img.src = readerImageUrl(book, book.pages[pageIndex]);
      img.alt = book.title;
      img.style.width = "100%";
      stage.appendChild(img);
    } else {
      const source = document.querySelector(".reader-pdf-canvas");
      if (!source) {
        showToast("这一页还没渲染完，稍后再试。");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      stage.appendChild(canvas);
    }
    let scale = 1;
    const applyScale = () => {
      const media = stage.firstElementChild;
      if (!media) return;
      media.style.width = `${Math.round(scale * 100)}%`;
    };
    overlay.addEventListener("click", (event) => {
      const zoom = event.target.closest("[data-zoom]")?.dataset.zoom;
      if (zoom) {
        scale = clamp(scale + (zoom === "in" ? 0.5 : -0.5), 1, 3);
        applyScale();
        return;
      }
      if (event.target === overlay || event.target === stage) {
        closeReaderFullscreen();
      }
    });
    const onKey = (event) => {
      if (event.key === "Escape") closeReaderFullscreen();
    };
    document.addEventListener("keydown", onKey);
    overlay._onKey = onKey;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="close-reader-fullscreen"]')?.focus();
  }

  function closeReaderFullscreen() {
    const overlay = document.getElementById("readerFullscreen");
    if (!overlay) return;
    if (overlay._onKey) document.removeEventListener("keydown", overlay._onKey);
    overlay.remove();
  }

  function readerTokens(text, language) {
    const seen = new Set();
    const tokens = [];
    if (language === "zh") return tokens;
    const pattern = language === "fr" ? /[A-Za-zÀ-ÿ’'-]{2,}/g : /[A-Za-z][A-Za-z'-]{1,}/g;
    for (const match of String(text || "").matchAll(pattern)) {
      const key = match[0].toLowerCase();
      if (seen.has(key) || key.length < 2) continue;
      seen.add(key);
      const dictionaryEntry = typewordsDictionary[key];
      tokens.push({
        word: match[0],
        meaning: dictionaryEntry?.m || "",
      });
      if (tokens.length >= 40) break;
    }
    return tokens;
  }

  function flushReadingTime() {
    if (!renderReader.openedAt) return;
    const seconds = Math.max(0, Math.round((Date.now() - renderReader.openedAt) / 1000));
    if (seconds > 0 && seconds < 4 * 60 * 60) {
      state.profile.readingSeconds = Number(state.profile.readingSeconds || 0) + seconds;
      const key = todayKey();
      state.profile.readDays = state.profile.readDays || {};
      state.profile.readDays[key] = Number(state.profile.readDays[key] || 0) + seconds;
      state.profile.readSessionMax = Math.max(
        Number(state.profile.readSessionMax || 0),
        seconds,
      );
      saveState();
    }
    renderReader.openedAt = 0;
  }

  function startReadingClock() {
    if (readingClockTimer) return;
    renderReader.openedAt = Date.now();
    readingClockTimer = window.setInterval(() => {
      flushReadingTime();
      if (!document.hidden) renderReader.openedAt = Date.now();
    }, 30000);
  }

  function pauseReadingClock() {
    if (readingClockTimer) {
      window.clearInterval(readingClockTimer);
      readingClockTimer = null;
    }
    flushReadingTime();
  }

  const ACHIEVEMENT_GROUPS = [
    { id: "streak", label: "打卡 · 学习日期", tab: "打卡" },
    { id: "words", label: "单词 · 背诵", tab: "单词" },
    { id: "time", label: "阅读时长", tab: "时长" },
    { id: "days", label: "阅读天数", tab: "天数" },
    { id: "books", label: "阅读本数", tab: "本数" },
    { id: "notes", label: "笔记 · 输出", tab: "笔记" },
    { id: "fun", label: "综合 · 彩蛋", tab: "综合" },
  ];

  // 成就全部由本地真实数据推导，不额外维护计数器；首次达成时只记录时间。
  // sticker 字段就是贴纸墙上的圆章：icon 图标 / color 主色 / disp 数字 / label 手写文案。
  const ACHIEVEMENTS = [
    { id: "first-step", group: "streak", tier: 1, metric: "studied", goal: 1, unit: "词", title: "第一笔", desc: "完成第一次词条学习", sticker: { icon: "pen", color: "cream", disp: "√", label: "开始学习" } },
    { id: "streak-3", group: "streak", tier: 1, metric: "bestStreak", goal: 3, unit: "天", title: "三日不断", desc: "连续 3 天有学习记录", sticker: { icon: "star", color: "cream", disp: "3", label: "连续3天" } },
    { id: "streak-7", group: "streak", tier: 1, metric: "bestStreak", goal: 7, unit: "天", title: "一周成习", desc: "连续 7 天有学习记录", sticker: { icon: "calendar", color: "butter", disp: "7", label: "连续7天" } },
    { id: "streak-14", group: "streak", tier: 2, metric: "bestStreak", goal: 14, unit: "天", title: "两周不辍", desc: "连续 14 天有学习记录", sticker: { icon: "calendar", color: "orange", disp: "14", label: "连续14天" } },
    { id: "streak-30", group: "streak", tier: 2, metric: "bestStreak", goal: 30, unit: "天", title: "月满不辍", desc: "连续 30 天有学习记录", sticker: { icon: "moon", color: "sky", disp: "30", label: "连续30天" } },
    { id: "streak-90", group: "streak", tier: 3, metric: "bestStreak", goal: 90, unit: "天", title: "一季之约", desc: "连续 90 天有学习记录", sticker: { icon: "tree", color: "sage", disp: "90", label: "连续90天" } },
    { id: "streak-180", group: "streak", tier: 3, metric: "bestStreak", goal: 180, unit: "天", title: "半年同行", desc: "连续 180 天有学习记录", sticker: { icon: "hourglass", color: "lavender", disp: "180", label: "连续180天" } },
    { id: "streak-365", group: "streak", tier: 3, metric: "bestStreak", goal: 365, unit: "天", title: "一年灯下", desc: "连续 365 天有学习记录", sticker: { icon: "sun", color: "butter", disp: "365", label: "连续365天" } },
    { id: "days-7", group: "streak", tier: 1, metric: "activeDays", goal: 7, unit: "天", title: "常来坐坐", desc: "累计 7 天打开词刻作答", sticker: { icon: "calendar", color: "cream", disp: "7", label: "累计7天" } },
    { id: "days-30", group: "streak", tier: 2, metric: "activeDays", goal: 30, unit: "天", title: "一月常客", desc: "累计 30 天有学习记录", sticker: { icon: "calendar", color: "sky", disp: "30", label: "累计30天" } },
    { id: "days-100", group: "streak", tier: 2, metric: "activeDays", goal: 100, unit: "天", title: "百天小丘", desc: "累计 100 天有学习记录", sticker: { icon: "mountain", color: "orange", disp: "100", label: "累计100天" } },
    { id: "days-365", group: "streak", tier: 3, metric: "activeDays", goal: 365, unit: "天", title: "一年刻度", desc: "累计 365 天有学习记录", sticker: { icon: "medal", color: "butter", disp: "365", label: "累计365天" } },
    { id: "early-bird", group: "streak", tier: 2, metric: "earlyCount", goal: 10, unit: "次", title: "早起鸟", desc: "早上 5–7 点学习 10 次", sticker: { icon: "sun", color: "butter", disp: "早", label: "早起学习" } },
    { id: "night-owl", group: "streak", tier: 2, metric: "nightCount", goal: 10, unit: "次", title: "夜猫子", desc: "晚上 22 点后学习 10 次", sticker: { icon: "moon", color: "lavender", disp: "夜", label: "深夜学习" } },
    { id: "weekend-warrior", group: "streak", tier: 1, metric: "weekendDays", goal: 4, unit: "天", title: "周末也学", desc: "周末留下 4 天学习记录", sticker: { icon: "coffee", color: "rose", disp: "周末", label: "周末也学" } },
    { id: "month-full", group: "streak", tier: 3, metric: "monthFull", goal: 1, unit: "月", title: "本月全勤", desc: "某个月每天都留下学习记录", sticker: { icon: "check", color: "sky", disp: "满", label: "全勤月" } },
    { id: "comeback", group: "streak", tier: 1, metric: "comeback", goal: 1, unit: "次", title: "欢迎回来", desc: "间隔一周后重新开始学习", sticker: { icon: "refresh", color: "sage", disp: "回", label: "欢迎回来" } },
    { id: "new-year", group: "streak", tier: 2, metric: "crossYear", goal: 1, unit: "次", title: "跨年也在学", desc: "元旦当天留下学习记录", sticker: { icon: "lantern", color: "orange", disp: "跨年", label: "跨年学习" } },

    { id: "words-100", group: "words", tier: 1, metric: "studied", goal: 100, unit: "词", title: "百词成行", desc: "累计学习 100 个词条", sticker: { icon: "books", color: "cream", disp: "100", label: "学100词" } },
    { id: "words-500", group: "words", tier: 2, metric: "studied", goal: 500, unit: "词", title: "半千之步", desc: "累计学习 500 个词条", sticker: { icon: "folder", color: "sage", disp: "500", label: "学500词" } },
    { id: "words-1000", group: "words", tier: 2, metric: "studied", goal: 1000, unit: "词", title: "千词为卷", desc: "累计学习 1000 个词条", sticker: { icon: "library", color: "sky", disp: "1000", label: "学1000词" } },
    { id: "words-3000", group: "words", tier: 3, metric: "studied", goal: 3000, unit: "词", title: "三千词汇", desc: "累计学习 3000 个词条", sticker: { icon: "books", color: "orange", disp: "3000", label: "学3000词" } },
    { id: "words-5000", group: "words", tier: 3, metric: "studied", goal: 5000, unit: "词", title: "五千台阶", desc: "累计学习 5000 个词条", sticker: { icon: "trophy", color: "butter", disp: "5000", label: "学5000词" } },
    { id: "words-10000", group: "words", tier: 3, metric: "studied", goal: 10000, unit: "词", title: "万词达人", desc: "累计学习 10000 个词条", sticker: { icon: "diamond", color: "lavender", disp: "1万", label: "万词达人" } },
    { id: "day-100", group: "words", tier: 1, metric: "wordsDayMax", goal: 100, unit: "词", title: "单日百词", desc: "一天内学习 100 个新词", sticker: { icon: "rocket", color: "orange", disp: "100", label: "单日100词" } },
    { id: "day-300", group: "words", tier: 2, metric: "wordsDayMax", goal: 300, unit: "词", title: "单日三百", desc: "一天内学习 300 个新词", sticker: { icon: "rocket", color: "rose", disp: "300", label: "单日300词" } },
    { id: "day-500", group: "words", tier: 3, metric: "wordsDayMax", goal: 500, unit: "词", title: "单日五百", desc: "一天内学习 500 个新词", sticker: { icon: "flame", color: "butter", disp: "500", label: "单日500词" } },
    { id: "attempts-100", group: "words", tier: 1, metric: "attempts", goal: 100, unit: "次", title: "练满百次", desc: "累计作答 100 次", sticker: { icon: "refresh", color: "sky", disp: "100", label: "练习100次" } },
    { id: "attempts-1000", group: "words", tier: 2, metric: "attempts", goal: 1000, unit: "次", title: "千次作答", desc: "累计作答 1000 次", sticker: { icon: "refresh", color: "sage", disp: "1000", label: "练习1000次" } },
    { id: "attempts-5000", group: "words", tier: 3, metric: "attempts", goal: 5000, unit: "次", title: "五千次打磨", desc: "累计作答 5000 次", sticker: { icon: "chain", color: "lavender", disp: "5000", label: "练习5000次" } },
    { id: "correct-100", group: "words", tier: 1, metric: "correct", goal: 100, unit: "次", title: "答对百次", desc: "累计答对 100 次", sticker: { icon: "check", color: "cream", disp: "100", label: "答对100次" } },
    { id: "correct-500", group: "words", tier: 2, metric: "correct", goal: 500, unit: "次", title: "稳稳答对", desc: "累计答对 500 次", sticker: { icon: "check", color: "sage", disp: "500", label: "答对500次" } },
    { id: "correct-2000", group: "words", tier: 3, metric: "correct", goal: 2000, unit: "次", title: "两千正解", desc: "累计答对 2000 次", sticker: { icon: "medal", color: "butter", disp: "2000", label: "答对2000次" } },
    { id: "accuracy-80", group: "words", tier: 1, metric: "accuracy", goal: 80, unit: "%", title: "八成命中", desc: "整体正确率达到 80%", sticker: { icon: "target", color: "cream", disp: "80%", label: "正确率80%" } },
    { id: "accuracy-90", group: "words", tier: 2, metric: "accuracy", goal: 90, unit: "%", title: "九成命中", desc: "整体正确率达到 90%", sticker: { icon: "target", color: "sage", disp: "90%", label: "正确率90%" } },
    { id: "accuracy-100", group: "words", tier: 3, metric: "accuracy", goal: 100, unit: "%", title: "全部正确", desc: "整体正确率达到 100%", sticker: { icon: "target", color: "butter", disp: "100%", label: "全部正确" } },
    { id: "review-10", group: "words", tier: 1, metric: "reviews", goal: 10, unit: "词", title: "温故知新", desc: "智能复习里累计复习 10 个词", sticker: { icon: "refresh", color: "cream", disp: "10", label: "复习10次" } },
    { id: "review-100", group: "words", tier: 2, metric: "reviews", goal: 100, unit: "词", title: "复习百词", desc: "智能复习里累计复习 100 个词", sticker: { icon: "refresh", color: "sky", disp: "100", label: "复习100次" } },
    { id: "review-500", group: "words", tier: 2, metric: "reviews", goal: 500, unit: "词", title: "温故五百", desc: "智能复习里累计复习 500 个词", sticker: { icon: "refresh", color: "sage", disp: "500", label: "复习500次" } },
    { id: "review-1000", group: "words", tier: 3, metric: "reviews", goal: 1000, unit: "词", title: "复习千次", desc: "智能复习里累计复习 1000 个词", sticker: { icon: "chain", color: "lavender", disp: "1000", label: "复习千次" } },
    { id: "wordbook-20", group: "words", tier: 1, metric: "wordbook", goal: 20, unit: "词", title: "词袋渐满", desc: "单词库收藏 20 个词", sticker: { icon: "star", color: "cream", disp: "20", label: "收藏20词" } },
    { id: "wordbook-100", group: "words", tier: 2, metric: "wordbook", goal: 100, unit: "词", title: "词袋满满", desc: "单词库收藏 100 个词", sticker: { icon: "star", color: "butter", disp: "100", label: "收藏100词" } },
    { id: "wordbook-500", group: "words", tier: 3, metric: "wordbook", goal: 500, unit: "词", title: "宝箱满格", desc: "单词库收藏 500 个词", sticker: { icon: "diamond", color: "sky", disp: "500", label: "收藏500词" } },

    { id: "read-10min", group: "time", tier: 1, metric: "readMinutes", goal: 10, unit: "分钟", title: "十分钟", desc: "累计阅读 10 分钟", sticker: { icon: "clock", color: "cream", disp: "10min", label: "阅读10分" } },
    { id: "read-30min", group: "time", tier: 1, metric: "readMinutes", goal: 30, unit: "分钟", title: "半小时", desc: "累计阅读 30 分钟", sticker: { icon: "clock", color: "butter", disp: "30min", label: "阅读半小时" } },
    { id: "read-1h", group: "time", tier: 1, metric: "readMinutes", goal: 60, unit: "分钟", title: "阅读一小时", desc: "累计阅读 1 小时", sticker: { icon: "hourglass", color: "cream", disp: "1h", label: "阅读1小时" } },
    { id: "read-10h", group: "time", tier: 2, metric: "readMinutes", goal: 600, unit: "分钟", title: "阅读十小时", desc: "累计阅读 10 小时", sticker: { icon: "coffee", color: "sage", disp: "10h", label: "阅读10小时" } },
    { id: "read-50h", group: "time", tier: 2, metric: "readMinutes", goal: 3000, unit: "分钟", title: "阅读五十小时", desc: "累计阅读 50 小时", sticker: { icon: "lamp", color: "sky", disp: "50h", label: "阅读50小时" } },
    { id: "read-100h", group: "time", tier: 3, metric: "readMinutes", goal: 6000, unit: "分钟", title: "百时读者", desc: "累计阅读 100 小时", sticker: { icon: "clock", color: "butter", disp: "100h", label: "阅读100小时" } },
    { id: "read-300h", group: "time", tier: 3, metric: "readMinutes", goal: 18000, unit: "分钟", title: "三百小时", desc: "累计阅读 300 小时", sticker: { icon: "scroll", color: "orange", disp: "300h", label: "阅读300小时" } },
    { id: "read-500h", group: "time", tier: 3, metric: "readMinutes", goal: 30000, unit: "分钟", title: "五百小时", desc: "累计阅读 500 小时", sticker: { icon: "moon", color: "lavender", disp: "500h", label: "阅读500小时" } },
    { id: "read-1000h", group: "time", tier: 3, metric: "readMinutes", goal: 60000, unit: "分钟", title: "千时读者", desc: "累计阅读 1000 小时", sticker: { icon: "tree", color: "taupe", disp: "1000h", label: "千时读者" } },
    { id: "read-session-2h", group: "time", tier: 2, metric: "readSessionMax", goal: 120, unit: "分钟", title: "沉浸两小时", desc: "单次连续阅读 2 小时", sticker: { icon: "hourglass", color: "sky", disp: "2h", label: "沉浸2小时" } },
    { id: "zen-1h", group: "time", tier: 2, metric: "readSessionMax", goal: 60, unit: "分钟", title: "无干扰一小时", desc: "一次不中断地读满 1 小时", sticker: { icon: "target", color: "taupe", disp: "禅", label: "无干扰1小时" } },

    { id: "read-days-1", group: "days", tier: 1, metric: "readDays", goal: 1, unit: "天", title: "开始阅读", desc: "留下第一天阅读记录", sticker: { icon: "books", color: "cream", disp: "1", label: "开始阅读" } },
    { id: "read-days-7", group: "days", tier: 1, metric: "readDays", goal: 7, unit: "天", title: "阅读七天", desc: "累计 7 天阅读", sticker: { icon: "calendar", color: "cream", disp: "7", label: "阅读7天" } },
    { id: "read-days-30", group: "days", tier: 2, metric: "readDays", goal: 30, unit: "天", title: "阅读三十天", desc: "累计 30 天阅读", sticker: { icon: "calendar", color: "sky", disp: "30", label: "阅读30天" } },
    { id: "read-days-100", group: "days", tier: 3, metric: "readDays", goal: 100, unit: "天", title: "阅读一百天", desc: "累计 100 天阅读", sticker: { icon: "leaf", color: "orange", disp: "100", label: "阅读100天" } },
    { id: "read-days-365", group: "days", tier: 3, metric: "readDays", goal: 365, unit: "天", title: "阅读一年", desc: "累计 365 天阅读", sticker: { icon: "tree", color: "butter", disp: "365", label: "阅读一年" } },
    { id: "read-streak-7", group: "days", tier: 2, metric: "readStreak", goal: 7, unit: "天", title: "连读七天", desc: "连续 7 天阅读", sticker: { icon: "chain", color: "sage", disp: "7", label: "连读7天" } },
    { id: "read-streak-30", group: "days", tier: 3, metric: "readStreak", goal: 30, unit: "天", title: "连读三十天", desc: "连续 30 天阅读", sticker: { icon: "chain", color: "sage", disp: "30", label: "连读30天" } },
    { id: "read-weekend", group: "days", tier: 1, metric: "readWeekend", goal: 1, unit: "次", title: "周末阅读", desc: "周末也翻开一本书", sticker: { icon: "coffee", color: "rose", disp: "周末", label: "周末阅读" } },

    { id: "book-start", group: "books", tier: 1, metric: "booksStarted", goal: 1, unit: "本", title: "翻开第一本", desc: "开始阅读 1 本书", sticker: { icon: "books", color: "cream", disp: "1", label: "翻开一本" } },
    { id: "book-finish", group: "books", tier: 1, metric: "booksFinished", goal: 1, unit: "本", title: "读到最后一页", desc: "完整读完 1 本书", sticker: { icon: "bookmark", color: "sky", disp: "1", label: "读完一本" } },
    { id: "books-5", group: "books", tier: 2, metric: "booksFinished", goal: 5, unit: "本", title: "五本小书堆", desc: "完整读完 5 本书", sticker: { icon: "books", color: "sage", disp: "5", label: "读完5本" } },
    { id: "books-10", group: "books", tier: 2, metric: "booksFinished", goal: 10, unit: "本", title: "十本一层", desc: "完整读完 10 本书", sticker: { icon: "library", color: "butter", disp: "10", label: "读完10本" } },
    { id: "books-30", group: "books", tier: 3, metric: "booksFinished", goal: 30, unit: "本", title: "三十本小墙", desc: "完整读完 30 本书", sticker: { icon: "library", color: "orange", disp: "30", label: "读完30本" } },
    { id: "books-50", group: "books", tier: 3, metric: "booksFinished", goal: 50, unit: "本", title: "五十本角落", desc: "完整读完 50 本书", sticker: { icon: "library", color: "lavender", disp: "50", label: "读完50本" } },
    { id: "books-100", group: "books", tier: 3, metric: "booksFinished", goal: 100, unit: "本", title: "百本读者", desc: "完整读完 100 本书", sticker: { icon: "trophy", color: "taupe", disp: "100", label: "百本读者" } },
    { id: "books-year-12", group: "books", tier: 3, metric: "booksYear", goal: 12, unit: "本", title: "每月一本", desc: "今年读完 12 本书", sticker: { icon: "calendar", color: "sky", disp: "12", label: "每月一本" } },
    { id: "thick-500", group: "books", tier: 3, metric: "thickPages", goal: 500, unit: "页", title: "啃完厚书", desc: "读完一本 500 页以上的书", sticker: { icon: "scroll", color: "rose", disp: "500p", label: "啃完厚书" } },
    { id: "books-started-10", group: "books", tier: 1, metric: "booksStarted", goal: 10, unit: "本", title: "书架十本", desc: "翻开过 10 本不同的书", sticker: { icon: "books", color: "sage", disp: "10", label: "书架十本" } },

    { id: "annotate-1", group: "notes", tier: 1, metric: "highlights", goal: 1, unit: "条", title: "第一条划线", desc: "在书里留下第一条划线", sticker: { icon: "pen", color: "butter", disp: "1", label: "第一条划线" } },
    { id: "annotate-100", group: "notes", tier: 2, metric: "highlights", goal: 100, unit: "条", title: "划线一百", desc: "累计划下 100 条线", sticker: { icon: "pen", color: "orange", disp: "100", label: "划线100条" } },
    { id: "notes-10", group: "notes", tier: 1, metric: "pageNotes", goal: 10, unit: "条", title: "页边有话", desc: "写下 10 条页边笔记", sticker: { icon: "note", color: "cream", disp: "10", label: "笔记10条" } },
    { id: "notes-100", group: "notes", tier: 3, metric: "pageNotes", goal: 100, unit: "条", title: "便签一墙", desc: "写下 100 条页边笔记", sticker: { icon: "note", color: "sky", disp: "100", label: "笔记100条" } },
    { id: "bookmarks-5", group: "notes", tier: 1, metric: "bookmarks", goal: 5, unit: "页", title: "折角", desc: "给 5 页按下书签", sticker: { icon: "bookmark", color: "cream", disp: "5", label: "书签5枚" } },
    { id: "bookmarks-50", group: "notes", tier: 2, metric: "bookmarks", goal: 50, unit: "页", title: "书签一串", desc: "给 50 页按下书签", sticker: { icon: "bookmark", color: "rose", disp: "50", label: "书签50枚" } },
    { id: "translate-10", group: "notes", tier: 1, metric: "translations", goal: 10, unit: "段", title: "译海初拾", desc: "保存 10 段整句译文", sticker: { icon: "speech", color: "cream", disp: "10", label: "译文10段" } },
    { id: "translate-50", group: "notes", tier: 2, metric: "translations", goal: 50, unit: "段", title: "译海拾贝", desc: "保存 50 段整句译文", sticker: { icon: "speech", color: "sky", disp: "50", label: "译文50段" } },
    { id: "ocr-5", group: "notes", tier: 2, metric: "ocrPages", goal: 5, unit: "页", title: "火眼金睛", desc: "识别 5 页图片或 PDF 文字", sticker: { icon: "search", color: "sage", disp: "5", label: "识别5页" } },
    { id: "writing-1", group: "notes", tier: 1, metric: "writingDone", goal: 1, unit: "次", title: "落笔成句", desc: "完成 1 次写译练习", sticker: { icon: "pen", color: "sage", disp: "1", label: "落笔成句" } },
    { id: "writing-20", group: "notes", tier: 2, metric: "writingDone", goal: 20, unit: "次", title: "下笔有神", desc: "完成 20 次写译练习", sticker: { icon: "pen", color: "butter", disp: "20", label: "下笔有神" } },
    { id: "writing-perfect", group: "notes", tier: 2, metric: "writingPerfect", goal: 1, unit: "次", title: "拼写无误", desc: "不靠提示完成一次写译", sticker: { icon: "check", color: "cream", disp: "拼", label: "拼写无误" } },
    { id: "listening-1", group: "notes", tier: 1, metric: "listeningDone", goal: 1, unit: "套", title: "第一次听力", desc: "提交 1 套听力练习", sticker: { icon: "headphones", color: "cream", disp: "1", label: "第一次听力" } },
    { id: "listening-10", group: "notes", tier: 2, metric: "listeningDone", goal: 10, unit: "套", title: "耳朵熟了", desc: "提交 10 套听力练习", sticker: { icon: "headphones", color: "lavender", disp: "10", label: "耳朵熟了" } },
    { id: "backup-1", group: "notes", tier: 1, metric: "backups", goal: 1, unit: "次", title: "留一份底", desc: "导出 1 次本地备份", sticker: { icon: "download", color: "taupe", disp: "1", label: "首次备份" } },

    { id: "profile-done", group: "fun", tier: 1, metric: "profileDone", goal: 1, unit: "次", title: "完善资料", desc: "改过昵称或头像", sticker: { icon: "user", color: "cream", disp: "hi", label: "完善资料" } },
    { id: "local-import-1", group: "fun", tier: 1, metric: "localBooks", goal: 1, unit: "本", title: "导入本地书", desc: "把一本书留在本机", sticker: { icon: "folder", color: "sky", disp: "本地", label: "导入本地书" } },
    { id: "local-import-10", group: "fun", tier: 2, metric: "localBooks", goal: 10, unit: "本", title: "本地十本", desc: "本机导入 10 本书", sticker: { icon: "folder", color: "sage", disp: "10", label: "本地十本" } },
    { id: "dark-mode", group: "fun", tier: 1, metric: "darkMode", goal: 1, unit: "次", title: "夜间模式", desc: "在夜里把界面切到深色", sticker: { icon: "moon", color: "lavender", disp: "夜", label: "夜间模式" } },
    { id: "offline", group: "fun", tier: 1, metric: "offlineSeen", goal: 1, unit: "次", title: "离线学习", desc: "断网时也打开过词刻", sticker: { icon: "offline", color: "taupe", disp: "离线", label: "离线学习" } },
    { id: "dual-day", group: "fun", tier: 1, metric: "dualDays", goal: 1, unit: "天", title: "同日双修", desc: "同一天既有单词也有阅读", sticker: { icon: "books", color: "sage", disp: "双", label: "单词+阅读" } },
    { id: "dual-7", group: "fun", tier: 2, metric: "dualStreak", goal: 7, unit: "天", title: "七日双修", desc: "连续 7 天单词与阅读都没落下", sticker: { icon: "chain", color: "orange", disp: "7", label: "七日双修" } },
    { id: "season-spring", group: "fun", tier: 1, metric: "seasonSpring", goal: 1, unit: "次", title: "春日学习", desc: "在春天留下学习记录", sticker: { icon: "sprout", color: "sage", disp: "春", label: "春日学习" } },
    { id: "season-summer", group: "fun", tier: 1, metric: "seasonSummer", goal: 1, unit: "次", title: "夏日学习", desc: "在夏天留下学习记录", sticker: { icon: "sun", color: "rose", disp: "夏", label: "夏日学习" } },
    { id: "season-autumn", group: "fun", tier: 1, metric: "seasonAutumn", goal: 1, unit: "次", title: "秋日学习", desc: "在秋天留下学习记录", sticker: { icon: "leaf", color: "orange", disp: "秋", label: "秋日学习" } },
    { id: "season-winter", group: "fun", tier: 1, metric: "seasonWinter", goal: 1, unit: "次", title: "冬日学习", desc: "在冬天留下学习记录", sticker: { icon: "snowflake", color: "sky", disp: "冬", label: "冬日学习" } },
    { id: "christmas", group: "fun", tier: 2, metric: "christmas", goal: 1, unit: "次", title: "圣诞阅读", desc: "12 月 25 日留下一段阅读", sticker: { icon: "tree", color: "sage", disp: "诞", label: "圣诞阅读" } },
    { id: "easter-cat", group: "fun", tier: 3, metric: "easterCat", goal: 1, unit: "次", title: "隐藏彩蛋", desc: "在个人页的页边留白连点 7 下", sticker: { icon: "cat", color: "cream", disp: "喵", label: "隐藏彩蛋" } },
    { id: "easter-coffee", group: "fun", tier: 3, metric: "easterCoffee", goal: 1, unit: "次", title: "咖啡伴侣", desc: "早起鸟与夜猫子都已解锁", sticker: { icon: "coffee", color: "taupe", disp: "咖", label: "咖啡伴侣" } },
    { id: "discover-5", group: "fun", tier: 1, metric: "discover", goal: 5, unit: "份", title: "资料夹", desc: "收藏 5 份资料或图书", sticker: { icon: "star", color: "cream", disp: "5", label: "资料夹" } },
    { id: "all-unlock", group: "fun", tier: 3, metric: "allUnlock", goal: 1, unit: "枚", title: "全成就解锁", desc: "集齐所有贴纸", sticker: { icon: "crown", color: "lavender", disp: "★", label: "全成就解锁" } },
  ];

  // 原画贴纸对照表：key 是成就 id，value 是 stickers/ 里的编号（已转成 assets/stickers/<编号>.webp）。
  // 没在这一表里的成就继续用本地绘制的圆章兜底。
  const ACHIEVEMENT_ART = {
    "first-step": "G1",
    "streak-3": "A1",
    "streak-7": "A2",
    "streak-14": "A3",
    "streak-30": "A4",
    "streak-90": "A5",
    "streak-180": "A6",
    "streak-365": "A7",
    "days-100": "A9",
    "early-bird": "A11",
    "night-owl": "A12",
    "weekend-warrior": "A13",
    "month-full": "A14",
    "comeback": "A15",
    "new-year": "A16",
    "words-100": "B1",
    "words-500": "B2",
    "words-1000": "B3",
    "words-3000": "B4",
    "words-5000": "B5",
    "words-10000": "B6",
    "day-100": "B9",
    "day-300": "B10",
    "day-500": "B11",
    "accuracy-90": "B12",
    "accuracy-100": "B13",
    "review-1000": "B14",
    "wordbook-100": "B15",
    "wordbook-500": "B16",
    "writing-perfect": "B17",
    "read-1h": "C1",
    "read-10h": "C2",
    "read-50h": "C3",
    "read-100h": "C4",
    "read-300h": "C5",
    "read-500h": "C6",
    "read-1000h": "C7",
    "read-session-2h": "C8",
    "read-30min": "C10",
    "zen-1h": "G22",
    "read-days-7": "D1",
    "read-days-30": "D2",
    "read-days-100": "D3",
    "read-days-365": "D4",
    "read-streak-30": "D5",
    "read-weekend": "D6",
    "book-finish": "E1",
    "books-5": "E2",
    "books-10": "E3",
    "books-30": "E4",
    "books-50": "E5",
    "books-100": "E6",
    "books-year-12": "E7",
    "thick-500": "E8",
    "books-started-10": "E9",
    "annotate-1": "F1",
    "annotate-100": "F2",
    "notes-10": "F3",
    "notes-100": "F4",
    "bookmarks-50": "F5",
    "writing-1": "F6",
    "backup-1": "F10",
    "profile-done": "G2",
    "local-import-1": "G3",
    "offline": "G4",
    "dark-mode": "G5",
    "dual-day": "G6",
    "dual-7": "G7",
    "easter-cat": "G10",
    "easter-coffee": "G11",
    "season-spring": "G12",
    "season-summer": "G13",
    "season-autumn": "G14",
    "season-winter": "G15",
    "christmas": "G18",
    "all-unlock": "G21",
    // 第二批补绘贴纸，风格沿用奶油圆章 + 墨线图标。
    "days-7": "N01",
    "days-30": "N02",
    "days-365": "N03",
    "attempts-100": "N04",
    "attempts-1000": "N05",
    "attempts-5000": "N06",
    "correct-100": "N07",
    "correct-500": "N08",
    "correct-2000": "N09",
    "accuracy-80": "N10",
    "review-10": "N11",
    "review-100": "N12",
    "review-500": "N13",
    "wordbook-20": "N14",
    "read-10min": "N15",
    "read-days-1": "N16",
    "read-streak-7": "N17",
    "book-start": "N18",
    "bookmarks-5": "N19",
    "translate-10": "N20",
    "translate-50": "N21",
    "ocr-5": "N22",
    "writing-20": "N23",
    "listening-1": "N24",
    "listening-10": "N25",
    "local-import-10": "N26",
    "discover-5": "N27",
  };

  function achievementLongestRun(keys) {
    let best = 0;
    let run = 0;
    let previous = "";
    for (const key of keys) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      run = previous && core.addDays(previous, 1) === key ? run + 1 : 1;
      if (run > best) best = run;
      previous = key;
    }
    return best;
  }

  function achievementDayGap(previous, next) {
    const a = new Date(`${previous}T12:00:00`).getTime();
    const b = new Date(`${next}T12:00:00`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.round((b - a) / 86400000);
  }

  function achievementMetrics() {
    const summary = currentSummary();
    const readerBookList = readerBooks();
    const startedBooks = readerBookList.filter(
      (book) => state.reader.progress?.[book.id] !== undefined,
    );
    const finishedBooks = readerBookList.filter((book) => {
      const page = state.reader.progress?.[book.id];
      return (
        page !== undefined &&
        Number(page) >= Math.max(0, (book.pages?.length || 1) - 1)
      );
    });
    const studyDays = Object.entries(state.daily || {})
      .filter(([, record]) => Number(record?.total || 0) > 0)
      .map(([key]) => key)
      .sort();
    const readDayMap = state.profile.readDays || {};
    const readDayKeys = Object.entries(readDayMap)
      .filter(([, seconds]) => Number(seconds) > 0)
      .map(([key]) => key)
      .sort();
    const studySet = new Set(studyDays);
    const dualKeys = readDayKeys.filter((key) => studySet.has(key));
    const clock = state.profile.studyClock || {};
    const sumHours = (hours) =>
      hours.reduce((total, hour) => total + Number(clock[hour] || 0), 0);
    const weekdayOf = (key) => new Date(`${key}T12:00:00`).getDay();
    const weekendDays = studyDays.filter((key) => [0, 6].includes(weekdayOf(key))).length;
    const monthFull = (() => {
      const counts = new Map();
      for (const key of studyDays) {
        const month = key.slice(0, 7);
        counts.set(month, (counts.get(month) || 0) + 1);
      }
      const now = new Date();
      for (const [month, count] of counts) {
        const [year, mon] = month.split("-").map(Number);
        const daysInMonth = new Date(year, mon, 0).getDate();
        const expected =
          year === now.getFullYear() && mon === now.getMonth() + 1
            ? now.getDate()
            : daysInMonth;
        if (count >= expected) return 1;
      }
      return 0;
    })();
    const comeback = (() => {
      for (let index = 1; index < studyDays.length; index += 1) {
        if (achievementDayGap(studyDays[index - 1], studyDays[index]) >= 7) return 1;
      }
      return 0;
    })();
    const monthsOfStudy = new Set(studyDays.map((key) => Number(key.slice(5, 7))));
    const finishedAt = state.reader.finishedAt || {};
    const thisYear = String(new Date().getFullYear());
    const booksYear = Object.entries(finishedAt).filter(([, at]) =>
      String(at || "").startsWith(thisYear),
    ).length;
    const thickPages = finishedBooks.reduce(
      (max, book) => Math.max(max, Number(book.pages?.length || book.pageCount || 0)),
      0,
    );
    const listeningDone = Object.values(state.listening.progress || {}).filter(
      (item) => item?.submitted,
    ).length;
    const ocrPages = Object.values(state.reader.ocrText || {}).reduce(
      (total, pages) => total + Object.keys(pages || {}).length,
      0,
    );
    const annotationList = Object.values(state.reader.annotations || {}).filter(Boolean);
    const highlights = annotationList.filter((item) =>
      String(item.quote || "").trim(),
    ).length;
    const pageNotes = Object.values(state.reader.notes || {}).filter((text) =>
      String(text || "").trim(),
    ).length;
    const bookmarks = Object.values(state.reader.bookmarks || {}).reduce(
      (total, item) =>
        total + (Array.isArray(item) ? item.length : item ? 1 : 0),
      0,
    );
    const writingSession = state.writing.session || {};
    const wordbookCount = Object.values(state.reader.wordbook || {}).filter(Boolean).length;
    const earlyCount = sumHours([5, 6, 7]);
    const nightCount = sumHours([22, 23, 0, 1, 2, 3]);
    const earlyUnlocked = earlyCount >= 10;
    const nightUnlocked = nightCount >= 10;
    const readWeekend = readDayKeys.some((key) => [0, 6].includes(weekdayOf(key)));
    return {
      studied: Number(summary.studied || 0),
      attempts: Number(summary.attempts || 0),
      correct: Number(summary.correct || 0),
      accuracy: Number(summary.accuracy || 0),
      streak: Number(summary.streak || 0),
      bestStreak: achievementLongestRun(studyDays),
      activeDays: studyDays.length,
      wordsDayMax: Math.max(
        0,
        ...Object.values(state.daily || {}).map((record) => Number(record?.new || 0)),
      ),
      earlyCount,
      nightCount,
      weekendDays,
      monthFull,
      comeback,
      crossYear: studyDays.some((key) => key.endsWith("-01-01")) ? 1 : 0,
      readMinutes: Math.floor(Number(state.profile.readingSeconds || 0) / 60),
      readSessionMax: Math.floor(Number(state.profile.readSessionMax || 0) / 60),
      readDays: readDayKeys.length,
      readStreak: achievementLongestRun(readDayKeys),
      readWeekend: readWeekend ? 1 : 0,
      booksStarted: startedBooks.length,
      booksFinished: finishedBooks.length,
      booksYear,
      thickPages,
      highlights,
      pageNotes,
      annotations: highlights + pageNotes,
      translations: Object.keys(state.reader.sentenceTranslations || {}).length,
      ocrPages,
      listeningDone,
      writingDone: Number(writingSession.count || 0),
      writingPerfect:
        Number(writingSession.hints || 0) === 0 && Number(writingSession.chars || 0) >= 50
          ? 1
          : 0,
      wordbook: wordbookCount,
      reviews: Object.keys(state.reviewItems || {}).length,
      discover: Array.isArray(state.notes.discover) ? state.notes.discover.length : 0,
      bookmarks,
      backups: Array.isArray(state.backupMeta?.history)
        ? state.backupMeta.history.length
        : state.backupMeta?.lastExportAt
          ? 1
          : 0,
      profileDone:
        (state.profile.name && state.profile.name !== "词刻学习者") || state.profile.avatar
          ? 1
          : 0,
      localBooks: Array.isArray(state.userBooks) ? state.userBooks.length : 0,
      darkMode: state.settings.theme === "dark" ? 1 : 0,
      offlineSeen: state.profile.offlineSeen ? 1 : 0,
      dualDays: dualKeys.length,
      dualStreak: achievementLongestRun(dualKeys),
      seasonSpring: [3, 4, 5].some((month) => monthsOfStudy.has(month)) ? 1 : 0,
      seasonSummer: [6, 7, 8].some((month) => monthsOfStudy.has(month)) ? 1 : 0,
      seasonAutumn: [9, 10, 11].some((month) => monthsOfStudy.has(month)) ? 1 : 0,
      seasonWinter: [12, 1, 2].some((month) => monthsOfStudy.has(month)) ? 1 : 0,
      christmas: readDayKeys.some((key) => key.endsWith("-12-25")) ? 1 : 0,
      easterCat: state.profile.easterCat ? 1 : 0,
      easterCoffee: earlyUnlocked && nightUnlocked ? 1 : 0,
      allUnlock: 0,
    };
  }

  function achievementCatalog() {
    const metrics = achievementMetrics();
    const list = ACHIEVEMENTS.map((item) => {
      const raw = Math.max(0, Number(metrics[item.metric] || 0));
      const unlocked = (!item.guard || item.guard(metrics)) && raw >= item.goal;
      return {
        ...item,
        raw,
        unlocked,
        value: Math.min(raw, item.goal),
        progress: item.goal ? Math.min(1, raw / item.goal) : 0,
      };
    });
    // “全成就”以其余成就的解锁数量为准，单独回填，避免自己依赖自己。
    const allItem = list.find((item) => item.id === "all-unlock");
    if (allItem) {
      const others = list.filter((item) => item !== allItem);
      const done = others.filter((item) => item.unlocked).length;
      allItem.goal = Math.max(1, others.length);
      allItem.raw = done;
      allItem.value = Math.min(done, allItem.goal);
      allItem.progress = done / allItem.goal;
      allItem.unlocked = done >= allItem.goal;
    }
    return list;
  }

  // 成就解锁弹窗：本地合成音效 + DOM 粒子，不依赖任何外部资源。
  let achievementWatchArmed = false;
  let achievementCheckTimer = 0;
  let achievementUnlockQueue = [];
  let achievementUnlockBusy = false;

  function syncAchievements(list) {
    state.profile.achievements = state.profile.achievements || {};
    const unlockedNow = [];
    for (const item of list) {
      if (item.unlocked && !state.profile.achievements[item.id]) {
        state.profile.achievements[item.id] = new Date().toISOString();
        unlockedNow.push(item);
      }
    }
    if (unlockedNow.length) {
      saveState();
      if (!achievementWatchArmed || unlockedNow.length > 3) {
        // 首次补齐历史记录时可能一次点亮十几枚，逐条弹窗会糊住整屏。
        showToast(
          unlockedNow.length > 3
            ? `新点亮 ${unlockedNow.length} 枚贴纸，去成就页看看。`
            : `成就解锁：${unlockedNow.map((item) => item.title).join("、")}`,
        );
      } else {
        queueAchievementUnlock(unlockedNow);
      }
    }
    return unlockedNow;
  }

  function scheduleAchievementCheck() {
    if (!achievementWatchArmed) return;
    clearTimeout(achievementCheckTimer);
    achievementCheckTimer = window.setTimeout(() => {
      achievementCheckTimer = 0;
      try {
        syncAchievements(achievementCatalog());
      } catch (error) {
        console.warn("Achievement check failed.", error);
      }
    }, 700);
  }

  function queueAchievementUnlock(items) {
    achievementUnlockQueue.push(...items);
    if (!achievementUnlockBusy) showNextAchievementUnlock();
  }

  function playAchievementChime() {
    if (!state.settings.soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioContext;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const start = ctx.currentTime + 0.02;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, start);
      master.gain.exponentialRampToValueAtTime(0.24, start + 0.04);
      master.gain.exponentialRampToValueAtTime(0.0001, start + 1.35);
      master.connect(ctx.destination);
      // C5 → E5 → G5 → C6 上行琶音，末尾加一颗高音闪光。
      const notes = [
        [523.25, 0],
        [659.25, 0.09],
        [783.99, 0.18],
        [1046.5, 0.27],
      ];
      for (const [freq, offset] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        const at = start + offset;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.42, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.62);
        osc.connect(gain).connect(master);
        osc.start(at);
        osc.stop(at + 0.7);
      }
      const sparkle = ctx.createOscillator();
      const sparkleGain = ctx.createGain();
      sparkle.type = "sine";
      sparkle.frequency.setValueAtTime(1567.98, start + 0.34);
      sparkle.frequency.exponentialRampToValueAtTime(2093, start + 0.5);
      sparkleGain.gain.setValueAtTime(0.0001, start + 0.34);
      sparkleGain.gain.exponentialRampToValueAtTime(0.18, start + 0.37);
      sparkleGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);
      sparkle.connect(sparkleGain).connect(master);
      sparkle.start(start + 0.34);
      sparkle.stop(start + 0.9);
    } catch (error) {
      // 音频被系统策略拦住时静默降级，不影响弹窗。
    }
  }

  // 查看贴纸时的轻音效：一声“啪”贴上去，再接一颗小亮音，比解锁琶音更短更收。
  function playStickerViewSound() {
    if (!state.settings.soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioContext;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const start = ctx.currentTime + 0.01;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, start);
      master.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, start + 0.46);
      master.connect(ctx.destination);
      const notes = [
        [880, 0, "triangle"],
        [1318.51, 0.075, "sine"],
      ];
      for (const [freq, offset, type] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const at = start + offset;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.5, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        osc.connect(gain).connect(master);
        osc.start(at);
        osc.stop(at + 0.32);
      }
    } catch (error) {
      // 无声降级，不影响查看。
    }
  }

  function showNextAchievementUnlock() {
    const item = achievementUnlockQueue.shift();
    if (!item) {
      achievementUnlockBusy = false;
      return;
    }
    achievementUnlockBusy = true;
    presentSticker(item, "unlock");
  }

  // mode: "unlock" 是获得成就时的动画，自动结束并继续队列；
  // "view" 是贴纸墙上点开查看，不碰解锁队列。
  function presentSticker(item, mode = "unlock") {
    const viewing = mode === "view";
    const unlocked = item.unlocked !== false;
    if (viewing) {
      playStickerViewSound();
    } else {
      playAchievementChime();
    }
    const palette = ["var(--butter)", "var(--mint)", "var(--sky)", "var(--rose)", "var(--coral)"];
    const total = viewing ? (unlocked ? 18 : 0) : 30;
    let particles = "";
    for (let index = 0; index < total; index += 1) {
      const angle = (360 / total) * index + (Math.random() * 26 - 13);
      const distance = 88 + Math.random() * 96;
      const dx = Math.cos((angle * Math.PI) / 180) * distance;
      const dy = Math.sin((angle * Math.PI) / 180) * distance;
      const size = 4 + Math.random() * 8;
      const delay = Math.round(Math.random() * 140);
      particles += `<i class="unlock-particle" style="--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;--size:${size.toFixed(1)}px;--delay:${delay}ms;--hue:${palette[index % palette.length]}"></i>`;
    }
    const kicker = viewing
      ? unlocked
        ? "STICKER · 已获得"
        : "LOCKED · 尚未解锁"
      : "NEW STICKER · 新贴纸";
    const meta = viewing
      ? unlocked
        ? `${achievementTierLabel(item.tier)}章贴纸 · ${achievementDate(item.id) || "已获得"}`
        : `${achievementTierLabel(item.tier)}章贴纸 · 进度 ${formatNumber(item.value)} / ${formatNumber(item.goal)} ${esc(item.unit)}`
      : `${achievementTierLabel(item.tier)}章贴纸 · 已贴到成就墙`;
    const layer = document.createElement("div");
    layer.className = "unlock-layer";
    layer.innerHTML = `
      <div class="unlock-backdrop"></div>
      <div class="unlock-card" role="dialog" aria-modal="true" aria-label="${viewing ? "贴纸" : "新贴纸"}：${esc(item.title)}">
        <p class="unlock-kicker">${kicker}</p>
        <div class="unlock-sticker-wrap${unlocked ? "" : " is-locked-preview"}">
          ${unlocked ? '<span class="unlock-ring" aria-hidden="true"></span>' : ""}
          ${achievementStickerMarkup({ ...item, unlocked }, "is-unlock", -1, false, true)}
          <span class="unlock-burst" aria-hidden="true">${particles}</span>
        </div>
        <h2>${esc(item.title)}</h2>
        <p class="unlock-desc">${esc(item.desc || "")}</p>
        <p class="unlock-meta">${meta}</p>
        <button type="button" class="unlock-close">${viewing ? "合上贴纸" : "收下贴纸"}</button>
      </div>`;
    document.body.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add("is-open"));
    let autoTimer = window.setTimeout(close, viewing ? 9000 : 7000);
    function close() {
      if (layer.dataset.closing) return;
      layer.dataset.closing = "1";
      window.clearTimeout(autoTimer);
      window.removeEventListener("keydown", onKey);
      layer.classList.remove("is-open");
      layer.classList.add("is-closing");
      window.setTimeout(() => {
        layer.remove();
        if (!viewing) {
          achievementUnlockBusy = false;
          showNextAchievementUnlock();
        }
      }, 300);
    }
    function onKey(event) {
      if (event.key === "Escape") close();
    }
    layer.addEventListener("click", (event) => {
      if (
        event.target.closest(".unlock-close") ||
        event.target.classList.contains("unlock-backdrop") ||
        event.target === layer
      ) {
        close();
      }
    });
    window.addEventListener("keydown", onKey);
  }

  function achievementDate(id) {
    const at = state.profile.achievements?.[id];
    if (!at) return "";
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN");
  }

  function achievementTierLabel(tier) {
    return tier >= 3 ? "金" : tier === 2 ? "银" : "铜";
  }

  function achievementStickerMarkup(item, extraClass = "", index = -1, wall = false, eager = false) {
    const sticker = item.sticker || {};
    const tilt = ((String(item.id).charCodeAt(0) + String(item.id).length) % 7) - 3;
    const color = sticker.color || "cream";
    const art = ACHIEVEMENT_ART[item.id];
    const locked = item.unlocked === false;
    const classes = [
      "sticker-badge",
      `sticker-color-${esc(color)}`,
      art ? "has-art" : "",
      locked ? "is-locked" : "is-unlocked",
      wall ? "is-wall" : "",
      extraClass,
    ].filter(Boolean).join(" ");
    const style = `--tilt:${tilt}deg${wall && index >= 0 ? `;--i:${index}` : ""}`;
    const tag = wall ? "button" : "span";
    const attrs = wall
      ? ` type="button" data-sticker-id="${esc(item.id)}" aria-label="${esc(item.title)}${locked ? "（尚未解锁）" : ""}"`
      : ` aria-hidden="true"`;
    // 原画加载失败时退回本地绘制的圆章，任何设备上都不会只剩一个空圆。
    const fallback = `<span class="sticker-fallback">
        <span class="sticker-icon">${icon(sticker.icon || "star")}</span>
        <b class="sticker-disp">${esc(sticker.disp || "")}</b>
        <span class="sticker-label">${esc(sticker.label || item.title)}</span>
      </span>`;
    if (art) {
      return `<${tag} class="${classes}" style="${style}"${attrs}>
        <span class="sticker-inner"><img class="sticker-art" src="./assets/stickers/${esc(art)}.webp" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async">${fallback}</span>
      </${tag}>`;
    }
    return `<${tag} class="${classes}" style="${style}"${attrs}>
      <span class="sticker-inner">
        <span class="sticker-icon">${icon(sticker.icon || "star")}</span>
        <b class="sticker-disp">${esc(sticker.disp || "")}</b>
        <span class="sticker-label">${esc(sticker.label || item.title)}</span>
      </span>
    </${tag}>`;
  }

  function achievementChipMarkup(item) {
    const unlocked = item.unlocked;
    return `<div class="achievement-chip ${unlocked ? "is-unlocked" : "is-locked"} tier-${item.tier}">
      ${achievementStickerMarkup(item, "is-mini")}
      <span class="achievement-copy">
        <strong>${esc(item.title)}</strong>
        <small>${unlocked ? "已解锁" : `${formatNumber(item.value)} / ${formatNumber(item.goal)} ${esc(item.unit)}`}</small>
      </span>
    </div>`;
  }

  function achievementCardMarkup(item) {
    const unlocked = item.unlocked;
    const percentValue = Math.round(item.progress * 100);
    return `<article class="achievement-card ${unlocked ? "is-unlocked" : "is-locked"} tier-${item.tier}">
      ${achievementStickerMarkup(item, "is-card")}
      <div class="achievement-card-head">
        <div>
          <strong>${esc(item.title)}</strong>
          <small>${esc(item.desc)}</small>
        </div>
        <span class="achievement-tier">${achievementTierLabel(item.tier)}</span>
      </div>
      <div class="achievement-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentValue}" aria-label="${esc(item.title)}进度">
        <span style="--progress:${percentValue}%"></span>
      </div>
      <p class="achievement-foot">${unlocked ? `已解锁 · ${esc(achievementDate(item.id))}` : `${formatNumber(item.value)} / ${formatNumber(item.goal)} ${esc(item.unit)}`}</p>
    </article>`;
  }

  const AI_CHAT_STORE = "cike-ai-chat-v1";
  let aiChatMessages = null;
  let aiChatBusy = false;
  let aiChatError = "";
  let aiChatDraft = "";
  let aiChatContext = "";

  function aiChatHistory() {
    if (aiChatMessages) return aiChatMessages;
    aiChatMessages = [];
    try {
      const raw = JSON.parse(localStorage.getItem(AI_CHAT_STORE) || "[]");
      if (Array.isArray(raw)) {
        aiChatMessages = raw
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              String(item.content || "").trim(),
          )
          .slice(-40)
          .map((item) => ({
            role: item.role,
            content: String(item.content).slice(0, 6000),
          }));
      }
    } catch (error) {
      aiChatMessages = [];
    }
    return aiChatMessages;
  }

  function saveAiChat() {
    try {
      localStorage.setItem(
        AI_CHAT_STORE,
        JSON.stringify(aiChatHistory().slice(-40)),
      );
    } catch (error) {
      // 存储写满时只影响本机历史，不阻塞对话。
    }
  }

  function aiChatScrollToEnd() {
    window.requestAnimationFrame(() => {
      const log = document.querySelector(".ai-chat-log");
      if (!log) return;
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
      const input = document.getElementById("aiChatInput");
      if (input && !input.disabled) {
        input.style.height = "auto";
        input.style.height = `${Math.min(120, input.scrollHeight)}px`;
      }
    });
  }

  function aiChatBubbleMarkup(message) {
    const mine = message.role === "user";
    return `<article class="ai-msg ${mine ? "is-user" : "is-ai"}">
      ${mine ? "" : `<span class="ai-msg-label">CIKE AI</span>`}
      <div class="ai-msg-body">${esc(message.content).replace(/\n/g, "<br>")}</div>
    </article>`;
  }

  function renderAiChat() {
    const messages = aiChatHistory();
    const ready = Boolean(window.CikeAI?.can?.("chat"));
    const settings = aiSettings();
    const model = settings.model || "未填写模型";
    const starters = [
      ["解释 virtual 这个词，并给两个例句", "virtual 讲解"],
      ["把这句翻译成中文：The quick brown fox jumps over the lazy dog.", "翻译一句"],
      ["简述英语虚拟语气的用法，给两个例句", "语法问答"],
    ];
    const logHtml = messages.length
      ? messages.map(aiChatBubbleMarkup).join("")
      : `<div class="ai-chat-empty">
          <p class="kicker">START HERE</p>
          <h2>有什么想问的？</h2>
          <p>可以问单词、句子、语法，也可以直接贴一段文字让我翻译或润色。</p>
          <div class="ai-chat-starters">
            ${starters
              .map(
                ([prompt, label]) =>
                  `<button class="ai-chat-starter" type="button" data-action="ai-chat-prompt" data-prompt="${esc(prompt)}">${esc(label)}</button>`,
              )
              .join("")}
          </div>
        </div>`;
    main.innerHTML = `
      ${pageHead({
        kicker: "CIKE AI · 对话",
        title: "AI 对话",
        sub: ready ? `当前模型 ${esc(model)}` : "先在设置里启用 AI 助手并保存 Key",
        right: `<button class="icon-button" type="button" data-action="ai-chat-clear" aria-label="清空对话">${icon("trash")}</button>`,
      })}
      ${
        ready
          ? ""
          : `<div class="paper-card ai-chat-setup">
              <p>AI 对话复用设置里的接口与 Key，保存后这里就能直接使用。</p>
              <button class="paper-btn is-butter" type="button" data-action="open-settings">去设置 AI 接口 ${icon("arrow")}</button>
            </div>`
      }
      ${
        aiChatContext
          ? `<div class="ai-chat-context"><span>上下文</span><p>${esc(aiChatContext)}</p></div>`
          : ""
      }
      <section class="ai-chat-log" id="aiChatLog" aria-live="polite">
        ${logHtml}
        ${
          aiChatBusy
            ? `<article class="ai-msg is-ai is-thinking"><span class="ai-msg-label">CIKE AI</span><div class="ai-msg-body"><span class="ai-typing"><i></i><i></i><i></i></span></div></article>`
            : ""
        }
        ${aiChatError ? `<p class="ai-chat-error">${esc(aiChatError)}</p>` : ""}
      </section>
      <form class="ai-chat-compose" id="aiChatForm">
        <label class="sr-only" for="aiChatInput">给 AI 发消息</label>
        <textarea id="aiChatInput" rows="1" placeholder="问一个词、一句话，或贴一段文本…" ${ready && !aiChatBusy ? "" : "disabled"}>${esc(aiChatDraft)}</textarea>
        <button class="paper-btn is-butter ai-chat-send" type="submit" ${ready && !aiChatBusy ? "" : "disabled"}>${aiChatBusy ? "发送中…" : "发送"}</button>
      </form>
      <p class="ai-chat-hint">Enter 发送 · Shift + Enter 换行 · 对话只保存在本机</p>
    `;
    aiChatScrollToEnd();
  }

  function askAiFromReader() {
    const text = String(readerSelectionText || "").trim();
    if (!text) return;
    const book = activeReaderBook();
    const isWord = readerSelectionWord;
    const context = readerSelectionContext();
    const title = book?.title || "电子书";
    const prompt = isWord
      ? `我在阅读《${title}》时遇到单词“${text}”。请解释它在这段文字中的含义、词性、发音和用法，并给一个例句。

原文段落：${context || text}`
      : `我在阅读《${title}》时遇到这句话：“${text}”。请解释它的中文意思、语法结构和关键词。

原文段落：${context || text}`;
    aiChatContext = `《${title}》 · ${isWord ? "单词" : "句子"} “${text}”`;
    aiChatDraft = "";
    clearReaderSelection({ removeNative: true });
    setView("ai-chat");
    if (window.CikeAI?.can?.("chat")) {
      sendAiChat(prompt);
    } else {
      aiChatDraft = prompt;
      renderAiChat();
      showToast("先在设置里启用 AI 助手并保存 Key。");
    }
  }

  async function sendAiChat(rawText) {
    const text = String(rawText || "").trim();
    if (!text || aiChatBusy) return;
    if (!window.CikeAI?.can?.("chat")) {
      showToast("先在设置里启用 AI 助手并保存 Key。");
      return;
    }
    const messages = aiChatHistory();
    messages.push({ role: "user", content: text });
    aiChatBusy = true;
    aiChatError = "";
    saveAiChat();
    if (currentView === "ai-chat") renderAiChat();
    try {
      const result = await window.CikeAI.chat(messages);
      messages.push({ role: "assistant", content: result.answer });
    } catch (error) {
      aiChatError = error?.message || "请求失败，请稍后再试。";
    } finally {
      aiChatBusy = false;
      saveAiChat();
      if (currentView === "ai-chat") renderAiChat();
    }
  }

  function renderAchievements() {
    const list = achievementCatalog();
    syncAchievements(list);
    const unlockedCount = list.filter((item) => item.unlocked).length;
    const wallHtml = ACHIEVEMENT_GROUPS.map((group) => {
      const items = list.filter((item) => item.group === group.id);
      if (!items.length) return "";
      const done = items.filter((item) => item.unlocked).length;
      return `<section class="sticker-plate">
        <div class="sticker-plate-head"><strong>${esc(group.label)}</strong><span>${done} / ${items.length}</span></div>
        <div class="sticker-plate-grid">${items.map((item, index) => achievementStickerMarkup(item, "", index, true)).join("")}</div>
      </section>`;
    }).join("");
    const groupsHtml = ACHIEVEMENT_GROUPS.map((group) => {
      const items = list.filter((item) => item.group === group.id);
      if (!items.length) return "";
      const done = items.filter((item) => item.unlocked).length;
      return `<section class="achievement-group">
        <div class="section-title"><h2>${esc(group.label)}</h2><span>${done} / ${items.length}</span></div>
        <div class="achievement-grid">${items.map(achievementCardMarkup).join("")}</div>
      </section>`;
    }).join("");
    main.innerHTML = `
      ${pageHead({ kicker: "ACHIEVEMENTS · 本地记录", title: "成就贴纸", sub: "所有进度都由这台设备上的真实学习记录推导" })}
      <section class="achievement-hero">
        <div class="achievement-hero-score"><b>${unlockedCount}</b><span>/ ${list.length} 已解锁</span></div>
        <div class="achievement-track"><span style="--progress:${percent(unlockedCount, list.length)}%"></span></div>
        <p>连续 ${Number(currentSummary().streak || 0)} 天 · 已学 ${formatNumber(currentSummary().studied)} 词 · 阅读 ${formatNumber(Math.floor(Number(state.profile.readingSeconds || 0) / 60))} 分钟</p>
      </section>
      <div class="section-title"><h2>贴纸墙</h2><span>点亮一枚就贴上去</span></div>
      <div class="sticker-wall-board">${wallHtml}</div>
      <div class="section-title"><h2>成就明细</h2><span>进度、条件与解锁日期</span></div>
      ${groupsHtml}
      <div class="privacy-strip">${icon("check")}成就只在本机计算，不联网、不排名。</div>
      <section class="profile-margin-art" aria-label="页边留白">
        <div class="margin-art-strokes" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span>
        </div>
        <p class="margin-art-caption"><strong>页边留白</strong><small>留给下一枚</small></p>
      </section>
    `;
  }

  function renderProfile() {
    flushReadingTime();
    const minutes = Math.floor(Number(state.profile.readingSeconds || 0) / 60);
    const summary = currentSummary();
    const bookedCount = readerBooks().filter(
      (book) => state.reader.progress?.[book.id] !== undefined,
    ).length;
    const reviewCount = Object.keys(state.reviewItems || {}).length;
    const writingCount = Number(state.writing.session?.count || 0);
    const annotationCount = Object.values(state.reader.annotations || {}).filter(Boolean).length;
    const pageNoteCount = Object.values(state.reader.notes || {}).filter((text) =>
      String(text || "").trim(),
    ).length;
    const wordbookCount = Object.values(state.reader.wordbook || {}).filter(Boolean).length;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayDay = now.getDate();
    const todayStampKey = todayKey();
    // 今天首次作答时 recordStudyAnswer 会留下 checkinPending，回到个人页就补画红圈。
    const todayRecordData = state.daily[todayStampKey] || {};
    const pendingCheckin =
      String(state.profile.checkinPending || "") === todayStampKey &&
      Number(todayRecordData.total || 0) > 0;
    const calendarCells = [];
    for (let index = 0; index < firstWeekday; index += 1) {
      calendarCells.push(`<span class="cal-day is-outside"></span>`);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = core.localDateKey(new Date(year, month, day, 12));
      const record = state.daily[key] || {};
      const done = Number(record.total || 0) > 0;
      const past = day < todayDay;
      const justChecked = pendingCheckin && day === todayDay;
      const dayState = done ? "is-done" : past ? "is-missed" : "is-future";
      calendarCells.push(
        `<span class="cal-day ${dayState} ${day === todayDay ? "is-today" : ""} ${justChecked ? "is-just-checked" : ""}" title="${done ? `${record.total} 次作答` : "没有记录"}">
          ${
            done
              ? `<svg class="cal-ink" viewBox="0 0 44 44" aria-hidden="true"><path d="M31 8 C 22 2.5, 9 6, 5 18 C 1 30, 10 40, 23 40 C 36 40, 42 30, 38 19 C 35 10, 24 6, 15 9" /></svg>`
              : ""
          }
          <b class="cal-num">${day}</b>
          ${justChecked ? `<span class="cal-stamp">打卡成功</span>` : ""}
        </span>`,
      );
    }
    const achievementList = achievementCatalog();
    syncAchievements(achievementList);
    const unlockedAchievements = achievementList.filter((item) => item.unlocked);
    const achievementShowcase = [...achievementList]
      .sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        if (a.unlocked) {
          return String(state.profile.achievements?.[b.id] || "").localeCompare(
            String(state.profile.achievements?.[a.id] || ""),
          );
        }
        return b.progress - a.progress;
      })
      .slice(0, 6);
    const stickerPreview = [...achievementList]
      .sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        return b.progress - a.progress;
      })
      .slice(0, 12);

    main.innerHTML = `
      <header class="profile-head">
        <div>
          <span class="cike-brand" style="margin-bottom:2px">词刻 <b>CIKE</b></span>
          <h1>个人</h1>
        </div>
        <div class="profile-more">
          <button type="button" data-action="open-settings">设置</button>
          <button type="button" data-view="backup">备份</button>
        </div>
      </header>

      <section class="profile-top">
        <div class="polaroid ${profileFrameClass(state.profile.frame)}">
          ${
            state.profile.avatar
              ? `<img src="${esc(state.profile.avatar)}" alt="本地头像">`
              : `<div class="avatar-placeholder">${esc((state.profile.name || "词").slice(0, 1))}</div>`
          }
          <span class="avatar-name">${esc(state.profile.name || "词刻")}</span>
        </div>
        <div class="profile-identity">
          <div class="profile-tags">
            ${(state.profile.tag || "本地学习者")
              .split(/[、,，]/)
              .filter(Boolean)
              .slice(0, 4)
              .map((tag) => `<span class="profile-tag">${esc(tag.trim())}</span>`)
              .join("")}
          </div>
          <p class="profile-motto">${esc(state.notes.profile || "纸页只留在这台设备上，慢慢写也算数。")}</p>
          <p class="profile-days">已经连续记词 <b>${summary.streak || 0}</b> 天</p>
        </div>
      </section>

      <div class="profile-stats">
        <article class="profile-stat-big">
          <small>累计学习词条</small>
          <b>${formatNumber(summary.studied)}</b>
          <small>${formatNumber(words.length)} 词中已翻开 ${percent(summary.studied, words.length)}%</small>
        </article>
        <div class="profile-stat-column">
          <div class="profile-stat-slip"><small>阅读分钟</small><b>${minutes}</b></div>
          <div class="profile-stat-slip"><small>复习收藏</small><b>${reviewCount}</b></div>
          <div class="profile-stat-slip"><small>正确率</small><b>${summary.accuracy}%</b></div>
        </div>
      </div>

      <div class="section-title"><h2>贴纸墙</h2><span>${unlockedAchievements.length} / ${achievementList.length} 枚 · 只记录真实发生的事</span></div>
      <div class="sticker-wall-board is-preview">
        ${stickerPreview.map((item) => achievementStickerMarkup(item)).join("")}
      </div>

      <div class="section-title"><h2>成就</h2><span>${unlockedAchievements.length} / ${achievementList.length} 已解锁</span></div>
      <div class="achievement-strip">
        ${achievementShowcase.map(achievementChipMarkup).join("")}
      </div>
      <button class="achievement-more" type="button" data-view="achievements">
        <span>查看全部成就</span><span class="entry-arrow">›</span>
      </button>

      <section class="calendar-wrap">
        <h2>${year} 年 ${month + 1} 月</h2>
        <div class="calendar-grid">
          ${["日", "一", "二", "三", "四", "五", "六"].map((label) => `<span class="cal-head">${label}</span>`).join("")}
          ${calendarCells.join("")}
        </div>
      </section>

      <div class="privacy-strip">
        ${icon("check")}头像、笔记和阅读记录只保存在本机，不上传、不排名。
      </div>

      <button class="backup-entry" type="button" data-view="backup">
        <span class="backup-icon">${icon("download")}</span>
        <span>
          <strong>本地备份与恢复</strong>
          <small>${state.backupMeta?.lastExportAt ? `上次导出 ${esc(new Date(state.backupMeta.lastExportAt).toLocaleDateString("zh-CN"))}` : "还没有导出过备份"}</small>
        </span>
        <span class="entry-arrow">›</span>
      </button>

      <div class="home-entries" style="margin-top:14px">
        <button class="home-entry" type="button" data-view="book-notes">${icon("note")}图书笔记${annotationCount + pageNoteCount ? `<small>${annotationCount + pageNoteCount}</small>` : ""}</button>
        <button class="home-entry" type="button" data-view="wordbook">${icon("library")}单词库${wordbookCount ? `<small>${wordbookCount}</small>` : ""}</button>
        <button class="home-entry" type="button" data-view="mistakes">${icon("errors")}错词本</button>
        <button class="home-entry" type="button" data-view="stats">${icon("chart")}学习数据</button>
        <button class="home-entry" type="button" data-action="open-review">${icon("clock")}智能复习</button>
        <button class="home-entry" type="button" data-action="open-settings">${icon("settings")}设置</button>
      </div>

      <section class="profile-margin-art" aria-label="页边留白" data-action="tap-margin-art" role="button" tabindex="0">
        <div class="margin-art-strokes" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span>
        </div>
        <p class="margin-art-caption"><strong>页边留白</strong><small>${state.profile.easterCat ? "猫来过" : "留给下一笔"}</small></p>
      </section>
    `;
    // 红圈动画是一次性的，画完就清掉标记，下次进个人页不再重播。
    if (pendingCheckin) {
      state.profile.checkinPending = "";
      saveState();
    }
  }

  function renderDeveloper() {
    main.innerHTML = `
      ${pageHead({ kicker: "DEVELOPER · 作者的话", title: "开发者的话", sub: "词刻 CIKE · 本地优先的外语学习本" })}

      <section class="developer-hero">
        <div class="polaroid is-frame-tape developer-photo">
          <img src="assets/developer-qimuliang.jpg" alt="开发者祁木良的头像" />
          <span class="avatar-name">祁木良</span>
        </div>
        <div class="developer-intro">
          <p class="kicker">A NOTE FROM THE MAKER</p>
          <h2>祁木良</h2>
          <p>个人进步是解决所有问题的最优解。</p>
        </div>
      </section>

      <article class="developer-letter">
        <p>这是一个简易的背单词，刷六级听力和写译的软件，同时图书板块我内置了几千本外文资源，还有我比较喜欢的一些外文漫画，此外还做了一些成就系统，关于外文书籍我也会随时扩充，有需要可找我要新版本使用，总之欢迎使用本软件。</p>
        <p>在设置界面可填写AI模型api方便你随时调用查看电子书的翻译和史料。</p>
        <p>此外本软件所有数据都在本地，如需卸载请及时导出数据。</p>
        <p class="developer-sign">—— 祁木良</p>
      </article>

      <div class="privacy-strip">${icon("check")}遇到任何bug请随时call我</div>
    `;
  }

  function readerNoteRecords() {
    const records = [];
    Object.values(state.reader.annotations || {}).forEach((item) => {
      if (!item) return;
      records.push({
        id: `ann:${item.id}`,
        kind: "annotation",
        annotationId: item.id,
        bookId: item.bookId || "",
        bookTitle: item.bookTitle || "图书",
        page: Number(item.page) || 0,
        quote: String(item.quote || ""),
        note: String(item.note || ""),
        color: item.color || READER_NOTE_COLORS[1].value,
        createdAt: item.createdAt || "",
      });
    });
    Object.entries(state.reader.notes || {}).forEach(([key, text]) => {
      const value = String(text || "").trim();
      if (!value) return;
      const [bookId, page] = String(key).split(":");
      const book = readerBooks().find((item) => item.id === bookId);
      records.push({
        id: `page:${key}`,
        kind: "page-note",
        noteKey: key,
        bookId,
        bookTitle: book?.title || "图书",
        page: Number(page) || 0,
        quote: "",
        note: value,
        color: READER_NOTE_COLORS[2].value,
        createdAt: "",
      });
    });
    return records.sort((a, b) => {
      if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      if (a.createdAt) return -1;
      if (b.createdAt) return 1;
      return a.bookTitle.localeCompare(b.bookTitle, "zh-CN") || a.page - b.page;
    });
  }

  function renderBookNotes() {
    const records = readerNoteRecords();
    const groups = new Map();
    records.forEach((record) => {
      if (!groups.has(record.bookId)) {
        groups.set(record.bookId, { title: record.bookTitle, items: [] });
      }
      groups.get(record.bookId).items.push(record);
    });
    main.innerHTML = `
      ${pageHead({
        kicker: "MARGIN NOTES",
        title: "图书笔记",
        sub: records.length ? `共 ${records.length} 条 · 只保存在本机` : "阅读时划选文字即可留下笔记",
      })}
      ${
        records.length
          ? [...groups.entries()]
              .map(
                ([bookId, group]) => `<section class="booknote-group">
                  <div class="section-title">
                    <h2>${esc(group.title)}</h2>
                    <span>${group.items.length} 条</span>
                  </div>
                  ${group.items
                    .map(
                      (item) => `<article class="booknote-card" style="--annotation-color:${esc(item.color)}">
                        <div class="booknote-top">
                          <span class="booknote-kind">${item.kind === "annotation" ? "摘录笔记" : "页边便签"}</span>
                          <span class="booknote-page">第 ${item.page + 1} 页</span>
                        </div>
                        ${item.quote ? `<blockquote class="booknote-quote">${esc(item.quote)}</blockquote>` : ""}
                        <p class="booknote-note">${esc(item.note || "（没有写下额外文字）")}</p>
                        <div class="booknote-actions">
                          <button type="button" data-action="open-reader-note" data-book-id="${esc(bookId)}" data-page="${item.page}">回到原文</button>
                          <button type="button" data-action="delete-reader-note" data-note-id="${esc(item.id)}">删除</button>
                        </div>
                      </article>`,
                    )
                    .join("")}
                </section>`,
              )
              .join("")
          : `<div class="empty-state">
              ${icon("note")}
              <h2>还没有图书笔记</h2>
              <p>打开一本书，长按选中一句话，就能翻译、标注颜色或写下笔记。</p>
              <button class="button button-primary" type="button" data-view="books">${icon("books")}去书架</button>
            </div>`
      }
    `;
  }

  function renderWordbook() {
    const entries = Object.entries(state.reader.wordbook || {})
      .filter(([, item]) => item && item.word)
      .sort(([, a], [, b]) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      );
    const frenchCount = entries.filter(([, item]) => item.language === "fr").length;
    main.innerHTML = `
      ${pageHead({
        kicker: "WORDBOOK",
        title: "我的单词库",
        sub: entries.length
          ? `共 ${entries.length} 词 · 英语 ${entries.length - frenchCount} · 法语 ${frenchCount}`
          : "阅读时选中单词，即可收进这里",
      })}
      ${
        entries.length
          ? `<div class="wordbook-grid">
              ${entries
                .map(
                  ([key, item]) => `<article class="wordbook-card">
                    <div class="wordbook-main">
                      <strong>${esc(item.word)}</strong>
                      <span class="wordbook-lang ${item.language === "fr" ? "is-fr" : ""}">${item.language === "fr" ? "FR" : "EN"}</span>
                    </div>
                    <p class="wordbook-meaning">${esc(item.meaning || "还没有词义，可回到原文看上下文。")}</p>
                    <p class="wordbook-source">${esc(item.bookTitle || "阅读")}${item.page !== undefined ? ` · 第 ${Number(item.page) + 1} 页` : ""}</p>
                    <div class="wordbook-actions">
                      <button type="button" data-action="wordbook-speak" data-word="${esc(item.word)}" data-language="${item.language === "fr" ? "fr" : "en"}">朗读</button>
                      ${item.bookId ? `<button type="button" data-action="open-reader-note" data-book-id="${esc(item.bookId)}" data-page="${Number(item.page) || 0}">回到原文</button>` : ""}
                      <button type="button" data-action="delete-wordbook-word" data-word-key="${esc(key)}">移除</button>
                    </div>
                  </article>`,
                )
                .join("")}
            </div>`
          : `<div class="empty-state">
              ${icon("library")}
              <h2>单词库还是空的</h2>
              <p>在书里长按选中一个词，点“加入单词库”，它就会出现在这里。</p>
              <button class="button button-primary" type="button" data-view="books">${icon("books")}去书架</button>
            </div>`
      }
    `;
  }

  function addReviewItem(item) {
    if (!item?.id) return;
    state.reviewItems[item.id] = {
      ...state.reviewItems[item.id],
      ...item,
      updatedAt: new Date().toISOString(),
    };
    if (!state.progress[`review:${item.id}`]) {
      state.progress[`review:${item.id}`] = {
        status: "learning",
        seen: 0,
        correct: 0,
        wrong: 0,
        streak: 0,
        ease: 2.4,
        interval: 0,
        due: Date.now(),
        lastSeen: 0,
      };
    }
    saveState();
  }

  function dueReviewItems() {
    const now = Date.now();
    return Object.values(state.reviewItems)
      .filter((item) => {
        const schedule = state.progress[`review:${item.id}`];
        return schedule && schedule.status !== "mastered" && schedule.due <= now;
      })
      .sort((a, b) => {
        const aDue = state.progress[`review:${a.id}`]?.due || 0;
        const bDue = state.progress[`review:${b.id}`]?.due || 0;
        return aDue - bDue;
      });
  }

  function renderReview() {
    const queue = dueReviewItems();
    const item = queue[0];
    const reveal = Boolean(state.reviewMeta.revealed);
    if (!item) {
      main.innerHTML = `
        <section class="review-page">
          <header class="review-head">
            ${backButton("返回学习中心")}
            <div>
              <span class="cike-brand">词刻 <b>CIKE</b></span>
              <h1>智能复习</h1>
            </div>
            <span class="review-counter">0 待复习</span>
          </header>
          <div class="empty-state review-empty">
            ${icon("check")}
            <h2>今天没有到期的综合复习</h2>
            <p>完成翻译、收藏阅读生词或背词后，系统会自动安排下一次出现。复习会先让你回忆，再翻开答案。</p>
            <button class="paper-btn is-butter" type="button" data-view="learning">回到学习中心</button>
          </div>
        </section>
      `;
      return;
    }
    const isWord = item.type === "word";
    const total = Math.max(queue.length, Number(state.reviewMeta.total || queue.length));
    const position = Math.min(total, total - queue.length + 1);
    main.innerHTML = `
      <section class="review-page">
        <header class="review-head">
          ${backButton("返回学习中心")}
          <div>
            <span class="cike-brand">词刻 <b>CIKE</b></span>
            <h1>智能复习</h1>
          </div>
          <span class="review-counter">第 ${position} / ${total} 张</span>
        </header>

        <article class="review-card">
          <div class="study-meta" style="justify-content:center">
            <span class="tag">${isWord ? "生词" : "翻译"}</span>
            <span class="tiny">${esc(item.source || "本地收藏")}</span>
          </div>
          ${
            isWord
              ? `<div class="review-word">${esc(item.prompt || "回忆这个词")}</div>
                 <div class="review-phonetic">${esc(item.source || "")}</div>`
              : `<p class="kicker" style="text-align:center">先翻译这句原文</p>
                 <div class="review-prompt">${esc(item.prompt || "")}</div>`
          }
          ${
            reveal
              ? `<div class="review-answer">
                  <span class="tiny">答案</span>
                  <div class="review-word">${esc(item.answer || "暂无参考答案")}</div>
                </div>`
              : `<div class="review-flip-zone">
                  <p>先在心里回答，再翻开纸页。</p>
                  <button class="paper-btn is-butter" type="button" data-action="review-reveal">翻面核对 ${icon("arrow")}</button>
                  ${isWord ? `<button class="listen-round" type="button" data-action="review-speak">${icon("volume")}朗读</button>` : ""}
                  <button class="listen-round" type="button" data-action="review-skip">稍后再看</button>
                </div>`
          }
          <div class="review-ratings" role="group" aria-label="这道题记得怎样">
            <button class="paper-btn is-forget" type="button" data-action="review-grade" data-grade="again" ${reveal ? "" : "disabled"}>忘记</button>
            <button class="paper-btn is-hard" type="button" data-action="review-grade" data-grade="hard" ${reveal ? "" : "disabled"}>模糊</button>
            <button class="paper-btn is-know" type="button" data-action="review-grade" data-grade="know" ${reveal ? "" : "disabled"}>奶油</button>
          </div>
          <p class="tiny" style="text-align:center;margin:10px 0 0">${reveal ? "按真实记忆程度选择，下一次出现会据此调整。" : "翻页后才可以选择记忆程度。"}</p>
        </article>
      </section>
    `;
  }

  function gradeReview(grade) {
    const item = dueReviewItems()[0];
    if (!item) return;
    const key = `review:${item.id}`;
    state.progress[key] = core.gradeAnswer(state.progress[key], grade);
    state.reviewMeta.revealed = false;
    playSound(
      grade === "again"
        ? "rating-again"
        : grade === "know"
          ? "rating-know"
          : "rating-hard",
    );
    saveState();
    renderReview();
  }

  function splitTextIntoPages(text) {
    const normalized = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (!normalized) return [];
    const blocks = normalized
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);
    const sections = [];
    let section = { title: "", blocks: [] };

    for (const block of blocks) {
      const heading = extractHeadingTitle(block);
      if (heading) {
        if (section.blocks.length) sections.push(section);
        section = { title: heading, blocks: [block] };
      } else {
        section.blocks.push(block);
      }
    }
    if (section.blocks.length) sections.push(section);

    const pages = [];
    for (const currentSection of sections) {
      let current = "";
      const sectionPages = [];
      for (const block of currentSection.blocks) {
        if (current && current.length + block.length > 1050) {
          sectionPages.push(current);
          current = "";
        }
        current += `${current ? "\n\n" : ""}${block}`;
      }
      if (current) sectionPages.push(current);

      sectionPages.forEach((content, sectionPageIndex) => {
        const title = currentSection.title
          ? `${currentSection.title}${sectionPages.length > 1 ? ` · 第 ${sectionPageIndex + 1} 段` : ""}`
          : `第 ${pages.length + 1} 页`;
        pages.push({
          title,
          chapterTitle: currentSection.title,
          text: content,
        });
      });
    }
    return pages;
  }

  function extractHeadingTitle(block) {
    const lines = String(block || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return "";
    const first = lines[0];
    if (/^#{1,6}\s+\S/.test(first)) {
      return first.replace(/^#{1,6}\s+/, "").slice(0, 100);
    }
    const explicitHeading =
      /^(?:第[一二三四五六七八九十百千万0-9]+[章节部分篇]|Chapter\s+\d+|Part\s+[IVXLC\d]+|Unit\s+\d+|Lesson\s+\d+|[一二三四五六七八九十]+[、.]\s*\S)/i;
    if (explicitHeading.test(first)) return first.slice(0, 100);
    const looksLikeShortTitle =
      lines.length === 1 &&
      first.length >= 3 &&
      first.length <= 48 &&
      !/[。！？.!?；;：:]$/.test(first);
    return looksLikeShortTitle ? first.slice(0, 100) : "";
  }

  // 公版书正文是 Gutenberg 的纯文本：空行分段、行宽固定、正文里常有
  // "[Illustration]" 这类短行。这里只把真正的章节标题当作分页点，
  // 其余段落按长度装箱，避免每个短行都变成一页。
  function splitPlainTextIntoPages(text) {
    const normalized = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (!normalized) return [];
    const blocks = normalized
      .split(/\n{2,}/)
      .map((raw) => ({
        text: raw.trim(),
        // 缩进两格以上的独立短行多半是诗节编号或引文，不能当成章节标题。
        indented: /^[ \t]{2,}/.test(raw),
      }))
      .filter((block) => block.text);
    const headingRe =
      /^(?:CHAPTER|Chapter|BOOK|Book|PART|Part|ACT|Act|SCENE|Scene|LETTER|Letter|STAVE|Stave|第[一二三四五六七八九十百千万0-9]+[章节回部分篇])\b/;
    const pages = [];
    let sectionTitle = "";
    let current = "";
    const flush = () => {
      if (!current) return;
      pages.push({
        title: sectionTitle || `第 ${pages.length + 1} 页`,
        chapterTitle: sectionTitle,
        text: current,
      });
      current = "";
    };
    for (const block of blocks) {
      const text = block.text;
      const firstLine = text.split("\n")[0].trim();
      const bracketOnly = /^\[[^\]]*\]$/.test(firstLine);
      const isHeading =
        !bracketOnly &&
        (headingRe.test(firstLine) ||
          (!block.indented &&
            /^[IVXLC]+\.?$/.test(firstLine) &&
            text.length <= 24) ||
          /^#{1,6}\s+\S/.test(firstLine));
      if (isHeading) {
        flush();
        let headingText = firstLine.replace(/^#{1,6}\s+/, "");
        // 不少公版书把章名拆成两行："CHAPTER I." 换行 "Down the Rabbit-Hole"。
        // 这种块只有两行，第二行就是真正的章名，补进目录才不是清一色 Chapter I。
        const restLines = text
          .split("\n")
          .slice(1)
          .map((line) => line.trim())
          .filter(Boolean);
        const subtitle = restLines[0] || "";
        if (
          restLines.length === 1 &&
          subtitle.length <= 60 &&
          subtitle.split(/\s+/).length <= 9 &&
          !/[.,;:!?。，；：！？]$/.test(subtitle)
        ) {
          headingText = `${headingText.replace(/[.\s]+$/, "")} · ${subtitle}`;
        }
        sectionTitle = headingText.slice(0, 80);
        current = text;
        continue;
      }
      if (current && current.length + text.length > 1100) flush();
      current += `${current ? "\n\n" : ""}${text}`;
    }
    flush();
    return pages;
  }

  async function extractDocxText(file) {
    if (!window.JSZip) {
      throw new Error("DOCX 解析器未加载，请安装或更新应用后重试。");
    }
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) throw new Error("这个 DOCX 找不到正文结构。");
    const xml = new DOMParser().parseFromString(documentXml, "application/xml");
    const paragraphs = [...xml.getElementsByTagName("w:p")].map((node) => {
      const text = [...node.getElementsByTagName("w:t")]
        .map((textNode) => textNode.textContent || "")
        .join("");
      const style =
        node.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") || "";
      const outlineLevel =
        node.getElementsByTagName("w:outlineLvl")[0]?.getAttribute("w:val");
      const isHeading =
        /(?:heading|title|标题|目录)/i.test(style) ||
        (outlineLevel !== undefined && Number(outlineLevel) <= 3);
      return text && isHeading ? `# ${text}` : text;
    });
    return paragraphs.filter(Boolean).join("\n\n");
  }

  async function extractEpubBook(file) {
    if (!window.JSZip) {
      throw new Error("EPUB 解析器未加载，请更新应用后重试。");
    }
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const contentFiles = Object.keys(zip.files)
      .filter((name) => /\.x?html?$/i.test(name))
      .filter((name) => !/(^|\/)(nav|toc|cover|titlepage)\.x?html?$/i.test(name))
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
    const pages = [];
    for (const name of contentFiles) {
      const html = await zip.file(name)?.async("text");
      if (!html) continue;
      const document = new DOMParser().parseFromString(html, "text/html");
      document
        .querySelectorAll("script,style,nav")
        .forEach((element) => element.remove());
      const title =
        document.querySelector("h1,h2,title")?.textContent?.trim() ||
        `第 ${pages.length + 1} 节`;
      const blocks = [...document.querySelectorAll("h1,h2,h3,h4,p,li,blockquote")]
        .map((node) => node.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const text = blocks.join("\n\n");
      if (text.replace(/\s/g, "").length < 20) continue;
      pages.push(...splitTextIntoPages(text).map((page) => ({ ...page, title })));
    }
    if (!pages.length) throw new Error("EPUB 中没有可读取的正文。");
    const coverData = await extractEpubCover(zip).catch(() => null);
    return { pages, coverData };
  }

  // TXT / MD 多数来自 Windows：GBK、GB18030 文件按 UTF-8 硬读会整篇乱码。
  // 先按 UTF-8 严格解码，失败后依次尝试中文、繁体与西欧编码。
  async function readTextFileSmart(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decode = (label) => {
      try {
        return new TextDecoder(label, { fatal: true }).decode(bytes);
      } catch (error) {
        return null;
      }
    };
    const text =
      decode("utf-8") ??
      decode("gb18030") ??
      decode("big5") ??
      decode("windows-1252") ??
      new TextDecoder().decode(bytes);
    return sanitizeBookText(text.replace(/^\uFEFF/, ""));
  }

  async function extractPdfText(file) {
    const pdfjs = await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
    const document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      wasmUrl: "./vendor/wasm/",
    }).promise;
    try {
      const pages = [];
      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        const content = await page.getTextContent();
        pages.push(
          sanitizeBookText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          )
            .replace(/\s+/g, " ")
            .trim(),
        );
        page.cleanup();
      }
      const text = pages.filter(Boolean).join("\n\n");
      return {
        text,
        pageCount: document.numPages,
        imageOnly: text.replace(/\s/g, "").length < document.numPages * 20,
      };
    } finally {
      try {
        await document.destroy();
      } catch (error) {
        // The import has already finished; cleanup failures are harmless.
      }
    }
  }

  const COVER_PALETTES = [
    { bg: "#f7e6a5", ink: "#34302a", accent: "#b54f3a" },
    { bg: "#f3dde1", ink: "#3a3033", accent: "#8c4a5a" },
    { bg: "#d7ece2", ink: "#2f3a35", accent: "#3d5b53" },
    { bg: "#d9edf3", ink: "#2c353a", accent: "#3c5d6b" },
  ];

  const coverJobs = new Map();

  function coverHash(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6d2b79f5) >>> 0;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const size = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + size, y);
    context.lineTo(x + width - size, y);
    context.quadraticCurveTo(x + width, y, x + width, y + size);
    context.lineTo(x + width, y + height - size);
    context.quadraticCurveTo(x + width, y + height, x + width - size, y + height);
    context.lineTo(x + size, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - size);
    context.lineTo(x, y + size);
    context.quadraticCurveTo(x, y, x + size, y);
    context.closePath();
  }

  function canvasTextLines(context, text, maxWidth, maxLines) {
    const source = String(text || "").trim();
    if (!source) return [];
    const tokens =
      source.match(/[\u3400-\u9fff\u3040-\u30ff\uf900-\ufaff]|[^\s]+|\s+/g) || [];
    const lines = [];
    let line = "";
    const pushLine = () => {
      if (line.trim()) lines.push(line.trim());
      line = "";
    };
    for (const token of tokens) {
      if (lines.length >= maxLines) break;
      if (/^\s+$/.test(token)) {
        if (line && !line.endsWith(" ")) line += " ";
        continue;
      }
      const test = line + token;
      if (context.measureText(test).width > maxWidth && line.trim()) {
        pushLine();
        if (lines.length >= maxLines) break;
        line = token;
        if (context.measureText(line).width > maxWidth) {
          let current = "";
          for (const character of Array.from(line)) {
            const next = current + character;
            if (context.measureText(next).width > maxWidth && current) {
              lines.push(current);
              current = character;
              if (lines.length >= maxLines) break;
            } else {
              current = next;
            }
          }
          line = current;
        }
      } else {
        line = test;
      }
    }
    if (line.trim() && lines.length < maxLines) lines.push(line.trim());
    return lines;
  }

  function fitOneLine(context, text, maxWidth) {
    const source = String(text || "").trim();
    if (!source) return "";
    if (context.measureText(source).width <= maxWidth) return source;
    let line = "";
    for (const character of Array.from(source)) {
      if (context.measureText(`${line}${character}…`).width > maxWidth) break;
      line += character;
    }
    return line ? `${line}…` : "…";
  }

  function canvasToCoverBlob(canvas, quality = 0.88) {
    return new Promise((resolve) => {
      if (!canvas?.toBlob) {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob || null), "image/jpeg", quality);
    });
  }

  function loadImageElement(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败"));
      };
      image.src = url;
    });
  }

  async function makeTypographicCover(book) {
    try {
      await Promise.race([
        document.fonts?.ready || Promise.resolve(),
        new Promise((resolve) => window.setTimeout(resolve, 1200)),
      ]);
    } catch (error) {
      // A missing webfont only affects the fallback typeface.
    }
    const title = String(book?.title || "未命名资料").trim() || "未命名资料";
    const palette = COVER_PALETTES[coverHash(title) % COVER_PALETTES.length];
    const width = 600;
    const height = 900;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const random = mulberry32(coverHash(`${title}:${book?.id || ""}`));

    context.fillStyle = palette.bg;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(48, 47, 44, 0.055)";
    context.lineWidth = 2;
    for (let y = 96; y < height - 70; y += 38) {
      context.beginPath();
      context.moveTo(44, y);
      context.lineTo(width - 44, y);
      context.stroke();
    }

    context.fillStyle = "rgba(48, 47, 44, 0.05)";
    for (let count = 0; count < 240; count += 1) {
      context.beginPath();
      context.arc(
        random() * width,
        random() * height,
        0.8 + random() * 1.8,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    context.strokeStyle = palette.ink;
    context.lineWidth = 4;
    context.strokeRect(28, 28, width - 56, height - 56);
    context.lineWidth = 1.4;
    context.strokeRect(43, 43, width - 86, height - 86);

    context.save();
    context.translate(width - 96, height - 112);
    context.rotate(-0.18);
    context.setLineDash([7, 7]);
    context.lineWidth = 2.4;
    context.globalAlpha = 0.32;
    context.strokeStyle = palette.accent;
    context.beginPath();
    context.arc(0, 0, 52, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    context.fillStyle = palette.ink;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.font = '600 21px "Patrick Hand", "Microsoft YaHei", sans-serif';
    context.fillText("词刻 CIKE", 58, 92);

    const badge =
      book?.language === "fr" ? "FR" : book?.language === "zh" ? "ZH" : "EN";
    context.font = '700 18px "Cascadia Mono", monospace';
    const badgeWidth = context.measureText(badge).width + 26;
    roundRectPath(context, width - 58 - badgeWidth, 68, badgeWidth, 34, 6);
    context.fillStyle = "rgba(255, 253, 247, 0.72)";
    context.fill();
    context.strokeStyle = "rgba(36, 35, 32, 0.34)";
    context.lineWidth = 1.4;
    context.stroke();
    context.fillStyle = palette.ink;
    context.textAlign = "center";
    context.fillText(badge, width - 58 - badgeWidth / 2, 92);

    let fontSize = 70;
    let lines = [];
    const titleLength = title.replace(/\s/g, "").length;
    while (fontSize >= 34) {
      context.font = `400 ${fontSize}px "Ma Shan Zheng", "KaiTi", "Microsoft YaHei", serif`;
      lines = canvasTextLines(context, title, width - 140, 5);
      const renderedLength = lines.join("").replace(/\s/g, "").length;
      if (lines.length > 0 && renderedLength >= titleLength) break;
      fontSize -= 4;
    }
    if (!lines.length) lines = [title.slice(0, 24)];

    const lineHeight = fontSize * 1.24;
    const blockHeight = lines.length * lineHeight;
    let top = 430 - blockHeight / 2;
    top = Math.max(170, Math.min(top, 620 - blockHeight));
    context.textAlign = "center";
    context.fillStyle = palette.ink;
    lines.forEach((line, index) => {
      context.fillText(line, width / 2, top + fontSize + index * lineHeight);
    });

    const underlineY = Math.min(690, top + blockHeight + 26);
    context.strokeStyle = palette.accent;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(width / 2 - 62, underlineY);
    context.lineTo(width / 2 + 62, underlineY);
    context.stroke();

    context.font = '400 26px "Microsoft YaHei", "PingFang SC", sans-serif';
    context.fillStyle = palette.ink;
    context.globalAlpha = 0.76;
    context.fillText(
      fitOneLine(context, book?.author || book?.source || "本地资料", width - 150),
      width / 2,
      height - 128,
    );
    context.globalAlpha = 1;
    context.font = '700 16px "Cascadia Mono", monospace';
    context.fillText(
      book?.type === "comic"
        ? "COMIC"
        : book?.type === "magazine"
          ? "MAGAZINE"
          : book?.type === "teaching"
            ? "STUDY"
            : "READER",
      width / 2,
      height - 84,
    );

    return canvasToCoverBlob(canvas, 0.88);
  }

  async function coverBlobFromImageBlob(blob) {
    if (!(blob instanceof Blob)) return null;
    const type = String(blob.type || "");
    if (type && !type.startsWith("image/")) return null;
    if (/svg/i.test(type)) return null;
    let source = null;
    let release = () => {};
    try {
      source = await createImageBitmap(blob);
      release = () => source.close?.();
    } catch (error) {
      try {
        const image = await loadImageElement(blob);
        source = image;
        release = () => URL.revokeObjectURL(image.src);
      } catch (fallbackError) {
        return null;
      }
    }
    const sourceWidth = source.width || source.naturalWidth || 0;
    const sourceHeight = source.height || source.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) {
      release();
      return null;
    }
    const maxSide = 1000;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      release();
      return null;
    }
    context.fillStyle = "#fbf6e9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    release();
    return canvasToCoverBlob(canvas, 0.88);
  }

  async function pdfFirstPageCover(source) {
    if (!source) return null;
    const pdfjs = await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
    const data =
      source instanceof Blob
        ? new Uint8Array(await source.arrayBuffer())
        : new Uint8Array(source);
    const pdfDocument = await pdfjs.getDocument({ data, wasmUrl: "./vendor/wasm/" }).promise;
    try {
      const page = await pdfDocument.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(0.6, 900 / Math.max(1, baseViewport.width)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      page.cleanup();
      return canvasToCoverBlob(canvas, 0.85);
    } finally {
      try {
        await pdfDocument.destroy();
      } catch (error) {
        // Cover rendering already finished; cleanup failures are harmless.
      }
    }
  }

  function normalizeZipPath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
  }

  function resolveZipPath(fromFile, href) {
    const parts = normalizeZipPath(fromFile).split("/");
    parts.pop();
    normalizeZipPath(href)
      .split("/")
      .forEach((part) => {
        if (!part || part === ".") return;
        if (part === "..") parts.pop();
        else parts.push(part);
      });
    return parts.join("/");
  }

  const EPUB_IMAGE_TYPES = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };

  async function extractEpubCover(zip) {
    if (!zip) return null;
    let target = "";
    try {
      const opfName = Object.keys(zip.files).find((name) =>
        /\.opf$/i.test(name),
      );
      if (opfName) {
        const opf = new DOMParser().parseFromString(
          await zip.file(opfName).async("text"),
          "application/xml",
        );
        const items = [...opf.getElementsByTagName("item")];
        const metaCoverId =
          [...opf.getElementsByTagName("meta")]
            .find((node) => node.getAttribute("name") === "cover")
            ?.getAttribute("content") || "";
        const item =
          items.find((node) =>
            String(node.getAttribute("properties") || "")
              .split(/\s+/)
              .includes("cover-image"),
          ) ||
          items.find((node) => node.getAttribute("id") === metaCoverId) ||
          items.find(
            (node) =>
              /cover/i.test(node.getAttribute("id") || "") &&
              String(node.getAttribute("media-type") || "").startsWith("image/"),
          ) ||
          items.find(
            (node) =>
              /cover/i.test(node.getAttribute("href") || "") &&
              String(node.getAttribute("media-type") || "").startsWith("image/"),
          );
        const href = String(item?.getAttribute("href") || "")
          .split("#")[0]
          .trim();
        if (href) target = resolveZipPath(opfName, decodeURIComponent(href));
      }
    } catch (error) {
      target = "";
    }
    if (!target) {
      target =
        Object.keys(zip.files).find(
          (name) =>
            /\.(?:jpe?g|png|webp|gif)$/i.test(name) &&
            /(?:^|\/)cover(?:[-_.][^/]*)?\.(?:jpe?g|png|webp|gif)$/i.test(name),
        ) || "";
    }
    if (!target) return null;
    const entry = zip.file(target);
    if (!entry) return null;
    const extension = target.split(".").pop()?.toLowerCase() || "";
    const mime = EPUB_IMAGE_TYPES[extension];
    if (!mime) return null;
    try {
      const raw = await entry.async("blob");
      const typed = new Blob([raw], { type: mime });
      return await coverBlobFromImageBlob(typed);
    } catch (error) {
      return null;
    }
  }

  function coverSearchTitle(book) {
    let title = String(book?.title || book?.source || "").trim();
    title = title.replace(/\.[a-z0-9]{1,5}$/i, "");
    title = title.replace(/_+/g, " ");
    title = title.replace(/\s*[\(（]\s*(?:\d+|副本|copy|copie)\s*[\)）]\s*$/i, "");
    return title.replace(/\s+/g, " ").trim();
  }

  function normalizeCoverTitle(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function coverTitleSimilar(query, candidate) {
    const left = normalizeCoverTitle(query);
    const right = normalizeCoverTitle(candidate);
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length >= 3 && (left.includes(right) || right.includes(left))) {
      return true;
    }
    const bigrams = (value) => {
      const characters = Array.from(value);
      const grams = new Set();
      if (characters.length < 2) {
        grams.add(value);
        return grams;
      }
      for (let index = 0; index < characters.length - 1; index += 1) {
        grams.add(characters[index] + characters[index + 1]);
      }
      return grams;
    };
    const leftGrams = bigrams(left);
    const rightGrams = bigrams(right);
    let hits = 0;
    leftGrams.forEach((gram) => {
      if (rightGrams.has(gram)) hits += 1;
    });
    return hits / Math.min(leftGrams.size, rightGrams.size) >= 0.55;
  }

  async function fetchWithTimeout(url, timeout = 5000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fetchOnlineCover(book) {
    const title = coverSearchTitle(book);
    if (!title) return null;
    const author = String(book?.author || "").trim();
    const authorIsLocal = /本地|本地上传|unknown|未知/i.test(author);

    try {
      const params = new URLSearchParams({
        title,
        limit: "5",
        fields: "title,author_name,cover_i",
      });
      if (author && !authorIsLocal) params.set("author", author);
      const response = await fetchWithTimeout(
        `https://openlibrary.org/search.json?${params.toString()}`,
        5000,
      );
      if (response.ok) {
        const payload = await response.json();
        const match = (payload.docs || []).find(
          (doc) => doc.cover_i && coverTitleSimilar(title, doc.title),
        );
        if (match) {
          const coverResponse = await fetchWithTimeout(
            `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`,
            6000,
          );
          if (coverResponse.ok) {
            const cover = await coverBlobFromImageBlob(
              await coverResponse.blob(),
            );
            if (cover) return cover;
          }
        }
      }
    } catch (error) {
      // Network covers are optional; fall back to the generated cover.
    }

    try {
      const query = `intitle:"${title.replace(/"/g, " ")}"`;
      const response = await fetchWithTimeout(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&printType=books`,
        5000,
      );
      if (!response.ok) return null;
      const payload = await response.json();
      for (const item of payload.items || []) {
        const info = item.volumeInfo || {};
        if (!coverTitleSimilar(title, info.title)) continue;
        let link =
          info.imageLinks?.extraLarge ||
          info.imageLinks?.large ||
          info.imageLinks?.medium ||
          info.imageLinks?.thumbnail ||
          "";
        if (!link) continue;
        link = link
          .replace(/^http:/, "https:")
          .replace(/&edge=curl/g, "")
          .replace(/zoom=\d/, "zoom=2");
        const coverResponse = await fetchWithTimeout(link, 6000);
        if (!coverResponse.ok) continue;
        const cover = await coverBlobFromImageBlob(await coverResponse.blob());
        if (cover) return cover;
      }
    } catch (error) {
      // Try the next provider next time.
    }
    return null;
  }

  async function ensureBookCover(book, { network = false, force = false } = {}) {
    if (!book || typeof book !== "object") return null;
    if (!force && book.coverData instanceof Blob) return book.coverData;
    if (coverJobs.has(book.id)) return coverJobs.get(book.id);
    const task = (async () => {
      let cover = null;
      let source = "";
      try {
        if (book.kind === "image" && book.imageData instanceof Blob) {
          cover = await coverBlobFromImageBlob(book.imageData);
          source = "image";
        } else if (book.kind === "pdf" && book.pdfData instanceof Blob) {
          cover = await pdfFirstPageCover(book.pdfData);
          source = "pdf";
        }
      } catch (error) {
        cover = null;
      }
      if (!cover && network) {
        cover = await fetchOnlineCover(book).catch(() => null);
        if (cover) source = "web";
      }
      if (!cover) {
        cover = await makeTypographicCover(book).catch(() => null);
        source = "generated";
      }
      if (!cover) return null;
      book.coverData = cover;
      book.coverSource = source;
      try {
        if (window.CikeDB) await window.CikeDB.putBook(book);
      } catch (error) {
        console.warn("封面保存失败。", error);
      }
      forgetReaderCoverUrl(book.id);
      applyCoverToDom(book);
      return cover;
    })().finally(() => coverJobs.delete(book.id));
    coverJobs.set(book.id, task);
    return task;
  }

  // v2：生成封面新增了原文语言徽章（EN/FR/ZH），旧缓存里的徽章会一直错下去，
  // 换一版缓存键让旧封面自然失效并重新生成。
  const PRELOADED_COVER_KEY = "cover:v2:";
  const PRELOADED_COVER_SOURCE_KEY = "cover-source:v2:";
  const PRELOADED_COVER_TRIED_KEY = "cover-tried:v2:";

  async function readCoverKv(key) {
    try {
      return window.CikeDB ? await window.CikeDB.get(key) : undefined;
    } catch (error) {
      return undefined;
    }
  }

  async function writeCoverKv(key, value) {
    try {
      if (window.CikeDB) await window.CikeDB.set(key, value);
    } catch (error) {
      // Preloaded covers are a cache; losing them only costs a regeneration.
    }
  }

  async function hydratePreloadedCovers() {
    for (const book of preloadedBooks()) {
      if (book.coverData instanceof Blob) continue;
      const cached = await readCoverKv(PRELOADED_COVER_KEY + book.id);
      if (!(cached instanceof Blob)) continue;
      const source = await readCoverKv(PRELOADED_COVER_SOURCE_KEY + book.id);
      book.coverData = cached;
      book.coverSource =
        source === "web" || source === "pdf" ? source : "generated";
      applyCoverToDom(book);
    }
  }

  async function generatePreloadedCover(book) {
    let cover = null;
    let source = "";
    if (book.coverAssetPath) {
      try {
        const response = await fetch(book.coverAssetPath);
        if (response.ok) {
          cover = await coverBlobFromImageBlob(await response.blob());
          if (cover) source = "asset";
        }
      } catch (error) {
        cover = null;
      }
    }
    if (!cover && book.kind === "pdf" && book.assetPath && book.available !== false) {
      try {
        const response = await fetch(book.assetPath);
        if (response.ok) {
          cover = await pdfFirstPageCover(await response.blob());
          if (cover) source = "pdf";
        }
      } catch (error) {
        cover = null;
      }
    }
    if (!cover) {
      cover = await makeTypographicCover(book).catch(() => null);
      source = "generated";
    }
    if (!cover) return;
    book.coverData = cover;
    book.coverSource = source;
    await writeCoverKv(PRELOADED_COVER_KEY + book.id, cover);
    await writeCoverKv(PRELOADED_COVER_SOURCE_KEY + book.id, source);
    applyCoverToDom(book);
  }

  async function upgradePreloadedCovers() {
    let attempted = 0;
    for (const book of preloadedBooks()) {
      if (attempted >= 6) break;
      if (book.coverSource !== "generated") continue;
      if (!(book.coverData instanceof Blob)) continue;
      const triedAt =
        Number(await readCoverKv(PRELOADED_COVER_TRIED_KEY + book.id)) || 0;
      if (Date.now() - triedAt < 7 * 24 * 60 * 60 * 1000) continue;
      await writeCoverKv(PRELOADED_COVER_TRIED_KEY + book.id, Date.now());
      attempted += 1;
      const cover = await fetchOnlineCover(book).catch(() => null);
      if (!cover) continue;
      book.coverData = cover;
      book.coverSource = "web";
      await writeCoverKv(PRELOADED_COVER_KEY + book.id, cover);
      await writeCoverKv(PRELOADED_COVER_SOURCE_KEY + book.id, "web");
      forgetReaderCoverUrl(book.id);
      applyCoverToDom(book);
    }
  }

  let coverBackfillTask = null;

  function backfillBookCovers() {
    if (coverBackfillTask) return coverBackfillTask;
    coverBackfillTask = (async () => {
      await hydratePreloadedCovers();
      for (const book of preloadedBooks()) {
        if (!(book.coverData instanceof Blob)) {
          await generatePreloadedCover(book);
        }
      }
      const books = userBooksCache.slice();
      for (const book of books) {
        if (!(book.coverData instanceof Blob)) {
          await ensureBookCover(book, { network: false }).catch(() => null);
        }
      }
      let attempted = 0;
      for (const book of userBooksCache.slice()) {
        if (attempted >= 8) break;
        if (book.coverSource !== "generated") continue;
        if (!(book.coverData instanceof Blob)) continue;
        const lastAttempt = Number(book.coverWebTriedAt || 0);
        if (Date.now() - lastAttempt < 7 * 24 * 60 * 60 * 1000) continue;
        attempted += 1;
        book.coverWebTriedAt = Date.now();
        try {
          if (window.CikeDB) await window.CikeDB.putBook(book);
        } catch (error) {
          // The generated cover still works without the timestamp.
        }
        const cover = await fetchOnlineCover(book).catch(() => null);
        if (!cover) continue;
        book.coverData = cover;
        book.coverSource = "web";
        try {
          if (window.CikeDB) await window.CikeDB.putBook(book);
        } catch (error) {
          console.warn("在线封面保存失败。", error);
        }
        forgetReaderCoverUrl(book.id);
        applyCoverToDom(book);
      }
      await upgradePreloadedCovers();
    })()
      .catch((error) => console.warn("封面补全失败。", error))
      .finally(() => {
        coverBackfillTask = null;
      });
    return coverBackfillTask;
  }

  let coverUpgradeQueue = Promise.resolve();

  function queueBookCoverWebUpgrade(book) {
    if (!book || book.coverSource !== "generated") return;
    coverUpgradeQueue = coverUpgradeQueue
      .then(async () => {
        book.coverWebTriedAt = Date.now();
        try {
          if (window.CikeDB) await window.CikeDB.putBook(book);
        } catch (error) {
          // The generated cover is already usable.
        }
        const cover = await fetchOnlineCover(book).catch(() => null);
        if (!cover) return;
        book.coverData = cover;
        book.coverSource = "web";
        try {
          if (window.CikeDB) await window.CikeDB.putBook(book);
        } catch (error) {
          console.warn("在线封面保存失败。", error);
        }
        forgetReaderCoverUrl(book.id);
        applyCoverToDom(book);
      })
      .catch(() => {});
  }

  async function finalizePendingBookCover(book, cover, source) {
    if (cover) {
      book.coverData = cover;
      book.coverSource = source;
      return;
    }
    const generated = await makeTypographicCover(book).catch(() => null);
    if (generated) {
      book.coverData = generated;
      book.coverSource = "generated";
    }
  }

  async function prepareBookImport(file) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (file.type.startsWith("image/")) {
      const book = {
        id: `user-${Date.now()}`,
        title: file.name.replace(/\.[^.]+$/, ""),
        author: "本地图片",
        language:
          pendingBookTarget === "writing"
            ? state.writing.language || "en"
            : state.reader.language || "en",
        type: "comic",
        source: file.name,
        importedAt: new Date().toISOString(),
        kind: "image",
        imageData: file,
        pages: [{ title: "第 1 页", text: "" }],
      };
      await finalizePendingBookCover(
        book,
        await coverBlobFromImageBlob(file).catch(() => null),
        "image",
      );
      pendingReaderBook = book;
      currentView = "reader-import";
      render();
      return;
    }
    let text;
    let epubPages = null;
    let epubCover = null;
    let pdfCover = null;
    if (["txt", "md", "markdown"].includes(extension)) {
      text = await readTextFileSmart(file);
    } else if (extension === "docx") {
      text = await extractDocxText(file);
    } else if (extension === "pdf") {
      const pdfResult = await extractPdfText(file);
      pdfCover = await pdfFirstPageCover(file).catch((error) => {
        console.warn("PDF 封面生成失败。", error);
        return null;
      });
      if (pdfResult.imageOnly) {
        const book = {
          id: `user-${Date.now()}`,
          title: file.name.replace(/\.[^.]+$/, ""),
          author: "本地上传",
          language:
            pendingBookTarget === "writing"
              ? state.writing.language || "en"
              : state.reader.language || "en",
          type: "comic",
          source: file.name,
          importedAt: new Date().toISOString(),
          kind: "pdf",
          pdfData: file,
          pages: Array.from({ length: pdfResult.pageCount }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            text: "",
          })),
        };
        await finalizePendingBookCover(book, pdfCover, "pdf");
        pendingReaderBook = book;
        currentView = "reader-import";
        render();
        return;
      }
      text = pdfResult.text;
    } else if (extension === "epub") {
      const epub = await extractEpubBook(file);
      epubPages = epub.pages;
      epubCover = epub.coverData;
    } else {
      throw new Error("暂不支持这个格式。可上传 TXT、Markdown、PDF、DOCX 或 EPUB。");
    }
    const pages = epubPages || splitTextIntoPages(text);
    if (!pages.length) throw new Error("文档没有可读取的正文。");
    const book = {
      id: `user-${Date.now()}`,
      title: file.name.replace(/\.[^.]+$/, ""),
      author: "本地上传",
      language:
        pendingBookTarget === "writing"
          ? state.writing.language || "en"
          : state.reader.language || "en",
      type:
        pendingBookTarget === "writing" || state.reader.filter === "teaching"
          ? "teaching"
          : ["ebook", "comic", "magazine"].includes(state.reader.filter)
            ? state.reader.filter
            : "ebook",
      source: file.name,
      importedAt: new Date().toISOString(),
      pages,
    };
    await finalizePendingBookCover(
      book,
      epubCover || pdfCover,
      epubCover ? "epub" : "pdf",
    );
    pendingReaderBook = book;
    currentView = "reader-import";
    render();
  }

  function renderImportPreview() {
    if (!pendingReaderBook) {
      currentView = "books";
      renderBooks();
      return;
    }
    const book = pendingReaderBook;
    const isOcr = ["image", "pdf"].includes(book.kind);
    const donePages = book.pages.filter((page) => String(page.text || "").trim()).length;
    const errors = book.ocrErrors || [];

    main.innerHTML = `
      <header class="import-head">
        <div>
          ${backButton("返回")}
          <p class="kicker" style="margin-top:8px">IMPORT · 本地解析</p>
          <h1>上传与识别</h1>
          <p>扫描纸页，提取可学习的句子；文档只在本机解析。</p>
        </div>
        <span class="tag tag--mint">${book.pages.length} 页</span>
      </header>

      <div class="import-cover-strip">
        ${readerCoverMarkup(book)}
        <div>
          <strong>封面预览</strong>
          <p>已自动生成封面：漫画与 PDF 优先取第一页，EPUB 优先用原书封面，文本资料会再尝试在线匹配。</p>
        </div>
      </div>

      <div class="import-meta">
        <label>资料名称
          <input id="pendingBookTitle" type="text" value="${esc(book.title)}">
        </label>
        <label>资料类型
          <select id="pendingBookType">
            <option value="ebook" ${book.type === "ebook" ? "selected" : ""}>电子书</option>
            <option value="comic" ${book.type === "comic" ? "selected" : ""}>漫画 / 绘本</option>
            <option value="magazine" ${book.type === "magazine" ? "selected" : ""}>杂志</option>
            <option value="teaching" ${book.type === "teaching" ? "selected" : ""}>教学资料</option>
          </select>
        </label>
      </div>

      <div class="compact-list">
        <li><span>语言</span><strong>${book.language === "fr" ? "法语" : "英语"}</strong></li>
        <li><span>来源</span><strong>${esc(book.source)}</strong></li>
        <li><span>可读文字</span><strong>${donePages} / ${book.pages.length} 页</strong></li>
      </div>

      ${
        isOcr
          ? `<div class="paper-card is-mint" style="margin-top:12px">
              <strong>离线 OCR</strong>
              <p class="tiny">${book.ocrState === "running" ? `正在识别：${book.ocrDone || 0}/${book.pages.length} 页` : "图像或扫描 PDF 可先做本地文字识别，原页面仍会保留。识别结果可以逐页改名、删除、合并或重试。"}</p>
              <div class="ocr-progress">
                <div class="progress-track"><span style="--progress:${percent(donePages, book.pages.length)}%"></span></div>
                <span class="tiny">${donePages} / ${book.pages.length} 页已有文字</span>
              </div>
              ${
                window.Tesseract
                  ? `<button class="paper-btn is-butter ${book.ocrState === "running" ? "is-loading" : ""}" type="button" data-action="run-pending-ocr" ${book.ocrState === "running" ? "disabled aria-busy=\"true\"" : ""}>${book.ocrState === "running" ? `<span class="btn-spinner" aria-hidden="true"></span><span>识别中…</span>` : book.ocrState === "done" ? "重新识别全部页面" : "开始 OCR"}</button>`
                  : `<p class="tiny" style="margin:8px 0 0">当前安装包未内置离线 OCR 引擎，可直接编辑分页文字后加入书架。</p>`
              }
            </div>`
          : ""
      }

      ${
        errors.length
          ? `<div class="paper-card" style="margin-top:12px;border-color:var(--coral)">
              <strong>有 ${errors.length} 页识别失败</strong>
              <p class="tiny">${errors.map((error) => `第 ${error.page} 页：${esc(error.message)}`).join("<br>")}</p>
              <button class="paper-btn" type="button" data-action="retry-failed-ocr" ${book.ocrState === "running" ? "disabled" : ""}>重试失败页</button>
            </div>`
          : ""
      }

      <div class="ocr-foot">共 <b>${book.pages.length}</b> 页，下面是前 20 页。分页可以在导入前整理。</div>
      <div class="ocr-page-list">
        ${book.pages
          .slice(0, 20)
          .map((page, index) => {
            const hasText = Boolean(String(page.text || "").trim());
            const failed = errors.some((error) => error.page === index + 1);
            return `<article class="ocr-page ${failed ? "is-failed" : ""}">
              <div class="ocr-thumb">
                ${
                  book.kind === "image"
                    ? `<img src="${URL.createObjectURL(book.imageData)}" alt="">`
                    : `第 ${index + 1} 页`
                }
              </div>
              <div class="ocr-body">
                <span class="ocr-page-label">PAGE ${String(index + 1).padStart(2, "0")}</span>
                <h2>${esc(page.title || `第 ${index + 1} 页`)}</h2>
                <span class="ocr-status ${failed ? "is-failed" : hasText ? "is-done" : "is-running"}">${failed ? "识别失败" : hasText ? "已有文字" : "待识别 / 无文字"}</span>
                <p class="ocr-text">${esc(String(page.text || "").slice(0, 220)) || "这一页还没有可读取的文字。"}</p>
                <div class="rename-row">
                  <input id="ocrName-${index}" type="text" value="${esc(page.title || "")}" aria-label="第 ${index + 1} 页标题">
                  <button class="paper-btn" type="button" data-action="ocr-rename-page" data-page="${index}">改名</button>
                </div>
                <div class="ocr-actions">
                  ${
                    isOcr && window.Tesseract
                      ? `<button class="paper-btn" type="button" data-action="ocr-retry-page" data-page="${index}">重试本页</button>`
                      : ""
                  }
                  <button class="paper-btn" type="button" data-action="ocr-merge-page" data-page="${index}">与下一页合并</button>
                  <button class="paper-btn" type="button" data-action="ocr-delete-page" data-page="${index}">删除本页</button>
                </div>
              </div>
            </article>`;
          })
          .join("")}
      </div>

      <div class="import-confirm">
        <button class="paper-btn" type="button" data-action="cancel-reader-import">取消</button>
        <button class="paper-btn is-primary" type="button" data-action="confirm-reader-import">确认加入书架</button>
      </div>
    `;
  }

  // ---------- 手机端加书：本地上传 / 摄像头扫描 ----------

  function openAddBookDialog() {
    const dialog = document.getElementById("addBookDialog");
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }

  function closeAddBookDialog() {
    document.getElementById("addBookDialog")?.close();
  }

  function scanStatusLabel(page) {
    if (page.status === "running") return "识别中…";
    if (page.status === "done") return "已识别 ✓";
    if (page.status === "empty") return "无文字";
    if (page.status === "failed") return "识别失败";
    return "待识别";
  }

  function renderScanCapture() {
    scanCaptureToken += 1;
    const token = scanCaptureToken;
    // 离线 OCR 只有英语 / 法语训练数据，中文界面下继续标“中文”会误导用户。
    const language = state.reader.language === "fr" ? "fr" : "en";
    main.innerHTML = `
      <header class="scan-head">
        ${backButton("返回上一级")}
        <div class="scan-head-copy">
          <p class="kicker" style="margin:0">CAMERA · SCAN</p>
          <h1>扫描上传</h1>
          <p>把纸页放进取景框，拍完再统一识别。</p>
        </div>
        <span class="tag tag--sky">${languageLabel(language)}</span>
      </header>

      <div class="scan-stage" id="scanStage">
        <video id="scanVideo" playsinline autoplay muted></video>
        <div class="scan-frame" aria-hidden="true">
          <span class="scan-corner is-tl"></span><span class="scan-corner is-tr"></span>
          <span class="scan-corner is-bl"></span><span class="scan-corner is-br"></span>
          <span class="scan-frame-line"></span>
        </div>
        <p class="scan-hint" id="scanHint">保持页面平整、光线均匀</p>
        <div class="scan-fallback" id="scanFallback" hidden>
          <strong>摄像头没有打开</strong>
          <p id="scanFallbackCopy">可以调用系统相机逐页拍摄，或直接从相册选择纸页照片。</p>
          <div class="scan-fallback-actions">
            <button class="paper-btn is-butter" type="button" data-action="scan-take-photo">调用系统相机</button>
            <button class="paper-btn" type="button" data-action="scan-pick-image">从相册选择</button>
          </div>
        </div>
      </div>

      <div class="scan-controls">
        <button class="scan-side-btn" type="button" data-action="scan-pick-image">相册</button>
        <button class="scan-shutter" type="button" data-action="scan-capture" aria-label="拍下这一页"><span></span></button>
        <button class="scan-side-btn is-finish" type="button" data-action="scan-finish" id="scanFinish" ${scanPages.length ? "" : "disabled"}>完成${scanPages.length ? ` · ${scanPages.length} 页` : ""}</button>
      </div>

      <div class="scan-strip-wrap">
        <p class="scan-strip-title">已拍页面 <b id="scanCount">${scanPages.length}</b> 张</p>
        <div class="scan-strip" id="scanStrip">${scanStripMarkup()}</div>
      </div>

      <input id="scanUpload" type="file" accept="image/*" capture="environment" hidden>
      <input id="scanGalleryUpload" type="file" accept="image/*" multiple hidden>
    `;
    window.requestAnimationFrame(() => {
      if (token !== scanCaptureToken) return;
      if (scanStream) attachScanStream();
      else startScanCamera(token);
    });
  }

  function scanStripMarkup() {
    if (!scanPages.length) {
      return `<p class="scan-strip-empty">还没有拍页。对准纸页后按中间的快门。</p>`;
    }
    return scanPages
      .map(
        (page, index) => `<figure class="scan-thumb">
          <img src="${page.url}" alt="第 ${index + 1} 页">
          <figcaption>第 ${index + 1} 页</figcaption>
          <button type="button" data-action="scan-remove-page" data-index="${index}" aria-label="删除第 ${index + 1} 页">×</button>
        </figure>`,
      )
      .join("");
  }

  function refreshScanCaptureChrome() {
    const strip = document.getElementById("scanStrip");
    if (strip) strip.innerHTML = scanStripMarkup();
    const count = document.getElementById("scanCount");
    if (count) count.textContent = String(scanPages.length);
    const finish = document.getElementById("scanFinish");
    if (finish) {
      finish.disabled = scanPages.length === 0;
      finish.textContent = scanPages.length
        ? `完成 · ${scanPages.length} 页`
        : "完成";
    }
  }

  async function startScanCamera(token = scanCaptureToken) {
    const video = document.getElementById("scanVideo");
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showScanFallback("当前浏览器不支持实时取景，可以调用系统相机。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      if (token !== scanCaptureToken || currentView !== "scan-capture") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopScanCamera();
      scanStream = stream;
      attachScanStream();
      document.getElementById("scanStage")?.classList.add("is-live");
    } catch (error) {
      showScanFallback(
        error?.name === "NotAllowedError"
          ? "相机权限被拒绝，可以在系统设置里允许后重试。"
          : "实时取景不可用，可以调用系统相机。",
      );
    }
  }

  function setScannerMode(enabled) {
    if (scannerModeActive === enabled) return;
    scannerModeActive = enabled;
    try {
      window.AndroidBridge?.setScannerMode?.(enabled);
    } catch (error) {
      // Browser preview has no bridge; the video element still autoplays muted.
    }
  }

  function attachScanStream() {
    const video = document.getElementById("scanVideo");
    if (!video || !scanStream) return;
    setScannerMode(true);
    video.srcObject = scanStream;
    video.classList.add("is-ready");
    video.play().catch(() => {});
  }

  function showScanFallback(message) {
    const fallback = document.getElementById("scanFallback");
    const hint = document.getElementById("scanHint");
    const copy = document.getElementById("scanFallbackCopy");
    if (copy && message) copy.textContent = message;
    if (fallback) fallback.hidden = false;
    if (hint) hint.hidden = true;
    document.getElementById("scanVideo")?.classList.remove("is-ready");
  }

  function stopScanCamera() {
    setScannerMode(false);
    if (scanStream) {
      scanStream.getTracks().forEach((track) => track.stop());
      scanStream = null;
    }
    const video = document.getElementById("scanVideo");
    if (video) {
      video.srcObject = null;
      video.classList.remove("is-ready");
    }
  }

  let scanIngestQueue = Promise.resolve();

  async function normalizeScanPageImage(page, image) {
    const maxEdge = 2200;
    const scale = Math.min(
      1,
      maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    // 相册里可能是带透明通道的 PNG；先铺白底，避免转成 JPEG 后透出黑块。
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!jpeg || !scanPages.includes(page)) return;
    // PDF 写入器只接受 JPEG（DCTDecode）。这里统一转码，缩略图仍沿用原图 URL。
    page.blob = jpeg;
    page.width = canvas.width;
    page.height = canvas.height;
  }

  function addScanPage(blob) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    scanPages.push({
      blob,
      url,
      text: "",
      status: "pending",
      title: `第 ${scanPages.length + 1} 页`,
      width: 0,
      height: 0,
    });
    const page = scanPages[scanPages.length - 1];
    const image = new Image();
    image.onload = () => {
      page.width = image.naturalWidth;
      page.height = image.naturalHeight;
      const isJpeg = /^image\/jpe?g$/i.test(String(blob.type || ""));
      if (!isJpeg) {
        scanIngestQueue = scanIngestQueue
          .then(() => normalizeScanPageImage(page, image))
          .catch(() => {});
      }
    };
    image.onerror = () => {
      removeScanPage(scanPages.indexOf(page));
      showToast("这张图片无法解析，请换一张 JPG 或 PNG 图片。");
    };
    image.src = url;
    refreshScanCaptureChrome();
    playSound("ocr-start");
  }

  function removeScanPage(index) {
    const page = scanPages[index];
    if (page) URL.revokeObjectURL(page.url);
    scanPages.splice(index, 1);
    scanPages.forEach((item, at) => {
      if (!item.renamed) item.title = `第 ${at + 1} 页`;
    });
    refreshScanCaptureChrome();
  }

  async function captureScanFrame() {
    const video = document.getElementById("scanVideo");
    if (!video || !video.videoWidth) {
      showScanFallback("还没有画面，可以改用系统相机。");
      return;
    }
    const maxEdge = 2200;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (blob) addScanPage(blob);
  }

  function finishScanCapture() {
    if (!scanPages.length) {
      showToast("先拍下至少一页。");
      return;
    }
    stopScanCamera();
    const now = new Date();
    scanBook = {
      id: `user-${Date.now()}`,
      title: `扫描件 ${now.getMonth() + 1}月${now.getDate()}日`,
      author: "扫描导入",
      language: state.reader.language === "fr" ? "fr" : "en",
      source: `扫描 · ${scanPages.length} 页`,
      importedAt: now.toISOString(),
      pages: scanPages,
      ocrState: "idle",
    };
    currentView = "scan-import";
    render();
  }

  function renderScanImport() {
    if (!scanBook || !scanBook.pages.length) {
      currentView = "scan-capture";
      render();
      return;
    }
    const pages = scanBook.pages;
    const done = pages.filter((page) => page.status === "done").length;
    const failed = pages.filter((page) => page.status === "failed").length;
    const running = scanBook.ocrState === "running";
    const lastPage = pages.findLast?.((page) => page.status !== "pending") || pages[0];

    main.innerHTML = `
      <header class="import-head scan-import-head">
        <div>
          ${backButton("返回上一级")}
          <p class="kicker" style="margin-top:8px">IMPORT · 扫描识别</p>
          <h1>上传与识别</h1>
          <p>拍下的纸页会按顺序识别，确认后合并成一本 PDF。</p>
        </div>
        <div class="scan-import-side">
          <span class="tag tag--sky">${languageLabel(scanBook.language)}</span>
          <button class="paper-btn" type="button" data-action="scan-restart">重新选择文件</button>
        </div>
      </header>

      <div class="import-meta">
        <label>资料名称
          <input id="scanBookTitle" type="text" value="${esc(scanBook.title)}">
        </label>
      </div>

      <div class="scan-summary">
        <span class="scan-summary-chip">共 <b>${pages.length}</b> 页</span>
        <span class="scan-summary-chip">已识别 <b>${done}</b> 页</span>
        ${failed ? `<span class="scan-summary-chip is-alert">失败 <b>${failed}</b> 页</span>` : ""}
        <button class="paper-btn is-butter ${running ? "is-loading" : ""}" type="button" data-action="scan-run-ocr" ${running ? "disabled aria-busy=\"true\"" : ""}>
          ${running ? `<span class="btn-spinner" aria-hidden="true"></span><span>识别中…</span>` : done ? "重新识别全部" : "开始识别"}
        </button>
      </div>

      ${running ? `<p class="scan-live-hint" id="scanLiveHint">正在识别第 ${done + 1} / ${pages.length} 页…</p>` : ""}

      <div class="ocr-page-list">
        ${pages
          .map((page, index) => {
            const status = page.status || "pending";
            return `<article class="ocr-page scan-review-page ${status === "failed" ? "is-failed" : ""}">
              <div class="ocr-thumb">
                ${page.url ? `<img src="${page.url}" alt="第 ${index + 1} 页">` : `第 ${index + 1} 页`}
                <span class="scan-page-no">第 ${index + 1} 页</span>
              </div>
              <div class="ocr-body">
                <span class="ocr-page-label">PAGE ${String(index + 1).padStart(2, "0")} / Page ${index + 1}</span>
                <h2>${esc(page.title)}</h2>
                <span class="ocr-status ${status === "failed" ? "is-failed" : status === "done" ? "is-done" : "is-running"}">${scanStatusLabel(page)}</span>
                <p class="ocr-text">${esc(String(page.text || "").slice(0, 240)) || (status === "running" ? "正在识别这一页…" : "识别后可在这里预览文字。")}</p>
                <div class="rename-row">
                  <input id="scanName-${index}" type="text" value="${esc(page.title)}" aria-label="第 ${index + 1} 页章节名">
                  <button class="paper-btn" type="button" data-action="scan-rename-page" data-index="${index}">重命名章节</button>
                </div>
                <div class="ocr-actions">
                  <button class="paper-btn" type="button" data-action="scan-retry-page" data-index="${index}" ${running ? "disabled" : ""}>重试本页</button>
                  <button class="paper-btn" type="button" data-action="scan-delete-page" data-index="${index}" ${running || pages.length <= 1 ? "disabled" : ""}>删除</button>
                </div>
                ${page.error ? `<p class="tiny scan-error">${esc(page.error)}</p>` : ""}
              </div>
            </article>`;
          })
          .join("")}
      </div>

      <div class="ocr-foot">
        第 <b>${Math.min(pages.indexOf(lastPage) + 1 || 1, pages.length)}</b> 页，共 <b>${pages.length}</b> 页
      </div>

      <div class="import-confirm">
        <button class="paper-btn" type="button" data-action="scan-retry-failed" ${running || !failed ? "disabled" : ""}>重试失败页</button>
        <button class="paper-btn is-primary" type="button" data-action="scan-confirm-import" ${running ? "disabled" : ""}>确认导入</button>
      </div>
    `;
  }

  async function ensureScanOcrWorker() {
    if (!window.Tesseract) throw new Error("当前安装包没有内置离线 OCR 引擎。");
    const language = scanBook?.language === "fr" ? "fra" : "eng";
    return window.Tesseract.createWorker(language, 1, {
      workerPath: "./vendor/worker.min.js",
      corePath: "./vendor/",
      langPath: "./vendor/tessdata/",
    });
  }

  async function runScanOcr(indices = null) {
    if (!scanBook || scanBusy) return;
    if (!window.Tesseract) {
      showToast("当前安装包没有内置离线 OCR 引擎，仍可直接确认导入。");
      return;
    }
    const targets = indices ||
      scanBook.pages
        .map((page, index) => (page.status === "done" ? -1 : index))
        .filter((index) => index >= 0);
    if (!targets.length) {
      showToast("所有页面都已经识别过了。");
      return;
    }
    scanBusy = true;
    scanBook.ocrState = "running";
    renderScanImport();
    let worker;
    try {
      worker = await ensureScanOcrWorker();
      for (const index of targets) {
        const page = scanBook.pages[index];
        if (!page) continue;
        page.status = "running";
        page.error = "";
        renderScanImport();
        try {
          const result = await worker.recognize(page.blob, {}, { blocks: true, text: true });
          page.text = ocrResultToParagraphs(result);
          page.status = page.text ? "done" : "empty";
        } catch (error) {
          page.status = "failed";
          page.error = error.message || "识别失败";
        }
      }
      scanBook.ocrState = "done";
      const failures = scanBook.pages.filter((page) => page.status === "failed").length;
      playSound("ocr-done");
      showToast(
        failures
          ? `识别完成，还有 ${failures} 页失败，可以单独重试。`
          : "扫描页识别完成。",
      );
    } catch (error) {
      scanBook.ocrState = "error";
      showToast(`OCR 失败：${error.message}`);
    } finally {
      scanBusy = false;
      await worker?.terminate?.();
      renderScanImport();
    }
  }

  function pdfNumber(value) {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }

  async function buildPdfFromJpegPages(pages) {
    const encoder = new TextEncoder();
    const parts = [];
    let size = 0;
    const offsets = [];
    const push = (value) => {
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      parts.push(bytes);
      size += bytes.length;
    };
    const begin = (id) => {
      offsets[id] = size;
      push(`${id} 0 obj\n`);
    };
    const end = () => push("endobj\n");
    const objectCount = 2 + pages.length * 3;

    push("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");
    begin(1);
    push("<< /Type /Catalog /Pages 2 0 R >>\n");
    end();
    begin(2);
    push(
      `<< /Type /Pages /Kids [${pages
        .map((page, index) => `${3 + index * 3} 0 R`)
        .join(" ")}] /Count ${pages.length} >>\n`,
    );
    end();

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const pageId = 3 + index * 3;
      const contentId = pageId + 1;
      const imageId = pageId + 2;
      const bytes = new Uint8Array(await page.blob.arrayBuffer());
      const imageWidth = page.width || 1200;
      const imageHeight = page.height || 1600;
      const maxWidth = 595;
      const maxHeight = 842;
      let drawWidth = maxWidth;
      let drawHeight = Math.round((maxWidth * imageHeight) / imageWidth);
      if (drawHeight > maxHeight) {
        drawHeight = maxHeight;
        drawWidth = Math.round((maxHeight * imageWidth) / imageHeight);
      }
      const offsetX = Math.round((maxWidth - drawWidth) / 2);
      const offsetY = Math.round((maxHeight - drawHeight) / 2);
      const content = `q ${pdfNumber(drawWidth)} 0 0 ${pdfNumber(drawHeight)} ${offsetX} ${offsetY} cm /Im0 Do Q`;

      begin(pageId);
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${maxWidth} ${maxHeight}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\n`,
      );
      end();
      begin(contentId);
      push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`);
      end();
      begin(imageId);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
      );
      push(bytes);
      push("\nendstream\n");
      end();
    }

    const xrefOffset = size;
    push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= objectCount; id += 1) {
      push(`${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`);
    }
    push(
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );
    return new Blob(parts, { type: "application/pdf" });
  }

  async function confirmScanImport(button) {
    if (!scanBook || !scanBook.pages.length) return;
    if (scanBusy) {
      showToast("还在识别，等这一轮结束再导入。");
      return;
    }
    const finish = beginButtonTask(button, "正在生成 PDF…");
    const titleInput = document.getElementById("scanBookTitle");
    const title = titleInput?.value.trim() || scanBook.title;
    try {
      // 相册图片可能是 PNG / HEIC，等后台统一转成 JPEG 后再写 PDF。
      await scanIngestQueue;
      const pdfData = await buildPdfFromJpegPages(scanBook.pages);
      const book = {
        id: scanBook.id,
        title,
        author: "扫描导入",
        language: scanBook.language,
        type: "comic",
        source: `扫描 · ${scanBook.pages.length} 页`,
        importedAt: scanBook.importedAt,
        kind: "pdf",
        pdfData,
        pages: scanBook.pages.map((page, index) => ({
          title: page.renamed ? page.title : `第 ${index + 1} 页`,
          text: page.text || "",
        })),
      };
      const cover = await coverBlobFromImageBlob(scanBook.pages[0].blob).catch(
        () => null,
      );
      await finalizePendingBookCover(book, cover, "image");
      if (window.CikeDB) await window.CikeDB.putBook(book);
      userBooksCache = [
        ...userBooksCache.filter((item) => item.id !== book.id),
        book,
      ];
      state.userBooks = [
        ...(state.userBooks || []).filter((item) => item.id !== book.id),
        {
          id: book.id,
          title: book.title,
          author: book.author,
          language: book.language,
          type: book.type,
          source: book.source,
          importedAt: book.importedAt,
          pageCount: book.pages.length,
        },
      ];
      scanBook.pages.forEach((page) => {
        if (page.url) URL.revokeObjectURL(page.url);
      });
      scanPages = [];
      scanBook = null;
      state.reader.language = book.language;
      state.reader.activeBookId = book.id;
      state.reader.page = 0;
      state.reader.progress[book.id] = 0;
      currentView = "books";
      saveState();
      render();
      finish("done", "已加入");
      showToast(`已生成 PDF 图书《${book.title}》。`);
    } catch (error) {
      finish();
      showToast(error.message || "生成 PDF 失败，请重试。");
    }
  }

  async function runPendingOcr() {
    if (!pendingReaderBook || !window.Tesseract) {
      showToast("离线 OCR 引擎不可用。");
      return;
    }
    const book = pendingReaderBook;
    book.ocrState = "running";
    book.ocrDone = 0;
    book.ocrErrors = [];
    renderImportPreview();
    const language = book.language === "fr" ? "fra" : "eng";
    let worker;
    try {
      worker = await window.Tesseract.createWorker(language, 1, {
        workerPath: "./vendor/worker.min.js",
        corePath: "./vendor/",
        langPath: "./vendor/tessdata/",
        logger: (message) => {
          if (message.status === "recognizing text") {
            const status = document.querySelector(".ocr-panel p");
            if (status) {
              status.textContent = `正在识别第 ${book.ocrDone + 1}/${book.pages.length} 页：${Math.round((message.progress || 0) * 100)}%`;
            }
          }
        },
      });

      if (book.kind === "image") {
        const result = await worker.recognize(
          book.imageData,
          {},
          { blocks: true, text: true },
        );
        book.pages[0].text = ocrResultToParagraphs(result);
        book.ocrDone = 1;
      } else {
        const pdfjs = await import("./vendor/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
        const data =
          book.pdfData instanceof Blob
            ? new Uint8Array(await book.pdfData.arrayBuffer())
            : new Uint8Array(book.pdfData);
        const document = await pdfjs.getDocument({ data, wasmUrl: "./vendor/wasm/" }).promise;
        for (let index = 0; index < book.pages.length; index += 1) {
          try {
            const page = await document.getPage(index + 1);
            const viewport = page.getViewport({ scale: 1.8 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({
              canvasContext: canvas.getContext("2d"),
              viewport,
            }).promise;
            const result = await worker.recognize(
              canvas,
              {},
              { blocks: true, text: true },
            );
            book.pages[index].text = ocrResultToParagraphs(result);
          } catch (error) {
            book.ocrErrors.push({ page: index + 1, message: error.message });
          }
          book.ocrDone = index + 1;
          renderImportPreview();
        }
      }
      book.ocrState = "done";
      playSound("ocr-done");
      showToast("离线 OCR 完成，已保留原页面和识别文字。");
    } catch (error) {
      book.ocrState = "error";
      showToast(`OCR 失败：${error.message}`);
    } finally {
      await worker?.terminate?.();
      renderImportPreview();
    }
  }

  async function retryPendingOcrPage(index) {
    const book = pendingReaderBook;
    if (!book || !window.Tesseract) {
      showToast("离线 OCR 引擎不可用。");
      return;
    }
    const page = book.pages[index];
    if (!page) return;
    book.ocrErrors = (book.ocrErrors || []).filter(
      (error) => error.page !== index + 1,
    );
    let worker;
    try {
      worker = await window.Tesseract.createWorker(
        book.language === "fr" ? "fra" : "eng",
        1,
        {
          workerPath: "./vendor/worker.min.js",
          corePath: "./vendor/",
          langPath: "./vendor/tessdata/",
        },
      );
      let source = null;
      if (book.kind === "image") {
        source = book.imageData;
      } else if (book.kind === "pdf" && book.pdfData) {
        const pdfjs = await import("./vendor/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
        const data =
          book.pdfData instanceof Blob
            ? new Uint8Array(await book.pdfData.arrayBuffer())
            : new Uint8Array(book.pdfData);
        const document = await pdfjs.getDocument({ data, wasmUrl: "./vendor/wasm/" }).promise;
        const pdfPage = await document.getPage(index + 1);
        const viewport = pdfPage.getViewport({ scale: 1.8 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await pdfPage.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        }).promise;
        source = canvas;
      }
      if (!source) throw new Error("这一页没有可识别的图像。");
      const result = await worker.recognize(source, {}, { blocks: true, text: true });
      page.text = ocrResultToParagraphs(result);
      showToast(`第 ${index + 1} 页已重新识别。`);
    } catch (error) {
      book.ocrErrors.push({ page: index + 1, message: error.message });
      showToast(`第 ${index + 1} 页识别失败：${error.message}`);
    } finally {
      await worker?.terminate?.();
      renderImportPreview();
    }
  }

  function writingDocuments() {
    return (
      userBooksCache.length
        ? userBooksCache
        : (state.userBooks || []).filter((book) => Array.isArray(book.pages))
    ).filter((book) => book.type === "teaching");
  }

  function writingChapters(doc) {
    const chapters = [];
    (doc.pages || []).forEach((page, index) => {
      const lines = page.lines || String(page.text || "").split(/\n+/);
      const firstUseful = lines.find((line) => String(line).trim()) || "";
      const title = page.chapterTitle || page.title || `第 ${index + 1} 页`;
      const previous = chapters.at(-1);
      if (previous && previous.title === title) {
        previous.lines.push(...lines);
        return;
      }
      chapters.push({
        index,
        title,
        subtitle: firstUseful.replace(/^#+\s*/, "").slice(0, 32),
        lines: lines.filter((line, lineIndex, array) => {
          if (String(line).trim()) return true;
          return lineIndex > 0 && lineIndex < array.length - 1;
        }),
      });
    });
    return chapters;
  }

  function writingBoards(chapter, size = 5) {
    const boards = [];
    const lines = chapter.lines || [];
    for (let index = 0; index < lines.length; index += size) {
      boards.push(lines.slice(index, index + size));
    }
    return boards.length ? boards : [["本页没有可背诵的文字。"]];
  }

  function renderStats() {
    const summary = currentSummary();
    const days = Array.from({ length: 14 }, (_, index) => core.addDays(todayKey(), index - 13));
    const dailyValues = days.map((day) => Number(state.daily[day]?.total || 0));
    const maxDaily = Math.max(1, ...dailyValues);
    const tagCoverage = deck.meta.tagCounts || {};
    const dynamicCoverage =
      Object.keys(tagCoverage).length > 0
        ? tagCoverage
        : words.reduce((result, word) => {
            for (const tag of word.tags || []) {
              result[tag] = (result[tag] || 0) + 1;
            }
            return result;
          }, {});
    const learnedByCategory = {};
    for (const word of words) {
      if (state.progress[word.id]) {
        learnedByCategory[word.category] =
          (learnedByCategory[word.category] || 0) + 1;
      }
    }
    const topCategories = Object.entries(learnedByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    main.innerHTML = `
      <header>
        <h1>学习进度</h1>
        <p class="page-lede">数据来自这台设备上的实际答题记录。不要把“看过”当成“记住”，这里只统计真正作答过的词。</p>
      </header>

      <div class="metric-grid">
        <div class="metric"><span class="metric-label">深入学习</span><span class="metric-value">${formatNumber(summary.studied)} <small>/ ${formatNumber(words.length)}</small></span></div>
        <div class="metric"><span class="metric-label">已经掌握</span><span class="metric-value">${formatNumber(summary.mastered)}</span></div>
        <div class="metric"><span class="metric-label">今日到期</span><span class="metric-value">${formatNumber(summary.due)}</span></div>
        <div class="metric"><span class="metric-label">累计作答</span><span class="metric-value">${formatNumber(summary.attempts)}</span></div>
      </div>

      <div class="section-heading">
        <div><h2>近 14 天</h2><p>每日作答量</p></div>
      </div>
      <section class="chart-panel" aria-label="近 14 天学习量">
        <div class="activity-chart">
          ${days.map((day, index) => {
            const value = dailyValues[index];
            return `<span class="activity-bar ${index === days.length - 1 ? "is-today" : ""}" style="--height:${Math.max(2, percent(value, maxDaily))}%" data-value="${value}"></span>`;
          }).join("")}
        </div>
        <div class="activity-labels"><span>${esc(days[0].slice(5))}</span><span>${esc(days.at(-1).slice(5))}</span></div>
        <div class="accuracy-line">
          <span>累计正确率</span>
          <div class="accuracy-track"><span style="--accuracy:${summary.accuracy}%"></span></div>
          <strong>${summary.accuracy}%</strong>
        </div>
      </section>

      <div class="split-stats">
        <section class="panel">
          <div class="panel-header"><div><h3>词库覆盖</h3><p>一个词可属于多个场景</p></div></div>
          <div class="tag-bars">
            ${(deck.meta.filters || [])
              .filter((filter) => filter.id !== "all")
              .slice(0, 5)
              .map((filter) => {
              const value = Number(dynamicCoverage[filter.id] || 0);
              return `<div class="tag-bar"><span>${esc(filter.label)}</span><div class="tag-bar-track"><span style="width:${percent(value, words.length)}%"></span></div><strong>${value}</strong></div>`;
            }).join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h3>已学主题</h3><p>按进入复习的词统计</p></div></div>
          ${
            topCategories.length
              ? `<ul class="compact-list">${topCategories.map(([category, count]) => `<li><span>${esc(category)}</span><strong>${count}</strong></li>`).join("")}</ul>`
              : `<p style="color:var(--ink-faint);font-size:12px;margin:18px 0 0">完成第一组练习后，这里会开始显示你的主题分布。</p>`
          }
        </section>
      </div>
    `;
  }

  function renderSidePanel(summary) {
    const today = todayRecord();
    const done = Number(today.total || 0);
    const progress = percent(summary.studied, words.length);
    const date = new Date();
    const day = String(date.getDate()).padStart(2, "0");
    const month = new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(date);

    sidePanel.innerHTML = `
      <section class="side-section">
        <div class="side-label"><span>今日学习</span><span>不限量</span></div>
        <div class="side-plan">
          <strong>${esc(deck.meta.title)}</strong>
          <p>今日已作答 ${done} 次${summary.due ? `，${summary.due} 个词到期。` : "。"}</p>
          <div class="progress-track"><span style="--progress:${progress}%"></span></div>
        </div>
      </section>
      <section class="side-section">
        <div class="side-label"><span>快速开始</span></div>
        <button class="side-link" type="button" data-action="quick-start" data-mode="listen">听力默写 ${icon("arrow")}</button>
        <button class="side-link" type="button" data-action="quick-start" data-mode="write">释义默写 ${icon("arrow")}</button>
        <button class="side-link" type="button" data-action="start-mistakes">错词回炉 ${icon("arrow")}</button>
        <button class="side-link" type="button" data-action="open-unit" data-unit="${nextUnit()}">继续下一单元 ${icon("arrow")}</button>
      </section>
      <section class="side-section">
        <div class="side-label"><span>今天</span></div>
        <div class="day-stamp">
          <strong>${esc(day)}</strong>
          <span>${esc(month)} · ${summary.streak ? `连续 ${summary.streak} 天` : "从今天开始"}</span>
        </div>
      </section>
    `;
  }

  function nextUnit() {
    const touchedUnits = new Set(
      words.filter((word) => state.progress[word.id]).map((word) => word.unit),
    );
    return (
      Array.from({ length: deck.meta.units }, (_, index) => index + 1).find(
        (unit) => !touchedUnits.has(unit),
      ) || 1
    );
  }

  function bookCompositionRows() {
    if (deck.meta.levelCounts) {
      return Object.entries(deck.meta.levelCounts)
        .map(
          ([level, count]) =>
            `<li><span>${esc(level)}</span><strong>${formatNumber(count)}</strong></li>`,
        )
        .join("");
    }
    if (deck.meta.wordCount && deck.meta.phraseCount) {
      return `<li><span>核心词</span><strong>${formatNumber(deck.meta.wordCount)}</strong></li>
        <li><span>语境词组</span><strong>${formatNumber(deck.meta.phraseCount)}</strong></li>`;
    }
    if (deck.meta.syllabusWords) {
      return `<li><span>六级大纲词</span><strong>${formatNumber(deck.meta.syllabusWords)}</strong></li>
        <li><span>B2 高频补充</span><strong>${formatNumber(deck.meta.b2SupplementWords)}</strong></li>
        <li><span>高级/学术补充</span><strong>${formatNumber(deck.meta.relevanceSupplementWords)}</strong></li>`;
    }
    return `<li><span>当前词书</span><strong>${formatNumber(words.length)}</strong></li>`;
  }

  function renderDetailPanel(summary) {
    const recentDays = Array.from({ length: 7 }, (_, index) =>
      core.addDays(todayKey(), index - 6),
    );
    const values = recentDays.map((day) => Number(state.daily[day]?.total || 0));
    const max = Math.max(1, ...values);

    detailPanel.innerHTML = `
      <div class="side-label"><span>${esc(deck.meta.title)}</span><span>${formatNumber(summary.studied)} / ${formatNumber(words.length)}</span></div>
      <div class="detail-stat">
        <strong>${formatNumber(summary.due)}</strong>
        <span>今日到期，优先安排</span>
      </div>
      <div class="detail-stat">
        <strong>${formatNumber(summary.mistakes)}</strong>
        <span>错词待回炉</span>
      </div>
      <div class="detail-stat">
        <strong>${summary.accuracy}%</strong>
        <span>累计作答正确率</span>
      </div>
      <div class="side-section">
        <div class="side-label"><span>近 7 天节奏</span></div>
        <div class="rhythm" aria-label="近七天作答量">
          ${values.map((value) => `<span style="--height:${Math.max(8, percent(value, max))}%"></span>`).join("")}
        </div>
      </div>
      <div class="side-section">
        <div class="side-label"><span>题库构成</span></div>
        <ul class="compact-list">${bookCompositionRows()}</ul>
      </div>
      <div class="side-section">
        <button class="button button-secondary button-wide" type="button" data-action="start-session">
          ${icon("play")}${dailyPlanButtonLabel()}
        </button>
      </div>
    `;
  }

  function wordMeaning(word) {
    const meaning = String(word?.meaning || "").trim();
    if (meaning) return meaning;
    const phonetic = String(word?.phonetic || "").trim();
    return phonetic ? `暂无中文释义 · 读音 ${phonetic}` : "暂无中文释义";
  }

  function startSession(options = {}) {
    const mode = options.mode || selectedMode || "mixed";
    const focus = options.focus || "today";
    const tag = options.tag || selectedTag;
    const unit = options.unit || selectedUnit || null;
    const size = options.all
      ? words.length
      : Math.max(1, Number(options.size || dailyPlanSize()));
    const queue = options.queue
      ? expandLearningFlow(
          options.queue.map((word) => ({ word })),
          mode,
        )
      : expandLearningFlow(
          core.buildSessionQueue(words, state.progress, {
            tag,
            unit,
            size,
            mode,
            focus,
          }),
          mode,
        );

    if (!queue.length) {
      showToast("当前筛选下没有可练习的词，换一个范围试试。");
      return;
    }

    session = {
      queue,
      index: 0,
      correct: 0,
      wrong: 0,
      results: [],
      answerState: null,
      revealed: false,
      listenDraft: "",
      mode,
      focus,
      tag,
      unit,
      bookId: deck.meta.id,
      startedAt: Date.now(),
    };
    lastStudyConfig = { ...options, mode, focus, tag, unit, size };
    currentView = "study";
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function expandLearningFlow(queue, mode) {
    // 拼写与听写对所有语种都开放：拉丁语系用屏内键盘，
    // 日/粤/中改用系统输入法输入，不再整段跳过写词环节。
    if (mode !== "mixed") return queue.map((item) => ({ ...item, kind: mode }));
    return queue.flatMap((item) => [
      { word: item.word, kind: "recognize" },
      { word: item.word, kind: "write" },
    ]);
  }

  function renderStudy() {
    if (!session || session.index >= session.queue.length) {
      renderStudyResult();
      return;
    }

    const current = session.queue[session.index];
    const word = current.word;
    const kind = current.kind;
    const answer = session.answerState;
    const progress = percent(
      session.index + (answer ? 1 : 0),
      session.queue.length,
    );
    const status = statusFor(word);

    if (kind === "listen") {
      renderListen(current, word, answer, progress);
      return;
    }

    main.innerHTML = `
      <section class="study-view">
        <div class="study-topbar">
          <button class="icon-button" type="button" data-action="exit-study" aria-label="退出练习">${icon("close")}</button>
          <div class="study-progress">
            <div class="study-progress-label"><span>${session.index + 1} / ${session.queue.length}</span><span>${session.focus === "review" ? "错词与到期复习" : "今日任务"}</span></div>
            <div class="progress-track" aria-label="本组进度 ${progress}%"><span style="--progress:${progress}%"></span></div>
          </div>
          <button class="icon-button" type="button" data-action="speak" data-word-id="${esc(word.id)}" aria-label="播放发音" title="播放发音">${icon("volume")}</button>
        </div>

        <article class="study-card is-entering" aria-live="polite">
          <div class="study-meta">
            <span class="study-kind">${icon(kindIcon(kind))}${kindLabel(kind)}</span>
            <span>#${word.rank} · ${esc(word.band)} · ${esc(word.cefr || "进阶")}</span>
          </div>
          ${renderStudyPrompt(kind, word, answer)}
          <div class="study-footer">
            <span class="keyboard-hint"><kbd>Space</kbd> 听发音 <kbd>Enter</kbd> ${answer ? "继续" : "提交"}</span>
            <span><span class="status-dot ${status.className}"></span> ${esc(status.label)}</span>
          </div>
        </article>
      </section>
    `;

    if (!answer) {
      if (kind === "listen" || kind === "write") {
        requestAnimationFrame(() => {
          document.querySelector(".answer-input")?.focus();
        });
      }
    }
  }

  const LISTEN_KEYPADS = {
    en: { rows: ["qwertyuiop", "asdfghjkl", "zxcvbnm"], extra: [] },
    fr: {
      rows: ["azertyuiop", "qsdfghjklm", "wxcvbn"],
      extra: ["é", "è", "ê", "à", "ç", "ô", "î", "û", "ù", "œ", "'", "-"],
    },
    de: {
      rows: ["qwertzuiopü", "asdfghjklöä", "yxcvbnm"],
      extra: ["ß", "'", "-"],
    },
    es: {
      rows: ["qwertyuiop", "asdfghjklñ", "zxcvbnm"],
      extra: ["á", "é", "í", "ó", "ú", "ü", "ñ", "'", "-"],
    },
    it: {
      rows: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
      extra: ["à", "è", "é", "ì", "ò", "ù", "'", "-"],
    },
    la: {
      rows: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
      extra: ["ā", "ē", "ī", "ō", "ū", "'", "-"],
    },
  };
  const LISTEN_IME_LANGS = new Set(["ja", "yue", "zh"]);

  function listenKeyLabel(letter) {
    if (letter === "ß") return "ß";
    return /^[a-z]$/.test(letter) ? letter.toUpperCase() : letter;
  }

  function renderListen(current, word, answer, progress) {
    const languageName = languageLabel(word.language);
    const draft = String(session.listenDraft || "");
    const keypad = LISTEN_KEYPADS[word.language] || LISTEN_KEYPADS.en;
    const usesIme = LISTEN_IME_LANGS.has(word.language);

    main.innerHTML = `
      <section class="listen-page">
        <header class="listen-head">
          ${backButton("返回学习中心")}
          <div>
            <span class="cike-brand">词刻 <b>CIKE</b></span>
            <h1>听音拼写</h1>
            <small>本组第 ${session.index + 1} 词 · ${languageName}</small>
          </div>
          <span class="tag tag--yellow">${bookLanguageBadge(word.language)}</span>
        </header>

        <div class="practice-progress" style="width:100%">
          <div class="practice-progress-label">
            <span>本组第 ${session.index + 1} 词</span>
            <span>${esc(word.cefr || "进阶")}</span>
          </div>
          <div class="progress-track"><span style="--progress:${progress}%"></span></div>
        </div>

        <button class="listen-orb listen-trigger" type="button" data-action="speak" data-word-id="${esc(word.id)}" aria-label="播放单词发音">
          ${icon("volume")}
        </button>
        <p class="listen-hint">${answer ? "可以再听一次，核对自己的拼写。" : "听发音，拼出单词"}</p>

        ${
          answer
            ? `<div class="listen-input" style="display:grid;align-items:center">${esc(answer.value || "（未输入）")}</div>
               ${renderAnswerFeedback(word, answer)}
               ${renderAfterAnswer(word, answer)}`
            : usesIme
              ? `<form class="answer-form listen-ime-form" id="listenImeForm">
                  <label class="sr-only" for="listenImeInput">输入听到的${languageName}</label>
                  <input class="answer-input" id="listenImeInput" name="answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" value="${esc(draft)}" placeholder="用系统输入法写出听到的词" />
                  <button class="button button-primary" type="submit">检查</button>
                </form>
                <div class="listen-actions">
                  <button class="paper-btn is-replay" type="button" data-action="speak" data-word-id="${esc(word.id)}">重听</button>
                </div>`
              : `<div class="listen-input" aria-live="polite" aria-label="已输入的字母">${
                  draft
                    ? `<span>${esc(draft)}</span>`
                    : `<span class="listen-placeholder">在这里拼写……</span>`
                }</div>
                <div class="keypad" role="group" aria-label="拼写键盘">
                  ${keypad.rows
                    .map(
                      (row) => `<div class="keypad-row">
                        ${row
                          .split("")
                          .map(
                            (letter) =>
                              `<button class="key" type="button" data-action="type-letter" data-letter="${letter}">${listenKeyLabel(letter)}</button>`,
                          )
                          .join("")}
                      </div>`,
                    )
                    .join("")}
                  ${
                    keypad.extra.length
                      ? `<div class="keypad-row">
                          ${keypad.extra
                            .map(
                              (letter) =>
                                `<button class="key" type="button" data-action="type-letter" data-letter="${esc(letter)}">${listenKeyLabel(letter)}</button>`,
                            )
                            .join("")}
                        </div>`
                      : ""
                  }
                  <div class="keypad-row">
                    <button class="key is-wide" type="button" data-action="listen-backspace">退格</button>
                    <button class="key" type="button" data-action="type-letter" data-letter=" ">空格</button>
                    <button class="key is-wide" type="button" data-action="listen-clear">清空</button>
                  </div>
                </div>
                <div class="listen-actions">
                  <button class="paper-btn is-check" type="button" data-action="listen-check" ${draft.trim() ? "" : "disabled"}>检查</button>
                  <button class="paper-btn is-replay" type="button" data-action="speak" data-word-id="${esc(word.id)}">重听</button>
                </div>`
        }
      </section>
    `;

    if (!answer && usesIme) {
      requestAnimationFrame(() => {
        document.getElementById("listenImeInput")?.focus();
      });
    }
  }

  function typeListenLetter(letter) {
    if (!session || session.answerState) return;
    playSound("key");
    const value = String(session.listenDraft || "") + String(letter || "");
    session.listenDraft = value.slice(0, 48);
    renderStudy();
  }

  function checkListenAnswer() {
    if (!session || session.answerState) return;
    const value = String(session.listenDraft || "").trim();
    if (!value) {
      showToast("先按顺序写下听到的字母。");
      return;
    }
    const current = session.queue[session.index];
    const correct = core.normalizeAnswer(value) === core.normalizeAnswer(current.word.word);
    session.answerState = { value, correct };
    recordStudyAnswer(current.word, correct ? "know" : "again", correct);
    playSound(correct ? "correct" : "wrong");
    render();
    focusNextStudyAction();
  }

  function renderStudyPrompt(kind, word, answer) {
    const languageName = languageLabel(word.language);
    if (kind === "recognize") {
      if (answer) {
        return `
          <div class="word-stage">
            <div class="study-word">${esc(word.word)}</div>
            <div class="study-meaning">${esc(wordMeaning(word))}</div>
            ${
              word.example
                ? `<div class="study-example">${esc(word.example)}${word.exampleZh ? `<span class="study-example-zh">${esc(word.exampleZh)}</span>` : ""}</div>`
                : ""
            }
            ${renderAnswerFeedback(word, answer)}
          </div>
          <div class="study-actions">
            <button class="button button-secondary" type="button" data-action="speak" data-word-id="${esc(word.id)}">${icon("volume")}再听一次</button>
            <button class="button button-primary" type="button" data-action="next-question">${icon("arrow")}下一个</button>
          </div>
        `;
      }
      return `
        <div class="word-stage">
          <div class="study-word">${esc(word.word)}</div>
          <button class="text-button" type="button" data-action="speak" data-word-id="${esc(word.id)}">听发音</button>
          ${
            session.revealed
              ? `<div class="study-meaning">${esc(wordMeaning(word))}</div>
                 ${
                   word.example
                     ? `<div class="study-example">${esc(word.example)}${word.exampleZh ? `<span class="study-example-zh">${esc(word.exampleZh)}</span>` : ""}</div>`
                     : ""
                 }`
              : `<p class="study-example" style="color:var(--ink-faint)">先在脑海里说出词义，再翻开答案。</p>`
          }
        </div>
        ${
          session.revealed
            ? `<div class="study-actions">
                <button class="button grade-again" type="button" data-action="grade" data-grade="again">1 · 没记住</button>
                <button class="button grade-hard" type="button" data-action="grade" data-grade="hard">2 · 模糊</button>
                <button class="button grade-know" type="button" data-action="grade" data-grade="know">3 · 记住了</button>
              </div>`
            : `<div class="study-actions">
                <button class="button button-primary" type="button" data-action="reveal">${icon("library")}显示释义</button>
                <button class="button button-ghost" type="button" data-action="grade" data-grade="again">没想起来</button>
              </div>`
        }
      `;
    }

    if (kind === "listen") {
      return `
        <div class="word-stage">
          <p class="prompt-label">听发音，默写${languageName}单词</p>
          <button class="listen-trigger" type="button" data-action="speak" data-word-id="${esc(word.id)}" aria-label="播放单词发音">${icon("volume")}</button>
          <div class="listen-wave" aria-hidden="true">
            ${Array.from({ length: 12 }, (_, index) => `<span style="--wave-height:${6 + (index % 5) * 4}px;--wave-index:${index}"></span>`).join("")}
          </div>
          ${
            answer
              ? renderAnswerFeedback(word, answer)
              : `<form class="answer-form" id="answerForm">
                  <label class="sr-only" for="answerInput">输入听到的${languageName}单词</label>
                  <input class="answer-input" id="answerInput" name="answer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="听到什么，就写什么" />
                  <button class="button button-primary" type="submit">提交</button>
                </form>`
          }
        </div>
        ${answer ? renderAfterAnswer(word, answer) : ""}
      `;
    }

    const maskedExample = word.example
      ? esc(word.example).replace(
          new RegExp(escapeRegExp(word.word), "gi"),
          '<span style="color:var(--orange);font-weight:700">_____</span>',
        )
      : "";
    return `
      <div class="word-stage">
        <p class="prompt-label">根据释义，写出${languageName}单词</p>
        <h2 class="prompt-meaning">${esc(wordMeaning(word))}</h2>
        ${maskedExample ? `<div class="prompt-hint">${maskedExample}${word.exampleZh ? `<span class="study-example-zh">${esc(word.exampleZh)}</span>` : ""}</div>` : ""}
        ${
          answer
            ? renderAnswerFeedback(word, answer)
            : `<form class="answer-form" id="answerForm">
                <label class="sr-only" for="answerInput">输入对应的${languageName}单词</label>
                <input class="answer-input" id="answerInput" name="answer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入${languageName}拼写" />
                <button class="button button-primary" type="submit">提交</button>
              </form>`
        }
      </div>
      ${answer ? renderAfterAnswer(word, answer) : ""}
    `;
  }

  function renderAnswerFeedback(word, answer) {
    return `<div class="answer-feedback ${answer.correct ? "is-correct" : "is-wrong"}">
      <span class="feedback-status ${answer.correct ? "is-correct" : "is-wrong"}">
        ${icon(answer.correct ? "check" : "close")}${answer.correct ? "拼写正确" : "还差一点"}
      </span>
      <span class="spell-diff">${diffSpelling(word.word, answer.value)}</span>
    </div>`;
  }

  function renderAfterAnswer(word, answer) {
    return `
      <div class="study-meaning" style="margin-top:20px;text-align:center">${esc(wordMeaning(word))}</div>
      ${
        word.example
          ? `<div class="study-example" style="text-align:center">${esc(word.example)}${word.exampleZh ? `<span class="study-example-zh">${esc(word.exampleZh)}</span>` : ""}</div>`
          : ""
      }
      <div class="study-actions">
        <button class="button button-secondary" type="button" data-action="speak" data-word-id="${esc(word.id)}">${icon("volume")}再听一次</button>
        <button class="button button-primary" type="button" data-action="next-question">${icon("arrow")}继续</button>
      </div>
    `;
  }

  function renderStudyResult() {
    const attempted = session.correct + session.wrong;
    const accuracy = attempted ? Math.round((session.correct / attempted) * 100) : 0;
    const wrongResults = session.results.filter((result) => !result.correct);

    main.innerHTML = `
      <section class="study-view">
        <div class="study-card session-result">
          <div class="result-mark">${icon(accuracy >= 80 ? "check" : "keyboard")}</div>
          <p class="task-date">本组完成</p>
          <h1 style="max-width:none;margin-bottom:0">${accuracy >= 90 ? "这一组很稳" : accuracy >= 70 ? "记住大半了" : "错词已经排到前面"}</h1>
          <p class="result-score">${accuracy}%</p>
          <p class="result-detail">完成 ${attempted} 词，答对 ${session.correct} 个，待回炉 ${session.wrong} 个。错词和到期时间已经自动更新。</p>
          <div class="result-burst" aria-hidden="true">
            ${Array.from({ length: 10 }, (_, index) => {
              const angle = (Math.PI * 2 * index) / 10;
              return `<span style="left:50%;top:50%;--burst-index:${index};--burst-x:${Math.cos(angle) * 90}px;--burst-y:${Math.sin(angle) * 70}px"></span>`;
            }).join("")}
          </div>
          ${
            wrongResults.length
              ? `<div class="result-actions">
                  <button class="button button-primary" type="button" data-action="review-session-wrong">${icon("shuffle")}立刻回炉错词</button>
                  <button class="button button-secondary" type="button" data-action="start-session">再来一组</button>
                  <button class="button button-ghost" type="button" data-action="go-home">返回今日</button>
                </div>`
              : `<div class="result-actions">
                  <button class="button button-primary" type="button" data-action="start-session">再来一组</button>
                  <button class="button button-secondary" type="button" data-action="go-home">返回今日</button>
                </div>`
          }
        </div>
      </section>
    `;
  }

  function renderStudyPanels() {
    if (!session) return;
    const current = session.queue[session.index]?.word;
    const attempted = session.correct + session.wrong;
    const accuracy = attempted ? Math.round((session.correct / attempted) * 100) : 0;

    const sessionProgress = percent(
      session.index + (session.answerState ? 1 : 0),
      session.queue.length,
    );
    sidePanel.innerHTML = `
      <section class="side-section">
        <div class="side-label"><span>本组设置</span></div>
        <div class="side-plan">
          <strong>${kindLabel(session.mode)}</strong>
          <p>${session.tag === "all" ? "全部核心词" : tagLabel(session.tag)}${session.unit ? ` · 第 ${session.unit} 单元` : ""}</p>
          <div class="progress-track"><span style="--progress:${sessionProgress}%"></span></div>
        </div>
      </section>
      <section class="side-section">
        <div class="side-label"><span>当前</span></div>
        <ul class="compact-list">
          <li><span>答对</span><strong>${session.correct}</strong></li>
          <li><span>待回炉</span><strong>${session.wrong}</strong></li>
          <li><span>正确率</span><strong>${accuracy}%</strong></li>
        </ul>
      </section>
      <section class="side-section">
        <div class="side-label"><span>快捷键</span></div>
        <ul class="compact-list">
          <li><span>显示释义</span><strong>Space</strong></li>
          <li><span>提交 / 继续</span><strong>Enter</strong></li>
          <li><span>退出本组</span><strong>Esc</strong></li>
        </ul>
      </section>
    `;

    detailPanel.innerHTML = current
      ? `
        <div class="side-label"><span>词条位置</span><span>#${current.rank}</span></div>
        <div class="detail-stat"><strong>${current.frequency ?? current.unit}</strong><span>${current.frequency ? "真题词频" : "当前单元"}</span></div>
        <div class="detail-stat"><strong>${esc(current.band)}</strong><span>${esc(languageLabel(current.language))}词书</span></div>
        <div class="side-section">
          <div class="side-label"><span>主题</span></div>
          <p style="color:var(--ink-soft);font-size:12px">${esc(current.category)}</p>
        </div>
        <div class="side-section">
          <button class="button button-ghost button-wide" type="button" data-action="exit-study">退出练习</button>
        </div>
      `
      : "";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function diffSpelling(expected, actual) {
    const target = String(expected || "");
    const typed = String(actual || "");
    if (!typed.trim()) return "目标拼写：" + esc(target);
    const max = Math.max(target.length, typed.length);
    let output = "";
    let misses = 0;
    for (let index = 0; index < max; index += 1) {
      const expectedChar = target[index] || "";
      const actualChar = typed[index] || "";
      if (expectedChar.toLowerCase() === actualChar.toLowerCase()) {
        output += `<span class="correct-char">${esc(expectedChar)}</span>`;
      } else {
        misses += 1;
        output += `<span class="wrong-char">${esc(expectedChar || "·")}</span>`;
      }
    }
    return `你的输入 ${esc(typed)} · 目标拼写 ${output}${misses ? ` · ${misses} 处不同` : ""}`;
  }

  function submitAnswer(form) {
    if (!session || session.answerState) return;
    const input = form.querySelector(".answer-input");
    if (!input) return;
    const value = input.value;
    if (!value.trim()) {
      input.classList.add("is-wrong");
      input.focus();
      showToast("先写下答案，再提交。");
      return;
    }
    const current = session.queue[session.index];
    const correct = core.normalizeAnswer(value) === core.normalizeAnswer(current.word.word);
    session.answerState = { value, correct };
    recordStudyAnswer(current.word, correct ? "know" : "again", correct);
    playSound(correct ? "correct" : "wrong");
    render();
    focusNextStudyAction();
  }

  function gradeRecognize(grade) {
    if (!session || session.answerState) return;
    const current = session.queue[session.index];
    session.revealed = true;
    session.answerState = { value: current.word.word, correct: grade !== "again" };
    recordStudyAnswer(current.word, grade, grade !== "again");
    playSound(
      grade === "again"
        ? "rating-again"
        : grade === "know"
          ? "rating-know"
          : "rating-hard",
    );
    render();
    focusNextStudyAction();
  }

  function recordStudyAnswer(word, grade, correct) {
    const alreadySeen = Boolean(state.progress[word.id]);
    const previous = state.progress[word.id];
    state.progress[word.id] = core.gradeAnswer(previous, grade);
    const daily = todayRecord();
    const firstAnswerToday = Number(daily.total || 0) === 0;
    daily.total += 1;
    daily.correct += correct ? 1 : 0;
    daily.wrong += correct ? 0 : 1;
    daily.new += alreadySeen ? 0 : 1;
    // 当天第一次作答算一次打卡，回到个人页时把这个标记画成红圈。
    if (firstAnswerToday) state.profile.checkinPending = todayKey();
    // 只存 24 个计数，用来判断早起与深夜学习，不记录具体时间点。
    const hour = new Date().getHours();
    state.profile.studyClock = state.profile.studyClock || {};
    state.profile.studyClock[hour] = Number(state.profile.studyClock[hour] || 0) + 1;

    if (correct) {
      session.correct += 1;
    } else {
      session.wrong += 1;
    }
    session.results.push({ wordId: word.id, grade, correct });
    saveState();
  }

  function nextQuestion() {
    if (!session) return;
    session.index += 1;
    session.answerState = null;
    session.revealed = false;
    session.listenDraft = "";
    if (session.index >= session.queue.length) playSound("complete");
    else playSound("next");
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function speechLocaleFor(code) {
    const language = String(code || "en").toLowerCase();
    const accent = String(state.settings.accent || "en-US").toLowerCase();
    if (language.startsWith("fr")) return "fr-FR";
    if (language.startsWith("es")) return "es-ES";
    if (language.startsWith("de")) return "de-DE";
    if (language.startsWith("it")) return "it-IT";
    if (language.startsWith("ja")) return "ja-JP";
    if (language.startsWith("ko")) return "ko-KR";
    if (language.startsWith("ru")) return "ru-RU";
    if (language.startsWith("yue")) return "zh-HK";
    if (language.startsWith("zh")) return "zh-CN";
    // 系统一般没有拉丁语语音包，退回教会式读音最接近的意大利语。
    if (language.startsWith("la")) return "it-IT";
    return accent === "en-gb" ? "en-GB" : "en-US";
  }

  function speechLanguageName(language) {
    const value = String(language || "").toLowerCase();
    if (value.startsWith("fr")) return "法语";
    if (value.startsWith("zh-hk") || value.startsWith("yue")) return "粤语";
    if (value.startsWith("zh")) return "中文";
    if (value.startsWith("de")) return "德语";
    if (value.startsWith("es")) return "西班牙语";
    if (value.startsWith("it")) return "意大利语";
    if (value.startsWith("ja")) return "日语";
    if (value.startsWith("ko")) return "韩语";
    if (value.startsWith("ru")) return "俄语";
    if (value.startsWith("la")) return "拉丁语";
    return "英语";
  }

  function clampSpeechRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return 0.88;
    return Math.min(1.15, Math.max(0.65, rate));
  }

  function speechErrorMessage(language, code = "") {
    const languageName = speechLanguageName(language);
    if (code === "not-allowed") {
      return "系统拦截了本次朗读，请再点一次朗读按钮。";
    }
    if (code === "network-voice") {
      return "当前语音需要联网才能播放，请到“学习设置 → 系统语音设置”安装离线语音包。";
    }
    if (
      code === "engine-unavailable" ||
      code === "language-unavailable" ||
      code === "voice-unavailable"
    ) {
      return `当前设备没有可用的${languageName}语音，请到“学习设置 → 系统语音设置”安装语音包。`;
    }
    return `暂时无法朗读${languageName}，请重试或在设置中检查系统语音。`;
  }

  function announceSpeechFailure(language, code = "") {
    showToast(speechErrorMessage(language, code));
  }

  function warmSpeechVoices() {
    if (speechVoicesWarm || !("speechSynthesis" in window)) return;
    speechVoicesWarm = true;
    try {
      const synth = window.speechSynthesis;
      synth.getVoices();
      synth.addEventListener?.("voiceschanged", () => synth.getVoices());
    } catch (error) {
      console.warn("Speech voice preload failed.", error);
    }
  }

  function pickBrowserVoice(synth, language) {
    const voices = synth.getVoices?.() || [];
    if (!voices.length) return null;
    const target = String(language || "en-US").toLowerCase().replace("_", "-");
    const prefix = target.slice(0, 2);
    let best = null;
    let bestScore = -Infinity;
    for (const voice of voices) {
      const lang = String(voice.lang || "").toLowerCase().replace("_", "-");
      if (!lang.startsWith(prefix)) continue;
      let score = 0;
      if (lang === target) score += 4000;
      else if (lang.startsWith(target)) score += 3000;
      else score += 1000;
      if (voice.localService) score += 5000;
      if (voice.default) score += 500;
      if (/natural|neural/i.test(voice.name || "")) score += 200;
      if (score > bestScore) {
        bestScore = score;
        best = voice;
      }
    }
    return best;
  }

  function clearSpeechSafety() {
    if (!speechSafetyTimer) return;
    window.clearTimeout(speechSafetyTimer);
    speechSafetyTimer = 0;
  }

  function clearSpeakingIndicators() {
    document
      .querySelectorAll(".is-speaking")
      .forEach((button) => button.classList.remove("is-speaking"));
  }

  function markSpeakingTrigger(trigger) {
    clearSpeakingIndicators();
    if (trigger && trigger.classList) trigger.classList.add("is-speaking");
  }

  function speechSafetyDelay(text) {
    const value = String(text || "");
    if (!/\s/.test(value) && value.length <= 24) return 1600;
    return Math.min(20000, Math.max(2600, value.length * 90));
  }

  function armSpeechSafety(request) {
    clearSpeechSafety();
    speechSafetyTimer = window.setTimeout(() => {
      if (!activeSpeechRequest || activeSpeechRequest.id !== request.id) return;
      request.trigger?.classList.remove("is-speaking");
      activeSpeechRequest = null;
    }, request.safetyMs);
  }

  function finishSpeechRequest(id) {
    if (!activeSpeechRequest) return;
    if (id && activeSpeechRequest.id !== id) return;
    activeSpeechRequest.trigger?.classList.remove("is-speaking");
    activeSpeechRequest = null;
    clearSpeechSafety();
  }

  function stopSpeech() {
    const request = activeSpeechRequest;
    activeSpeechRequest = null;
    clearSpeechSafety();
    clearSpeakingIndicators();
    try {
      window.AndroidBridge?.stopSpeech?.();
    } catch (error) {
      console.warn("Android stopSpeech failed.", error);
    }
    try {
      window.speechSynthesis?.cancel();
    } catch (error) {
      console.warn("Browser speech cancel failed.", error);
    }
    try {
      window.CikeFrenchAudio?.stop?.();
    } catch (error) {
      console.warn("French audio stop failed.", error);
    }
    stopOnlineSpeech();
    return request;
  }

  // 离线包没有收录的英文文本，优先走在线 TTS，再退回系统语音。
  const ONLINE_SPEECH_CHUNK = 900;

  // 安卓包内 WebView 是断网的（blockNetworkLoads），因此音频字节改由原生桥取回，
  // 网页端拿到 base64 后转成 Blob 播放，网络与播放链路都与浏览器端保持一致。
  const audioFetchPending = new Map();
  let audioFetchSeq = 0;
  let onlineSpeechObjectUrl = "";

  function releaseOnlineSpeechObjectUrl() {
    if (!onlineSpeechObjectUrl) return;
    try {
      URL.revokeObjectURL(onlineSpeechObjectUrl);
    } catch (error) {
      // 释放失败无需处理，浏览器会在页面关闭时回收。
    }
    onlineSpeechObjectUrl = "";
  }

  function bridgeFetchAudio(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = `audio-${Date.now()}-${++audioFetchSeq}`;
      const timer = window.setTimeout(() => {
        audioFetchPending.delete(id);
        reject(new Error("audio-timeout"));
      }, timeout);
      audioFetchPending.set(id, { resolve, reject, timer });
      try {
        window.AndroidBridge.fetchAudio(id, url);
      } catch (error) {
        window.clearTimeout(timer);
        audioFetchPending.delete(id);
        reject(error);
      }
    });
  }

  window.CikeSpeechAudio = {
    onResult(id, payload) {
      const pending = audioFetchPending.get(String(id));
      if (!pending) return;
      window.clearTimeout(pending.timer);
      audioFetchPending.delete(String(id));
      let result;
      try {
        result = typeof payload === "string" ? JSON.parse(payload) : payload;
      } catch (error) {
        pending.reject(new Error("audio-bad-payload"));
        return;
      }
      if (result?.ok && result.base64) {
        pending.resolve(String(result.base64));
        return;
      }
      pending.reject(new Error(result?.error || "audio-failed"));
    },
  };

  async function onlineSpeechSource(chunk) {
    const url = onlineSpeechUrl(chunk);
    if (!window.AndroidBridge?.fetchAudio || typeof Blob !== "function") return url;
    const base64 = await bridgeFetchAudio(url);
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  }

  function stopOnlineSpeech() {
    onlineSpeechToken += 1;
    if (onlineSpeechTimer) {
      window.clearTimeout(onlineSpeechTimer);
      onlineSpeechTimer = 0;
    }
    if (!onlineSpeechAudio) {
      releaseOnlineSpeechObjectUrl();
      return;
    }
    try {
      onlineSpeechAudio.pause();
      onlineSpeechAudio.removeAttribute("src");
      onlineSpeechAudio.load();
    } catch (error) {
      console.warn("Online speech stop failed.", error);
    }
    releaseOnlineSpeechObjectUrl();
  }

  function onlineSpeechChunks(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return [];
    const pieces = value.match(/[^.!?;:。！？；]+[.!?;:。！？；]?/g) || [value];
    const chunks = [];
    let current = "";
    for (const raw of pieces) {
      const piece = raw.trim();
      if (!piece) continue;
      if (piece.length > ONLINE_SPEECH_CHUNK) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (let i = 0; i < piece.length; i += ONLINE_SPEECH_CHUNK) {
          chunks.push(piece.slice(i, i + ONLINE_SPEECH_CHUNK));
        }
        continue;
      }
      const merged = current ? `${current} ${piece}` : piece;
      if (merged.length > ONLINE_SPEECH_CHUNK && current) {
        chunks.push(current);
        current = piece;
      } else {
        current = merged;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function onlineSpeechUrl(text) {
    const lan = state.settings.accent === "en-GB" ? "uk" : "en";
    return `https://fanyi.baidu.com/gettts?lan=${lan}&spd=3&source=web&text=${encodeURIComponent(text)}`;
  }

  function speakViaOnline(text, language, trigger = null, onFail = null) {
    if (typeof Audio !== "function") return false;
    if (!/^en(?:[_-]|$)/i.test(String(language || ""))) return false;
    if (navigator.onLine === false) return false;
    const chunks = onlineSpeechChunks(text);
    if (!chunks.length) return false;

    stopSpeech();
    const token = onlineSpeechToken;
    const id = `online:${++speechRequestSerial}`;
    const request = { id, language, trigger: trigger || null, safetyMs: 0 };
    activeSpeechRequest = request;
    markSpeakingTrigger(request.trigger);

    onlineSpeechAudio ||= new Audio();
    const audio = onlineSpeechAudio;
    audio.preload = "auto";
    let cursor = 0;
    let started = false;
    let settled = false;

    function isAlive() {
      return !settled && token === onlineSpeechToken;
    }

    function clearStartTimer() {
      if (!onlineSpeechTimer) return;
      window.clearTimeout(onlineSpeechTimer);
      onlineSpeechTimer = 0;
    }

    function armTimer(ms, action) {
      clearStartTimer();
      onlineSpeechTimer = window.setTimeout(() => {
        onlineSpeechTimer = 0;
        if (isAlive()) action();
      }, ms);
    }

    function detach() {
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
    }

    function finish() {
      if (!isAlive()) return;
      settled = true;
      clearStartTimer();
      detach();
      releaseOnlineSpeechObjectUrl();
      finishSpeechRequest(id);
    }

    function fallback(error) {
      if (!isAlive()) return;
      settled = true;
      clearStartTimer();
      detach();
      try {
        audio.pause();
      } catch (pauseError) {
        // 忽略停止时的异常。
      }
      releaseOnlineSpeechObjectUrl();
      if (typeof onFail === "function") {
        if (activeSpeechRequest?.id === id) activeSpeechRequest = null;
        onFail(error);
      } else {
        finishSpeechRequest(id);
      }
    }

    const nativeAudio = Boolean(window.AndroidBridge?.fetchAudio);

    function loadChunk() {
      if (!isAlive()) return;
      const chunk = chunks[cursor];
      started = false;
      clearStartTimer();
      releaseOnlineSpeechObjectUrl();
      // 原生桥取音频要给下载留时间；网页端直接播放在线地址则 7 秒没动静就视为不可用，
      // 直接退回系统语音，避免按钮一直转圈。
      armTimer(
        nativeAudio ? 15000 : 7000,
        () => fallback(new Error("online-speech-timeout")),
      );
      Promise.resolve(onlineSpeechSource(chunk))
        .then((src) => {
          if (!isAlive()) {
            if (src.startsWith("blob:")) URL.revokeObjectURL(src);
            return;
          }
          if (src.startsWith("blob:")) onlineSpeechObjectUrl = src;
          audio.src = src;
          let promise = null;
          try {
            promise = audio.play();
          } catch (error) {
            fallback(error);
            return;
          }
          if (promise && typeof promise.catch === "function") {
            promise.catch((error) => {
              if (isAlive() && !started) fallback(error);
            });
          }
        })
        .catch((error) => fallback(error));
    }

    audio.onplaying = () => {
      if (!isAlive()) return;
      started = true;
      // 播放卡住（引擎不再前进）时兜底收尾，避免朗读按钮一直亮着。
      const chunk = chunks[cursor] || "";
      armTimer(Math.min(180000, 12000 + chunk.length * 150), finish);
    };
    audio.onended = () => {
      if (!isAlive()) return;
      cursor += 1;
      if (cursor >= chunks.length) {
        finish();
        return;
      }
      loadChunk();
    };
    audio.onerror = () => {
      if (isAlive()) fallback(new Error("online-speech-error"));
    };
    loadChunk();
    return true;
  }

  function speakWithBrowser(text, language, rate, trigger, wordId = "") {
    if (
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      announceSpeechFailure(language);
      return false;
    }

    const synth = window.speechSynthesis;
    const id = `web:${++speechRequestSerial}:${wordId || ""}`;
    // 浏览器语音必须用完整地区码（fr-FR），只传 "fr" 时部分 WebView 会退回默认英语。
    const targetLocale = speechLocaleFor(language);
    let utterance;
    try {
      synth.cancel();
      utterance = new SpeechSynthesisUtterance(String(text));
      utterance.lang = targetLocale;
      utterance.rate = clampSpeechRate(rate);
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = pickBrowserVoice(synth, targetLocale);
      if (voice) utterance.voice = voice;
      // 没有目标语言语音时宁可提示安装，也不要用默认英语把法/德/西语读成英语。
      if (!voice && (synth.getVoices?.() || []).length) {
        announceSpeechFailure(language, "language-unavailable");
        return false;
      }
    } catch (error) {
      console.warn("Speech synthesis setup failed.", error);
      announceSpeechFailure(language);
      return false;
    }

    const request = {
      id,
      language,
      trigger: trigger || null,
      safetyMs: speechSafetyDelay(text),
    };
    activeSpeechRequest = request;
    markSpeakingTrigger(request.trigger);
    armSpeechSafety(request);

    utterance.onstart = () => {
      if (activeSpeechRequest?.id === id) {
        request.trigger?.classList.add("is-speaking");
      }
    };
    utterance.onend = () => finishSpeechRequest(id);
    utterance.onerror = (event) => {
      if (activeSpeechRequest?.id !== id) return;
      finishSpeechRequest(id);
      const code = String(event?.error || "");
      if (!["canceled", "interrupted"].includes(code)) {
        announceSpeechFailure(language, code);
      }
    };

    try {
      synth.speak(utterance);
      return true;
    } catch (error) {
      console.warn("Speech playback failed.", error);
      finishSpeechRequest(id);
      announceSpeechFailure(language);
      return false;
    }
  }

  function androidSpeechStatus() {
    try {
      return Number(window.AndroidBridge.getSpeechStatus?.() ?? 1);
    } catch (error) {
      return -1;
    }
  }

  function speakViaAndroid(text, language, rate, wordId, trigger) {
    const bridge = window.AndroidBridge;
    if (!bridge || typeof bridge.speak !== "function") return false;
    const status = androidSpeechStatus();
    if (status < 0) {
      // 桥接调用异常时让上层继续尝试 Web Speech，避免手机端彻底没声音。
      console.warn("Android speech bridge unavailable, falling back to browser speech.");
      return false;
    }

    let utteranceId = "";
    // 统一成完整地区码，避免原生把只带语言码的句子交给默认英语音色。
    const speechLocale = speechLocaleFor(language);
    try {
      if (typeof bridge.speakWord === "function") {
        utteranceId = String(
          bridge.speakWord(String(text), speechLocale, clampSpeechRate(rate), wordId || "") ||
            "",
        );
      } else {
        bridge.speak(String(text), speechLocale, clampSpeechRate(rate));
      }
    } catch (error) {
      console.warn("Android speech bridge failed.", error);
      return false;
    }

    const id = utteranceId || `android:${++speechRequestSerial}:${wordId || ""}`;
    const request = {
      id,
      language: speechLocale,
      trigger: trigger || null,
      // 初始化未完成时原生会保留最后一次请求，等引擎可用后自动播放。
      safetyMs: status === 0 ? 8000 : speechSafetyDelay(text),
    };
    activeSpeechRequest = request;
    markSpeakingTrigger(request.trigger);
    armSpeechSafety(request);
    if (status === 0) {
      showToast("系统语音正在准备，完成后会自动朗读。");
    }
    return true;
  }

  function audioLanguageFor(language) {
    const value = String(language || "").toLowerCase();
    if (value.startsWith("zh-hk") || value.startsWith("yue")) return "yue";
    return value.slice(0, 2);
  }

  function tryOfflineWordAudio(text, language, trigger = null) {
    const pack = window.CikeWordAudio;
    const code = audioLanguageFor(language);
    // 英语离线包是美音；用户明确选英音时改走英音在线发音，避免口音被悄悄改掉。
    if (code === "en" && state.settings.accent === "en-GB") return false;
    if (!pack?.has?.(text, code)) return false;
    stopSpeech();
    return Boolean(
      pack.playWord(String(text).trim(), code, trigger, () => {
        const rate = clampSpeechRate(state.settings.voiceRate);
        const systemFallback = () => {
          if (speakViaAndroid(text, language, rate, "", trigger)) return;
          speakWithBrowser(text, language, rate, trigger, "");
        };
        // 离线文件损坏或解码失败时，仍先试在线语音，最后才退到系统语音。
        if (speakViaOnline(text, language, trigger, systemFallback)) return;
        systemFallback();
      }),
    );
  }

  function speak(wordId, trigger = null) {
    const word = wordById.get(wordId) || session?.queue[session.index]?.word;
    if (!word) return;
    const language = speechLocaleFor(word.language);
    const rate = clampSpeechRate(state.settings.voiceRate);
    const id = word.id || wordId || "";
    if (tryOfflineWordAudio(word.word, word.language || language, trigger)) return;
    const fallback = () => {
      if (speakViaAndroid(word.word, language, rate, id, trigger)) return;
      speakWithBrowser(word.word, language, rate, trigger, id);
    };
    if (speakViaOnline(word.word, language, trigger, fallback)) return;
    fallback();
  }

  function tryOfflineSentenceAudio(text, language, trigger = null) {
    const pack = window.CikeWordAudio;
    const value = String(text || "").trim();
    const code = audioLanguageFor(language);
    if (code === "en" && state.settings.accent === "en-GB") return false;
    if (!value || !pack?.hasSentence?.(value, code)) return false;
    stopSpeech();
    return Boolean(
      pack.playSentence(value, code, trigger, () => {
        const rate = clampSpeechRate(state.settings.voiceRate);
        const systemFallback = () => {
          if (speakViaAndroid(value, language, rate, "", trigger)) return;
          speakWithBrowser(value, language, rate, trigger, "");
        };
        if (speakViaOnline(value, language, trigger, systemFallback)) return;
        systemFallback();
      }),
    );
  }

  // 法/德/西/意/拉没有整句离线包时，用已收录的单词音频逐词拼读整句。
  const SENTENCE_SEQUENCE_LANGS = new Set(["fr", "de", "es", "it", "la"]);

  function offlineSentenceTokens(text, code) {
    const pack = window.CikeWordAudio;
    if (!pack?.has) return [];
    const chunks = String(text || "")
      .replace(/[’‘]/g, "'")
      .split(/\s+/)
      .map((part) =>
        part.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""),
      )
      .filter(Boolean);
    const tokens = [];
    for (const chunk of chunks) {
      if (pack.has(chunk, code)) {
        tokens.push(chunk);
        continue;
      }
      // 法语省音：d'avoir → avoir，l'homme → homme。
      const afterApostrophe = chunk.split("'").filter(Boolean);
      if (afterApostrophe.length > 1) {
        const tail = afterApostrophe[afterApostrophe.length - 1];
        if (pack.has(tail, code)) {
          tokens.push(tail);
          continue;
        }
      }
      // 连字符复合词：peut-être → peut + être。
      const hyphenParts = chunk.split("-").filter(Boolean);
      if (
        hyphenParts.length > 1 &&
        hyphenParts.every((part) => pack.has(part, code))
      ) {
        tokens.push(...hyphenParts);
      }
    }
    return tokens;
  }

  function tryOfflineWordSentenceAudio(text, language, trigger = null) {
    const pack = window.CikeWordAudio;
    const value = String(text || "").trim();
    const code = audioLanguageFor(language);
    if (!value || !SENTENCE_SEQUENCE_LANGS.has(code) || !pack?.playSequence) {
      return false;
    }
    if (code === "en" && state.settings.accent === "en-GB") return false;
    const expected = value.split(/\s+/).filter(Boolean).length;
    const tokens = offlineSentenceTokens(value, code);
    if (tokens.length < 2 || tokens.length / Math.max(1, expected) < 0.6) {
      return false;
    }
    stopSpeech();
    const rate = clampSpeechRate(state.settings.voiceRate);
    const systemFallback = () => {
      if (speakViaAndroid(value, language, rate, "", trigger)) return;
      speakWithBrowser(value, language, rate, trigger, "");
    };
    return Boolean(
      pack.playSequence(
        tokens,
        code,
        trigger,
        () => {
          if (speakViaOnline(value, language, trigger, systemFallback)) return;
          systemFallback();
        },
        null,
      ),
    );
  }

  function speakText(text, language = "en-US", trigger = null) {
    const value = String(text || "").trim();
    if (!value) return;
    const rate = clampSpeechRate(state.settings.voiceRate);
    if (tryOfflineSentenceAudio(value, language, trigger)) return;
    if (tryOfflineWordSentenceAudio(value, language, trigger)) return;
    if (tryOfflineWordAudio(value, language, trigger)) return;
    const fallback = () => {
      if (speakViaAndroid(value, language, rate, "", trigger)) return;
      speakWithBrowser(value, language, rate, trigger, "");
    };
    if (speakViaOnline(value, language, trigger, fallback)) return;
    fallback();
  }

  function toggleMastered(wordId) {
    const word = wordById.get(wordId);
    if (!word) return;
    const current = state.progress[wordId];
    if (current?.status === "mastered") {
      state.progress[wordId] = {
        ...current,
        status: "learning",
        interval: 1,
        due: Date.now() + core.DAY_MS,
      };
      showToast(`“${word.word}”已恢复复习。`);
    } else {
      state.progress[wordId] = core.markMastered(current);
      showToast(`“${word.word}”已标记为掌握。`);
    }
    saveState();
    render();
  }

  function setTag(tag) {
    selectedTag = tag;
    libraryPage = 1;
    render();
  }

  function clearFilters() {
    selectedTag = "all";
    selectedUnit = "";
    libraryStatus = "all";
    libraryQuery = "";
    searchInput.value = "";
    libraryPage = 1;
    render();
  }

  function openUnit(unit) {
    selectedUnit = String(unit);
    selectedTag = "all";
    libraryStatus = "all";
    libraryPage = 1;
    currentView = "library";
    render();
  }

  async function exportProgress(full = false) {
    if (!full) {
      const payload = {
        app: "cike-cet6",
        version: 2,
        exportedAt: new Date().toISOString(),
        deckCount: words.length,
        state,
      };
      const filename = `词刻基础备份-${todayKey()}.json`;
      downloadJson(payload, filename);
      recordBackupExport(
        filename,
        new Blob([JSON.stringify(payload)]).size,
        "json",
      );
      if (currentView === "backup") renderBackupPage();
      playSound("backup");
      showToast("基础学习备份已导出。");
      return;
    }
    if (!window.JSZip || !window.CikeDB) {
      showToast("完整备份组件不可用。");
      return;
    }
    const zip = new window.JSZip();
    const books = await window.CikeDB.getAllBooks();
    const manifest = {
      format: "cike-full-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      databaseVersion: 1,
      state,
      files: [],
    };
    const pushFile = async (bookId, filename, data, metadata, role) => {
      const digest = await crypto.subtle.digest("SHA-256", data);
      const hash = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      zip.file(filename, data);
      manifest.files.push({
        bookId,
        filename,
        bytes: data.byteLength,
        sha256: hash,
        metadata,
        role,
      });
    };
    for (const book of books) {
      const metadata = { ...book };
      const entries = [];
      const collect = (key, suffix) => {
        const blob = book[key];
        if (!(blob instanceof Blob)) return;
        entries.push({
          key,
          filename: `files/${book.id}.${suffix}`,
          data: blob.arrayBuffer(),
        });
        delete metadata[key];
      };
      collect("pdfData", "pdf");
      collect("imageData", "image");
      collect("coverData", "cover");
      if (!entries.length) {
        entries.push({
          key: "json",
          filename: `files/${book.id}.json`,
          data: Promise.resolve(
            new TextEncoder().encode(JSON.stringify(book)).buffer,
          ),
        });
      }
      for (const entry of entries) {
        await pushFile(
          book.id,
          entry.filename,
          await entry.data,
          metadata,
          entry.key,
        );
      }
    }
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const filename = `词刻完整备份-${todayKey()}.zip`;
    downloadBlob(blob, filename);
    recordBackupExport(filename, blob.size, "zip");
    if (currentView === "backup") renderBackupPage();
    playSound("backup");
    showToast("完整备份已导出。");
  }

  function exportMistakes() {
    const rows = [
      ["单词", "释义", "错误次数", "正确次数", "分类"],
      ...mistakeWords().map((word) => {
        const item = state.progress[word.id];
        return [
          word.word,
          word.meaning,
          item.wrong,
          item.correct,
          word.category,
        ];
      }),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `词刻CET6-错词-${todayKey()}.csv`);
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    if (window.AndroidBridge?.saveFile) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result || "").split(",")[1] || "";
        window.AndroidBridge.saveFile(
          filename,
          blob.type || "application/octet-stream",
          base64,
        );
      };
      reader.onerror = () => showToast("导出文件读取失败。");
      reader.readAsDataURL(blob);
      return;
    }
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importProgress(file, options = {}) {
    try {
      if (
        file.name.toLowerCase().endsWith(".zip") ||
        file.type === "application/zip"
      ) {
        await importFullBackup(file, options);
        return;
      }
      const text = await file.text();
      const payload = JSON.parse(text);
      const imported = payload?.state || payload;
      if (!imported || typeof imported !== "object" || !imported.progress) {
        throw new Error("Invalid backup shape.");
      }
      for (const id of Object.keys(imported.progress)) {
        if (!id.startsWith("tw:") && !allWordById.has(id)) {
          delete imported.progress[id];
        }
      }
      state = mergeState(defaultState, imported);
      applyWordbookTitles();
      saveState();
      populateSettings();
      render();
      playSound("backup");
      showToast("学习备份已恢复。");
    } catch (error) {
      console.error(error);
      showToast("导入失败：请选择词刻导出的 JSON 备份。");
    }
  }

  async function importFullBackup(file, options = {}) {
    if (!window.JSZip || !window.CikeDB) {
      throw new Error("完整备份组件不可用。");
    }
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("备份中没有 manifest.json。");
    const manifest = JSON.parse(await manifestFile.async("text"));
    if (manifest.format !== "cike-full-backup") {
      throw new Error("不是词刻完整备份格式。");
    }
    const groups = new Map();
    for (const entry of manifest.files || []) {
      const item = zip.file(entry.filename);
      if (!item) throw new Error(`备份缺少文件：${entry.filename}`);
      const data = await item.async("arraybuffer");
      const digest = await crypto.subtle.digest("SHA-256", data);
      const hash = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (hash !== entry.sha256) {
        throw new Error(`文件校验失败：${entry.filename}`);
      }
      const groupId =
        entry.bookId || entry.metadata?.id || entry.filename;
      let group = groups.get(groupId);
      if (!group) {
        group = { metadata: entry.metadata || {}, blobs: {}, json: null };
        groups.set(groupId, group);
      }
      if (entry.filename.endsWith(".json")) {
        group.json = JSON.parse(new TextDecoder().decode(data));
      } else if (
        entry.role === "pdfData" ||
        (!entry.role &&
          (entry.filename.endsWith(".pdf") ||
            group.metadata.kind === "pdf"))
      ) {
        group.blobs.pdfData = new Blob([data], { type: "application/pdf" });
      } else if (
        entry.role === "coverData" ||
        (!entry.role && entry.filename.endsWith(".cover"))
      ) {
        group.blobs.coverData = new Blob([data], { type: "image/jpeg" });
      } else {
        group.blobs.imageData = new Blob([data]);
      }
    }
    const restored = [...groups.values()].map((group) =>
      group.json
        ? { ...group.json, ...group.blobs }
        : { ...group.metadata, ...group.blobs },
    );
    const replace =
      options.mode === "replace"
        ? true
        : options.mode === "merge"
          ? false
          : window.confirm(
              "完整备份校验通过。点击“确定”替换全部本地数据；点击“取消”则将备份合并到当前数据。",
            );
    let importedState = mergeState(defaultState, manifest.state || {});
    if (!replace) {
      importedState = mergeState(state, importedState);
      for (const [key, value] of Object.entries(state.progress || {})) {
        importedState.progress[key] = importedState.progress[key] || value;
      }
      restored.push(
        ...userBooksCache.filter(
          (book) => !restored.some((item) => item.id === book.id),
        ),
      );
    } else {
      const existing = await window.CikeDB.getAllBooks();
      for (const book of existing) await window.CikeDB.deleteBook(book.id);
    }
    readerCoverUrls.forEach((url) => URL.revokeObjectURL(url));
    readerCoverUrls.clear();
    readerImageUrls.forEach((url) => URL.revokeObjectURL(url));
    readerImageUrls.clear();
    for (const book of restored) await window.CikeDB.putBook(book);
    userBooksCache = restored;
    importedState.userBooks = restored.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      language: book.language,
      type: book.type,
      source: book.source,
      importedAt: book.importedAt,
      pageCount: book.pages?.length || 0,
    }));
    state = importedState;
    saveState();
    populateSettings();
    render();
    playSound("backup");
    showToast(replace ? "完整备份已替换恢复。" : "完整备份已合并恢复。");
    window.setTimeout(() => backfillBookCovers(), 400);
  }

  function musicVolumeValue() {
    const raw = Number(state.settings?.musicVolume);
    return Number.isFinite(raw) ? clamp(raw, 0, 1) : 0.35;
  }

  function applyBgmSettings({ autoplay = false } = {}) {
    const bgm = window.CikeBgm;
    if (!bgm) return;
    bgm.setVolume(musicVolumeValue());
    const trackId = String(state.settings?.bgmTrack || "");
    if (!trackId) {
      bgm.stop();
      return;
    }
    if (autoplay && !state.settings.bgmPaused) bgm.play(trackId);
    else bgm.setTrack(trackId);
  }

  function syncBgmUi() {
    const bgm = window.CikeBgm;
    if (!bgm) return;
    const info = bgm.getState();
    const selected = String(state.settings?.bgmTrack || "");
    document.querySelectorAll("[data-bgm-track]").forEach((chip) => {
      const active = String(chip.dataset.bgmTrack || "") === selected;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const card = document.querySelector("[data-bgm-widget]");
    if (!card) return;
    card.classList.toggle("is-playing", info.playing);
    const disc = card.querySelector(".home-bgm-disc");
    if (disc) {
      const current = (bgm.tracks || []).find((track) => track.id === selected) || null;
      disc.setAttribute(
        "aria-label",
        `${info.playing ? "暂停" : "播放"}背景音乐${current ? `（${current.title}）` : ""}`,
      );
    }
  }

  function closeBgmList() {
    const list = document.querySelector("[data-bgm-list]");
    if (!list || list.hasAttribute("hidden")) return;
    list.setAttribute("hidden", "");
    document
      .querySelector('[data-action="bgm-list-toggle"]')
      ?.setAttribute("aria-expanded", "false");
  }

  const PROFILE_FRAMES = ["tape", "ink", "film", "none"];

  function profileFrameClass(frame) {
    const id = PROFILE_FRAMES.includes(String(frame)) ? String(frame) : "tape";
    return `is-frame-${id}`;
  }

  function renderProfileDraft() {
    if (!profileDraft) return;
    if (settingsAvatarPreview) {
      settingsAvatarPreview.className = `avatar-editor-preview ${profileFrameClass(profileDraft.frame)}`;
      settingsAvatarPreview.innerHTML = profileDraft.avatar
        ? `<img src="${esc(profileDraft.avatar)}" alt="头像预览">`
        : `<span class="avatar-editor-initial">${esc((profileDraft.name || "词").slice(0, 1))}</span>`;
    }
    if (settingsAvatarFrame) settingsAvatarFrame.value = profileDraft.frame;
    if (profileNameInput) profileNameInput.value = profileDraft.name;
    if (profileTagInput) profileTagInput.value = profileDraft.tag;
    if (profileNoteInput) profileNoteInput.value = profileDraft.note;
  }

  // 手机拍照原图动辄几 MB，localStorage 装不下；统一缩到 512px JPEG。
  function readAvatarFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("头像读取失败，请换一张图片。"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("这张图片无法识别，请换一张。"));
        image.onload = () => {
          const limit = 512;
          const ratio = Math.min(1, limit / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * ratio));
          canvas.height = Math.max(1, Math.round(image.height * ratio));
          canvas
            .getContext("2d")
            .drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        image.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleSettingsAvatarFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !profileDraft) return;
    try {
      const data = await readAvatarFile(file);
      if (!profileDraft) return;
      profileDraft.avatar = data;
      renderProfileDraft();
      showToast("头像已选好，点“保存设置”后生效。");
    } catch (error) {
      showToast(error.message || "头像读取失败。");
    }
  }

  function aiSettings() {
    const raw = state.settings.ai || {};
    const provider = ["doubao", "deepseek", "kimi", "custom"].includes(
      raw.provider,
    )
      ? raw.provider
      : "doubao";
    const fallback = window.CikeAI?.defaults(provider) || {
      model: "",
      baseUrl: "",
    };
    return {
      enabled: raw.enabled !== false,
      provider,
      model: String(raw.model || fallback.model || ""),
      baseUrl: String(raw.baseUrl || fallback.baseUrl || ""),
      tasks: {
        define: raw.tasks?.define !== false,
        translate: raw.tasks?.translate !== false,
        allusion: raw.tasks?.allusion !== false,
        comic: raw.tasks?.comic !== false,
        grade: raw.tasks?.grade !== false,
      },
    };
  }

  function syncAIConfig() {
    const ai = aiSettings();
    window.CikeAI?.configure(ai);
    return ai;
  }

  function aiReady(task) {
    return Boolean(window.CikeAI?.can(task));
  }

  function aiLanguageLabel(lang) {
    const labels = {
      en: "英语",
      fr: "法语",
      de: "德语",
      es: "西班牙语",
      it: "意大利语",
      ja: "日语",
      yue: "粤语",
      la: "拉丁语",
      zh: "中文",
    };
    return labels[lang] || String(lang || "en").toUpperCase();
  }

  function refreshAIKeyHint() {
    if (!aiKeyHint) return;
    const provider = aiProviderSelect?.value || aiSettings().provider;
    const hasKey = window.CikeAI?.hasKey(provider);
    const storage = window.CikeAI?.keyStorageLabel?.() || "本机";
    const network = window.AndroidBridge?.aiChat
      ? "手机端联网：系统网络桥 HTTPS 直连已就绪"
      : navigator.onLine
        ? "联网：浏览器直连"
        : "当前离线，仅本地词典与规则可用";
    aiKeyHint.textContent = hasKey
      ? `${network} · 已保存到${storage}；输入新 Key 可替换。`
      : `${network} · Key 会写入${storage}，不进入备份。`;
  }

  async function refreshAICacheHint() {
    if (!aiCacheHint) return;
    const stats = await window.CikeAI?.cacheStats();
    if (!stats) return;
    const kb = Math.max(0, Math.round(stats.bytes / 1024));
    aiCacheHint.textContent = `本机缓存 ${stats.count} 条 · 约 ${formatNumber(kb)} KB；导出的缓存包可直接分享给朋友。`;
  }

  function populateSettings() {
    dailyGoalInput.value = String(dailyGoalValue());
    accentSelect.value = state.settings.accent;
    voiceRateInput.value = String(state.settings.voiceRate);
    voiceRateOutput.textContent = `${Number(state.settings.voiceRate).toFixed(2)}×`;
    musicVolumeInput.value = String(Math.round(musicVolumeValue() * 100));
    musicVolumeOutput.textContent = `${Math.round(musicVolumeValue() * 100)}%`;
    themeSelect.value = state.settings.theme;
    soundEnabledInput.checked = state.settings.soundEnabled;
    window.CikeSound?.setEnabled(state.settings.soundEnabled);
    window.CikeBgm?.setVolume(musicVolumeValue());
    const ai = syncAIConfig();
    if (aiProviderSelect && !aiProviderSelect.options.length) {
      aiProviderSelect.innerHTML = (window.CikeAI?.providers?.() || [])
        .map(
          (item) =>
            `<option value="${esc(item.id)}">${esc(item.label)}</option>`,
        )
        .join("");
    }
    if (aiEnabledInput) aiEnabledInput.checked = ai.enabled;
    if (aiProviderSelect) aiProviderSelect.value = ai.provider;
    if (aiModelInput) aiModelInput.value = ai.model;
    if (aiBaseUrlInput) aiBaseUrlInput.value = ai.baseUrl;
    if (aiTaskDefine) aiTaskDefine.checked = ai.tasks.define;
    if (aiTaskTranslate) aiTaskTranslate.checked = ai.tasks.translate;
    if (aiTaskAllusion) aiTaskAllusion.checked = ai.tasks.allusion;
    if (aiTaskComic) aiTaskComic.checked = ai.tasks.comic;
    if (aiTaskGrade) aiTaskGrade.checked = ai.tasks.grade;
    refreshAIKeyHint();
    refreshAICacheHint();
    const ocrServiceInput = document.getElementById("ocrServiceInput");
    if (ocrServiceInput) {
      ocrServiceInput.value = String(state.settings.ocrServiceUrl || "");
    }
    profileDraft = {
      avatar: String(state.profile.avatar || ""),
      frame: String(state.profile.frame || "tape"),
      name: String(state.profile.name || ""),
      tag: String(state.profile.tag || ""),
      note: String(state.notes.profile || ""),
    };
    renderProfileDraft();
  }

  function bindEvents() {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const open = document.querySelector("[data-bgm-list]:not([hidden])");
        if (!open || event.target.closest("[data-bgm-widget]")) return;
        closeBgmList();
      },
      true,
    );
    // 原画加载失败（离线包缺失、解码不支持）时退回本地圆章，避免出现空贴纸。
    document.addEventListener(
      "error",
      (event) => {
        const image = event.target;
        if (image instanceof HTMLImageElement && image.classList.contains("sticker-art")) {
          image.closest(".sticker-badge")?.classList.add("art-failed");
        }
      },
      true,
    );
    window.addEventListener("cike:speech-status", (event) => {
      const detail = event.detail || {};
      const id = String(detail.utteranceId || "");
      const state = String(detail.state || "");
      const code = String(detail.code || "");
      const current = activeSpeechRequest;
      if (current && id && current.id !== id) return;
      if (state === "started") {
        if (current && (!id || current.id === id)) {
          current.trigger?.classList.add("is-speaking");
        }
        return;
      }
      if (state === "done") {
        finishSpeechRequest(id || current?.id || "");
        return;
      }
      if (state === "error") {
        finishSpeechRequest(id || current?.id || "");
        if (!["canceled", "interrupted"].includes(code)) {
          announceSpeechFailure(detail.language || current?.language || "en-US", code);
        }
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (renderReader.openedAt) pauseReadingClock();
        if (renderReader.openedAt) flushReadingTime();
        flushState();
        return;
      }
      if (currentView === "books" && state.reader.activeBookId) {
        renderReader();
      }
    });
    window.addEventListener("pagehide", () => {
      if (renderReader.openedAt) flushReadingTime();
      flushState();
    });

    main.addEventListener(
      "touchstart",
      (event) => {
        if (currentView !== "books" || !state.reader.activeBookId) return;
        if (event.touches.length !== 1) {
          readerSwipe = null;
          return;
        }
        if (
          event.target.closest(
            "button,a,input,textarea,select,summary,label,.reader-drawer",
          )
        ) {
          readerSwipe = null;
          return;
        }
        const touch = event.touches[0];
        readerSwipe = { x: touch.clientX, y: touch.clientY, at: Date.now() };
      },
      { passive: true },
    );

    main.addEventListener(
      "touchend",
      (event) => {
        if (!readerSwipe) return;
        const gesture = readerSwipe;
        readerSwipe = null;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - gesture.x;
        const dy = touch.clientY - gesture.y;
        if (Date.now() - gesture.at > 900) return;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        const selection = window.getSelection();
        if (selection && String(selection).trim()) return;
        readerSuppressClickUntil = Date.now() + 450;
        turnReaderPage(dx < 0 ? 1 : -1);
      },
      { passive: true },
    );

    main.addEventListener("touchcancel", () => {
      readerSwipe = null;
    });

    main.addEventListener("pointerdown", (event) => {
      const card = event.target.closest(".reader-book-card");
      if (!card || !isManagedBook(card.dataset.bookId)) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const bookId = card.dataset.bookId;
      const startX = event.clientX;
      const startY = event.clientY;
      clearTimeout(bookLongPressTimer);
      const cancel = (moveEvent) => {
        if (
          moveEvent.type === "pointermove" &&
          Math.abs(moveEvent.clientX - startX) < 8 &&
          Math.abs(moveEvent.clientY - startY) < 8
        ) {
          return;
        }
        clearTimeout(bookLongPressTimer);
        bookLongPressTimer = 0;
        card.removeEventListener("pointermove", cancel);
        card.removeEventListener("pointerup", cancel);
        card.removeEventListener("pointercancel", cancel);
        card.removeEventListener("pointerleave", cancel);
      };
      bookLongPressTimer = window.setTimeout(() => {
        bookLongPressTimer = 0;
        bookLongPressUntil = Date.now() + 800;
        cancel({ type: "timeout" });
        openBookAdmin(bookId);
      }, 550);
      card.addEventListener("pointermove", cancel);
      card.addEventListener("pointerup", cancel);
      card.addEventListener("pointercancel", cancel);
      card.addEventListener("pointerleave", cancel);
    });

    main.addEventListener("contextmenu", (event) => {
      const card = event.target.closest(".reader-book-card");
      if (!card || !isManagedBook(card.dataset.bookId)) return;
      event.preventDefault();
      bookLongPressUntil = Date.now() + 800;
      openBookAdmin(card.dataset.bookId);
    });

    document.addEventListener("selectionchange", () => {
      if (currentView !== "books" || !state.reader.activeBookId) return;
      if (readerDrawMode) return;
      scheduleReaderSelectionMenu();
    });

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.target.closest(
            "#readerSelectBar,#readerLookupSheet,#readerLookupScrim,#readerDrawBar,.reader-draw-canvas",
          )
        ) {
          return;
        }
        if (!String(window.getSelection?.() || "").trim()) {
          clearReaderSelection();
        }
      },
      true,
    );

    document.addEventListener("click", async (event) => {
      if (
        Date.now() < readerSuppressClickUntil &&
        event.target.closest(".reader-stage")
      ) {
        event.preventDefault();
        return;
      }
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        event.preventDefault();
        activeWordId = null;
        playSound("tab");
        setView(viewButton.dataset.view);
        return;
      }

      const paper = event.target.closest(".reader-paper");
      if (
        paper &&
        currentView === "books" &&
        state.reader.activeBookId &&
        !event.target.closest(
          "button,a,input,textarea,select,summary,[data-action]",
        ) &&
        !String(window.getSelection?.() || "").trim()
      ) {
        const rect = paper.getBoundingClientRect();
        const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
        if (ratio < 0.2) {
          turnReaderPage(-1);
          return;
        }
        if (ratio > 0.8) {
          turnReaderPage(1);
          return;
        }
      }

      const stickerButton = event.target.closest(".sticker-badge[data-sticker-id]");
      if (stickerButton) {
        event.preventDefault();
        if (!document.querySelector(".unlock-layer")) {
          const item = achievementCatalog().find(
            (entry) => entry.id === stickerButton.dataset.stickerId,
          );
          if (item) presentSticker(item, "view");
        }
        return;
      }

      const actionButton = event.target.closest("[data-action]");
      if (!actionButton) return;
      const action = actionButton.dataset.action;
      if (!actionButton.disabled) {
        playActionSound(action, actionButton);
      }

      if (action === "switch-book") {
        const returnToLibrary = currentView === "typewords";
        const beforeId = deck.meta.id;
        activateBook(actionButton.dataset.bookId);
        if (deck.meta.id === beforeId) return;
        currentView = returnToLibrary ? "library" : "home";
        render();
        showToast(`已切换到《${deck.meta.title}》`);
      } else if (action === "open-typewords") {
        currentView = "typewords";
        typewordsQuery = "";
        render();
        main.scrollIntoView({ block: "start", behavior: "instant" });
      } else if (action === "back-library") {
        currentView = "library";
        render();
        main.scrollIntoView({ block: "start", behavior: "instant" });
      } else if (action === "set-typewords-category") {
        typewordsCategory = actionButton.dataset.category || "全部";
        languageLibraryGroup = "all";
        render();
      } else if (action === "set-language-group") {
        languageLibraryGroup = actionButton.dataset.group || "all";
        render();
      } else if (action === "pick-mode") {
        selectedMode = actionButton.dataset.mode;
        render();
      } else if (action === "start-session" || action === "quick-start") {
        startSession({
          mode: actionButton.dataset.mode || selectedMode,
          focus: actionButton.dataset.focus || "today",
        });
      } else if (action === "start-all") {
        startSession({
          mode: actionButton.dataset.mode || selectedMode,
          focus: actionButton.dataset.focus || "today",
          all: true,
        });
      } else if (action === "start-mistakes") {
        startSession({ mode: "mixed", focus: "review", tag: "all", all: true });
      } else if (action === "show-word") {
        activeWordId = actionButton.dataset.wordId;
        currentView = "library";
        render();
        main.scrollIntoView({ block: "start", behavior: "instant" });
      } else if (action === "close-word") {
        stopSpeech();
        activeWordId = null;
        render();
      } else if (action === "speak") {
        event.preventDefault();
        event.stopPropagation();
        speak(actionButton.dataset.wordId, actionButton);
      } else if (action === "speak-quote") {
        event.preventDefault();
        event.stopPropagation();
        const quoteWord = wordById.get(actionButton.dataset.wordId);
        if (quoteWord?.example) {
          const quoteLanguage = quoteWord.language || deck?.meta?.language || "en-US";
          speakText(quoteWord.example, quoteLanguage, actionButton);
        } else if (quoteWord) {
          speak(quoteWord.id, actionButton);
        }
      } else if (action === "study-word") {
        const word = wordById.get(actionButton.dataset.wordId);
        if (word) startSession({ mode: "write", queue: [word], focus: "today" });
      } else if (action === "toggle-mastered") {
        toggleMastered(actionButton.dataset.wordId);
      } else if (action === "set-tag") {
        setTag(actionButton.dataset.tag);
      } else if (action === "clear-filters") {
        clearFilters();
      } else if (action === "page-prev") {
        libraryPage = Math.max(1, libraryPage - 1);
        render();
      } else if (action === "page-next") {
        libraryPage += 1;
        render();
      } else if (action === "open-unit") {
        openUnit(actionButton.dataset.unit);
      } else if (action === "export-mistakes") {
        exportMistakes();
      } else if (action === "type-letter") {
        typeListenLetter(actionButton.dataset.letter);
      } else if (action === "listen-backspace") {
        if (!session || session.answerState) return;
        session.listenDraft = String(session.listenDraft || "").slice(0, -1);
        renderStudy();
      } else if (action === "listen-clear") {
        if (!session || session.answerState) return;
        session.listenDraft = "";
        renderStudy();
      } else if (action === "listen-check") {
        checkListenAnswer();
      } else if (action === "reveal") {
        session.revealed = true;
        render();
      } else if (action === "grade") {
        gradeRecognize(actionButton.dataset.grade);
      } else if (action === "next-question") {
        nextQuestion();
      } else if (action === "exit-study") {
        session = null;
        currentView = "home";
        render();
      } else if (action === "go-home") {
        session = null;
        currentView = "home";
        render();
      } else if (action === "review-session-wrong") {
        const wrongWords = session.results
          .filter((result) => !result.correct)
          .map((result) => wordById.get(result.wordId))
          .filter(Boolean);
        if (wrongWords.length) startSession({ mode: "mixed", queue: wrongWords, focus: "review" });
      } else if (action === "back") {
        goBack();
      } else if (action === "continue-writing") {
        if (state.writing.practice?.active) {
          currentView = "writing-practice";
          render();
          window.scrollTo({ top: 0, behavior: "instant" });
        } else {
          currentView = "corpus";
          render();
        }
      } else if (action === "open-writing-home") {
        currentView = "corpus";
        render();
      } else if (action === "open-essay") {
        examActive = { kind: "essay", id: actionButton.dataset.id };
        currentView = "essay-practice";
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "open-translation") {
        examActive = { kind: "translation", id: actionButton.dataset.id };
        currentView = "trans-practice";
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "submit-essay") {
        const draft = examEnsure("essay", examActive?.id);
        if (!String(draft.text || "").trim()) {
          showToast("先写一点内容再提交。");
          return;
        }
        draft.submitted = true;
        stopExamTimer();
        saveState();
        render();
      } else if (action === "submit-translation") {
        const draft = examEnsure("translation", examActive?.id);
        if (!String(draft.text || "").trim()) {
          showToast("先写一点内容再提交。");
          return;
        }
        draft.submitted = true;
        stopExamTimer();
        saveState();
        render();
      } else if (action === "retry-essay") {
        const draft = examEnsure("essay", examActive?.id);
        draft.text = "";
        draft.seconds = 0;
        draft.submitted = false;
        draft.aiGradeKey = "";
        saveState();
        render();
      } else if (action === "retry-translation") {
        const draft = examEnsure("translation", examActive?.id);
        draft.text = "";
        draft.seconds = 0;
        draft.submitted = false;
        draft.aiGradeKey = "";
        saveState();
        render();
      } else if (action === "clear-essay") {
        if (!window.confirm("清空这篇作文的草稿？")) return;
        const draft = examEnsure("essay", examActive?.id);
        if (draft.submitted) return;
        draft.text = "";
        saveState();
        render();
      } else if (action === "clear-translation") {
        if (!window.confirm("清空这段译文？")) return;
        const draft = examEnsure("translation", examActive?.id);
        if (draft.submitted) return;
        draft.text = "";
        saveState();
        render();
      } else if (action === "listen-start") {
        startListeningPaper(
          actionButton.dataset.paperId,
          actionButton.dataset.section || "all",
        );
      } else if (action === "listen-restart") {
        const paperId = actionButton.dataset.paperId;
        if (!window.confirm("重新开始这套题？当前的选择会被清空。")) return;
        startListeningPaper(paperId, "all", { fresh: true });
      } else if (action === "listen-view-result") {
        openListeningResult(actionButton.dataset.paperId);
      } else if (action === "listen-analysis-open") {
        openListeningAnalysis(actionButton.dataset.paperId);
      } else if (action === "analysis-open") {
        openWritingAnalysis(actionButton.dataset.kind, actionButton.dataset.id);
      } else if (action === "analysis-prev") {
        analysisGo(analysisState.page - 1);
      } else if (action === "analysis-next") {
        analysisGo(analysisState.page + 1);
      } else if (action === "analysis-zoom") {
        toggleAnalysisZoom();
      } else if (action === "listen-home") {
        listenSession = null;
        stopListenAudio();
        currentView = "listening-home";
        render();
      } else if (action === "listen-select") {
        selectListenOption(actionButton.dataset.letter);
      } else if (action === "listen-next") {
        if (!listenSession) return;
        const question = listenSession.questions[listenSession.index];
        if (!listenSession.answers[question.n]) return;
        goListen(listenSession.index + 1);
      } else if (action === "listen-prev") {
        goListen((listenSession?.index || 0) - 1);
      } else if (action === "listen-jump") {
        goListen(Number(actionButton.dataset.index || 0));
      } else if (action === "listen-card") {
        if (!listenSession) return;
        listenSession.cardOpen = !listenSession.cardOpen;
        render();
      } else if (action === "listen-submit") {
        submitListeningPaper();
      } else if (action === "listen-toggle") {
        toggleListenAudio();
      } else if (action === "listen-replay") {
        replayListenQuestion();
      } else if (action === "listen-rate") {
        setListenRate(Number(actionButton.dataset.rate || 1));
      } else if (action === "listen-replay-paper") {
        startListeningPaper(actionButton.dataset.paperId, "all", { fresh: true });
      } else if (action === "listen-pick-audio") {
        document.getElementById("listenAudioInput")?.click();
      } else if (action === "listen-pick-questions") {
        document.getElementById("listenQuestionInput")?.click();
      } else if (action === "listen-save-audio") {
        if (!listenImportDraft?.audio?.length) return;
        actionButton.disabled = true;
        let saved = 0;
        for (const row of listenImportDraft.audio) {
          if (!row.paperId || !row.file) continue;
          await window.CikeDB.putAudio(row.paperId, row.file, {
            name: row.name,
            size: row.size,
            importedAt: Date.now(),
          });
          saved += 1;
        }
        listenImportDraft.audio = [];
        showToast(`已保存 ${saved} 个音频到本地。`);
        await refreshListenAudio();
        renderListeningImport();
      } else if (action === "listen-preview-answers") {
        const paperId = document.getElementById("listenAnswerPaper")?.value || "";
        const text = document.getElementById("listenAnswerText")?.value || "";
        const map = parseListenAnswers(text);
        listenImportDraft = listenImportDraft || { audio: [], answers: null, paper: null };
        listenImportDraft.answerPaperId = paperId;
        listenImportDraft.answerText = text;
        listenImportDraft.answerMap = map;
        listenImportDraft.answerPreview = Array.from({ length: 25 }, (_, index) => ({
          n: index + 1,
          letter: map[index + 1] || "",
        }));
        renderListeningImport();
      } else if (action === "listen-save-answers") {
        const paperId = listenImportDraft?.answerPaperId;
        const map = listenImportDraft?.answerMap || {};
        if (!paperId || !Object.keys(map).length) {
          showToast("先预览一组可用的答案。");
          return;
        }
        state.listening.answers[paperId] = {
          ...(state.listening.answers[paperId] || {}),
          ...map,
        };
        saveState();
        listenImportDraft.answerPreview = null;
        listenImportDraft.answerMap = null;
        showToast("答案已保存。");
        renderListeningImport();
      } else if (action === "listen-save-paper") {
        const pending = listenImportDraft?.paper;
        if (!pending) return;
        const others = (state.listening.customPapers || []).filter(
          (paper) => paper.id !== pending.paper.id,
        );
        state.listening.customPapers = [...others, pending.paper];
        saveState();
        listenImportDraft.paper = null;
        showToast("题目已写入本地题库。");
        renderListeningImport();
      } else if (action === "continue-reading") {
        const book =
          readerBooks().find((item) => item.id === actionButton.dataset.bookId) ||
          readerBooks().find((item) => item.id === state.reader.activeBookId) ||
          readerBooks().find(
            (item) => state.reader.progress?.[item.id] !== undefined,
          );
        if (!book) {
          currentView = "books";
          render();
          return;
        }
        if (book.kind === "txt" || book.assetPath) {
          const finish = beginButtonTask(actionButton, "正在展开…");
          try {
            await ensureBookPages(book);
            finish("done", "已打开");
          } catch (error) {
            finish();
            showToast(`打开失败：${error.message}`);
            return;
          }
        }
        state.reader.language = book.language || "en";
        state.reader.activeBookId = book.id;
        state.reader.page = Number(state.reader.progress?.[book.id] || 0);
        startReadingClock();
        currentView = "books";
        saveState();
        render();
      } else if (action === "quote-to-review") {
        const word = wordById.get(actionButton.dataset.wordId);
        if (!word) return;
        addReviewItem({
          id: `quote:${word.id}`,
          type: "sentence",
          language: word.language || "en",
          source: deck.meta.title,
          prompt: word.example || word.word,
          answer: word.exampleZh || word.meaning,
        });
        showToast(`“${word.word}”的例句已收进智能复习。`);
      } else if (action === "set-writing-direction") {
        state.writing.setup.direction =
          actionButton.dataset.direction === "from-zh" ? "from-zh" : "to-zh";
        saveState();
        render();
      } else if (action === "toggle-writing-language") {
        const practice = state.writing.practice || {};
        if (practice.active && String(practice.input || "").trim()) {
          const confirmed = window.confirm(
            "切换语言会保留当前草稿，但会回到写译首页。继续吗？",
          );
          if (!confirmed) return;
          state.writing.practice.savedAt = Date.now();
        }
        state.writing.language = writingLanguage() === "en" ? "fr" : "en";
        state.writing.docId = "";
        state.writing.chapter = 0;
        state.writing.board = 0;
        state.writing.practice.active = false;
        saveState();
        currentView = "corpus";
        render();
      } else if (action === "select-writing-doc") {
        const doc = writingDocuments().find(
          (item) => item.id === actionButton.dataset.docId,
        );
        if (!doc) return;
        state.writing.language = doc.language || writingLanguage();
        state.writing.setup.source = doc.builtin ? "builtin" : "user";
        state.writing.setup.docId = doc.id;
        state.writing.setup.direction = "to-zh";
        state.writing.docId = doc.id;
        state.writing.chapter = 0;
        state.writing.board = 0;
        saveState();
        currentView = "writing-new";
        render();
      } else if (action === "set-writing-type") {
        state.writing.setup.type =
          actionButton.dataset.type === "paragraph" ? "paragraph" : "sentence";
        saveState();
        render();
      } else if (action === "set-writing-category") {
        const category = writingCategoryById(actionButton.dataset.categoryId);
        if (!category) return;
        state.writing.setup.categoryId = category.id;
        saveState();
        render();
      } else if (action === "set-writing-passage") {
        const passage = writingPassageById(actionButton.dataset.passageId);
        if (!passage) return;
        state.writing.setup.passageId = passage.id;
        saveState();
        render();
      } else if (action === "open-paragraph-setup") {
        state.writing.setup.type = "paragraph";
        saveState();
        currentView = "writing-new";
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "start-writing-category") {
        const category = writingCategoryById(actionButton.dataset.categoryId);
        if (!category) return;
        state.writing.setup.type = "sentence";
        state.writing.setup.categoryId = category.id;
        state.writing.setup.cursor = 0;
        state.writing.practice.active = false;
        saveState();
        startWritingPractice();
      } else if (action === "start-writing-passage") {
        const passage = writingPassageById(actionButton.dataset.passageId);
        if (!passage) return;
        state.writing.setup.type = "paragraph";
        state.writing.setup.passageId = passage.id;
        state.writing.practice.active = false;
        saveState();
        startWritingPractice();
      } else if (action === "set-writing-source") {
        const source = actionButton.dataset.source;
        state.writing.setup.source = ["book", "builtin", "user", "custom"].includes(
          source,
        )
          ? source
          : "book";
        if (state.writing.setup.source === "builtin" || state.writing.setup.source === "user") {
          state.writing.setup.direction = "to-zh";
        }
        saveState();
        render();
      } else if (action === "set-writing-doc") {
        state.writing.setup.docId = actionButton.dataset.docId || "";
        saveState();
        render();
      } else if (action === "set-writing-difficulty") {
        state.writing.setup.difficulty = ["easy", "normal", "hard"].includes(
          actionButton.dataset.difficulty,
        )
          ? actionButton.dataset.difficulty
          : "normal";
        saveState();
        render();
      } else if (action === "start-writing-practice") {
        startWritingPractice();
      } else if (action === "save-writing-setup") {
        saveState();
        showToast("这份训练设置已保存在本机。");
      } else if (action === "speak-writing-source") {
        const practice = state.writing.practice || {};
        const isPhrase = practice.kind === "phrase";
        const text = isPhrase ? practice.reference : practice.source;
        const lang = isPhrase
          ? "en-US"
          : practice.direction === "from-zh"
            ? "zh-CN"
            : "en-US";
        speakText(text || "", lang, actionButton);
      } else if (action === "writing-hint") {
        const practice = state.writing.practice || {};
        const max = setupHintCount(practice);
        if (Number(practice.hintLevel || 0) >= max) {
          showToast("这一句的提示已经全部揭开了。");
          return;
        }
        practice.hintLevel = Number(practice.hintLevel || 0) + 1;
        state.writing.session.hints = Number(state.writing.session.hints || 0) + 1;
        saveState();
        renderWritingPractice();
      } else if (action === "clear-writing-input") {
        const practice = state.writing.practice || {};
        if (!String(practice.input || "").trim()) return;
        if (!window.confirm("清空刚写下的译文？本地草稿也会一起清掉。")) return;
        practice.input = "";
        practice.savedAt = Date.now();
        saveState();
        renderWritingPractice();
      } else if (action === "submit-writing") {
        const practice = state.writing.practice || {};
        const answer = String(practice.input || "").trim();
        if (!practice.active || !answer) return;
        const evaluation =
          practice.kind === "phrase"
            ? evaluatePhrase(practice.reference, answer)
            : evaluateWriting(
                practice.source,
                answer,
                practice.reference,
                practice.direction,
              );
        const now = Date.now();
        state.writing.lastResult = {
          source: practice.source,
          answer,
          reference: practice.referenceAvailable ? practice.reference : "",
          referenceAvailable: Boolean(practice.referenceAvailable),
          sourceLabel: practice.sourceLabel,
          direction: practice.direction,
          language: practice.language,
          cursor: practice.cursor,
          mode: practice.mode,
          kind: practice.kind || "paragraph",
          itemLabel: practice.itemLabel || "",
          docId: practice.docId,
          chapter: practice.chapter,
          line: practice.line,
          hintLevel: practice.hintLevel,
          evaluation,
          submittedAt: now,
        };
        state.writing.session.count = Number(state.writing.session.count || 0) + 1;
        state.writing.session.chars =
          Number(state.writing.session.chars || 0) + answer.length;
        state.writing.session.lastAt = now;
        practice.submittedAt = now;
        practice.savedAt = now;
        if (practice.docId) {
          state.writing.progress[
            `${practice.docId}:${practice.chapter}:${practice.line}`
          ] = now;
        }
        playSound("submit");
        saveState();
        currentView = "writing-feedback";
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "run-ai-grade") {
        await runAiGrade(
          actionButton.dataset.scope || "writing",
          actionButton.dataset.kind || "",
          actionButton.dataset.id || "",
        );
        return;
      } else if (action === "ask-ai-grade") {
        askAiAboutGrade(
          actionButton.dataset.scope || "writing",
          actionButton.dataset.kind || "",
          actionButton.dataset.id || "",
        );
        return;
      } else if (action === "writing-next") {
        const practice = state.writing.practice || {};
        const fromDone = currentView === "writing-done";
        state.writing.practice.active = false;
        if (practice.kind === "paragraph") {
          const passages = writingPassages();
          if (fromDone) {
            state.writing.setup.passageId = passages[0]?.id || "";
            startWritingPractice({ keepSession: true });
            return;
          }
          const index = passages.findIndex(
            (passage) => practice.docId === `passage:${passage.id}`,
          );
          const next = passages[index + 1];
          if (!next) {
            state.writing.session.lastAt = Date.now();
            saveState();
            currentView = "writing-done";
            render();
            window.scrollTo({ top: 0, behavior: "instant" });
            return;
          }
          state.writing.setup.passageId = next.id;
          startWritingPractice({ keepSession: true });
          return;
        }
        const total = Number(practice.total || 0);
        const nextCursor = Number(practice.cursor || 0) + 1;
        if (!fromDone && total && nextCursor >= total) {
          state.writing.session.lastAt = Date.now();
          saveState();
          currentView = "writing-done";
          render();
          window.scrollTo({ top: 0, behavior: "instant" });
          return;
        }
        startWritingPractice({
          keepSession: true,
          cursor: fromDone ? 0 : nextCursor,
        });
      } else if (action === "writing-rewrite") {
        const practice = state.writing.practice || {};
        const result = state.writing.lastResult || {};
        practice.active = true;
        practice.input = "";
        practice.hintLevel = 0;
        practice.submittedAt = 0;
        practice.savedAt = Date.now();
        if (result.source) {
          practice.source = result.source;
          practice.reference = result.reference || "";
          practice.referenceAvailable = Boolean(result.referenceAvailable);
          practice.sourceLabel = result.sourceLabel || practice.sourceLabel;
          practice.direction = result.direction || practice.direction;
          practice.language = result.language || practice.language;
          practice.cursor = result.cursor ?? practice.cursor;
          practice.kind = result.kind || practice.kind;
          practice.itemLabel = result.itemLabel || practice.itemLabel;
          practice.docId = result.docId || practice.docId;
          practice.chapter = result.chapter ?? practice.chapter;
          practice.line = result.line ?? practice.line;
          practice.mode = result.mode || practice.mode;
        }
        state.writing.lastResult = null;
        state.writing.session.count = Math.max(
          0,
          Number(state.writing.session.count || 0) - 1,
        );
        state.writing.session.chars = Math.max(
          0,
          Number(state.writing.session.chars || 0) - String(result.answer || "").length,
        );
        saveState();
        currentView = "writing-practice";
        render();
      } else if (action === "writing-add-review") {
        const result = state.writing.lastResult;
        if (!result) return;
        addReviewItem({
          id: `translation:${result.docId || "custom"}:${result.cursor ?? result.line ?? 0}`,
          type: "translation",
          language: result.language || writingLanguage(),
          source: result.sourceLabel,
          prompt: result.source,
          answer: result.kind === "phrase" ? result.reference : result.answer,
        });
        state.writing.session = state.writing.session || {};
        state.writing.session.reviewAdded =
          Number(state.writing.session.reviewAdded || 0) + 1;
        saveState();
        showToast("这次翻译已加入智能复习。");
      } else if (action === "writing-save-note") {
        const result = state.writing.lastResult;
        if (!result) return;
        const stamp = new Date().toLocaleString("zh-CN");
        const isPhrase = result.kind === "phrase";
        const block = [
          `## 写译笔记 · ${stamp}`,
          `${isPhrase ? "中文提示" : "原文"}：${result.source}`,
          `${isPhrase ? "我的拼写" : "我的翻译"}：${result.answer}`,
          result.reference
            ? `${isPhrase ? "标准短语" : "参考译文"}：${result.reference}`
            : "参考译文：无（资料未附）",
        ].join("\n\n");
        const existing = String(state.notes.writing || "");
        state.notes.writing = existing ? `${existing}\n\n${block}` : block;
        saveState();
        showToast("已保存到本地笔记。");
      } else if (action === "writing-finish") {
        if (!state.writing.lastResult) return;
        state.writing.practice.active = false;
        state.writing.session.lastAt = Date.now();
        saveState();
        currentView = "writing-done";
        render();
      } else if (action === "set-reader-language") {
        state.reader.language = actionButton.dataset.language;
        state.reader.filter = "all";
        state.reader.activeBookId = "";
        saveState();
        renderBooks();
      } else if (action === "change-reader-language") {
        state.reader.language = "";
        state.reader.activeBookId = "";
        saveState();
        renderBooks();
      } else if (action === "set-book-filter") {
        state.reader.filter = actionButton.dataset.filter;
        renderBooks();
      } else if (action === "upload-book") {
        openAddBookDialog();
      } else if (action === "add-book-local") {
        closeAddBookDialog();
        pendingBookTarget = "reader";
        document.getElementById("bookUpload")?.click();
      } else if (action === "add-book-scan") {
        closeAddBookDialog();
        scanPages.forEach((page) => URL.revokeObjectURL(page.url));
        scanPages = [];
        scanBook = null;
        currentView = "scan-capture";
        render();
      } else if (action === "close-add-book") {
        closeAddBookDialog();
      } else if (action === "scan-capture") {
        await captureScanFrame();
      } else if (action === "scan-pick-image") {
        document.getElementById("scanGalleryUpload")?.click();
      } else if (action === "scan-take-photo") {
        document.getElementById("scanUpload")?.click();
      } else if (action === "scan-remove-page") {
        removeScanPage(Number(actionButton.dataset.index));
      } else if (action === "scan-finish") {
        finishScanCapture();
      } else if (action === "scan-restart") {
        stopScanCamera();
        scanPages.forEach((page) => URL.revokeObjectURL(page.url));
        scanPages = [];
        scanBook = null;
        currentView = "scan-capture";
        render();
      } else if (action === "scan-run-ocr") {
        await runScanOcr();
      } else if (action === "scan-retry-page") {
        await runScanOcr([Number(actionButton.dataset.index)]);
      } else if (action === "scan-delete-page") {
        if (scanBook) {
          const index = Number(actionButton.dataset.index);
          const [removed] = scanBook.pages.splice(index, 1);
          if (removed?.url) URL.revokeObjectURL(removed.url);
          scanBook.pages.forEach((page, at) => {
            if (!page.renamed) page.title = `第 ${at + 1} 页`;
          });
          renderScanImport();
        }
      } else if (action === "scan-rename-page") {
        if (scanBook) {
          const index = Number(actionButton.dataset.index);
          const page = scanBook.pages[index];
          const input = document.getElementById(`scanName-${index}`);
          const next = input?.value.trim();
          if (page && next) {
            page.title = next;
            page.renamed = true;
            renderScanImport();
          }
        }
      } else if (action === "scan-retry-failed") {
        if (scanBook) {
          const indices = scanBook.pages
            .map((page, index) => (page.status === "failed" ? index : -1))
            .filter((index) => index >= 0);
          await runScanOcr(indices);
        }
      } else if (action === "scan-confirm-import") {
        await confirmScanImport(actionButton);
      } else if (action === "manage-book") {
        openBookAdmin(actionButton.dataset.bookId);
      } else if (action === "close-book-admin") {
        closeBookAdmin();
      } else if (action === "save-book-admin") {
        event.preventDefault();
        await saveBookAdmin(actionButton);
      } else if (action === "delete-book") {
        await deleteManagedBook(actionButton);
      } else if (action === "open-wordbook-rename") {
        openWordbookRename(actionButton.dataset.bookId);
      } else if (action === "close-wordbook-rename") {
        closeWordbookRename();
      } else if (action === "save-wordbook-title") {
        event.preventDefault();
        saveWordbookTitle(actionButton.dataset.bookId);
      } else if (action === "reset-wordbook-title") {
        resetWordbookTitle(actionButton.dataset.bookId);
      } else if (action === "upload-writing") {
        pendingBookTarget = "writing";
        document.getElementById("bookUpload")?.click();
      } else if (action === "open-reader") {
        if (Date.now() < bookLongPressUntil) return;
        const targetId = actionButton.dataset.bookId;
        const target = readerBooks().find((item) => item.id === targetId) || null;
        if (target && (target.kind === "txt" || target.assetPath)) {
          const finish = beginButtonTask(actionButton, "正在展开…");
          try {
            await ensureBookPages(target);
            finish("done", "已打开");
          } catch (error) {
            finish();
            showToast(`打开失败：${error.message}`);
            return;
          }
        }
        exitReaderDrawing({ silent: true });
        if (target?.language) state.reader.language = target.language;
        state.reader.activeBookId = targetId;
        state.reader.page = Number(
          state.reader.progress?.[state.reader.activeBookId] || 0,
        );
        readerToolOpen = "";
        startReadingClock();
        saveState();
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "close-reader") {
        stopSpeech();
        exitReaderDrawing({ silent: true });
        destroyReaderPdfCache();
        clearReaderSelection({ removeNative: true });
        closeReaderLookup();
        readerToolOpen = "";
        pauseReadingClock();
        state.reader.activeBookId = "";
        saveState();
        render();
      } else if (action === "reader-page-translate") {
        readerToolOpen = readerToolOpen === "translate-page" ? "" : "translate-page";
        renderReader();
      } else if (action === "reader-page-ocr") {
        readerPageOcr(actionButton);
      } else if (action === "reader-comic-translate") {
        readerComicTranslate(actionButton);
      } else if (action === "reader-comic-uncertain") {
        const book = activeReaderBook();
        const pageIndex = state.reader.page;
        const items = book
          ? state.reader.comicTranslations?.[book.id]?.[pageIndex]
          : null;
        const index = Number(actionButton.dataset.index);
        if (!Array.isArray(items) || !items[index]) return;
        if (items[index].type === "uncertain") {
          items[index].type = items[index].prevType || "dialogue";
          delete items[index].prevType;
        } else {
          items[index].prevType = items[index].type;
          items[index].type = "uncertain";
        }
        saveState();
        renderReader();
      } else if (action === "reader-tool") {
        const tool = actionButton.dataset.tool;
        if (tool === "speak") {
          const book = readerBooks().find(
            (item) => item.id === state.reader.activeBookId,
          );
          const page = book?.pages?.[state.reader.page];
          if (book && page) {
            speakText(
              String(page.text || ""),
              book.language === "fr" ? "fr-FR" : "en-US",
              actionButton,
            );
          }
          return;
        }
        if (tool === "translate") {
          const shown = state.reader.showTranslations === false;
          state.reader.showTranslations = shown;
          saveState();
          document
            .getElementById("readerStage")
            ?.classList.toggle("is-translation-hidden", !shown);
          main
            .querySelectorAll('[data-action="reader-tool"][data-tool="translate"]')
            .forEach((button) => {
              button.classList.toggle("is-active", shown);
              if (button.hasAttribute("aria-pressed")) {
                button.setAttribute("aria-pressed", String(shown));
              }
            });
          if (shown) {
            const currentBook = readerBooks().find(
              (item) => item.id === state.reader.activeBookId,
            );
            // 中文正文不需要翻译；否则会把中文当成英文送去接口，既浪费请求又出乱码。
            if (
              currentBook &&
              currentBook.language !== "zh" &&
              currentBook.kind !== "image" &&
              currentBook.kind !== "pdf"
            ) {
              hydrateReaderParagraphTranslations(currentBook, state.reader.page);
            }
          }
          const currentBook = readerBooks().find(
            (item) => item.id === state.reader.activeBookId,
          );
          showToast(
            shown
              ? currentBook?.language === "zh"
                ? "中文正文无需翻译。"
                : "译文已显示在每段文字下方。"
              : "译文已隐藏。",
          );
          if (readerToolOpen) {
            readerToolOpen = "";
            renderReader();
          }
          return;
        }
        if (
          ["toc", "tokens", "note", "bookmark", "font", "menu"].includes(
            tool,
          )
        ) {
          readerToolOpen = readerToolOpen === tool ? "" : tool;
          renderReader();
        }
      } else if (action === "reader-close-tool") {
        if (!readerToolOpen) return;
        readerToolOpen = "";
        renderReader();
      } else if (action === "reader-prev" || action === "reader-next") {
        turnReaderPage(action === "reader-next" ? 1 : -1);
      } else if (action === "reader-bookmark") {
        const book = readerBooks().find(
          (item) => item.id === state.reader.activeBookId,
        );
        if (!book) return;
        const pageIndex = clamp(state.reader.page, 0, book.pages.length - 1);
        const list = Array.isArray(state.reader.bookmarks?.[book.id])
          ? [...state.reader.bookmarks[book.id]]
          : [];
        const at = list.indexOf(pageIndex);
        if (at >= 0) {
          list.splice(at, 1);
          showToast(`已取消收藏第 ${pageIndex + 1} 页。`);
        } else {
          list.push(pageIndex);
          list.sort((a, b) => a - b);
          showToast(`已收藏第 ${pageIndex + 1} 页，可在“收藏页”里翻回来。`);
        }
        state.reader.bookmarks = state.reader.bookmarks || {};
        state.reader.bookmarks[book.id] = list;
        saveState();
        renderReader();
      } else if (action === "reader-goto") {
        exitReaderDrawing({ silent: true });
        state.reader.page = clamp(
          Number(actionButton.dataset.page || 0),
          0,
          Number.MAX_SAFE_INTEGER,
        );
        readerToolOpen = "";
        saveState();
        renderReader();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "reader-fullscreen") {
        openReaderFullscreen();
      } else if (action === "close-reader-fullscreen") {
        closeReaderFullscreen();
      } else if (action === "reader-lookup-open") {
        openReaderLookup("translate");
      } else if (action === "reader-ask-ai") {
        askAiFromReader();
      } else if (action === "reader-annotate-open") {
        openReaderLookup("note");
      } else if (action === "reader-add-word") {
        if (!readerSelectionText) return;
        const language = readerLookupLanguage();
        addReaderWordToWordbook(
          readerSelectionText,
          lookupReaderWord(readerSelectionText, language),
          language,
        );
        clearReaderSelection({ removeNative: true });
      } else if (action === "reader-select-speak") {
        if (!readerSelectionText) return;
        speakText(
          readerSelectionText,
          readerLookupLanguage() === "fr" ? "fr-FR" : "en-US",
          actionButton,
        );
      } else if (action === "reader-select-close") {
        clearReaderSelection({ removeNative: true });
      } else if (action === "reader-lookup-close") {
        closeReaderLookup();
      } else if (action === "reader-lookup-color") {
        if (!readerLookup) return;
        const draft = document.getElementById("readerLookupNote")?.value;
        if (draft !== undefined) readerLookup.note = draft;
        readerLookup.color = actionButton.dataset.color || READER_NOTE_COLORS[1].value;
        renderReaderLookup();
      } else if (action === "reader-lookup-cancel-note") {
        if (!readerLookup) return;
        const draft = document.getElementById("readerLookupNote")?.value;
        if (draft !== undefined) readerLookup.note = draft;
        readerLookup.noteMode = false;
        renderReaderLookup();
      } else if (action === "reader-lookup-note") {
        if (!readerLookup) return;
        readerLookup.noteMode = true;
        renderReaderLookup();
      } else if (action === "reader-lookup-save-note") {
        saveReaderLookupNote();
      } else if (action === "reader-lookup-ai-retry") {
        loadReaderLookupAI();
      } else if (action === "reader-lookup-allusion") {
        loadReaderLookupAllusion();
      } else if (action === "reader-lookup-speak") {
        if (!readerLookup) return;
        speakText(
          readerLookup.text,
          readerLookup.language === "fr" ? "fr-FR" : "en-US",
          actionButton,
        );
      } else if (action === "reader-lookup-add-word") {
        if (!readerLookup) return;
        addReaderWordToWordbook(
          readerLookup.text,
          readerLookup.local || readerLookup.online || "",
          readerLookup.language,
        );
      } else if (action === "reader-lookup-suggest") {
        const word = actionButton.dataset.word || "";
        if (!word) return;
        readerSelectionText = word;
        readerSelectionWord = true;
        openReaderLookup("translate");
      } else if (action === "speak-global") {
        event.preventDefault();
        const lang = actionButton.dataset.lang || "en";
        const speechLocale =
          lang === "fr"
            ? "fr-FR"
            : lang === "ja"
              ? "ja-JP"
              : lang === "de"
                ? "de-DE"
                : lang === "es"
                  ? "es-ES"
                  : lang === "it"
                    ? "it-IT"
                    : "en-US";
        speakText(actionButton.dataset.word || "", speechLocale, actionButton);
      } else if (action === "search-global-word") {
        libraryQuery = actionButton.dataset.word || "";
        libraryPage = 1;
        activeWordId = null;
        selectedTag = deck.meta.filters?.[0]?.id || "all";
        currentView = "library";
        render();
      } else if (action === "translate-source") {
        translateSource = actionButton.dataset.source || "auto";
        render();
      } else if (action === "clear-translate") {
        translateText = "";
        translateResult = null;
        translateSerial += 1;
        render();
      } else if (action === "run-translate") {
        runTranslate();
      } else if (action === "reader-draw-start") {
        startReaderDrawing();
      } else if (action === "reader-draw-color") {
        readerDrawColor = actionButton.dataset.color || readerDrawColor;
        readerDrawTool = "pen";
        document.querySelectorAll("#readerDrawBar .reader-note-color").forEach((button) => {
          button.classList.toggle(
            "is-active",
            button.dataset.color === readerDrawColor,
          );
        });
        document
          .querySelector('[data-action="reader-draw-eraser"]')
          ?.classList.remove("is-active");
        document
          .querySelector('[data-action="reader-draw-eraser"]')
          ?.setAttribute("aria-pressed", "false");
        document.querySelector(".reader-draw-canvas")?.classList.remove("is-eraser");
      } else if (action === "reader-draw-eraser") {
        readerDrawTool = readerDrawTool === "eraser" ? "pen" : "eraser";
        actionButton.classList.toggle("is-active", readerDrawTool === "eraser");
        actionButton.setAttribute(
          "aria-pressed",
          readerDrawTool === "eraser" ? "true" : "false",
        );
        const canvas = document.querySelector(".reader-draw-canvas");
        canvas?.classList.toggle("is-eraser", readerDrawTool === "eraser");
        if (canvas && readerDrawTool === "eraser") {
          const pulse = document.createElement("span");
          pulse.className = "reader-erase-pulse is-hint";
          pulse.style.left = "50%";
          pulse.style.top = "50%";
          document.querySelector(".reader-paper")?.appendChild(pulse);
          window.setTimeout(() => pulse.remove(), 460);
        }
      } else if (action === "reader-draw-undo") {
        const book = activeReaderBook();
        if (!book) return;
        const current = drawingStrokes(book);
        if (current.length) {
          const strokes = current.slice(0, -1);
          saveDrawingStrokes(book, strokes);
          redrawReaderStrokes(document.querySelector(".reader-draw-canvas"), strokes, null);
        } else if (!removeLastReaderDoodle(book)) {
          showToast("这一页还没有可以撤销的涂鸦。");
        }
      } else if (action === "reader-draw-clear") {
        const book = activeReaderBook();
        if (!book) return;
        if (!window.confirm("清空这一页的涂鸦和句子标注？")) return;
        saveDrawingStrokes(book, []);
        saveReaderDoodles(book, []);
        redrawReaderStrokes(document.querySelector(".reader-draw-canvas"), [], null);
        paintReaderDoodles();
      } else if (action === "reader-draw-exit") {
        exitReaderDrawing();
        renderReader();
      } else if (action === "delete-reader-annotation") {
        const id = actionButton.dataset.annotationId;
        if (!id || !window.confirm("删除这条笔记？删除后不可恢复。")) return;
        deleteReaderAnnotation(id);
        if (currentView === "book-notes") renderBookNotes();
        else renderReader();
      } else if (action === "delete-reader-note") {
        const noteId = actionButton.dataset.noteId || "";
        if (!noteId || !window.confirm("删除这条笔记？删除后不可恢复。")) return;
        if (noteId.startsWith("ann:")) {
          deleteReaderAnnotation(noteId.slice(4));
        } else if (noteId.startsWith("page:")) {
          const key = noteId.slice(5);
          if (state.reader.notes) delete state.reader.notes[key];
          saveState();
        }
        renderBookNotes();
      } else if (action === "open-reader-note") {
        const bookId = actionButton.dataset.bookId;
        const book = readerBooks().find((item) => item.id === bookId);
        if (!book) {
          showToast("这本书已经不在书架上了。");
          return;
        }
        readerDrawMode = false;
        readerToolOpen = "";
        state.reader.activeBookId = book.id;
        state.reader.page = clamp(
          Number(actionButton.dataset.page || 0),
          0,
          book.pages.length - 1,
        );
        currentView = "books";
        saveState();
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "wordbook-speak") {
        speakText(
          actionButton.dataset.word || "",
          actionButton.dataset.language === "fr" ? "fr-FR" : "en-US",
          actionButton,
        );
      } else if (action === "delete-wordbook-word") {
        const key = actionButton.dataset.wordKey;
        const item = state.reader.wordbook?.[key];
        if (!item) return;
        if (!window.confirm(`从单词库移除“${item.word}”？`)) return;
        delete state.reader.wordbook[key];
        saveState();
        renderWordbook();
      } else if (action === "tap-margin-art") {
        const taps = Number(state.profile.marginTaps || 0) + 1;
        state.profile.marginTaps = taps;
        if (taps >= 7 && !state.profile.easterCat) {
          state.profile.easterCat = true;
          saveState();
          showToast("页边传来一声轻响：隐藏贴纸「趴书猫」已解锁。");
          render();
        } else {
          saveState();
        }
      } else if (action === "open-settings") {
        populateSettings();
        settingsDialog.showModal();
      } else if (action === "open-developer") {
        if (settingsDialog.open) settingsDialog.close();
        setView("developer");
      } else if (action === "ai-chat-prompt") {
        sendAiChat(actionButton.dataset.prompt || "");
      } else if (action === "ai-chat-clear") {
        if (!aiChatHistory().length) {
          showToast("对话已经是空的。");
        } else if (window.confirm("清空本机保存的全部 AI 对话？")) {
          aiChatMessages = [];
          aiChatError = "";
          saveAiChat();
          renderAiChat();
          showToast("对话已清空。");
        }
      } else if (action === "bgm-select") {
        const trackId = String(actionButton.dataset.bgmTrack || "");
        const bgm = window.CikeBgm;
        if (!bgm) return;
        if (!trackId) {
          bgm.stop();
          state.settings.bgmTrack = "";
          state.settings.bgmPaused = false;
          showToast("背景音乐已关闭。");
        } else {
          bgm.play(trackId);
          state.settings.bgmTrack = trackId;
          state.settings.bgmPaused = false;
        }
        saveState();
        syncBgmUi();
        closeBgmList();
      } else if (action === "bgm-list-toggle") {
        const widget = actionButton.closest("[data-bgm-widget]");
        const list = widget?.querySelector("[data-bgm-list]");
        if (!list) return;
        const open = list.hasAttribute("hidden");
        if (open) list.removeAttribute("hidden");
        else list.setAttribute("hidden", "");
        actionButton.setAttribute("aria-expanded", open ? "true" : "false");
        playSound?.("tab");
      } else if (action === "bgm-toggle") {
        const bgm = window.CikeBgm;
        if (!bgm) return;
        const info = bgm.getState();
        if (info.playing) {
          bgm.pause();
          state.settings.bgmPaused = true;
        } else {
          const trackId =
            state.settings.bgmTrack || bgm.tracks[0]?.id || "epiphany";
          bgm.play(trackId);
          state.settings.bgmTrack = trackId;
          state.settings.bgmPaused = false;
        }
        saveState();
        syncBgmUi();
      } else if (action === "collect-reader-word") {
        const word = actionButton.dataset.word;
        const meaning = actionButton.dataset.meaning;
        const book = readerBooks().find(
          (item) => item.id === state.reader.activeBookId,
        );
        speakText(
          String(word || ""),
          book?.language === "fr" ? "fr-FR" : "en-US",
          actionButton,
        );
        addReviewItem({
          id: `reader-word:${book?.id || "unknown"}:${word.toLowerCase()}`,
          type: "word",
          language: book?.language || "en",
          source: book?.title || "阅读",
          prompt: word,
          answer: meaning || `回忆 ${word} 的含义`,
        });
        showToast(`“${word}”已加入智能复习，不会自动收藏所有查词。`);
      } else if (action === "open-review") {
        state.reviewMeta.revealed = false;
        state.reviewMeta.total = dueReviewItems().length;
        currentView = "review";
        render();
      } else if (action === "review-reveal") {
        state.reviewMeta.revealed = true;
        renderReview();
      } else if (action === "review-speak") {
        const item = dueReviewItems()[0];
        if (item) {
          speakText(
            String(item.prompt || ""),
            item.language === "fr" || String(item.language).startsWith("fr")
              ? "fr-FR"
              : "en-US",
            actionButton,
          );
        }
      } else if (action === "review-grade") {
        gradeReview(actionButton.dataset.grade);
      } else if (action === "review-skip") {
        const item = dueReviewItems()[0];
        if (item) {
          const key = `review:${item.id}`;
          state.progress[key].due = Date.now() + 60 * 60 * 1000;
          saveState();
          renderReview();
        }
      } else if (action === "confirm-reader-import") {
        const titleInput = document.getElementById("pendingBookTitle");
        const finishButton = beginButtonTask(actionButton, "正在加入…");
        pendingReaderBook.title = titleInput?.value.trim() || pendingReaderBook.title;
        pendingReaderBook.type =
          document.getElementById("pendingBookType")?.value ||
          pendingReaderBook.type ||
          "ebook";
        if (!(pendingReaderBook.coverData instanceof Blob)) {
          const cover = await makeTypographicCover(pendingReaderBook).catch(
            () => null,
          );
          if (cover) {
            pendingReaderBook.coverData = cover;
            pendingReaderBook.coverSource = "generated";
          }
        }
        const importedBook = pendingReaderBook;
        try {
          if (window.CikeDB) await window.CikeDB.putBook(importedBook);
        } catch (error) {
          finishButton();
          showToast(error.message || "保存失败，请重试。");
          return;
        }
        userBooksCache = [
          ...userBooksCache.filter((book) => book.id !== pendingReaderBook.id),
          pendingReaderBook,
        ];
        state.userBooks = [
          ...(state.userBooks || []).filter(
            (book) => book.id !== pendingReaderBook.id,
          ),
          {
            id: pendingReaderBook.id,
            title: pendingReaderBook.title,
            author: pendingReaderBook.author,
            language: pendingReaderBook.language,
            type: pendingReaderBook.type,
            source: pendingReaderBook.source,
            importedAt: pendingReaderBook.importedAt,
            pageCount: pendingReaderBook.pages.length,
          },
        ];
        if (pendingBookTarget === "writing") {
          state.writing.language = pendingReaderBook.language;
          state.writing.docId = pendingReaderBook.id;
          state.writing.chapter = 0;
          state.writing.board = 0;
          state.writing.setup.source = "user";
          state.writing.setup.docId = pendingReaderBook.id;
          state.writing.setup.direction = "to-zh";
        } else {
          state.reader.activeBookId = pendingReaderBook.id;
          state.reader.page = 0;
          state.reader.progress[pendingReaderBook.id] = 0;
        }
        if (importedBook.coverSource === "generated") {
          queueBookCoverWebUpgrade(importedBook);
        }
        pendingReaderBook = null;
        currentView = pendingBookTarget === "writing" ? "corpus" : "books";
        saveState();
        render();
      } else if (action === "cancel-reader-import") {
        if (pendingReaderBook?.id) forgetReaderCoverUrl(pendingReaderBook.id);
        pendingReaderBook = null;
        currentView = pendingBookTarget === "writing" ? "corpus" : "books";
        render();
      } else if (action === "run-pending-ocr") {
        await runPendingOcr();
      } else if (action === "retry-failed-ocr") {
        if (!window.Tesseract) {
          showToast("当前安装包未内置离线 OCR 引擎，可直接改文字或重新选择文件。");
          return;
        }
        await runPendingOcr();
      } else if (action === "ocr-rename-page") {
        if (!pendingReaderBook) return;
        const index = Number(actionButton.dataset.page);
        const input = document.getElementById(`ocrName-${index}`);
        const title = input?.value.trim();
        if (!pendingReaderBook.pages[index] || !title) return;
        pendingReaderBook.pages[index].title = title;
        renderImportPreview();
        showToast(`第 ${index + 1} 页已改名为「${title}」。`);
      } else if (action === "ocr-delete-page") {
        if (!pendingReaderBook) return;
        const index = Number(actionButton.dataset.page);
        if (pendingReaderBook.pages.length <= 1) {
          showToast("至少要保留一页。");
          return;
        }
        const confirmed = window.confirm(
          `删除第 ${index + 1} 页？页面里的文字也会一起移除。`,
        );
        if (!confirmed) return;
        pendingReaderBook.pages.splice(index, 1);
        renderImportPreview();
      } else if (action === "ocr-merge-page") {
        if (!pendingReaderBook) return;
        const index = Number(actionButton.dataset.page);
        const pages = pendingReaderBook.pages;
        if (pages.length <= 1) {
          showToast("至少需要两页才能合并。");
          return;
        }
        const target = index < pages.length - 1 ? index + 1 : index - 1;
        const first = Math.min(index, target);
        const second = Math.max(index, target);
        pages[first] = {
          ...pages[first],
          title: `${pages[first].title} + ${pages[second].title}`,
          text: [pages[first].text, pages[second].text]
            .filter((text) => String(text || "").trim())
            .join("\n\n"),
        };
        pages.splice(second, 1);
        renderImportPreview();
        showToast(`已合并第 ${first + 1} 页与第 ${second + 1} 页。`);
      } else if (action === "ocr-retry-page") {
        await retryPendingOcrPage(Number(actionButton.dataset.page));
      } else if (action === "set-discover-filter") {
        discoverFilter = actionButton.dataset.filter || "all";
        discoverPage = 1;
        renderDiscoverPage();
      } else if (action === "set-discover-lang") {
        discoverLang = actionButton.dataset.lang || "all";
        discoverPage = 1;
        renderDiscoverPage();
      } else if (action === "set-discover-domain") {
        const next = actionButton.dataset.domain || "all";
        discoverDomain =
          next === "all" || DISCOVER_DOMAINS.includes(next) ? next : "all";
        discoverGenre = "all";
        discoverSeries = "all";
        discoverPeriodicalTheme = "all";
        discoverPage = 1;
        renderDiscoverPage();
      } else if (action === "set-discover-genre") {
        const next = actionButton.dataset.genre || "all";
        discoverGenre =
          next === "all" || [...DISCOVER_GENRES, ...COMIC_THEMES].includes(next)
            ? next
            : "all";
        discoverPage = 1;
        renderDiscoverPage();
      } else if (action === "set-discover-series") {
        const next = actionButton.dataset.series || "all";
        discoverSeries =
          next === "all" ||
          Object.prototype.hasOwnProperty.call(
            discoverPeriodicalFacets().series,
            next,
          )
            ? next
            : "all";
        discoverPage = 1;
        renderDiscoverPage();
      } else if (action === "set-discover-periodical-theme") {
        const next = actionButton.dataset.theme || "all";
        discoverPeriodicalTheme =
          next === "all" || PERIODICAL_THEMES.includes(next) ? next : "all";
        discoverPage = 1;
        renderDiscoverPage();
      } else if (action === "set-discover-page") {
        discoverPage = Math.max(1, Number(actionButton.dataset.page) || 1);
        renderDiscoverPage();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (action === "open-classic-ip") {
        const title =
          actionButton.closest(".discover-item")?.querySelector("h2")?.textContent ||
          "这本书";
        showToast(`《${title}》是版权作品，请在图书页用「＋ 加书」导入你已有的电子书。`);
        currentView = "books";
        render();
      } else if (action === "toggle-discover-save") {
        const id = actionButton.dataset.id;
        const list = new Set(
          Array.isArray(state.notes.discover) ? state.notes.discover : [],
        );
        if (list.has(id)) list.delete(id);
        else list.add(id);
        state.notes.discover = [...list];
        saveState();
        renderDiscoverPage();
      } else if (action === "open-public-book") {
        await openPublicBook(actionButton.dataset.id, actionButton);
      } else if (action === "open-discover-item") {
        const id = actionButton.dataset.id;
        if (id === "writing-library" || id === "builtin-writing") {
          state.writing.language = "en";
          currentView = "corpus";
          render();
        } else if (id === "typewords") {
          currentView = "typewords";
          render();
        } else if (id === "wordbook-examples") {
          currentView = "home";
          render();
        } else if (id.startsWith("book:")) {
          const bookId = id.slice(5);
          const book = readerBooks().find((item) => item.id === bookId);
          if (!book) return;
          state.reader.language = book.language || "en";
          state.reader.activeBookId = book.id;
          state.reader.page = Number(state.reader.progress?.[book.id] || 0);
          startReadingClock();
          currentView = "books";
          saveState();
          render();
        }
      } else if (action === "export-basic") {
        await exportProgress(false);
      } else if (action === "export-full") {
        const finishButton = beginButtonTask(actionButton, "正在打包…");
        try {
          await exportProgress(true);
          finishButton("done", "已导出");
        } catch (error) {
          finishButton();
          showToast(`导出失败：${error.message}`);
        }
      } else if (action === "import-backup") {
        document.getElementById("backupImportInput")?.click();
      } else if (action === "confirm-backup-import") {
        if (!pendingBackup?.file) return;
        const file = pendingBackup.file;
        const mode = actionButton.dataset.mode === "replace" ? "replace" : "merge";
        const finishButton = beginButtonTask(actionButton, "正在恢复…");
        try {
          await importProgress(file, { mode });
          finishButton("done", "已恢复");
          pendingBackup = null;
          currentView = "backup";
          render();
        } catch (error) {
          finishButton();
          console.error(error);
          showToast(`恢复失败：${error.message}`);
        }
      } else if (action === "cancel-backup-import") {
        pendingBackup = null;
        renderBackupPage();
      } else if (action === "reset-progress") {
        const confirmed = window.confirm(
          "确定清空全部进度、错词和学习记录吗？这个操作无法撤销，建议先导出备份。",
        );
        if (!confirmed) return;
        state = structuredClone(defaultState);
        saveState();
        deck = currentBook();
        words = deck.words;
        wordById = new Map(words.map((word) => [word.id, word]));
        selectedTag = deck.meta.filters?.[0]?.id || "all";
        populateSettings();
        currentView = "profile";
        render();
        showToast("本机学习记录已清空。");
      }
    });

    main.addEventListener("change", async (event) => {
      if (event.target.id === "essayYear") {
        essayYearFilter = event.target.value;
        render();
      }
      if (event.target.id === "transYear") {
        transYearFilter = event.target.value;
        render();
      }
      if (event.target.id === "unitFilter") {
        selectedUnit = event.target.value;
        libraryPage = 1;
        render();
      }
      if (event.target.id === "statusFilter") {
        libraryStatus = event.target.value;
        libraryPage = 1;
        render();
      }
      if (event.target.id === "bookUpload") {
        const file = event.target.files?.[0];
        event.target.value = "";
        prepareBookImport(file).catch((error) => {
          showToast(error.message || "资料解析失败。");
        });
      }
      if (
        event.target.id === "scanUpload" ||
        event.target.id === "scanGalleryUpload"
      ) {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        files.forEach((file) => addScanPage(file));
        if (currentView !== "scan-capture") {
          currentView = "scan-capture";
          render();
        }
      }
      if (event.target.id === "backupImportInput") {
        const file = event.target.files?.[0];
        event.target.value = "";
        await stageBackupFile(file);
      }
      if (event.target.id === "readerFontSize") {
        state.reader.fontSize = Number(event.target.value);
        saveState();
      }
      if (event.target.id === "listenFilterYear") {
        state.listening.filters.year = event.target.value;
        state.listening.filters.month = "all";
        state.listening.filters.set = "all";
        saveState();
        render();
      }
      if (event.target.id === "listenFilterMonth") {
        state.listening.filters.month = event.target.value;
        state.listening.filters.set = "all";
        saveState();
        render();
      }
      if (event.target.id === "listenFilterSet") {
        state.listening.filters.set = event.target.value;
        saveState();
        render();
      }
      if (event.target.id === "listenFilterSection") {
        state.listening.filters.section = event.target.value;
        saveState();
        render();
      }
      if (event.target.id === "analysisJump") {
        analysisGo(Number(event.target.value || 1));
      }
      if (event.target.id === "listenAnswerPaper") {
        listenImportDraft = listenImportDraft || { audio: [], paper: null };
        listenImportDraft.answerPaperId = event.target.value;
        listenImportDraft.answerPreview = null;
        listenImportDraft.answerMap = null;
        renderListeningImport();
      }
      if (event.target.matches("[data-listen-audio-map]")) {
        const index = Number(event.target.dataset.listenAudioMap);
        if (listenImportDraft?.audio?.[index]) {
          listenImportDraft.audio[index].paperId = event.target.value;
          renderListeningImport();
        }
      }
      if (event.target.id === "listenAudioInput") {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        listenImportDraft = listenImportDraft || { audio: [], paper: null };
        listenImportDraft.audio = files.map((file) => {
          const paper = matchListenPaperByAudio(file.name);
          return {
            name: file.name,
            size: file.size,
            file,
            paperId: paper?.id || "",
          };
        });
        renderListeningImport();
      }
      if (event.target.id === "listenQuestionInput") {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          listenImportDraft = listenImportDraft || { audio: [], answers: null };
          if (/\.json$/i.test(file.name)) {
            const data = JSON.parse(await file.text());
            const raw = Array.isArray(data) ? data[0] : data.paper || data;
            const questions = Array.isArray(raw?.questions) ? raw.questions : [];
            if (!questions.length) throw new Error("JSON 里没有 questions 数组。");
            const fixed = questions.map((q, index) => ({
              n: Number(q.n || q.number || index + 1),
              section: q.section || "A",
              stem: q.stem || "",
              options: {
                A: q.options?.A || "",
                B: q.options?.B || "",
                C: q.options?.C || "",
                D: q.options?.D || "",
              },
              answer: /^[A-D]$/.test(q.answer || "") ? q.answer : null,
              audioStart: null,
              audioEnd: null,
            }));
            listenImportDraft.paper = {
              sourceName: file.name,
              paper: {
                ...raw,
                id:
                  raw.id ||
                  `custom-${Date.now()}`,
                title: raw.title || file.name.replace(/\.json$/i, ""),
                year: Number(raw.year || 0),
                month: Number(raw.month || 0),
                set: Number(raw.set || 1),
                audioFile: null,
                audioBytes: 0,
                groups:
                  Array.isArray(raw.groups) && raw.groups.length
                    ? raw.groups
                    : [
                        { id: "g1", section: "A", from: 1, to: 8, type: "长对话", descriptor: "", audioStart: null, audioEnd: null },
                        { id: "g2", section: "B", from: 9, to: 15, type: "听力篇章", descriptor: "", audioStart: null, audioEnd: null },
                        { id: "g3", section: "C", from: 16, to: 25, type: "讲座", descriptor: "", audioStart: null, audioEnd: null },
                      ],
                questions: fixed,
              },
            };
          } else {
            const fallback = parseListenNameCode(file.name);
            const text = /\.pdf$/i.test(file.name)
              ? (await extractPdfText(file)).text
              : await file.text();
            const paper = parseListenQuestionText(text, fallback);
            listenImportDraft.paper = { sourceName: file.name, paper };
          }
          renderListeningImport();
        } catch (error) {
          showToast(error.message || "题目解析失败。");
        }
      }
      });

    main.addEventListener("submit", (event) => {
      if (event.target.id === "answerForm") {
        event.preventDefault();
        submitAnswer(event.target);
      } else if (event.target.id === "listenImeForm") {
        event.preventDefault();
        if (!session || session.answerState) return;
        const input = document.getElementById("listenImeInput");
        session.listenDraft = String(input?.value || "").slice(0, 48);
        checkListenAnswer();
      } else if (event.target.id === "aiChatForm") {
        event.preventDefault();
        const input = document.getElementById("aiChatInput");
        const value = input ? input.value : "";
        if (input) {
          input.value = "";
          input.style.height = "auto";
        }
        sendAiChat(value);
      }
    });

    main.addEventListener("keydown", (event) => {
      if (event.target.id !== "aiChatInput") return;
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      document
        .getElementById("aiChatForm")
        ?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });

    main.addEventListener("input", (event) => {
      if (event.target.id === "listenImeInput") {
        if (!session || session.answerState) return;
        session.listenDraft = String(event.target.value || "").slice(0, 48);
        return;
      }
      if (event.target.id === "aiChatInput") {
        event.target.style.height = "auto";
        event.target.style.height = `${Math.min(120, event.target.scrollHeight)}px`;
        return;
      }
      if (event.target.id !== "typewordsSearch") return;
      if (event.isComposing) return;
      typewordsQuery = event.target.value;
      renderTypewordsCatalog();
      const input = document.getElementById("typewordsSearch");
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });

    main.addEventListener("input", (event) => {
      if (event.target.id === "readerFontSize") {
        const value = Number(event.target.value);
        document
          .querySelector(".reader-stage")
          ?.style.setProperty("--reader-font-size", `${value}px`);
        const label = document.getElementById("readerFontSizeLabel");
        if (label) label.textContent = `${value}px`;
      } else if (event.target.id === "readerNote") {
        const key = `${state.reader.activeBookId}:${state.reader.page}`;
        state.reader.notes[key] = event.target.value;
        saveState();
      } else if (event.target.classList.contains("reader-comic-edit")) {
        // 人工修正优先：模型给的译文只是初稿，用户改过就以用户为准。
        const index = Number(event.target.dataset.comicIndex);
        const book = activeReaderBook();
        const pageIndex = state.reader.page;
        const items = book
          ? state.reader.comicTranslations?.[book.id]?.[pageIndex]
          : null;
        if (Array.isArray(items) && items[index]) {
          items[index].translation = event.target.value;
          items[index].edited = true;
          saveState();
        }
      } else if (event.target.id === "writingPracticeInput") {
        const practice = state.writing.practice;
        if (!practice?.active) return;
        practice.input = event.target.value;
        practice.savedAt = Date.now();
        clearTimeout(writingSaveTimer);
        writingSaveTimer = setTimeout(saveState, 500);
        const stateLine = main.querySelector(".draft-state");
        if (stateLine) {
          stateLine.textContent = writingDraftState(practice);
          stateLine.classList.toggle("is-saved", Boolean(practice.input.trim()));
        }
        const submit = main.querySelector('[data-action="submit-writing"]');
        if (submit) submit.disabled = !practice.input.trim();
        const track = main.querySelector(".practice-progress .progress-track span");
        if (track) {
          track.style.setProperty(
            "--progress",
            `${percent(
              practice.input.replace(/\s/g, "").length,
              Math.max(12, String(practice.source || "").length),
            )}%`,
          );
        }
      } else if (event.target.id === "essayInput" || event.target.id === "transInput") {
        if (!examActive) return;
        const draft = examEnsure(examActive.kind, examActive.id);
        if (draft.submitted) return;
        draft.text = event.target.value;
        clearTimeout(examSaveTimer);
        examSaveTimer = setTimeout(saveState, 500);
        const words = document.getElementById("examWords");
        if (words) {
          words.textContent = String(countEnglishWords(draft.text));
          if (examActive.kind === "essay") {
            const essay = essayById(examActive.id);
            const max = essay?.maxWords || 200;
            words.classList.toggle("is-over", countEnglishWords(draft.text) > max);
          }
        }
      } else if (event.target.id === "writingCustomText") {
        state.writing.setup.customText = event.target.value;
        saveState();
        const start = main.querySelector('[data-action="start-writing-practice"]');
        if (start) {
          start.disabled =
            state.writing.setup.source === "custom" && !event.target.value.trim();
        }
      } else if (event.target.id === "writingCustomReference") {
        state.writing.setup.customReference = event.target.value;
        saveState();
      } else if (event.target.id === "translateInput") {
        translateText = event.target.value;
        const detect = main.querySelector(".translate-detect");
        if (detect) {
          detect.textContent =
            translateSource === "auto"
              ? `自动识别：${languageLabel(translateDetectLanguage(translateText))}`
              : `按${languageLabel(translateSource)}查词`;
        }
      } else if (event.target.id === "librarySearchInput") {
        // 中文输入法组词期间不重绘，否则会被打断；结束后那次 input 事件会正常进入。
        if (event.isComposing) return;
        libraryQuery = event.target.value;
        libraryPage = 1;
        renderLibrary();
        // 同步抢回焦点：重绘会替换掉输入框，异步 focus 会让安卓软键盘闪一下。
        const input = document.getElementById("librarySearchInput");
        if (input) {
          input.focus({ preventScroll: true });
          input.setSelectionRange(input.value.length, input.value.length);
        }
      } else if (event.target.id === "discoverSearchInput") {
        if (event.isComposing) return;
        discoverQuery = event.target.value;
        renderDiscoverPage();
        const input = document.getElementById("discoverSearchInput");
        if (input) {
          input.focus({ preventScroll: true });
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    });

    headerSearch.addEventListener("submit", (event) => {
      event.preventDefault();
      libraryQuery = searchInput.value.trim();
      headerSearch.classList.remove("is-expanded");
      currentView = "library";
      libraryPage = 1;
      selectedTag = "all";
      selectedUnit = "";
      libraryStatus = "all";
      activeWordId = null;
      render();
    });

    headerSearch.addEventListener("pointerdown", (event) => {
      if (
        window.matchMedia("(max-width: 700px)").matches &&
        !headerSearch.classList.contains("is-expanded")
      ) {
        event.preventDefault();
        headerSearch.classList.add("is-expanded");
        setTimeout(() => searchInput.focus(), 0);
      }
    });

    document.getElementById("openSettings").addEventListener("click", () => {
      populateSettings();
      settingsDialog.showModal();
    });

    document
      .getElementById("settingsAvatarPick")
      ?.addEventListener("click", () =>
        document.getElementById("settingsAvatarFile")?.click(),
      );
    document
      .getElementById("settingsAvatarShoot")
      ?.addEventListener("click", () =>
        document.getElementById("settingsAvatarCapture")?.click(),
      );
    document
      .getElementById("settingsAvatarFile")
      ?.addEventListener("change", handleSettingsAvatarFile);
    document
      .getElementById("settingsAvatarCapture")
      ?.addEventListener("change", handleSettingsAvatarFile);
    settingsAvatarFrame?.addEventListener("change", (event) => {
      if (!profileDraft) return;
      profileDraft.frame = event.target.value;
      renderProfileDraft();
    });
    profileNameInput?.addEventListener("input", (event) => {
      if (!profileDraft) return;
      profileDraft.name = event.target.value;
      if (!profileDraft.avatar) {
        const initial = settingsAvatarPreview?.querySelector(
          ".avatar-editor-initial",
        );
        if (initial) initial.textContent = (event.target.value || "词").slice(0, 1);
      }
    });
    profileTagInput?.addEventListener("input", (event) => {
      if (profileDraft) profileDraft.tag = event.target.value;
    });
    profileNoteInput?.addEventListener("input", (event) => {
      if (profileDraft) profileDraft.note = event.target.value;
    });
    settingsDialog.addEventListener("close", () => {
      // 直接关掉设置等于放弃草稿；资料只能在设置里改。
      profileDraft = null;
    });

    document.getElementById("openVoiceSettings").addEventListener("click", () => {
      if (window.AndroidBridge?.openVoiceSettings) {
        window.AndroidBridge.openVoiceSettings();
      } else {
        showToast("请在系统设置中搜索“文字转语音”并安装英语/法语语音包。");
      }
    });

    aiProviderSelect?.addEventListener("change", () => {
      const fallback = window.CikeAI?.defaults(aiProviderSelect.value);
      if (fallback) {
        aiModelInput.value = fallback.model;
        aiBaseUrlInput.value = fallback.baseUrl;
      }
      refreshAIKeyHint();
    });

    document.getElementById("aiSaveKey")?.addEventListener("click", () => {
      const provider = aiProviderSelect?.value || "doubao";
      const key = String(aiKeyInput?.value || "").trim();
      if (!key) {
        showToast("先填入 API Key。");
        return;
      }
      if (!window.CikeAI?.saveKey(provider, key)) {
        showToast("Key 保存失败，请检查设备存储权限。");
        return;
      }
      if (aiKeyInput) aiKeyInput.value = "";
      refreshAIKeyHint();
      showToast(`Key 已保存到${window.CikeAI.keyStorageLabel()}。`);
    });

    document
      .getElementById("aiTest")
      ?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        if (!window.CikeAI) return;
        window.CikeAI.configure({
          ...aiSettings(),
          enabled: aiEnabledInput?.checked !== false,
          provider: aiProviderSelect?.value || "doubao",
          model: String(aiModelInput?.value || "").trim(),
          baseUrl: String(aiBaseUrlInput?.value || "").trim(),
        });
        const finish = beginButtonTask(button, "连接中…");
        try {
          const result = await window.CikeAI.testConnection();
          finish("done", "已连通");
          showToast(
            result.ok
              ? `${result.model} 连接正常，可以返回 JSON。`
              : `${result.model} 已连通，但返回内容不是约定的 JSON。`,
          );
        } catch (error) {
          finish();
          showToast(`连接失败：${error.message}`);
        }
      });

    document.getElementById("aiClearKey")?.addEventListener("click", () => {
      const provider = aiProviderSelect?.value || "doubao";
      if (!window.confirm("清除这个供应商的 API Key？")) return;
      window.CikeAI?.clearKey(provider);
      refreshAIKeyHint();
      showToast("Key 已清除。");
    });

    document
      .getElementById("aiExportCache")
      ?.addEventListener("click", async () => {
        if (!window.CikeAI) return;
        try {
          const text = await window.CikeAI.exportCache();
          const payload = JSON.parse(text);
          if (!payload.entries?.length) {
            showToast("本机还没有 AI 缓存。");
            return;
          }
          downloadJson(payload, `词刻AI缓存-${todayKey()}.json`);
          showToast(`已导出 ${payload.entries.length} 条缓存。`);
        } catch (error) {
          showToast("缓存导出失败。");
        }
      });

    document.getElementById("aiImportCache")?.addEventListener("click", () => {
      document.getElementById("aiCacheFile")?.click();
    });

    document
      .getElementById("aiCacheFile")
      ?.addEventListener("change", async (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (!file || !window.CikeAI) return;
        try {
          const result = await window.CikeAI.importCache(await file.text());
          refreshAICacheHint();
          showToast(
            `缓存已合并：新增 ${result.added} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条。`,
          );
        } catch (error) {
          showToast(`导入失败：${error.message}`);
        }
      });

    document
      .getElementById("aiClearCache")
      ?.addEventListener("click", async () => {
        if (!window.CikeAI) return;
        if (!window.confirm("清空本机 AI 缓存？已生成的内容会重新消耗 API 额度。")) {
          return;
        }
        await window.CikeAI.clearCache();
        refreshAICacheHint();
        showToast("AI 缓存已清空。");
      });

    document
      .getElementById("ocrServiceSave")
      ?.addEventListener("click", () => {
        const input = document.getElementById("ocrServiceInput");
        const value = String(input?.value || "")
          .trim()
          .replace(/\/+$/, "");
        state.settings.ocrServiceUrl = value;
        saveState();
        showToast(
          value
            ? "识别服务地址已保存，下次识别本页会优先使用。"
            : "已清空识别服务地址，只使用离线 OCR。",
        );
      });

    document
      .getElementById("ocrServiceTest")
      ?.addEventListener("click", async (event) => {
        const input = document.getElementById("ocrServiceInput");
        const base = String(input?.value || "")
          .trim()
          .replace(/\/+$/, "");
        if (!base) {
          showToast("先填入服务地址再测试。");
          return;
        }
        const button = event.currentTarget;
        const finish = beginButtonTask(button, "连接中…");
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(`${base}/health`, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          finish("done", "已连通");
          showToast("识别服务已连通。");
        } catch (error) {
          finish();
          showToast(
            `连接失败：${error.name === "AbortError" ? "超时" : error.message}`,
          );
        } finally {
          window.clearTimeout(timer);
        }
      });

    voiceRateInput.addEventListener("input", () => {
      voiceRateOutput.textContent = `${Number(voiceRateInput.value).toFixed(2)}×`;
    });

    musicVolumeInput.addEventListener("input", () => {
      const percent = clamp(Math.round(Number(musicVolumeInput.value) || 0), 0, 100);
      musicVolumeOutput.textContent = `${percent}%`;
      state.settings.musicVolume = percent / 100;
      window.CikeBgm?.setVolume(percent / 100);
      saveState();
    });

    window.addEventListener("cike:bgm-state", () => {
      if (currentView === "home") syncBgmUi();
    });

    settingsForm.addEventListener("submit", (event) => {
      if (event.submitter?.value !== "save") return;
      const goal = Math.max(0, Math.floor(Number(dailyGoalInput.value) || 0));
      state.settings.dailyGoal = goal;
      state.settings.sessionSize = Math.max(1, goal || 20);
      state.settings.accent = accentSelect.value;
      state.settings.voiceRate = Number(voiceRateInput.value);
      state.settings.musicVolume = clamp(
        Number(musicVolumeInput.value) / 100,
        0,
        1,
      );
      state.settings.theme = themeSelect.value;
      state.settings.soundEnabled = soundEnabledInput.checked;
      window.CikeSound?.setEnabled(state.settings.soundEnabled);
      state.settings.ai = {
        enabled: Boolean(aiEnabledInput?.checked),
        provider: aiProviderSelect?.value || "doubao",
        model: String(aiModelInput?.value || "").trim(),
        baseUrl: String(aiBaseUrlInput?.value || "").trim(),
        tasks: {
          define: aiTaskDefine?.checked !== false,
          translate: aiTaskTranslate?.checked !== false,
          allusion: aiTaskAllusion?.checked !== false,
          comic: aiTaskComic?.checked !== false,
          grade: aiTaskGrade?.checked !== false,
        },
      };
      syncAIConfig();
      window.CikeBgm?.setVolume(state.settings.musicVolume);
      if (profileDraft) {
        state.profile.avatar = String(profileDraft.avatar || "");
        state.profile.frame = PROFILE_FRAMES.includes(profileDraft.frame)
          ? profileDraft.frame
          : "tape";
        state.profile.name =
          String(profileDraft.name || "").trim() || "词刻学习者";
        state.profile.tag = String(profileDraft.tag || "").trim();
        state.notes.profile = String(profileDraft.note || "").trim();
      }
      writeUserPrefsSnapshot(state);
      saveState();
      applyTheme();
      setTimeout(render, 0);
      showToast("设置已保存。");
    });

    document.getElementById("exportProgress").addEventListener("click", () => {
      exportProgress(false);
    });
    document.getElementById("exportFullProgress").addEventListener("click", async (event) => {
      const finishButton = beginButtonTask(event.currentTarget, "正在打包…");
      try {
        await exportProgress(true);
        finishButton("done", "已导出");
      } catch (error) {
        finishButton();
        showToast(`导出失败：${error.message}`);
      }
    });
    document.getElementById("importProgress").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document.getElementById("importFile").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await importProgress(file);
      event.target.value = "";
    });
    document.getElementById("resetProgress").addEventListener("click", () => {
      const confirmed = window.confirm(
        "确定清空全部进度、错词和学习记录吗？这个操作无法撤销，建议先导出备份。",
      );
      if (!confirmed) return;
      state = structuredClone(defaultState);
      try {
        localStorage.removeItem(USER_PREFS_KEY);
      } catch (error) {
        // Ignore.
      }
      saveState();
      deck = currentBook();
      words = deck.words;
      wordById = new Map(words.map((word) => [word.id, word]));
      selectedTag = deck.meta.filters?.[0]?.id || "all";
      populateSettings();
      settingsDialog.close();
      render();
      showToast("进度已清空。");
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (event.key === "/" && !editing && !settingsDialog.open) {
        event.preventDefault();
        searchInput.focus();
        return;
      }

      if (currentView === "books" && state.reader.activeBookId && !editing) {
        if (event.key === "Escape" && readerToolOpen) {
          event.preventDefault();
          readerToolOpen = "";
          renderReader();
          return;
        }
        if (
          (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
          !readerToolOpen
        ) {
          event.preventDefault();
          turnReaderPage(event.key === "ArrowRight" ? 1 : -1);
          return;
        }
      }

      if (currentView !== "study" || !session || settingsDialog.open) return;

      if (event.key === "Escape") {
        goBack();
        return;
      }

      const current = session.queue[session.index];
      if (!current) return;

      if (event.key === " " && !editing) {
        event.preventDefault();
        speak(current.word.id, document.querySelector(".listen-trigger"));
        return;
      }

      if (event.key === "Enter" && session.answerState && !editing) {
        event.preventDefault();
        nextQuestion();
        return;
      }

      if (current.kind === "listen" && !session.answerState && !editing) {
        if (/^[a-zA-ZÀ-ÿ]$/.test(event.key)) {
          event.preventDefault();
          typeListenLetter(event.key);
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          playSound("back");
          session.listenDraft = String(session.listenDraft || "").slice(0, -1);
          renderStudy();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          checkListenAnswer();
          return;
        }
      }

      if (
        current.kind === "recognize" &&
        session.revealed &&
        !session.answerState &&
        !editing &&
        ["1", "2", "3"].includes(event.key)
      ) {
        event.preventDefault();
        gradeRecognize(
          { 1: "again", 2: "hard", 3: "know" }[event.key],
        );
      }
    });

    window.addEventListener("beforeunload", () => {
      flushReadingTime();
      flushState();
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("service-worker.js").catch((error) => {
        console.warn("Service worker registration failed.", error);
      });
    }
  }

  async function hydrateUserBooks() {
    if (!window.CikeDB) return;
    try {
      const stored = await window.CikeDB.getAllBooks();
      userBooksCache = Array.isArray(stored) ? stored : [];
      state.userBooks = userBooksCache.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        language: book.language,
        type: book.type,
        source: book.source,
        importedAt: book.importedAt,
        pageCount: book.pages?.length || 0,
      }));
      saveState();
    } catch (error) {
      console.warn("Could not load local books.", error);
      showToast("本地图书库加载失败，但词书学习仍可使用。");
    }
  }

  if (navigator.onLine === false && !state.profile.offlineSeen) {
    state.profile.offlineSeen = true;
    saveState();
  }
  window.addEventListener("offline", () => {
    if (!state.profile.offlineSeen) {
      state.profile.offlineSeen = true;
      saveState();
    }
  });
  applyTheme();
  populateSettings();
  warmSpeechVoices();
  applyBgmSettings({ autoplay: true });
  bindEvents();
  registerServiceWorker();
  // 启动阶段先静默补齐历史成就，稳定后再开启解锁弹窗，避免一进首页连弹。
  window.setTimeout(() => {
    achievementWatchArmed = true;
  }, 2600);
  restoreStateFromDb().finally(() => {
    hydrateUserBooks().finally(() => {
      refreshListenAudio().catch(() => {});
      render();
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("cike-app-ready"));
      });
      window.setTimeout(() => backfillBookCovers(), 900);
    });
  });
})();
