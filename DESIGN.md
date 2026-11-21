---
name: 词刻 CET-6
description: A local-first study ledger for CET-6 vocabulary recall and dictation.
colors:
  paper: "#eef0e7"
  paper-raised: "#f8f9f3"
  paper-muted: "#e1e5d9"
  ink: "#192622"
  ink-soft: "#4d5b55"
  ink-faint: "#5d6962"
  rule: "#c3c9bd"
  rule-strong: "#8f998f"
  forest: "#183b35"
  forest-hover: "#204b43"
  forest-soft: "#d8e7df"
  mint: "#b8ddce"
  oxide: "#cf5e3e"
  oxide-soft: "#f2d8ce"
  ochre: "#c9a846"
  success: "#1f6b4d"
  success-soft: "#dcecdf"
  danger: "#ad3d32"
  danger-soft: "#f2d9d5"
  task-ink: "#f2f6ee"
typography:
  display:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.028em"
  headline:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.028em"
  title:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  micro:
    fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace'
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.04em"
  word:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "54px"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  answer:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.01em"
rounded:
  annotation: "3px"
  sm: "5px"
  md: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "44px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper-raised}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.forest-hover}"
    textColor: "{colors.paper-raised}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
    height: "42px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
    height: "42px"
  nav-item-active:
    backgroundColor: "{colors.forest-soft}"
    textColor: "{colors.forest}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 13px"
    height: "38px"
  mode-option-selected:
    backgroundColor: "#ffffff17"
    textColor: "{colors.task-ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.annotation}"
    padding: "6px 10px"
    height: "34px"
  filter-tab-active:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.annotation}"
    padding: "5px 10px"
    height: "32px"
  tag:
    backgroundColor: "{colors.paper-muted}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.micro}"
    rounded: "{rounded.annotation}"
    padding: "2px 6px"
    height: "20px"
  answer-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.answer}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "50px"
  task-board:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.task-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "30px"
---

# Design System: 词刻 CET-6

## Overview

**Creative North Star: "The Revision Ledger"**

The interface is a working revision ledger rather than a promotional surface. Pale celadon paper, deep forest ink, ruled word lists, and compact frequency annotations create the calm order of a study document while keeping every control legible and immediately operable. The visual material comes from exam papers and editorial word lists, but the interaction belongs to a modern desktop and mobile tool.

The page is deliberately asymmetric: a compact plan rail, a broad current-task workspace, and a narrow live-state rail. Depth is restrained. The dark daily task board is the one elevated object; lists and study cards are defined by rules and borders. Recognition tasks and dictation tasks share the same folio-like card so the learner does not have to relearn the interface between modes.

**Key Characteristics:**

- Pale paper with dark forest ink and one oxide attention color.
- Serif English words against a compact system sans UI.
- Ruled lists and small mono annotations instead of card mosaics.
- One obvious primary action at a time.
- Status is always expressed with text as well as color.
- Responsive structure collapses rails into bottom navigation at 900px.

## Colors

The palette is a restrained paper-and-ink system with semantic accents drawn from proofreading marks.

### Primary

- **Revision Forest** (`colors.forest`): primary action fill, the daily task board, active progress, and strong selected states.
- **Forest Hover** (`colors.forest-hover`): hover state for primary actions and the listening control.
- **Forest Wash** (`colors.forest-soft`): active navigation backgrounds and study-tag backgrounds.

### Secondary

- **Proofing Oxide** (`colors.oxide`): the single attention accent. Use it for spelling errors, mistake counts, today's chart bar, and the active study progress segment.
- **Oxide Wash** (`colors.oxide-soft`): error backgrounds and low-emphasis danger surfaces.

### Tertiary

- **Review Ochre** (`colors.ochre`): scheduled-review state, daily progress fill on the dark board, and current-day emphasis.
- **Success Green** (`colors.success`): correct-answer feedback and mastered-state indicators.
- **Warning Red** (`colors.danger`): destructive actions and the strongest error text.

### Neutral

