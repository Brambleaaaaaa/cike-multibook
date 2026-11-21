/* 多语言离线单词发音：assets/audio/<语言>/word-audio.js 里登记词 → 文件名。 */
(() => {
  const BASE = "assets/audio/";
  const LANGUAGES = ["en", "es", "de", "it", "fr", "ja", "yue", "la"];
  const audio = new Audio();
  audio.preload = "none";

  let currentTrigger = null;
  let currentWord = "";
  let pendingFail = null;
  let sequenceToken = 0;
  let sequenceNext = null;

  function normalize(word) {
    return String(word || "")
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function indexFor(lang) {
    return (window.CIKE_WORD_AUDIO_INDEX || {})[lang] || {};
  }

  function fileFor(lang, word) {
    if (!LANGUAGES.includes(lang)) return "";
    const file = indexFor(lang)[normalize(word)];
    return file ? `${BASE}${lang}/${file}` : "";
  }

  // 句子索引与单词索引分开登记（assets/audio/<lang>/sentences.js）。
  function sentenceFileFor(lang, text) {
    const index = (window.CIKE_SENTENCE_AUDIO_INDEX || {})[lang];
    if (!index) return "";
    const file = index[normalize(text)];
    return file ? `${BASE}${lang}/${file}` : "";
  }

  function releaseTrigger() {
    if (currentTrigger) currentTrigger.classList.remove("is-speaking");
    currentTrigger = null;
  }

  function stop() {
    sequenceToken += 1;
    sequenceNext = null;
    if (!audio.paused) audio.pause();
    releaseTrigger();
    currentWord = "";
    pendingFail = null;
  }

  function failCurrent(error) {
    const handler = pendingFail;
    sequenceToken += 1;
    sequenceNext = null;
    pendingFail = null;
    releaseTrigger();
    currentWord = "";
    // 离线音频加载/解码/播放失败时交给上层回退到系统语音。
    if (typeof handler === "function") handler(error);
  }

  function playSource(src, key, trigger = null, onFail = null) {
    if (!src) return false;
    window.CikeFrenchAudio?.stop?.();
    stop();
    currentWord = key;
    currentTrigger = trigger || null;
    pendingFail = typeof onFail === "function" ? onFail : null;
    if (currentTrigger) currentTrigger.classList.add("is-speaking");
    audio.src = src;
    try {
      audio.currentTime = 0;
    } catch (error) {
      // WebView 在元数据就绪前可能抛错。
    }
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      result.catch((error) => {
        if (currentWord !== key) return;
        failCurrent(error);
      });
    }
    return true;
  }

  function playWord(word, lang, trigger = null, onFail = null) {
    return playSource(fileFor(lang, word), normalize(word), trigger, onFail);
  }

  function playSentence(text, lang, trigger = null, onFail = null) {
    return playSource(sentenceFileFor(lang, text), normalize(text), trigger, onFail);
  }

  // 没有整句音频时，用本地单词音频按顺序拼出一句话。
  function playSequence(words, lang, trigger = null, onFail = null, onDone = null) {
    const items = (Array.isArray(words) ? words : [])
      .map((word) => fileFor(lang, word))
      .filter(Boolean);
    if (!items.length) return false;
    window.CikeFrenchAudio?.stop?.();
    stop();
    const token = sequenceToken;
    currentTrigger = trigger || null;
    if (currentTrigger) currentTrigger.classList.add("is-speaking");
    pendingFail = typeof onFail === "function" ? onFail : null;
    let cursor = 0;
    const playNext = () => {
      if (token !== sequenceToken) return;
      if (cursor >= items.length) {
        sequenceToken += 1;
        sequenceNext = null;
        pendingFail = null;
        releaseTrigger();
        currentWord = "";
        if (typeof onDone === "function") onDone();
        return;
      }
      const src = items[cursor];
      cursor += 1;
      currentWord = `seq:${token}:${cursor}`;
      audio.src = src;
      try {
        audio.currentTime = 0;
      } catch (error) {
        // WebView 在元数据就绪前可能抛错。
      }
      const result = audio.play();
      if (result && typeof result.catch === "function") {
        result.catch((error) => {
          if (token === sequenceToken) failCurrent(error);
        });
      }
    };
    sequenceNext = playNext;
    playNext();
    return true;
  }

  audio.addEventListener("ended", () => {
    if (sequenceNext) {
      const next = sequenceNext;
      next();
      return;
    }
    pendingFail = null;
    releaseTrigger();
    currentWord = "";
  });

  audio.addEventListener("error", () => {
    if (!currentWord) return;
    failCurrent(audio.error);
  });

  window.CikeWordAudio = {
    has: (word, lang) => Boolean(fileFor(lang, word)),
    hasSentence: (text, lang) => Boolean(sentenceFileFor(lang, text)),
    playWord,
    playSentence,
    playSequence,
    stop,
    languages: LANGUAGES.slice(),
    size(lang) {
      return Object.keys(indexFor(lang)).length;
    },
  };
})();
