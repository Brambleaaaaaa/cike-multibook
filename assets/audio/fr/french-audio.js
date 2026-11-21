/* Offline French word pronunciation. Uses pre-generated local m4a files. */
(() => {
  const BASE = "assets/audio/fr/";
  const INDEX = window.CIKE_FRENCH_AUDIO_INDEX || {};
  const audio = new Audio();
  audio.preload = "none";

  let currentTrigger = null;
  let currentWord = "";

  function normalize(word) {
    return String(word || "")
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function fileFor(word) {
    const file = INDEX[normalize(word)];
    return file ? BASE + file : "";
  }

  function releaseTrigger() {
    if (currentTrigger) currentTrigger.classList.remove("is-speaking");
    currentTrigger = null;
  }

  function stop() {
    if (!audio.paused) audio.pause();
    releaseTrigger();
    currentWord = "";
  }

  function playWord(word, trigger = null) {
    const src = fileFor(word);
    if (!src) return false;
    stop();
    currentWord = normalize(word);
    currentTrigger = trigger || null;
    if (currentTrigger) currentTrigger.classList.add("is-speaking");
    audio.src = src;
    try {
      audio.currentTime = 0;
    } catch (error) {
      // Some WebViews throw before metadata is ready.
    }
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        if (currentWord === normalize(word)) releaseTrigger();
      });
    }
    return true;
  }

  audio.addEventListener("ended", () => {
    releaseTrigger();
    currentWord = "";
  });

  audio.addEventListener("error", () => {
    releaseTrigger();
    currentWord = "";
  });

  window.CikeFrenchAudio = {
    has: (word) => Boolean(fileFor(word)),
    playWord,
    stop,
    get size() {
      return Object.keys(INDEX).length;
    },
  };
})();