- **Celadon Paper** (`colors.paper`): application ground and input backgrounds.
- **Raised Sheet** (`colors.paper-raised`): panels, cards, table surfaces, and inverse text on primary controls.
- **Quiet Paper** (`colors.paper-muted`): neutral chips, tracks, hover fills, and secondary layers.
- **Ledger Ink** (`colors.ink`): primary text and icon strokes.
- **Soft Ink** (`colors.ink-soft`): secondary prose, controls, and explanatory text.
- **Faint Ink** (`colors.ink-faint`): metadata and tertiary labels that still meet the 4.5:1 body-text floor.
- **Rule / Strong Rule** (`colors.rule`, `colors.rule-strong`): one-pixel list and panel boundaries, with the stronger rule reserved for top-level divisions and focusable fields.
- **Task Ink** (`colors.task-ink`): cream text on the dark forest task board.

**The Semantic Accent Rule.** Forest means “do this,” oxide means “needs attention,” ochre means “scheduled,” and green means “retained.” Never use these colors as interchangeable decoration.

## Typography

**Display Font:** Georgia with Times New Roman and Songti SC fallback.  
**Body Font:** Segoe UI Variable with Segoe UI, Microsoft YaHei UI, and PingFang SC fallback.  
**Label/Mono Font:** Cascadia Mono with SFMono-Regular and Consolas fallback.

**Character:** The serif carries the memory object—English words and editorial headings—while the compact sans carries controls and Chinese explanations. Mono is reserved for numbers, frequency, dates, and keyboard hints.

### Hierarchy

- **Display** (700, 42px, 1.05): page titles and result statements. It uses a tight `-0.028em` tracking.
- **Headline** (700, 26px, 1.15): section headings and modal titles.
- **Title** (700, 16px, 1.35): panel headings and compact feature labels.
- **Body** (400, 15px, 1.55): explanatory prose and word meanings. Keep prose passages within 65–75ch.
- **Label** (600, 13px, 1.4): buttons, navigation, and control labels.
- **Micro** (500, 11px, 1.45): metadata, frequency, dates, keyboard hints, and compact tags.
- **Word** (700, 54px, 1.02): the single English word in the study card.
- **Answer** (400, 20px): typed spelling in the dictation field.

**The Two-Voice Rule.** Serif belongs to the material being learned; sans belongs to operating the tool. Do not set navigation, buttons, or long Chinese instructions in the serif face.

## Layout

The desktop workspace is a three-column ledger: `220px` plan rail, a flexible task workspace capped at `980px`, and `272px` live-state rail. The header stays `68px` high and the side rails stick below it. Main workspace padding is `42px 44px 72px`, creating a broad page without turning content into a floating-card stack.

Spacing follows a four-step rhythm: `4px` for icon and text attachments, `8px` for related controls, `12–16px` for component internals, `24–32px` for section separation, and `44px` for primary workspace breathing room. Tight groups are separated by rules rather than nested containers.

At `1180px`, the right live-state rail disappears. At `900px`, the primary navigation and plan rail disappear and a four-item fixed bottom navigation appears; main padding becomes `30px 24px 90px`. At `700px`, dashboard columns and settings fields become single-column, and study actions become a three-column grade row. At `430px`, the primary task action becomes full width and nonessential table columns disappear.

**The Working Margin Rule.** Keep the central study task visually dominant. Side rails may inform the session but must never compete with the current word or its answer field.

## Elevation & Depth

The system is border-first with one ambient elevation exception. Lists, panels, study cards, tag groups, and inputs use one-pixel boundaries. The daily task board and toast use the shared ambient shadow because they represent a separate working layer; the study card itself does not combine a hairline border with a wide shadow.

### Shadow Vocabulary

