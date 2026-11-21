(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.Cet6Core = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const REVIEW_AGAIN_MS = 10 * 60 * 1000;
  const REVIEW_HARD_MS = 12 * 60 * 60 * 1000;
  const MODES = ["recognize", "listen", "write"];

  function normalizeAnswer(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\s+/g, " ");
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(dateKey, amount) {
    const date = new Date(`${dateKey}T12:00:00`);
    date.setDate(date.getDate() + amount);
    return localDateKey(date);
  }

  function isDue(progress, now = Date.now()) {
    return Boolean(progress && progress.status !== "mastered" && progress.due <= now);
  }

  function gradeAnswer(previous, grade, now = Date.now()) {
    const prior = {
      status: "new",
      seen: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      ease: 2.4,
      interval: 0,
      due: now,
      lastSeen: 0,
      ...(previous || {}),
    };

    const next = {
      ...prior,
      seen: prior.seen + 1,
      lastSeen: now,
    };

    if (grade === "again") {
      next.wrong += 1;
      next.streak = 0;
      next.ease = Math.max(1.3, Number(prior.ease) - 0.2);
      next.interval = 0;
      next.status = "learning";
      next.due = now + REVIEW_AGAIN_MS;
      return next;
    }

    next.correct += 1;

    if (grade === "hard") {
      next.streak = Math.max(0, Number(prior.streak) - 1);
      next.ease = Math.max(1.3, Number(prior.ease) - 0.08);
      next.interval = 1;
      next.status = "learning";
      next.due = now + REVIEW_HARD_MS;
      return next;
    }

    next.streak = Number(prior.streak) + 1;
    next.ease = Math.min(3.2, Number(prior.ease) + 0.06);
    next.interval =
      prior.interval <= 0
        ? 1
        : Math.max(2, Math.round(Number(prior.interval) * Number(next.ease)));
    next.interval = Math.min(next.interval, 90);
    next.status =
      next.interval >= 14 && next.streak >= 3 ? "mastered" : "learning";
    next.due =
      next.status === "mastered"
        ? now + 365 * DAY_MS
        : now + next.interval * DAY_MS;
    return next;
  }

  function markMastered(previous, now = Date.now()) {
    return {
      status: "new",
      seen: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      ease: 2.4,
      interval: 0,
      due: now,
      lastSeen: 0,
      ...(previous || {}),
      status: "mastered",
      interval: 90,
      streak: Math.max(3, Number(previous?.streak || 0)),
      lastSeen: now,
      due: now + 365 * DAY_MS,
    };
  }

  function matchesTag(word, tag) {
    if (tag === "all") return true;
    if (Array.isArray(word.tags) && word.tags.includes(tag)) return true;
    // 多语言词书的分组写在 level/band 上（如 3000、CORE、2000），
    // tags 只有语言与 core 标记，需要一并匹配。
    return (
      String(word.level || "") === String(tag) || String(word.band || "") === String(tag)
    );
  }

  function filterWords(words, options = {}) {
    const { tag = "all", unit = null, query = "" } = options;
    const needle = String(query || "").trim().toLowerCase();
    return words.filter((word) => {
      if (!matchesTag(word, tag)) return false;
      if (unit && Number(word.unit) !== Number(unit)) return false;
      if (!needle) return true;
      return [word.word, word.meaning, word.category]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(needle));
    });
  }

  function buildSessionQueue(words, progress, options = {}) {
    const {
      tag = "all",
      unit = null,
      size = 20,
      mode = "mixed",
      now = Date.now(),
      focus = "today",
    } = options;
    const pool = filterWords(words, { tag, unit });
    const seen = new Set();
    const push = (item, list) => {
      if (!item || seen.has(item.id) || list.length >= size) return;
      seen.add(item.id);
      list.push(item);
    };

    const due = [];
    const mistakes = [];
    const fresh = [];
    const backup = [];

    for (const word of pool) {
      const item = progress[word.id];
      if (!item) {
        fresh.push(word);
      } else {
        if (item.status !== "mastered" && (isDue(item, now) || focus === "review")) {
          due.push(word);
        }
        if (Number(item.wrong || 0) > 0 && item.status !== "mastered") {
          mistakes.push(word);
        }
      }
      backup.push(word);
    }

    due.sort((a, b) => {
      const ap = progress[a.id] || {};
      const bp = progress[b.id] || {};
      return Number(ap.due || 0) - Number(bp.due || 0) || a.rank - b.rank;
    });
    mistakes.sort((a, b) => {
      const ap = progress[a.id] || {};
      const bp = progress[b.id] || {};
      return Number(bp.wrong || 0) - Number(ap.wrong || 0) || a.rank - b.rank;
    });
    fresh.sort((a, b) => a.rank - b.rank);
    backup.sort((a, b) => a.rank - b.rank);

    const queue = [];
    if (focus === "review") {
      [...mistakes, ...due].forEach((word) => push(word, queue));
    } else {
      const mistakeQuota = Math.min(Math.ceil(size * 0.2), mistakes.length);
      const reviewQuota = Math.min(Math.ceil(size * 0.45), due.length);
      mistakes.slice(0, mistakeQuota).forEach((word) => push(word, queue));
      due.slice(0, reviewQuota).forEach((word) => push(word, queue));
      fresh.forEach((word) => push(word, queue));
    }

    backup.forEach((word) => push(word, queue));

    return queue.map((word, index) => ({
      word,
      kind: mode === "mixed" ? MODES[index % MODES.length] : mode,
    }));
  }

  function getStreak(daily, today = localDateKey()) {
    let cursor = today;
    let streak = 0;
    if (!daily[cursor] || Number(daily[cursor].total || 0) === 0) {
      cursor = addDays(today, -1);
    }
    while (daily[cursor] && Number(daily[cursor].total || 0) > 0) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function summarize(words, progress, daily, now = Date.now()) {
    let studied = 0;
    let mastered = 0;
    let due = 0;
    let mistakes = 0;
    let attempts = 0;
    let correct = 0;

    for (const word of words) {
      const item = progress[word.id];
      if (!item) continue;
      studied += 1;
      attempts += Number(item.correct || 0) + Number(item.wrong || 0);
      correct += Number(item.correct || 0);
      if (item.status === "mastered") mastered += 1;
      else if (isDue(item, now)) due += 1;
      if (Number(item.wrong || 0) > 0 && item.status !== "mastered") mistakes += 1;
    }

    return {
      studied,
      mastered,
      due,
      mistakes,
      attempts,
      correct,
      accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
      streak: getStreak(daily),
    };
  }

  return {
    DAY_MS,
    MODES,
    normalizeAnswer,
    localDateKey,
    addDays,
    isDue,
    gradeAnswer,
    markMastered,
    matchesTag,
    filterWords,
    buildSessionQueue,
    getStreak,
    summarize,
  };
});
