/*
 * 词刻 AI 词典 / 翻译 / 典故
 * - 走 OpenAI Chat Completions 兼容协议，豆包 / DeepSeek / Kimi / 自定义端点共用一套提示词
 * - 结果按 hash(task + lang + text + model + prompt_version) 写入本地 IndexedDB 缓存
 * - 安卓包里请求经 AndroidBridge.aiChat 发出，API Key 只存在系统 Keystore 加密区
 */
(function () {
  "use strict";

  const PROMPT_VERSION = "v1";
  const DB_NAME = "cike-ai-cache-v1";
  const DB_VERSION = 1;
  const STORE = "entries";
  const REQUEST_TIMEOUT = 60000;
  const BRIDGE_TIMEOUT = 120000;

  const PROVIDERS = {
    doubao: {
      label: "豆包（火山方舟）",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-1-6-250615",
    },
    deepseek: {
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    },
    kimi: {
      label: "Kimi（月之暗面）",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k3.1-pro",
    },
    custom: {
      label: "自定义（OpenAI 兼容）",
      baseUrl: "",
      model: "",
    },
  };

  const TASK_FLAGS = {
    define: true,
    translate: true,
    allusion: true,
    comic: true,
    grade: true,
  };

  let config = {
    enabled: false,
    provider: "doubao",
    baseUrl: "",
    model: "",
    tasks: { ...TASK_FLAGS },
  };

  class AIError extends Error {
    constructor(code, message, extra) {
      super(message || code);
      this.name = "AIError";
      this.code = code;
      this.status = extra?.status || 0;
      this.detail = extra?.detail || "";
    }
  }

  function configure(next) {
    const source = next || {};
    config = {
      enabled: Boolean(source.enabled),
      provider: PROVIDERS[source.provider] ? source.provider : "doubao",
      baseUrl: String(source.baseUrl || "").trim(),
      model: String(source.model || "").trim(),
      tasks: { ...TASK_FLAGS, ...(source.tasks || {}) },
    };
    return config;
  }

  function defaults(provider) {
    const item = PROVIDERS[provider] || PROVIDERS.doubao;
    return { label: item.label, baseUrl: item.baseUrl, model: item.model };
  }

  function providerList() {
    return Object.entries(PROVIDERS).map(([id, item]) => ({
      id,
      label: item.label,
      baseUrl: item.baseUrl,
      model: item.model,
    }));
  }

  function resolvedBaseUrl() {
    const fallback = defaults(config.provider).baseUrl;
    return String(config.baseUrl || fallback || "").replace(/\/+$/, "");
  }

  function resolvedModel() {
    return String(config.model || defaults(config.provider).model || "");
  }

  function bridge() {
    return window.AndroidBridge || null;
  }

  function keySlot(provider) {
    return `cike-ai-key:${provider || config.provider}`;
  }

  function readKey(provider) {
    const id = provider || config.provider;
    try {
      if (bridge()?.getApiKey) {
        const value = bridge().getApiKey(id);
        if (value) return String(value);
      }
    } catch (error) {
      // Fall through to browser storage.
    }
    try {
      return localStorage.getItem(keySlot(id)) || "";
    } catch (error) {
      return "";
    }
  }

  function hasKey(provider) {
    return Boolean(readKey(provider));
  }

  function saveKey(provider, key) {
    const id = provider || config.provider;
    const value = String(key || "").trim();
    if (!value) return false;
    try {
      if (bridge()?.saveApiKey) {
        bridge().saveApiKey(id, value);
        return true;
      }
    } catch (error) {
      // Fall through to browser storage.
    }
    try {
      localStorage.setItem(keySlot(id), value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearKey(provider) {
    const id = provider || config.provider;
    try {
      bridge()?.clearApiKey?.(id);
    } catch (error) {
      // Ignore.
    }
    try {
      localStorage.removeItem(keySlot(id));
    } catch (error) {
      // Ignore.
    }
  }

  function keyStorageLabel() {
    return bridge()?.getApiKey ? "系统 Keystore 加密区" : "浏览器本地存储";
  }

  function can(task) {
    if (!config.enabled) return false;
    if (config.tasks[task] === false) return false;
    return Boolean(readKey()) && Boolean(resolvedBaseUrl()) && Boolean(resolvedModel());
  }

  function statusOfProvider(provider) {
    return {
      enabled: config.enabled,
      provider,
      hasKey: hasKey(provider),
      storage: keyStorageLabel(),
    };
  }

  /* ---------- IndexedDB cache ---------- */

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function withStore(mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function cacheGet(key) {
    try {
      return (await withStore("readonly", (store) => store.get(key))) || null;
    } catch (error) {
      return null;
    }
  }

  async function cachePut(entry) {
    try {
      await withStore("readwrite", (store) => store.put(entry));
    } catch (error) {
      // Cache failure never blocks the answer.
    }
  }

  async function cacheAll() {
    try {
      return (await withStore("readonly", (store) => store.getAll())) || [];
    } catch (error) {
      return [];
    }
  }

  async function cacheStats() {
    const entries = await cacheAll();
    const bytes = entries.reduce(
      (sum, entry) => sum + JSON.stringify(entry?.data ?? "").length,
      0,
    );
    return { count: entries.length, bytes };
  }

  async function exportCache() {
    const entries = await cacheAll();
    return JSON.stringify(
      {
        app: "cike",
        kind: "ai-cache",
        version: 1,
        promptVersion: PROMPT_VERSION,
        exportedAt: new Date().toISOString(),
        entries,
      },
      null,
      1,
    );
  }

  async function importCache(text) {
    let payload;
    try {
      payload = typeof text === "string" ? JSON.parse(text) : text;
    } catch (error) {
      throw new AIError("parse", "缓存包不是合法的 JSON。");
    }
    const entries = Array.isArray(payload?.entries)
      ? payload.entries
      : Array.isArray(payload)
        ? payload
        : null;
    if (!entries) throw new AIError("parse", "缓存包里没有 entries 数组。");
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.key !== "string" || !entry.data) {
        skipped += 1;
        continue;
      }
      const existing = await cacheGet(entry.key);
      if (existing) {
        if (Number(entry.createdAt || 0) <= Number(existing.createdAt || 0)) {
          skipped += 1;
          continue;
        }
        updated += 1;
      } else {
        added += 1;
      }
      await cachePut(entry);
    }
    return { added, updated, skipped };
  }

  async function clearCache() {
    await withStore("readwrite", (store) => store.clear());
  }

  /* ---------- prompts ---------- */

  const SYSTEM_DEFINE =
    "你是一个严谨的多语言词典编纂引擎。你的唯一任务是根据用户给定的单词和语言，输出一个严格合法的 JSON 对象。不要输出任何 JSON 以外的文字、解释、markdown 代码块标记或前后缀。";

  const SYSTEM_TRANSLATE =
    "你是一个精准的多语言翻译引擎。只输出目标语言的译文，不解释、不添加原文、不输出任何额外内容。";

  const SYSTEM_ALLUSION =
    "你是一个严谨的典故考据助手。你只基于可确认的事实回答。如果无法确认确切出处，必须如实返回 “unknown”，绝不编造书名、作者或引文。";

  const SYSTEM_COMIC =
    "你是一个专业的漫画翻译引擎。你会收到一页漫画的 OCR 识别结果，每一项包含原文、坐标框和类型（对话 bubble / 旁白 narration / 拟声词 sfx / 无法确定 uncertain）。请把每一项翻译成自然、符合语境的中文。你必须保持输入项的数量、顺序和坐标不变，只返回严格合法的 JSON 数组，不要输出任何解释、markdown 代码块标记或 JSON 以外的文字。";

  const SYSTEM_CHAT =
    "你是词刻的语言学习助手，帮助用户理解单词、句子、语法、阅读内容和写作表达。回答要简洁、准确、直接，默认使用中文；需要时给出例句和简短解释。不要编造无法确认的事实，也不要输出与问题无关的客套话。";

  const SYSTEM_GRADE =
    "你是大学英语四、六级考试阅卷组的资深教师，负责按官方评分标准批改学生的翻译和作文。你必须只返回严格合法的 JSON 对象，不要输出 JSON 以外的任何文字、解释或 markdown 代码块标记。评分要严格、具体、可执行：每个错误必须引用学生原文中的原句或原词，并给出可直接替换的改法；不要为了鼓励而虚高给分，也不要编造原文不存在的内容。";

  function definePrompt(word, lang) {
    return `为以下单词生成词典条目，以 JSON 格式返回：
单词："${word}"
语言："${lang}"（如 la 拉丁语、es 西班牙语、yue 粤语、en 英语、fr 法语、ja 日语、de 德语、it 意大利语）
输出 JSON，字段定义如下：
- "word": 原词
- "ipa": 国际音标或该语言的标准注音（粤语用粤拼，日语用假名+罗马字）。如果没有可靠注音，返回 null
- "pos": 词性，如 noun / verb / adj / phrase，不确定时返回 "unknown"
- "definitions": 中文释义数组，1-3 条，每条简洁准确
- "example": 一个例句对象 {"sentence": "目标语言例句", "translation": "中文翻译"}，无法给出时返回 null
- "etymology": 词源简述，不超过 50 字，不确定时返回 null
严格要求：
1. 只返回 JSON，不要任何额外文字。
2. 如果该词在指定语言中无法确认，definitions 返回空数组 []，不要编造释义。
3. 确保 JSON 可被程序直接解析。`;
  }

  function translatePrompt(text, sourceLang, targetLang) {
    return `将以下文本翻译为${targetLang}。源语言为${sourceLang}。只返回 JSON，格式为 {"translation": "译文"}，不要任何额外文字。
原文：${text}`;
  }

  function allusionPrompt(term, lang) {
    return `查询以下单词/短语在${lang}语言文化中的典故或出处，以 JSON 格式返回：
内容："${term}"
语言："${lang}"
输出 JSON，字段如下：
- "term": 原词/短语
- "meaning": 该典故在当前语境下的含义，用中文简述
- "source": 确切出处（书名、篇章名或可追溯的文献），无法确认时返回 "unknown"
- "quote": 原文引文（如有），没有则返回 null
- "confidence": "high" / "medium" / "low" / "unknown"
- "explanation": 简要说明，不超过 80 字
严格要求：
1. 如果 source 无法确认，confidence 必须为 "unknown" 或 "low"，source 返回 "unknown"。
2. 不要编造任何书名、作者、引文或章节信息。
3. 只返回 JSON，不要任何额外文字。`;
  }

  function comicPrompt(regions, sourceLang, targetLang) {
    const payload = regions.map((region) => ({
      index: region.index,
      text: region.text,
      box: region.box,
      class: region.type || "uncertain",
    }));
    return `源语言：${sourceLang}；目标语言：${targetLang}。
OCR 结果（JSON 数组）：
${JSON.stringify(payload)}

逐项翻译，并遵守下面的规则：
1. 输出 JSON 数组，元素数量和顺序必须与输入完全一致，不得合并、拆分、增删。
2. 每个元素包含字段：
   - "original_text": 输入的原文，原样返回
   - "translation": 中文译文
   - "box": 输入的坐标框，原样返回；输入为 null 时返回 null
   - "type": "dialogue" / "narration" / "sfx" / "uncertain" 之一
   - "speaker_hint": 说话人或语境提示，用简短中文，无法判断时返回 null
3. 气泡内对白用口语化中文；旁白保持书面语；拟声词用贴近画面的中文拟声词，不要意译成普通动词。
4. 无法辨认、语义残缺或你不确定的项，type 填 "uncertain"，translation 仍给出最可能的译文，并在末尾加上「（不确定）」。
5. 不要编造原作没有出现的信息。
6. 只返回 JSON 数组。`;
  }

  const GRADE_KINDS = {
    phrase: { label: "分句/短语拼写", maxScore: 100, rubric: "按拼写与短语准确度评分，满分 100 分。完全正确 100 分；拼错一个实词扣 8–12 分，漏词或多词扣 10–15 分，大小写和首尾标点不计入扣分。只评这一条短语或句子，不写长评。" },
    paragraph: { label: "整段翻译练习", maxScore: 15, rubric: "参照六级翻译 15 分制：13–15 分为 14 分档（优秀），10–12 分为 11 分档（良好），7–9 分为 8 分档（及格），4–6 分为 5 分档（较差），1–3 分为 2 分档（差）。重点看信息完整、语言准确、衔接自然。" },
    translation: { label: "六级翻译真题", maxScore: 15, rubric: "严格按六级翻译 15 分制评分：13–15 分为 14 分档（优秀），10–12 分为 11 分档（良好），7–9 分为 8 分档（及格），4–6 分为 5 分档（较差），1–3 分为 2 分档（差）。评分维度：信息点完整与准确、语法与拼写、词汇与搭配、句子衔接与连贯。漏译或误译整句要明显扣分。" },
    essay: { label: "六级作文真题", maxScore: 15, rubric: "严格按六级写作 15 分制评分：13–15 分为 14 分档（优秀），10–12 分为 11 分档（良好），7–9 分为 8 分档（及格），4–6 分为 5 分档（较差），1–3 分为 2 分档（差）。评分维度：内容切题与论点、篇章结构与衔接、语法与拼写、词汇与句式多样性。跑题或字数严重不足要扣分。" },
  };

  function gradePrompt(kind, source, reference, answer, extra) {
    const conf = GRADE_KINDS[kind] || GRADE_KINDS.paragraph;
    const lines = [
      `题型：${conf.label}`,
      `评分标准：${conf.rubric}`,
      "",
      `题目/原文：${source || "（无）"}`,
      `标准答案/参考译文：${reference || "（本题未提供参考答案，请依据题目和语言质量评分）"}`,
      "",
      `学生答案：${answer}`,
    ];
    if (extra?.direction === "to-zh") {
      lines.push("注意：这是英译中练习，学生答案应为中文；评价中文表达是否准确、通顺，不要按英文拼写扣分。");
    } else if (kind === "phrase" || kind === "paragraph" || kind === "translation") {
      lines.push("注意：这是中译英或英文拼写，学生答案应为英文；检查英文拼写、语法、搭配与信息完整度。");
    }
    lines.push(
      "",
      "请只返回如下结构的 JSON：",
      `{
  "score": 数字（0 到 ${conf.maxScore}，允许 0.5 分档）,
  "band": "档次名称，如 11 分档（良好）",
  "summary": "一句话总评，指出最关键的优点和问题",
  "dimensions": [
    {"name": "内容完整", "score": 数字, "max": 分值, "comment": "具体说明"}
  ],
  "errors": [
    {"type": "translation|omission|spelling|grammar|logic|word-choice|punctuation", "original": "学生原文中的原词或原句", "suggestion": "建议改成", "explanation": "中文解释为什么错"}
  ],
  "polished": "在保留学生原意的前提下，给出完整润色版本；不要替换成参考答案",
  "highlights": ["值得保留的表达，1–3 条"],
  "next_steps": ["下一步最该练的 2–4 件事"]
}`,
      "要求：",
      "1. score 必须是数字，且不超过满分；band 必须与分数对应。",
      "2. dimensions 必须覆盖：内容/信息完整、语法、拼写或用词、句子衔接与逻辑（作文另加篇章结构）。",
      "3. errors 按严重程度排序，最多 12 条；没有错误时返回空数组。type 只能取给定值。",
      "4. polished 必须是完整答案，不能只写修改片段；如果学生答案基本正确，也要给出自然流畅的润色版。",
      "5. 不要虚构标准答案里没有的信息，不要输出 JSON 以外的文字。",
    );
    return lines.join("\n");
  }

  /* ---------- transport ---------- */

  function joinUrl(base, path) {
    return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
  }

  function extractContent(bodyText) {
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (error) {
      throw new AIError("parse", "接口返回的不是 JSON。", {
        detail: String(bodyText || "").slice(0, 200),
      });
    }
    const message = payload?.choices?.[0]?.message;
    const content =
      message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text;
    if (typeof content !== "string" || !content.trim()) {
      throw new AIError("parse", "模型没有返回内容。", {
        detail: String(bodyText || "").slice(0, 200),
      });
    }
    return content;
  }

  function parseJsonLoosely(content) {
    let text = String(content || "").trim();
    text = text
      .replace(/^```(?:json|JSON)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      return JSON.parse(text);
    } catch (error) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch (inner) {
          // Fall through.
        }
      }
      throw new AIError("parse", "模型返回的 JSON 无法解析。", {
        detail: text.slice(0, 200),
      });
    }
  }

  function parseJsonArray(content) {
    let text = String(content || "").trim();
    text = text
      .replace(/^```(?:json|JSON)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const asArray = (value) => {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
        for (const key of ["items", "panels", "results", "regions", "translations", "data"]) {
          if (Array.isArray(parsed?.[key])) return parsed[key];
        }
        return null;
      } catch (error) {
        return null;
      }
    };
    const direct = asArray(text);
    if (direct) return direct;
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const sliced = asArray(text.slice(start, end + 1));
      if (sliced) return sliced;
    }
    throw new AIError("parse", "模型返回的 JSON 数组无法解析。", {
      detail: text.slice(0, 200),
    });
  }

  const bridgePending = new Map();
  let bridgeSeq = 0;

  function bridgeChat(body) {
    return new Promise((resolve, reject) => {
      const id = `ai-${Date.now()}-${++bridgeSeq}`;
      const timer = window.setTimeout(() => {
        bridgePending.delete(id);
        reject(new AIError("timeout", "请求超时，请稍后再试。"));
      }, BRIDGE_TIMEOUT);
      bridgePending.set(id, { resolve, reject, timer });
      try {
        window.AndroidBridge.aiChat(
          id,
          config.provider,
          resolvedBaseUrl(),
          JSON.stringify(body),
        );
      } catch (error) {
        window.clearTimeout(timer);
        bridgePending.delete(id);
        reject(new AIError("network", "无法调用本地网络桥。", { detail: String(error) }));
      }
    });
  }

  function onBridgeResult(id, payload) {
    const pending = bridgePending.get(String(id));
    if (!pending) return;
    window.clearTimeout(pending.timer);
    bridgePending.delete(String(id));
    let result;
    try {
      result = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch (error) {
      pending.reject(new AIError("parse", "本地网络桥返回了无法解析的结果。"));
      return;
    }
    if (result?.ok) {
      try {
        pending.resolve(extractContent(result.body));
      } catch (error) {
        pending.reject(error);
      }
      return;
    }
    const status = Number(result?.status) || 0;
    const detail = String(result?.body || result?.error || "").slice(0, 300);
    let message = "请求失败，请检查网络或供应商设置。";
    if (status === 401 || status === 403) message = "API Key 无效或没有该模型的权限。";
    else if (status === 404) message = "接口地址或模型名称不存在。";
    else if (status === 429) message = "请求太频繁或额度不足，稍后再试。";
    else if (status >= 500) message = "供应商服务暂时不可用。";
    pending.reject(new AIError("http", message, { status, detail }));
  }

  async function fetchChat(body) {
    if (bridge()?.aiChat) return bridgeChat(body);
    const key = readKey();
    if (!key) throw new AIError("missing-key", "还没有保存 API Key。");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let response;
    let text = "";
    try {
      response = await fetch(joinUrl(resolvedBaseUrl(), "chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new AIError("timeout", "请求超时，请稍后再试。");
      }
      throw new AIError("network", "网络请求失败，可能是对方域名未允许浏览器访问。", {
        detail: String(error),
      });
    } finally {
      window.clearTimeout(timer);
    }
    if (!response.ok) {
      let message = `接口返回 HTTP ${response.status}。`;
      if (response.status === 401 || response.status === 403) message = "API Key 无效或没有该模型的权限。";
      else if (response.status === 404) message = "接口地址或模型名称不存在。";
      else if (response.status === 429) message = "请求太频繁或额度不足，稍后再试。";
      else if (response.status >= 500) message = "供应商服务暂时不可用。";
      throw new AIError("http", message, {
        status: response.status,
        detail: text.slice(0, 300),
      });
    }
    return extractContent(text);
  }

  function buildBody(task, messages) {
    const body = {
      model: resolvedModel(),
      messages,
      temperature: task === "translate" ? 0.1 : 0.3,
      stream: false,
    };
    // 漫画整页翻译要求顶层是 JSON 数组，部分供应商的 json_object 模式
    // 只允对象，会把数组包坏，这里干脆不声明 response_format。
    if (task !== "comic") body.response_format = { type: "json_object" };
    return body;
  }

  async function requestJson(task, messages) {
    if (task === "comic") {
      const body = buildBody(task, messages);
      const content = await fetchChat(body);
      return parseJsonArray(content);
    }
    const body = buildBody(task, messages);
    let content;
    try {
      content = await fetchChat(body);
    } catch (error) {
      // 部分豆包模型不接受 response_format，去掉后重试一次。
      if (error.code === "http" && error.status === 400 && body.response_format) {
        delete body.response_format;
        content = await fetchChat(body);
      } else {
        throw error;
      }
    }
    return parseJsonLoosely(content);
  }

  /* ---------- cache keys ---------- */

  function cyrb53(text, seed) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (
      4294967296 * (2097151 & h2) +
      (h1 >>> 0)
    ).toString(36);
  }

  function cacheKeyOf(task, scope, text) {
    const model = resolvedModel() || "no-model";
    return `${task}:${cyrb53(
      `${scope}\u0000${text}\u0000${model}\u0000${PROMPT_VERSION}`,
      0x9e3779b9,
    )}`;
  }

  const inFlight = new Map();

  function dedupe(key, run) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      try {
        return await run();
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  async function runCached(task, scope, text, buildPrompt, normalize) {
    const key = cacheKeyOf(task, scope, text);
    const cached = await cacheGet(key);
    if (cached) {
      return { data: cached.data, cached: true };
    }
    return dedupe(key, async () => {
      const raw = await requestJson(task, buildPrompt());
      const data = normalize(raw);
      const model = resolvedModel();
      await cachePut({
        key,
        task,
        scope,
        label: text.slice(0, 120),
        model,
        promptVersion: PROMPT_VERSION,
        provider: config.provider,
        createdAt: Date.now(),
        data,
      });
      return { data, cached: false };
    });
  }

  /* ---------- task normalizers ---------- */

  function cleanText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function normalizeDefinition(raw, word) {
    const definitions = Array.isArray(raw?.definitions)
      ? raw.definitions
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    let example = null;
    const sourceExample = raw?.example;
    if (sourceExample && typeof sourceExample === "object") {
      const sentence = cleanText(sourceExample.sentence);
      if (sentence) {
        example = {
          sentence,
          translation: cleanText(sourceExample.translation),
        };
      }
    }
    const ipa = cleanText(raw?.ipa);
    const pos = cleanText(raw?.pos);
    const etymology = cleanText(raw?.etymology);
    return {
      word: cleanText(raw?.word) || word,
      ipa: ipa || null,
      pos: pos || "unknown",
      definitions,
      example,
      etymology: etymology ? etymology.slice(0, 80) : null,
    };
  }

  function normalizeAllusion(raw, term) {
    const confidences = ["high", "medium", "low", "unknown"];
    let confidence = String(raw?.confidence || "unknown").toLowerCase();
    if (!confidences.includes(confidence)) confidence = "unknown";
    let source = cleanText(raw?.source);
    if (!source || /^unknown$/i.test(source)) {
      source = "unknown";
      if (confidence === "high" || confidence === "medium") confidence = "low";
    }
    const quote = cleanText(raw?.quote);
    return {
      term: cleanText(raw?.term) || term,
      meaning: cleanText(raw?.meaning),
      source,
      quote: quote || null,
      confidence,
      explanation: cleanText(raw?.explanation).slice(0, 120),
    };
  }

  const COMIC_TYPES = ["dialogue", "narration", "sfx", "uncertain"];

  function normalizeBox(box) {
    if (!Array.isArray(box) || box.length !== 4) return null;
    const numbers = box.map((value) => Number(value));
    if (numbers.some((value) => !Number.isFinite(value))) return null;
    return numbers.map((value) => Math.round(value));
  }

  function normalizeComicItems(rawItems, regions) {
    // 模型偶尔会重排数组；只要它带了 index，就按 index 恢复顺序再对齐。
    const ordered = rawItems.every((item) =>
      Number.isFinite(Number(item?.index)),
    )
      ? [...rawItems].sort((a, b) => Number(a.index) - Number(b.index))
      : rawItems;
    const byIndex = new Map();
    ordered.forEach((item, position) => {
      const index = Number(item?.index);
      const key = Number.isFinite(index) ? index : position;
      if (!byIndex.has(key)) byIndex.set(key, item);
    });
    return regions.map((region, position) => {
      const item = byIndex.get(position) || ordered[position] || {};
      let type = String(item?.type || region.type || "uncertain").toLowerCase();
      if (!COMIC_TYPES.includes(type)) type = "uncertain";
      if (region.uncertain) type = "uncertain";
      let translation = cleanText(item?.translation);
      if (!translation) translation = "（未能翻译，可手动补上）";
      if (type === "uncertain" && !/（不确定）$/.test(translation)) {
        translation = `${translation}（不确定）`;
      }
      return {
        original_text: cleanText(item?.original_text) || region.text,
        translation,
        box: normalizeBox(region.box) || normalizeBox(item?.box),
        type,
        speaker_hint: cleanText(item?.speaker_hint) || null,
        edited: false,
      };
    });
  }

  const ERROR_TYPES = [
    "translation",
    "omission",
    "spelling",
    "grammar",
    "logic",
    "word-choice",
    "punctuation",
  ];

  function clampScore(value, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(max, Math.round(number * 2) / 2));
  }

  function gradeBand(score, max) {
    if (max === 100) {
      if (score >= 90) return "优秀";
      if (score >= 80) return "良好";
      if (score >= 70) return "中等";
      if (score >= 60) return "及格";
      return "待提高";
    }
    if (score >= 13) return "14 分档（优秀）";
    if (score >= 10) return "11 分档（良好）";
    if (score >= 7) return "8 分档（及格）";
    if (score >= 4) return "5 分档（较差）";
    return "2 分档（差）";
  }

  function normalizeGrade(raw, maxScore) {
    const score = clampScore(raw?.score, maxScore);
    const dimensions = Array.isArray(raw?.dimensions)
      ? raw.dimensions
          .map((item) => {
            const max = Math.max(1, Number(item?.max) || maxScore);
            return {
              name: cleanText(item?.name).slice(0, 24) || "综合",
              score: clampScore(item?.score, max),
              max: Math.round(max * 2) / 2,
              comment: cleanText(item?.comment).slice(0, 160),
            };
          })
          .filter((item) => item.name)
          .slice(0, 6)
      : [];
    const errors = Array.isArray(raw?.errors)
      ? raw.errors
          .map((item) => {
            let type = String(item?.type || "").toLowerCase().replace(/_/g, "-");
            if (!ERROR_TYPES.includes(type)) type = "grammar";
            const original = cleanText(item?.original).slice(0, 220);
            const suggestion = cleanText(item?.suggestion).slice(0, 220);
            const explanation = cleanText(item?.explanation).slice(0, 220);
            if (!original && !suggestion && !explanation) return null;
            return { type, original, suggestion, explanation };
          })
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const list = (value, limit) =>
      Array.isArray(value)
        ? value.map((item) => cleanText(item)).filter(Boolean).slice(0, limit)
        : [];
    return {
      score,
      maxScore,
      band: cleanText(raw?.band).slice(0, 32) || gradeBand(score, maxScore),
      summary: cleanText(raw?.summary).slice(0, 300),
      dimensions,
      errors,
      polished: cleanText(raw?.polished).slice(0, 4000),
      highlights: list(raw?.highlights, 3),
      nextSteps: list(raw?.next_steps || raw?.nextSteps, 4),
    };
  }

  /* ---------- public tasks ---------- */

  async function defineWord(word, lang) {
    const text = String(word || "").trim();
    if (!text) throw new AIError("bad-input", "没有要查询的单词。");
    if (!can("define")) throw new AIError("disabled", "AI 释义没有开启。");
    return runCached(
      "define",
      String(lang || "en"),
      text.toLowerCase(),
      () => [
        { role: "system", content: SYSTEM_DEFINE },
        { role: "user", content: definePrompt(text, lang || "en") },
      ],
      (raw) => normalizeDefinition(raw, text),
    );
  }

  async function translate(text, sourceLang, targetLang) {
    const value = String(text || "").trim();
    if (!value) return { data: "", cached: false };
    if (!can("translate")) throw new AIError("disabled", "AI 翻译没有开启。");
    return runCached(
      "translate",
      `${sourceLang || "auto"}>${targetLang || "zh-CN"}`,
      value,
      () => [
        { role: "system", content: SYSTEM_TRANSLATE },
        {
          role: "user",
          content: translatePrompt(value, sourceLang || "auto", targetLang || "中文"),
        },
      ],
      (raw) => {
        const translation = cleanText(raw?.translation);
        if (!translation) throw new AIError("parse", "模型没有给出译文。");
        return translation;
      },
    );
  }

  async function allusion(term, lang) {
    const text = String(term || "").trim();
    if (!text) throw new AIError("bad-input", "没有要考据的内容。");
    if (!can("allusion")) throw new AIError("disabled", "AI 典故查询没有开启。");
    return runCached(
      "allusion",
      String(lang || "en"),
      text,
      () => [
        { role: "system", content: SYSTEM_ALLUSION },
        { role: "user", content: allusionPrompt(text, lang || "en") },
      ],
      (raw) => normalizeAllusion(raw, text),
    );
  }

  async function translateComicPage(regions, sourceLang, targetLang) {
    const list = (Array.isArray(regions) ? regions : [])
      .map((region, index) => {
        let type = String(region?.type || "").toLowerCase();
        if (!COMIC_TYPES.includes(type)) type = "";
        return {
          index,
          text: cleanText(region?.text),
          box: normalizeBox(region?.box),
          type,
          uncertain: Boolean(region?.uncertain),
        };
      })
      .filter((region) => region.text);
    if (!list.length) throw new AIError("bad-input", "这一页没有可翻译的文字。");
    // 一页几十个文字区足够；异常超长时截断，避免把请求撑爆。
    if (list.length > 80) list.length = 80;
    if (!can("comic")) throw new AIError("disabled", "AI 漫画翻译没有开启。");
    const scope = `${sourceLang || "auto"}>${targetLang || "zh-CN"}`;
    const cacheText = JSON.stringify(
      list.map((region) => ({
        text: region.text,
        box: region.box,
        type: region.type,
      })),
    );
    return runCached(
      "comic",
      scope,
      cacheText,
      () => [
        { role: "system", content: SYSTEM_COMIC },
        {
          role: "user",
          content: comicPrompt(list, sourceLang || "auto", targetLang || "中文"),
        },
      ],
      (rawItems) => {
        if (!Array.isArray(rawItems) || !rawItems.length) {
          throw new AIError("parse", "模型没有返回有效的 JSON 数组。");
        }
        return normalizeComicItems(rawItems, list);
      },
    );
  }

  async function grade(kind, input = {}) {
    const conf = GRADE_KINDS[kind] || GRADE_KINDS.paragraph;
    const source = cleanText(input.source).slice(0, 4000);
    const reference = cleanText(input.reference).slice(0, 4000);
    const answer = String(input.answer || "").trim().slice(0, 6000);
    if (!answer) throw new AIError("bad-input", "还没有可批改的答案。");
    if (!can("grade")) throw new AIError("disabled", "AI 批改没有开启。");
    const cacheText = JSON.stringify({
      kind,
      source,
      reference,
      answer,
      direction: input.direction || "",
    });
    return runCached(
      "grade",
      `${kind}:${conf.maxScore}`,
      cacheText,
      () => [
        { role: "system", content: SYSTEM_GRADE },
        {
          role: "user",
          content: gradePrompt(kind, source, reference, answer, {
            direction: input.direction,
          }),
        },
      ],
      (raw) => normalizeGrade(raw, conf.maxScore),
    );
  }

  async function chat(messages, options = {}) {
    if (!config.enabled) throw new AIError("disabled", "请先在设置里启用 AI 助手。");
    if (!readKey()) throw new AIError("missing-key", "还没有保存 API Key。");
    if (!resolvedBaseUrl()) throw new AIError("missing-key", "还没有填写接口地址。");
    if (!resolvedModel()) throw new AIError("missing-key", "还没有填写模型名称。");
    const history = (Array.isArray(messages) ? messages : [])
      .filter((item) => item && (item.role === "user" || item.role === "assistant"))
      .map((item) => ({
        role: item.role,
        content: String(item.content || "").trim().slice(0, 6000),
      }))
      .filter((item) => item.content);
    if (!history.length) throw new AIError("bad-input", "还没有可以发送的内容。");
    const content = await fetchChat({
      model: resolvedModel(),
      messages: [{ role: "system", content: SYSTEM_CHAT }, ...history.slice(-12)],
      temperature:
        typeof options.temperature === "number" ? options.temperature : 0.6,
      stream: false,
    });
    const answer = String(content || "").trim();
    if (!answer) throw new AIError("empty", "模型没有返回内容，请稍后再试。");
    return { answer, model: resolvedModel() };
  }

  async function testConnection() {
    if (!config.enabled) throw new AIError("disabled", "请先勾选“启用 AI 助手”。");
    if (!resolvedBaseUrl()) throw new AIError("missing-key", "还没有填写接口地址。");
    if (!resolvedModel()) throw new AIError("missing-key", "还没有填写模型名称。");
    if (!readKey()) throw new AIError("missing-key", "还没有保存 API Key。");
    const content = await fetchChat({
      model: resolvedModel(),
      messages: [
        {
          role: "system",
          content: "你是接口连通性测试。只返回 JSON，不要任何额外文字。",
        },
        { role: "user", content: '只返回 {"ok":true}，不要任何额外文字。' },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
      stream: false,
    });
    const parsed = parseJsonLoosely(content);
    return { model: resolvedModel(), ok: Boolean(parsed?.ok) };
  }

  window.CikeAI = {
    PROMPT_VERSION,
    providers: providerList,
    defaults,
    configure,
    can,
    statusOfProvider,
    keyStorageLabel,
    saveKey,
    readKey,
    hasKey,
    clearKey,
    defineWord,
    translate,
    allusion,
    translateComicPage,
    grade,
    chat,
    testConnection,
    cacheStats,
    exportCache,
    importCache,
    clearCache,
    onBridgeResult,
  };
})();