- **Ambient Task Layer** (`box-shadow: 0 14px 34px rgba(32, 36, 30, 0.09), 0 2px 6px rgba(32, 36, 30, 0.05)`): the daily task board and transient toast.
- **Mobile Navigation Lift** (`box-shadow: 0 6px 14px rgba(25, 38, 34, 0.14)`): the fixed mobile navigation only.
- **Listening Control Lift** (`box-shadow: 0 8px 18px rgba(16, 28, 23, 0.16)`): the circular listening trigger only.
- **Focus Ring** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--forest-soft) 75%, transparent)`): search and answer fields on focus.

**The Defined Edge Rule.** Choose either a border or a broad ambient shadow for a stable surface. Do not use both as a default card treatment.

## Shapes

Annotation-sized elements use `3px` corners; controls and inputs use `5px`; major panels use `10px`; the task board uses `16px`. Pills are limited to progress tracks, status counts, and circular indicators. The study card uses a `16px` outer corner with an inset `10px` rule, creating the look of a ruled folio page without decorative illustration.

The icon language is a consistent `1.8px` stroke set. Borders are one pixel and carry structure; there are no left-accent bars, clipped polygons, or decorative geometric masks.

**The Annotation Rule.** Small elements look like marks made on paper: compact corners, clear rules, and no ornamental containers around individual labels.

## Components

### Buttons

Buttons are direct, compact, and task-labeled.

- **Shape:** slightly rounded ledger controls (`5px` radius).
- **Primary:** forest fill, raised-sheet text, `42px` minimum height, and `9px 16px` padding. On the dark task board, primary reverses to a cream fill with dark text.
- **Hover / Focus:** background moves to forest-hover over `160ms`; focus uses the global oxide `2px` ring with a `3px` offset.
- **Secondary:** transparent fill with a `1px` strong-rule border.
- **Ghost:** transparent fill and border, with quiet paper as the hover background.
- **Disabled:** `0.48` opacity and no pointer interaction.

### Chips

- **Style:** quiet-paper background, soft-ink text, `11px` mono or sans label, and `3px` corners.
- **State:** mode chips sit on dark forest and use translucent white fills for selected states; filter tabs sit on muted paper and elevate the selected tab to raised paper.
- **Semantic tags:** listening uses forest wash; writing uses danger wash.

### Cards / Containers

- **Corner Style:** `10px` for panels and chart surfaces; `16px` for the task board and study card.
- **Background:** raised sheet for panels; forest for the daily task board.
- **Shadow Strategy:** border-first; only the task board uses ambient elevation.
- **Border:** `1px` rule or strong rule.
- **Internal Padding:** `17–24px` for panels, `30px` for the task board, and `34px` for the study card.

### Inputs / Fields

- **Style:** paper fill, strong-rule border, `5px` radius. The answer field uses Georgia at `20px` so spelling remains the visual subject.
- **Focus:** forest border plus a soft forest focus ring.
- **Correct / Error:** correct adds the success border, incorrect adds the danger border; both are accompanied by text feedback and a character-level spelling target.
- **Disabled:** no active study input is shipped in a disabled state; controls that cannot act are removed or explicitly disabled at the page level.

### Navigation

- **Style:** desktop navigation is a compact sans row centered in the sticky header. Active items use forest wash and forest text.
- **Hover:** quiet-paper fill with primary ink.
- **Mobile:** below `900px`, the same four destinations become a fixed bottom bar with `11px` labels and visible English icons. The mobile bar preserves active, hover, and keyboard-focus states.

### Study Folio

The signature component is a bordered study card with an inset rule, a compact metadata row, and a large serif word or Chinese prompt. One card serves recognition, listening, and Chinese-to-English dictation. Correct and incorrect states remain inline, with a character-level spelling comparison rather than a modal.

### Daily Task Board

The dark forest board combines today's date, a ledger stamp, the current task statement, numeric progress, a track, mode chips, and the primary start action. Its two quiet concentric line circles are the only decorative geometry and establish the board as a separate working layer.

## Do's and Don'ts

### Do:

- **Do** keep body and secondary text at or above the 4.5:1 contrast floor; faint ink is still a readable text token.
- **Do** express state with a color token plus a written label.
- **Do** use serif for the learned English word and sans for the interface that operates it.
- **Do** separate dense groups with one-pixel rules and spacing before adding a container.
- **Do** preserve the semantic meanings of forest, oxide, ochre, success, and danger.
- **Do** keep the primary study action and answer field visible at every supported viewport.

### Don't:

- **Don't** use oxide, ochre, or success as ambient decoration.
- **Don't** nest cards inside cards or wrap every label in its own container.
- **Don't** add glass panels, colored glows, gradient text, or hard offset shadows.
- **Don't** animate width or height for progress feedback; update the track directly and reserve motion for state feedback.
- **Don't** reduce functional labels below `11px`.
- **Don't** use an icon without a visible label for a primary navigation destination; icons may stand alone only for universally understood utility actions with an accessible name.
