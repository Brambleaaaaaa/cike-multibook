import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../core.js");

const now = Date.UTC(2026, 10, 18, 4, 0, 0);

assert.equal(core.normalizeAnswer("  Cognitive  "), "cognitive");
assert.equal(core.normalizeAnswer("Cope"), "cope");

const fresh = core.gradeAnswer(undefined, "know", now);
assert.equal(fresh.status, "learning");
assert.equal(fresh.correct, 1);
assert.equal(fresh.interval, 1);
assert.ok(fresh.due > now);

const wrong = core.gradeAnswer(fresh, "again", now + 50);
assert.equal(wrong.correct, 1);
assert.equal(wrong.wrong, 1);
assert.equal(wrong.status, "learning");
assert.ok(wrong.due > now + 50);

const mastered = core.markMastered(fresh, now + 100);
assert.equal(mastered.status, "mastered");
assert.ok(mastered.due > now + core.DAY_MS);

const words = [
  { id: "alpha", rank: 1, unit: 1, tags: ["listening", "reading"] },
  { id: "beta", rank: 2, unit: 1, tags: ["reading", "writing"] },
  { id: "gamma", rank: 3, unit: 2, tags: ["reading"] },
];
const fixedProgress = {
  alpha: { status: "learning", due: now - 10, wrong: 2 },
  beta: { status: "learning", due: now - 5, wrong: 0 },
};
const queue = core.buildSessionQueue(words, fixedProgress, {
  tag: "reading",
  size: 3,
  mode: "mixed",
  now,
});
assert.equal(queue.length, 3);
assert.equal(queue[0].word.id, "alpha");
assert.equal(queue[0].kind, "recognize");
assert.equal(queue[1].kind, "listen");

assert.equal(core.filterWords(words, { tag: "writing" }).length, 1);
assert.equal(core.filterWords(words, { unit: 1 }).length, 2);

console.log("core tests passed");
