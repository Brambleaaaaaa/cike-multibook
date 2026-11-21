/* Background music manager for 词刻. One audio element per track so switching is reliable in Android WebView. */
(() => {
  const TRACKS = [
    { id: "epiphany", title: "Epiphany", duration: "1:21", src: "assets/audio/bgm/epiphany.m4a" },
    { id: "lion", title: "Lion", duration: "1:25", src: "assets/audio/bgm/lion.m4a" },
    { id: "rime", title: "Rime", duration: "3:27", src: "assets/audio/bgm/rime.m4a" },
    { id: "orken", title: "Ørken", duration: "2:02", src: "assets/audio/bgm/orken.m4a" },
    { id: "exile", title: "流亡", duration: "2:15", src: "assets/audio/bgm/exile.m4a" },
    { id: "snowfall", title: "Snowfall", duration: "1:00", src: "assets/audio/bgm/snowfall.m4a" },
    { id: "evo", title: "Evo", duration: "2:01", src: "assets/audio/bgm/evo.m4a" },
    { id: "siren", title: "斯人", duration: "2:03", src: "assets/audio/bgm/siren.m4a" },
    { id: "pingfeng", title: "萍逢", duration: "2:02", src: "assets/audio/bgm/pingfeng.m4a" },
    { id: "gin", title: "GIN", duration: "1:43", src: "assets/audio/bgm/gin.m4a" },
    { id: "gudichou", title: "故敌愁", duration: "4:44", src: "assets/audio/bgm/gudichou.m4a" },
    { id: "huaqiao", title: "画桥雨下", duration: "6:30", src: "assets/audio/bgm/huaqiao.m4a" },
    { id: "bear-apple", title: "小 熊 貓 和 蘋 果", duration: "8:17", src: "assets/audio/bgm/bear-apple.m4a" },
    { id: "south-dust", title: "南方尘埃", duration: "4:30", src: "assets/audio/bgm/south-dust.m4a" },
  ];

  const players = new Map();
  let volume = 0.35;
  let currentId = "";
  let wantPlay = false;
  let hiddenPaused = false;
  let suspended = false;
  let suspendWasPlaying = false;

  function trackById(id) {
    return TRACKS.find((track) => track.id === id) || null;
  }

  function emit() {
    window.dispatchEvent(new CustomEvent("cike:bgm-state", { detail: getState() }));
  }

  function createPlayer(track) {
    const audio = new Audio();
    audio.src = track.src;
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = volume;
    audio.addEventListener("playing", emit);
    audio.addEventListener("pause", emit);
    audio.addEventListener("loadedmetadata", emit);
    audio.addEventListener("error", () => {
      if (audio.error) emit();
    });
    return audio;
  }

  function playerFor(id) {
    const track = trackById(id);
    if (!track) return null;
    if (!players.has(id)) players.set(id, createPlayer(track));
    return players.get(id);
  }

  function activePlayer() {
    return currentId ? players.get(currentId) || null : null;
  }

  function pauseOthers(exceptId) {
    players.forEach((audio, id) => {
      if (id !== exceptId && !audio.paused) audio.pause();
    });
  }

  function getState() {
    const audio = activePlayer();
    return {
      trackId: currentId,
      playing: Boolean(audio) && !audio.paused && !audio.ended,
      wantPlay,
      volume,
      suspended,
      currentTime: Number(audio?.currentTime) || 0,
      duration: Number(audio?.duration) || 0,
      src: audio?.currentSrc || audio?.src || "",
    };
  }

  function setVolume(value) {
    const next = Math.max(0, Math.min(1, Number(value)));
    volume = Number.isFinite(next) ? next : 0.35;
    players.forEach((audio) => {
      audio.volume = volume;
    });
    emit();
  }

  function setTrack(id) {
    const track = trackById(id);
    if (!track) {
      if (currentId) stop();
      return false;
    }
    if (currentId && currentId !== id) {
      const previous = players.get(currentId);
      if (previous && !previous.paused) previous.pause();
    }
    currentId = id;
    playerFor(id);
    return true;
  }

  function playOnce(audio) {
    return audio.play();
  }

  async function play(id) {
    if (id && !setTrack(id)) return false;
    if (!currentId) return false;
    wantPlay = true;
    /* While suspended (e.g. on the listening page) keep the intent but stay silent. */
    if (suspended) {
      emit();
      return true;
    }
    const audio = playerFor(currentId);
    if (!audio) return false;
    pauseOthers(currentId);
    audio.volume = volume;
    try {
      const result = playOnce(audio);
      if (result && typeof result.then === "function") await result;
      emit();
      return true;
    } catch (error) {
      /* Android WebView sometimes rejects play() before metadata is ready. Retry once. */
      const retried = await new Promise((resolve) => {
        let settled = false;
        const attempt = () => {
          if (settled) return;
          settled = true;
          const result = playOnce(audio);
          if (result && typeof result.then === "function") {
            result.then(() => resolve(true)).catch(() => resolve(false));
          } else {
            resolve(true);
          }
        };
        if (audio.readyState >= 1) {
          attempt();
          return;
        }
        audio.addEventListener("loadedmetadata", attempt, { once: true });
        window.setTimeout(attempt, 900);
      });
      emit();
      return retried;
    }
  }

  function pause() {
    wantPlay = false;
    const audio = activePlayer();
    if (audio && !audio.paused) audio.pause();
    emit();
  }

  function stop() {
    wantPlay = false;
    hiddenPaused = false;
    players.forEach((audio) => {
      if (!audio.paused) audio.pause();
    });
    currentId = "";
    emit();
  }

  function resume() {
    if (suspended) return;
    if (!wantPlay || !currentId) return;
    const audio = players.get(currentId);
    if (!audio || !audio.paused) return;
    const result = audio.play();
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  /* Listening pages suspend the music without losing the exact playback position. */
  function suspend() {
    if (suspended) return;
    suspended = true;
    const audio = activePlayer();
    suspendWasPlaying = Boolean(audio) && !audio.paused;
    if (suspendWasPlaying) audio.pause();
    emit();
  }

  function restore() {
    if (!suspended) return;
    suspended = false;
    const shouldResume = suspendWasPlaying && wantPlay;
    suspendWasPlaying = false;
    emit();
    if (shouldResume) resume();
  }

  /* Browsers block autoplay until a user gesture; retry on the first interaction. */
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);

  document.addEventListener("visibilitychange", () => {
    const audio = activePlayer();
    if (!audio) return;
    if (document.hidden) {
      if (!audio.paused) {
        hiddenPaused = true;
        audio.pause();
      }
    } else if (hiddenPaused) {
      hiddenPaused = false;
      resume();
    }
  });

  window.CikeBgm = {
    tracks: TRACKS.map((track) => ({ ...track })),
    getState,
    setVolume,
    setTrack,
    play,
    pause,
    stop,
    resume,
    suspend,
    restore,
  };
})();
