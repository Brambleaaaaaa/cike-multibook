(function () {
  "use strict";

  const splash = document.getElementById("splashScreen");
  const button = document.getElementById("enterApp");
  const thumb = button?.querySelector(".splash-thumb");
  const status = document.getElementById("splashStatus");
  const label = button?.querySelector(".splash-enter-label");
  const canvas = document.getElementById("splashTrail");
  const paperLayer = splash?.querySelector(".splash-paper-layer");
  const stationerySlots = Array.from(
    document.querySelectorAll("#splashStationery .stationery-slot"),
  );
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const PALETTE = ["#F0D56B", "#A8D9C5", "#ACD8E4", "#E6B6C0", "#DD6F5D", "#242320"];

  let reduceMotion = motionQuery.matches;
  let ready = false;
  let entered = false;
  let dragging = false;
  let startX = 0;
  let dragX = 0;
  let ctx = null;
  let dpr = 1;
  let particles = [];
  let raf = 0;
  let lastX = 0;
  let lastY = 0;
  let hasLast = false;
  let pointerDown = false;
  let parallaxFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let shakeTimer = 0;
  let pressSoundPlayed = false;
  let hapticDone = false;
  let pendingEnter = false;
  let maxDrag = 128;
  let armed = false;
  let autoSliding = false;
  let springTimer = 0;
  let settleTimer = 0;

  if (localStorage.getItem("cike-entered-before") === "1") {
    const subtitle = document.querySelector(".splash-subtitle");
    if (subtitle) subtitle.textContent = "欢迎回到你的页边";
  }

  function sizeCanvas() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clearCanvas() {
    if (canvas && ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function stopCanvas() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    particles = [];
    clearCanvas();
  }

  function spawn(x, y, vx, vy, burst) {
    if (!ctx || reduceMotion) return;
    const count = burst ? 8 : 3;
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = burst ? 1.3 + Math.random() * 3 : 0.5 + Math.random() * 1.7;
      const kindRoll = Math.random();
      particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed + vx * 0.35,
        vy: Math.sin(angle) * speed - (burst ? 1.3 : 0.3) + vy * 0.35,
        gravity: 0.032 + Math.random() * 0.04,
        drag: 0.985,
        rotate: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        scale: 0.8 + Math.random() * 0.55,
        shrink: 0.988 + Math.random() * 0.006,
        size: 2 + Math.random() * 4.5,
        life: 1,
        decay: 0.012 + Math.random() * 0.013,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        kind: kindRoll < 0.46 ? "dot" : kindRoll < 0.7 ? "star" : kindRoll < 0.88 ? "strip" : "confetti",
      });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function drawStar(x, y, radius, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (let point = 0; point < 8; point++) {
      const r = point % 2 === 0 ? radius : radius * 0.32;
      const angle = (Math.PI / 4) * point - Math.PI / 2;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (point === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function loop() {
    raf = 0;
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const alive = [];
    for (const particle of particles) {
      particle.life -= particle.decay;
      if (particle.life <= 0) continue;
      particle.vx *= particle.drag;
      particle.vy = particle.vy * particle.drag + particle.gravity;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotate += particle.spin;
      particle.scale *= particle.shrink;
      if (particle.y > window.innerHeight + 40 || particle.scale < 0.25) continue;
      const size = particle.size * particle.scale;
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      if (particle.kind === "dot") {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (particle.kind === "star") {
        drawStar(particle.x, particle.y, size * 1.15, particle.rotate);
      } else if (particle.kind === "strip") {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotate);
        ctx.fillRect(-size * 1.7, -size * 0.3, size * 3.4, size * 0.6);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotate);
        ctx.fillRect(-size * 0.7, -size * 0.5, size * 1.4, size);
        ctx.restore();
      }
      alive.push(particle);
    }
    ctx.globalAlpha = 1;
    particles = alive;
    if (particles.length && splash && !splash.hidden && !document.hidden) {
      raf = requestAnimationFrame(loop);
    } else {
      clearCanvas();
    }
  }

  function applyParallax() {
    parallaxFrame = 0;
    if (!paperLayer || reduceMotion || entered) return;
    const nx = (pointerX / window.innerWidth - 0.5) * 2;
    const ny = (pointerY / window.innerHeight - 0.5) * 2;
    paperLayer.style.setProperty("--paper-shift-x", (-nx * 2.2).toFixed(2) + "px");
    paperLayer.style.setProperty("--paper-shift-y", (-ny * 1.6).toFixed(2) + "px");
    for (const slot of stationerySlots) {
      const depth = Number(slot.dataset.depth) || 4;
      slot.style.setProperty("--item-x", (-nx * depth).toFixed(2) + "px");
      slot.style.setProperty("--item-y", (-ny * depth).toFixed(2) + "px");
    }
  }

  function queueParallax(x, y) {
    pointerX = x;
    pointerY = y;
    if (!parallaxFrame) parallaxFrame = requestAnimationFrame(applyParallax);
  }

  function resetParallax() {
    if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
    parallaxFrame = 0;
    if (paperLayer) {
      paperLayer.style.setProperty("--paper-shift-x", "0px");
      paperLayer.style.setProperty("--paper-shift-y", "0px");
    }
    for (const slot of stationerySlots) {
      slot.style.setProperty("--item-x", "0px");
      slot.style.setProperty("--item-y", "0px");
    }
  }

  function triggerTremor() {
    if (!splash || reduceMotion) return;
    splash.classList.remove("is-shaking");
    void splash.offsetWidth;
    splash.classList.add("is-shaking");
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => splash.classList.remove("is-shaking"), 190);
  }

  function triggerHaptic() {
    if (hapticDone) return;
    hapticDone = true;
    try {
      if (typeof navigator.vibrate === "function" && !reduceMotion) {
        navigator.vibrate(10);
      }
    } catch (error) {
      /* vibration is optional */
    }
  }

  function playPressSound() {
    if (pressSoundPlayed) return;
    pressSoundPlayed = true;
    try {
      window.CikeSound?.unlock?.();
      window.CikeSound?.play?.("flip");
    } catch (error) {
      /* audio is optional */
    }
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function measureTrack() {
    if (!button || !thumb) return 128;
    const styles = window.getComputedStyle(button);
    const padLeft = parseFloat(styles.paddingLeft) || 0;
    const padRight = parseFloat(styles.paddingRight) || 0;
    return Math.max(72, button.clientWidth - thumb.offsetWidth - padLeft - padRight);
  }

  function thumbCenter() {
    if (!thumb) return [0, 0];
    const rect = thumb.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  }

  function burstAtThumb(times = 1) {
    const [x, y] = thumbCenter();
    for (let index = 0; index < times; index += 1) {
      spawn(x, y, 0, 0, true);
    }
  }

  function paintDrag(progressOverride) {
    if (!button || !thumb) return;
    const progress = clamp01(
      typeof progressOverride === "number"
        ? progressOverride
        : dragX / Math.max(1, maxDrag),
    );
    button.style.setProperty("--drag-progress", progress.toFixed(3));
    thumb.style.transform = `translateX(${dragX.toFixed(1)}px)`;
    const near = progress >= 0.55;
    const readyToDrop = progress >= 0.78;
    button.classList.toggle("is-near", near);
    button.classList.toggle("is-armed", readyToDrop && progress < 0.999);
    if (label) {
      label.textContent = readyToDrop
        ? "松手进入"
        : progress > 0.03
          ? "继续向右滑"
          : "滑动进入";
      label.classList.toggle("is-armed", readyToDrop);
    }
    if (readyToDrop && !armed) {
      armed = true;
      burstAtThumb(1);
      try {
        if (typeof navigator.vibrate === "function" && !reduceMotion) {
          navigator.vibrate(8);
        }
      } catch (error) {
        /* vibration is optional */
      }
    } else if (!readyToDrop) {
      armed = false;
    }
  }

  function springBack() {
    if (!button || !thumb) return;
    dragX = 0;
    button.classList.remove("is-armed", "is-near", "is-dragging");
    button.classList.add("is-springing");
    button.style.setProperty("--drag-progress", "0");
    thumb.style.transform = "translateX(0px)";
    if (label) {
      label.textContent = "滑动进入";
      label.classList.remove("is-armed");
    }
    window.clearTimeout(springTimer);
    springTimer = window.setTimeout(
      () => button.classList.remove("is-springing"),
      460,
    );
  }

  function slideToEnd(duration) {
    if (!button || !thumb || autoSliding || entered) return;
    autoSliding = true;
    dragging = false;
    maxDrag = measureTrack();
    button.classList.remove("is-dragging");
    button.classList.add("is-auto-sliding", "is-near");
    const from = dragX;
    const target = maxDrag;
    const limit = reduceMotion ? 0 : duration || 220;
    const start = performance.now();
    const step = (now) => {
      const progress = limit <= 0 ? 1 : Math.min(1, (now - start) / limit);
      const eased = 1 - Math.pow(1 - progress, 3);
      dragX = from + (target - from) * eased;
      paintDrag();
      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }
      autoSliding = false;
      button.classList.remove("is-armed");
      button.classList.add("is-complete");
      if (label) label.textContent = "翻开词书";
      burstAtThumb(3);
      window.setTimeout(enter, reduceMotion ? 0 : 90);
    };
    requestAnimationFrame(step);
  }

  function autoSlide() {
    if (!ready || entered || autoSliding) return;
    maxDrag = measureTrack();
    slideToEnd(dragX > 4 ? 180 : 560);
  }

  function enter() {
    if (entered) return;
    if (!ready) {
      pendingEnter = true;
      return;
    }
    try {
      if (window.CikeSound) {
        window.CikeSound.unlock();
        window.CikeSound.playOnce("brand");
      } else {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(950, now);
        oscillator.frequency.exponentialRampToValueAtTime(320, now + 0.055);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.055, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.08);
      }
    } catch {
      // Audio is optional and never blocks entry.
    }
    entered = true;
    localStorage.setItem("cike-entered-before", "1");
    button?.classList.add("is-complete");
    burstAtThumb(4);
    resetParallax();
    splash?.classList.remove("is-shaking");
    splash?.classList.add("is-leaving");
    document.body.classList.add("app-is-entered");
    setTimeout(
      () => {
        if (splash) splash.hidden = true;
        stopCanvas();
        // 进入动画结束时不要抢走用户已经点中的输入框焦点。
        const mainEl = document.getElementById("main");
        const active = document.activeElement;
        if (mainEl && (!active || active === document.body || active === mainEl)) {
          mainEl.focus({ preventScroll: true });
        }
      },
      reduceMotion ? 200 : 720,
    );
  }

  function settleSplash() {
    if (!splash || splash.hidden) return;
    splash.classList.add("is-settled");
  }

  function scheduleSettle() {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settleSplash, 1250);
  }

  scheduleSettle();

  function reopen() {
    entered = false;
    pendingEnter = false;
    dragging = false;
    autoSliding = false;
    dragX = 0;
    armed = false;
    stopCanvas();
    resetParallax();
    if (splash) {
      splash.hidden = false;
      splash.classList.remove("is-leaving");
      splash.classList.remove("is-shaking");
      splash.classList.remove("is-settled");
      scheduleSettle();
    }
    document.body.classList.remove("app-is-entered");
    if (button) {
      button.disabled = !ready;
      button.classList.remove(
        "is-dragging",
        "is-armed",
        "is-near",
        "is-complete",
        "is-hint",
        "is-springing",
        "is-auto-sliding",
      );
      button.style.removeProperty("--drag-progress");
    }
    if (thumb) thumb.style.transform = "";
    if (label) {
      label.textContent = "滑动进入";
      label.classList.remove("is-armed");
    }
    if (status) {
      status.textContent = ready
        ? "按住圆点，一路滑到最右边才会翻开"
        : "正在整理你的纸页…";
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function setReady() {
    ready = true;
    if (button) button.disabled = false;
    if (status) status.textContent = "按住圆点，一路滑到最右边才会翻开";
    if (pendingEnter && !entered) {
      pendingEnter = false;
      enter();
    }
  }

  if (!reduceMotion) {
    let scrollFrame = 0;
    window.addEventListener(
      "scroll",
      () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
          document.documentElement.style.setProperty(
            "--page-scroll",
            `${Math.min(window.scrollY * 0.08, 80)}px`,
          );
          scrollFrame = 0;
        });
      },
      { passive: true },
    );
  }

  if (canvas) {
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas, { passive: true });
  }

  splash?.addEventListener(
    "pointerdown",
    (event) => {
      pointerDown = true;
      hasLast = true;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!entered) {
        playPressSound();
        triggerHaptic();
        triggerTremor();
      }
      if (ready && !entered) spawn(event.clientX, event.clientY, 0, 0, true);
    },
    { passive: true },
  );

  splash?.addEventListener(
    "pointermove",
    (event) => {
      if (entered) return;
      queueParallax(event.clientX, event.clientY);
      if (!pointerDown || !ready) return;
      const moveX = hasLast ? event.clientX - lastX : 0;
      const moveY = hasLast ? event.clientY - lastY : 0;
      const distance = Math.hypot(moveX, moveY);
      lastX = event.clientX;
      lastY = event.clientY;
      hasLast = true;
      if (distance < 2) return;
      spawn(event.clientX, event.clientY, moveX * 0.08, moveY * 0.08, false);
    },
    { passive: true },
  );

  function endPointer() {
    pointerDown = false;
    hasLast = false;
  }

  window.addEventListener("pointerup", endPointer, { passive: true });
  window.addEventListener("pointercancel", endPointer, { passive: true });

  splash?.addEventListener(
    "pointerleave",
    () => {
      hasLast = false;
      if (!pointerDown) resetParallax();
    },
    { passive: true },
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCanvas();
  });

  motionQuery.addEventListener?.("change", (event) => {
    reduceMotion = event.matches;
    if (reduceMotion) {
      stopCanvas();
      resetParallax();
      splash?.classList.remove("is-shaking");
    }
  });

  if (button) button.disabled = true;
  window.addEventListener("cike-app-ready", setReady, { once: true });
  if (window.__cikeReady) setReady();

  let dragMoved = false;

  function hintSlide() {
    if (!button) return;
    button.classList.remove("is-hint");
    void button.offsetWidth;
    button.classList.add("is-hint");
    if (status) status.textContent = "手指按住圆点，一路滑到最右边才会翻开。";
    window.setTimeout(() => button.classList.remove("is-hint"), 900);
  }

  button?.addEventListener("pointerdown", (event) => {
    if (!ready || entered || autoSliding) return;
    if (event.button !== undefined && event.button > 0) return;
    dragging = true;
    dragMoved = false;
    startX = event.clientX;
    dragX = 0;
    maxDrag = measureTrack();
    button.classList.remove("is-springing", "is-complete", "is-hint");
    button.setPointerCapture?.(event.pointerId);
    button.classList.add("is-dragging");
    playPressSound();
    paintDrag();
  });

  button?.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const raw = Math.max(0, Math.min(maxDrag, event.clientX - startX));
    if (Math.abs(event.clientX - startX) > 4) dragMoved = true;
    const gap = maxDrag - raw;
    dragX = gap < 26 ? maxDrag - gap * 0.3 : raw;
    paintDrag();
    if (dragX >= maxDrag - 1) slideToEnd(170);
  });

  function release() {
    if (!dragging) return;
    dragging = false;
    button?.classList.remove("is-dragging");
    const progress = dragX / Math.max(1, maxDrag);
    if (progress >= 0.88 || dragX >= maxDrag - 2) {
      slideToEnd(170);
    } else {
      springBack();
    }
  }

  button?.addEventListener("pointerup", release);
  button?.addEventListener("pointercancel", release);
  button?.addEventListener("click", () => {
    if (!ready || entered) return;
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    if (navigator.webdriver) {
      autoSlide();
      return;
    }
    hintSlide();
  });
  button?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      autoSlide();
    }
  });

  window.CikeSplash = { enter, reopen, isEntered: () => entered };
  window.CikeLaunch = { reopen };
})();
