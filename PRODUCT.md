# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: static HTML/CSS/JavaScript. The product is a single-user, local-first study tool; a dependency-free build keeps it directly usable, portable, and easy to host on any static server.

## Users

The primary user is a Chinese-speaking CET-6 candidate who wants short, repeatable vocabulary sessions on a laptop or phone. The user may study offline and wants one dependable place for new words, due reviews, listening recognition, and Chinese-to-English dictation. This audience and operating context are inferred from the explicit request because the user delegated the remaining decisions.

## Product Purpose

Turn a curated 2,000-word CET-6 core list into a practical study loop: learn the meaning, retrieve the spelling from Chinese or audio, collect mistakes, review them on a spaced schedule, and see progress. Success means the user can start a productive session in one click and can see exactly which words need another pass.

## Positioning

A local-first CET-6 core deck that combines frequency-backed selection with three exam-facing retrieval modes and a transparent source trail. It is narrower than a general vocabulary platform: every word is in one auditable 2,000-word list, and every practice action feeds the same mistake and review state.

## Operating Context

- Personal daily study, typically shorter than 30 minutes.
- Desktop keyboard use and mobile one-handed use.
- Fully usable from a local static server; study state remains in the browser.
- No account, analytics, ads, remote database, or network dependency for the core study loop.
- Browser speech synthesis supplies pronunciation when the device has an installed English voice.

## Capabilities and Constraints

- 2,000 unique words, grouped into 50 units of 40 words.
- Filters for listening, reading, writing, high-frequency, CET-6 syllabus, unit, and mastery state.
- Flashcards, listening dictation, Chinese meaning-to-English dictation, mixed practice, and browsable word inventory.
- Spaced review with short intervals; wrong answers enter the mistake queue.
- Search in English, Chinese, and category names.
- Local progress persistence, progress export/import, and wrong-word export.
- Static, dependency-free implementation with an offline PWA shell.
- Pronunciation depends on the browser and installed system voices.

## Brand Commitments

The requested product has no established brand. The working name “词刻 CET-6” is inferred and may be changed.

## Evidence on Hand

- `data/words.js`: generated 2,000-word deck with rank, frequency, definition, CEFR level, category, example, exam tags, and unit.
- `scripts/build-wordbook.mjs`: reproducible selection and tagging logic.
- Source project: `exam-data/CETVocabulary`, based on the 2016 CET syllabus and roughly 200 exam papers. Data is shared under CC BY-NC-SA 4.0.
- No testimonials, commercial claims, usage metrics, or user accounts exist and none should be fabricated.

## Product Principles

1. Retrieval beats recognition: every session should demand an answer, not only a page turn.
2. Keep the next action obvious: start today's review, continue a word bank, or face mistakes.
3. Mistakes are useful learning state, never a dead-end score.
4. Keep the source and selection logic visible and reproducible.
5. Preserve user work locally and make it portable.

## Accessibility & Inclusion

Keyboard focus must remain visible, form controls need explicit labels, feedback must not rely on color alone, motion must respect reduced-motion preferences, and the main study loop must work without audio.
