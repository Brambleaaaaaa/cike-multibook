const CACHE_NAME = "cike-multibook-v3.2.15-apk";
const NETWORK_FIRST = /(?:^|\/)(?:index\.html|app\.js|core\.js|word-audio-player\.js|styles\.css|handdrawn\.css|launch\.js|interactions\.js)$/;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./handdrawn.css",
  "./launch.js",
  "./interactions.js",
  "./core.js",
  "./storage.js",
  "./ai-service.js",
  "./words.js",
  "./book-cet6-attachment.js",
  "./book-en-10000.js",
  "./book-fr-a1-b2.js",
  "./book-en-medical.js",
  "./book-es-core.js",
  "./book-de-core.js",
  "./book-it-core.js",
  "./book-ja-core.js",
  "./book-yue-core.js",
  "./book-la-core.js",
  "./listening-wordbook.js",
  "./writing-library.js",
  "./exam-library.js",
  "./listening-library.js",
  "./analysis/listening/manifest.js",
  "./analysis/writing/manifest.js",
  "./preloaded-user-library.js",
  "./covers/provided-01.jpg",
  "./covers/provided-05.jpg",
  "./covers/provided-06.jpg",
  "./covers/provided-08.jpg",
  "./covers/provided-11.jpg",
  "./covers/provided-13.jpg",
  "./covers/provided-14.jpg",
  "./covers/provided-15.jpg",
  "./covers/provided-16.jpg",
  "./covers/provided-17.jpg",
  "./covers/provided-18.jpg",
  "./covers/provided-19.jpg",
  "./covers/provided-20.jpg",
  "./covers/provided-21.jpg",
  "./covers/provided-22.jpg",
  "./covers/provided-23.jpg",
  "./covers/provided-24.jpg",
  "./covers/provided-25.jpg",
  "./covers/provided-26.jpg",
  "./covers/provided-28.jpg",
  "./covers/provided-29.jpg",
  "./preloaded-novels-library.js",
  "./public-library.js",
  "./classic-ip.js",
  "./typewords-catalog.js",
  "./typewords-dictionary.js",
  "./vendor/jszip.min.js",
  "./vendor/pdf.mjs",
  "./vendor/pdf.worker.mjs",
  "./vendor/wasm/openjpeg.wasm",
  "./vendor/wasm/openjpeg_nowasm_fallback.js",
  "./vendor/wasm/jbig2.wasm",
  "./vendor/wasm/qcms_bg.wasm",
  "./assets/audio/sound-manager.js",
  "./assets/audio/bgm/bgm-manager.js",
  "./assets/audio/en/word-audio.js",
  "./assets/audio/en/sentences.js",
  "./assets/audio/fr/word-audio.js",
  "./assets/audio/fr/french-audio.js",
  "./assets/audio/bgm/epiphany.m4a",
  "./assets/audio/bgm/lion.m4a",
  "./assets/audio/bgm/rime.m4a",
  "./assets/audio/bgm/orken.m4a",
  "./assets/audio/bgm/exile.m4a",
  "./assets/audio/bgm/snowfall.m4a",
  "./assets/audio/bgm/evo.m4a",
  "./assets/audio/bgm/siren.m4a",
  "./assets/audio/bgm/pingfeng.m4a",
  "./assets/audio/bgm/gin.m4a",
  "./assets/audio/bgm/gudichou.m4a",
  "./assets/audio/bgm/huaqiao.m4a",
  "./assets/audio/bgm/bear-apple.m4a",
  "./assets/audio/bgm/south-dust.m4a",
  "./assets/audio/ui/01_tap.wav",
  "./assets/audio/ui/02_back.wav",
  "./assets/audio/ui/03_tab.wav",
  "./assets/audio/ui/04_card_flip.wav",
  "./assets/audio/ui/05a_rating_again.wav",
  "./assets/audio/ui/05b_rating_hard.wav",
  "./assets/audio/ui/05c_rating_normal.wav",
  "./assets/audio/ui/05d_rating_know.wav",
  "./assets/audio/ui/06a_key.wav",
  "./assets/audio/ui/06b_key.wav",
  "./assets/audio/ui/06c_key.wav",
  "./assets/audio/ui/07_correct.wav",
  "./assets/audio/ui/08_wrong.wav",
  "./assets/audio/ui/09_hint.wav",
  "./assets/audio/ui/10_submit.wav",
  "./assets/audio/ui/11_note.wav",
  "./assets/audio/ui/12_next.wav",
  "./assets/audio/ui/13_complete.wav",
  "./assets/audio/ui/14a_page_turn.wav",
  "./assets/audio/ui/14b_page_turn.wav",
  "./assets/audio/ui/14c_page_turn.wav",
  "./assets/audio/ui/15_bookmark.wav",
  "./assets/audio/ui/16_ocr_start.wav",
  "./assets/audio/ui/17_ocr_done.wav",
  "./assets/audio/ui/18_backup.wav",
  "./assets/audio/ui/19_brand.wav",
  "./assets/paper-texture.svg",
  "./assets/splash-cike-paper.jpg",
  "./assets/PatrickHand-Regular.ttf",
  "./assets/MaShanZheng-Regular.ttf",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Listening audio is large and served with Range requests; keep it out of
  // the app-shell cache so installs and playback stay fast.
  if (url.pathname.includes("/audio/listening/")) return;
  // Analysis pages are bundled images; load them from assets/network directly
  // so the app-shell cache does not balloon by tens of megabytes.
  if (url.pathname.includes("/analysis/listening/")) return;
  if (url.pathname.includes("/analysis/writing/")) return;
  // Public-domain texts are read once per session and can be several MB each;
  // keep them out of the app-shell cache so storage does not grow by hundreds
  // of megabytes.
  if (url.pathname.includes("/library/public/")) return;
  // Imported PDFs are tens of megabytes each and only read while the book is
  // open; never put them in the app-shell cache.
  if (url.pathname.includes("/books/")) return;
  if (event.request.headers.get("range")) return;

  // 入口与交互代码走网络优先：更新后第一次刷新就能看到新界面，
  // 离线时再回落到缓存，避免用户被旧版 UI 卡住。
  if (event.request.mode === "navigate" || NETWORK_FIRST.test(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
