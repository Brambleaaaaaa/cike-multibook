/*
 * 词刻 CIKE · 手绘交互层
 * - 顶栏 / 底栏坞站放大镜
 * - 按钮点击纸屑粒子
 * - 图标弹跳与磁吸微动
 * 全部效果均可被 prefers-reduced-motion 关闭。
 */
(function () {
  "use strict";

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const palette = ["#F0D56B", "#A8D9C5", "#ACD8E4", "#E6B6C0", "#DD6F5D", "#242320"];
  let reduced = motionQuery.matches;

  /* ---------- 粒子层 ---------- */
  const canvas = document.createElement("canvas");
  canvas.className = "cike-fx-layer";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  let ctx = null;
  let dpr = 1;
  let particles = [];
  let raf = 0;

  // WebView 里 innerWidth 偶尔会比布局宽度多出几像素，粒子层超出视口会
  // 让页面出现一条横向滚动缝，这里统一按可视布局宽度取整。
  function viewportSize() {
    return {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    };
  }

  function sizeCanvas() {
    if (!ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = viewportSize();
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.hidden = false;
  }

  function drawStar(x, y, radius, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (let point = 0; point < 8; point += 1) {
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
      if (particle.y > window.innerHeight + 30) continue;
      const size = particle.size * particle.scale;
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.life));
      ctx.fillStyle = particle.color;
      if (particle.kind === "star") {
        drawStar(particle.x, particle.y, size * 1.2, particle.rotate);
      } else if (particle.kind === "ring") {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, size * 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (particle.kind === "strip") {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotate);
        ctx.fillRect(-size * 1.6, -size * 0.28, size * 3.2, size * 0.56);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      alive.push(particle);
    }
    ctx.globalAlpha = 1;
    particles = alive;
    if (particles.length) {
      raf = requestAnimationFrame(loop);
    } else {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function burst(x, y, count = 5, options = {}) {
    if (reduced || !ctx) return;
    const strength = options.strength || 1;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 2.1) * strength;
      const roll = Math.random();
      particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (options.rise || 0.5),
        gravity: 0.032 + Math.random() * 0.03,
        drag: 0.983,
        rotate: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.28,
        scale: 0.8 + Math.random() * 0.5,
        shrink: 0.989 + Math.random() * 0.006,
        size: 2.2 + Math.random() * 3.8,
        life: 1,
        decay: 0.013 + Math.random() * 0.011,
        color: palette[Math.floor(Math.random() * palette.length)],
        kind: roll < 0.5 ? "dot" : roll < 0.72 ? "star" : roll < 0.9 ? "strip" : "ring",
      });
    }
    if (particles.length > 160) particles.splice(0, particles.length - 160);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  /* 点击水波：落在手指位置，和粒子层同一套语言 */
  function ripple(target, x, y) {
    if (reduced) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(
      44,
      Math.min(260, Math.max(rect.width, rect.height) * 0.9),
    );
    const span = document.createElement("span");
    span.className = "fx-ripple";
    span.setAttribute("aria-hidden", "true");
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    // 弹层在 top layer 里，水波要挂到弹层内部才看得见
    const dialog = target.closest("dialog[open]");
    if (dialog) {
      const box = dialog.getBoundingClientRect();
      span.style.position = "absolute";
      span.style.left = `${x - box.left + dialog.scrollLeft - size / 2}px`;
      span.style.top = `${y - box.top + dialog.scrollTop - size / 2}px`;
      dialog.appendChild(span);
    } else {
      span.style.left = `${x - size / 2}px`;
      span.style.top = `${y - size / 2}px`;
      document.body.appendChild(span);
    }
    window.setTimeout(() => span.remove(), 520);
  }

  function ring(x, y, color) {
    if (reduced || !ctx) return;
    particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 1,
      rotate: 0,
      spin: 0,
      scale: 1.6,
      shrink: 0.94,
      size: 6,
      life: 0.9,
      decay: 0.05,
      color: color || "#242320",
      kind: "ring",
    });
    if (!raf) raf = requestAnimationFrame(loop);
  }

  if (!reduced) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        document.body.appendChild(canvas);
        ctx = canvas.getContext("2d");
        sizeCanvas();
      },
      { once: true },
    );
    window.addEventListener(
      "resize",
      () => {
        if (!ctx) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const { width, height } = viewportSize();
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
      { passive: true },
    );
  }

  motionQuery.addEventListener?.("change", (event) => {
    reduced = event.matches;
    if (reduced) {
      particles = [];
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      particles = [];
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  });

  /* ---------- 图标弹跳 ---------- */
  function popIcon(element) {
    if (reduced) return;
    const svg = element.querySelector("svg");
    if (!svg || svg.classList.contains("fx-icon-pop")) return;
    svg.classList.add("fx-icon-pop");
    window.setTimeout(() => svg.classList.remove("fx-icon-pop"), 460);
  }

  /* ---------- 顶栏 / 底栏坞站放大镜 ---------- */
  function setupDock(nav) {
    if (!nav) return;
    const items = Array.from(nav.querySelectorAll(".nav-item, .mobile-nav-item"));
    if (!items.length) return;
    const lens = document.createElement("span");
    lens.className = "dock-lens";
    lens.setAttribute("aria-hidden", "true");
    nav.appendChild(lens);
    let frame = 0;
    let pointerX = 0;
    let active = false;

    const reset = () => {
      active = false;
      lens.classList.remove("is-visible");
      for (const item of items) {
        item.style.setProperty("--dock-scale", "1");
        item.style.setProperty("--dock-lift", "0px");
        item.style.setProperty("--dock-glow", "0");
      }
    };

    const update = () => {
      frame = 0;
      if (!active) return;
      const navRect = nav.getBoundingClientRect();
      const range = Math.max(58, navRect.width / Math.max(3, items.length));
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const t = Math.max(0, 1 - Math.abs(pointerX - center) / range);
        const ease = t * t * (3 - 2 * t);
        item.style.setProperty("--dock-scale", (1 + 0.3 * ease).toFixed(3));
        item.style.setProperty("--dock-lift", `${(-9 * ease).toFixed(1)}px`);
        item.style.setProperty("--dock-glow", ease.toFixed(3));
      }
      const lensX = Math.max(20, Math.min(navRect.width - 20, pointerX - navRect.left));
      lens.style.setProperty("--lens-x", `${lensX.toFixed(1)}px`);
      lens.style.setProperty("--lens-y", `${(navRect.height / 2).toFixed(1)}px`);
    };

    nav.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerType === "touch" || reduced) return;
        pointerX = event.clientX;
        active = true;
        lens.classList.add("is-visible");
        if (!frame) frame = requestAnimationFrame(update);
      },
      { passive: true },
    );
    nav.addEventListener("pointerleave", () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      reset();
    });
  }

  setupDock(document.querySelector(".mobile-nav"));

  /* ---------- 全局按压状态 ---------- */
  const PRESSABLE_SELECTOR = [
    "button",
    "a[href]",
    '[role="button"]',
    "[data-action]",
    ".book-card",
    ".reader-book-card",
    ".typewords-card",
    ".reader-toc-item",
    ".home-entry",
    ".filter-tab",
    ".bgm-chip",
    ".word-card",
  ].join(", ");

  let pressedTarget = null;

  function setPressed(element) {
    if (pressedTarget === element) return;
    if (pressedTarget) pressedTarget.classList.remove("is-fx-pressed");
    pressedTarget = element;
    if (element) element.classList.add("is-fx-pressed");
  }

  function clearPressed() {
    setPressed(null);
  }

  document.addEventListener("pointerup", clearPressed, { passive: true });
  document.addEventListener("pointercancel", clearPressed, { passive: true });
  window.addEventListener("blur", clearPressed);

  function haptic(element) {
    if (typeof navigator.vibrate !== "function") return;
    if (
      element.matches(
        ".nav-item, .mobile-nav-item, .paper-btn, .button, .book-card, .reader-book-card, .typewords-card, .filter-tab, .direction-chip, .home-entry",
      )
    ) {
      navigator.vibrate(6);
    }
  }

  /* ---------- 点击粒子与图标动效 ---------- */
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const target = event.target.closest(PRESSABLE_SELECTOR);
      if (!target || target.disabled) return;
      setPressed(target);
      window.setTimeout(() => {
        if (pressedTarget === target) clearPressed();
      }, 260);
      if (event.pointerType !== "mouse") haptic(target);
      popIcon(target);
      const rect = target.getBoundingClientRect();
      const x = event.clientX || rect.left + rect.width / 2;
      const y = event.clientY || rect.top + rect.height / 2;
      burst(x, y, target.matches(".nav-item, .mobile-nav-item, .paper-btn, .button") ? 9 : 5);
      ripple(target, x, y);
      if (target.matches(".nav-item, .mobile-nav-item")) ring(x, y, "rgba(36,35,32,0.35)");
    },
    { passive: true },
  );

  document.addEventListener("pointerleave", clearPressed, { passive: true });

  /* ---------- 选书动画 ---------- */
  const SELECTION_SELECTOR =
    ".book-card, .reader-book-card, .typewords-card";
  const SELECTION_MS = 300;
  const BOOK_OPEN_MS = 340;

  document.addEventListener(
    "click",
    (event) => {
      if (reduced || event.detail === 0 || event.__cikeSelectPass) return;
      const card = event.target.closest(SELECTION_SELECTOR);
      if (!card || card.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      if (card.classList.contains("is-selecting")) return;
      card.classList.add("is-selecting");
      const stamp = document.createElement("span");
      stamp.className = "fx-select-stamp";
      stamp.setAttribute("aria-hidden", "true");
      stamp.textContent = "✓";
      card.appendChild(stamp);
      const rect = card.getBoundingClientRect();
      burst(
        rect.left + rect.width / 2,
        rect.top + rect.height * 0.4,
        9,
        { strength: 1.05 },
      );
      ring(
        rect.left + rect.width / 2,
        rect.top + rect.height * 0.4,
        "rgba(36,35,32,0.28)",
      );
      if (typeof navigator.vibrate === "function") navigator.vibrate(8);
      window.setTimeout(() => {
        card.classList.remove("is-selecting");
        stamp.remove();
        if (!card.isConnected) return;
        const replay = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        replay.__cikeSelectPass = true;
        card.dispatchEvent(replay);
      }, card.matches(".reader-book-card") ? BOOK_OPEN_MS : SELECTION_MS);
    },
    true,
  );

  /* ---------- 磁吸悬停（仅鼠标） ---------- */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches && !reduced) {
    const magnetic = new WeakMap();
    document.addEventListener(
      "pointermove",
      (event) => {
        const target =
          event.target.closest(".home-entry, .paper-btn, .small-paper-btn, .button") ||
          null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy);
        if (distance > 90) {
          target.style.removeProperty("--mag-x");
          target.style.removeProperty("--mag-y");
          return;
        }
        const pull = Math.min(4, (1 - distance / 90) * 6);
        const norm = Math.max(1, distance);
        target.style.setProperty("--mag-x", `${((dx / norm) * pull).toFixed(2)}px`);
        target.style.setProperty("--mag-y", `${((dy / norm) * pull).toFixed(2)}px`);
        magnetic.set(target, true);
      },
      { passive: true },
    );
    document.addEventListener(
      "pointerleave",
      (event) => {
        if (event.target instanceof Element && magnetic.has(event.target)) {
          event.target.style.removeProperty("--mag-x");
          event.target.style.removeProperty("--mag-y");
        }
      },
      true,
    );
  }

  window.CikeFx = { burst, ring, popIcon };
})();