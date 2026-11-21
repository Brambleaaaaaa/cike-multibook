/* Lightweight UI sound manager for 词刻. Loads local WAV files with Web Audio. */
(() => {
  const BASE = "assets/audio/ui/";
  const FILES = {
    tap: "01_tap.wav",
    back: "02_back.wav",
    tab: "03_tab.wav",
    flip: "04_card_flip.wav",
    "rating-again": "05a_rating_again.wav",
    "rating-hard": "05b_rating_hard.wav",
    "rating-normal": "05c_rating_normal.wav",
    "rating-know": "05d_rating_know.wav",
    key: ["06a_key.wav", "06b_key.wav", "06c_key.wav"],
    correct: "07_correct.wav",
    wrong: "08_wrong.wav",
    hint: "09_hint.wav",
    submit: "10_submit.wav",
    note: "11_note.wav",
    next: "12_next.wav",
    complete: "13_complete.wav",
    page: ["14a_page_turn.wav", "14b_page_turn.wav", "14c_page_turn.wav"],
    bookmark: "15_bookmark.wav",
    "ocr-start": "16_ocr_start.wav",
    "ocr-done": "17_ocr_done.wav",
    backup: "18_backup.wav",
    brand: "19_brand.wav",
  };

  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.35;
  let brandUsed = false;
  const buffers = new Map();
  const loading = new Map();
  const failed = new Set();
  const lastAt = Object.create(null);
  const activeSources = new Set();

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch (error) {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function unlock() {
    const audio = ensureContext();
    if (!audio) return false;
    if (audio.state === "suspended") audio.resume().catch(() => {});
    return true;
  }

  function load(file) {
    if (buffers.has(file)) return Promise.resolve(buffers.get(file));
    if (failed.has(file)) return Promise.resolve(null);
    if (loading.has(file)) return loading.get(file);
    const audio = ensureContext();
    if (!audio) return Promise.resolve(null);
    const promise = fetch(BASE + file)
      .then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.arrayBuffer();
      })
      .then((data) => audio.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(file, buffer);
        return buffer;
      })
      .catch(() => {
        failed.add(file);
        return null;
      });
    loading.set(file, promise);
    return promise;
  }

  function prefetch() {
    const files = new Set();
    Object.values(FILES).forEach((value) => {
      (Array.isArray(value) ? value : [value]).forEach((file) => files.add(file));
    });
    files.forEach((file) => load(file));
  }

  function start(buffer) {
    if (!ctx || !master || !enabled) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      source.onended = () => activeSources.delete(source);
      activeSources.add(source);
      source.start();
    } catch (error) {
      /* ignore playback errors */
    }
  }

  function play(name) {
    if (!enabled) return false;
    const audio = ensureContext();
    if (!audio) return false;
    if (audio.state === "suspended") audio.resume().catch(() => {});
    const spec = FILES[name];
    if (!spec) return false;
    const file = Array.isArray(spec)
      ? spec[Math.floor(Math.random() * spec.length)]
      : spec;
    if (failed.has(file)) return false;
    const cooldown = name === "key" ? 45 : 70;
    const now = performance.now();
    if (now - (lastAt[name] || 0) < cooldown) return true;
    lastAt[name] = now;
    const buffer = buffers.get(file);
    if (buffer) {
      start(buffer);
      return true;
    }
    load(file).then((loaded) => {
      if (loaded) start(loaded);
    });
    return true;
  }

  function playOnce(name) {
    if (name === "brand") {
      if (brandUsed) return true;
      brandUsed = true;
    }
    return play(name);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
      activeSources.forEach((source) => {
        try {
          source.stop();
        } catch (error) {
          /* already stopped */
        }
      });
      activeSources.clear();
    }
  }

  function setVolume(value) {
    const next = Math.max(0, Math.min(1, Number(value)));
    volume = Number.isFinite(next) ? next : 0.35;
    if (master) master.gain.value = volume;
  }

  window.CikeSound = {
    play,
    playOnce,
    unlock,
    prefetch,
    setEnabled,
    setVolume,
    getEnabled: () => enabled,
  };

  const firstGesture = () => {
    unlock();
    prefetch();
    window.removeEventListener("pointerdown", firstGesture, true);
    window.removeEventListener("keydown", firstGesture, true);
  };
  window.addEventListener("pointerdown", firstGesture, true);
  window.addEventListener("keydown", firstGesture, true);
})();