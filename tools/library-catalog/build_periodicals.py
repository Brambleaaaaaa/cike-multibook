#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 GUTINDEX.ALL 里筛出公版期刊（杂志 / 评论 / 画报），并入主 manifest。

之前的主目录把「期刊、增刊、年度报告」整体排除了，所以词刻里一直没有期刊栏目。
这里单独建一个「期刊」域：只收英文 / 法文、已进入公版、能在镜像上找到正文的
单期或合卷，按杂志名 + 卷期/日期双信号判定，避免把书评、随笔误当成期刊。

用法：
  python tools/library-catalog/build_periodicals.py
  python tools/library-catalog/build_periodicals.py --limit 320
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_catalog as bc  # noqa: E402

ROOT = bc.ROOT
MANIFEST = os.path.join(ROOT, "library-catalog", "manifest.json")
OUTPUT = os.path.join(ROOT, "library-catalog", "periodicals.json")

# 明确的期刊名。命中后仍要求有卷期或日期信息。
MAGAZINE_NAMES = re.compile(
    r"(blackwood'?s|atlantic monthly|harper'?s (new monthly|weekly|magazine)|"
    r"scribner'?s|the strand magazine|strand magazine|\bpunch\b|the idler|"
    r"belgravia|cornhill magazine|temple bar|all the year round|"
    r"chambers'?s (journal|edinburgh journal)|littell'?s living age|"
    r"the galaxy|knickerbocker|scientific american|macmillan'?s magazine|"
    r"fortnightly review|contemporary review|"
    r"edinburgh review|quarterly review|westminster review|dublin review|"
    r"gentleman'?s magazine|london magazine|the spectator|the examiner|"
    r"the nation|frank leslie'?s|once a week|good words|the argosy|"
    r"tinsley'?s magazine|london society|the yellow book|saturday review|"
    r"revue des deux mondes|la revue de paris|le correspondant|"
    r"l'illustration|"
    r"magasin d'[ée]ducation et de r[ée]cr[ée]ation|"
    r"journal des d[ée]bats|le figaro|la revue britannique)",
    re.I,
)

# 泛称期刊词，必须配合卷期 / 月份 / 年份才算数。
PERIODICAL_WORDS = re.compile(
    r"\b(magazine|periodical|journal|review|monthly|quarterly|weekly|"
    r"annual|yearbook|almanack|gazette|bulletin|revue|magasin)\b",
    re.I,
)

# 「review」既可能是《爱丁堡评论》，也可能是 "A Review of the State of…" 这种专论，
# 所以泛称路径只认这些刊物名词本身。
GENERIC_NOUN = re.compile(
    r"\b(magazine|periodical|journal|revue|magasin|gazette|bulletin|"
    r"annual|yearbook|almanack|review)\b",
    re.I,
)

SERIAL_MARKER = re.compile(
    r"(\b(vol\.?|volume|no\.?|number|issue|part|series|tome)\s*[\divxlc]+\b|"
    r"\b(january|february|march|april|may|june|july|august|september|"
    r"october|november|december)\b|"
    r"\b(18|19)\d{2}\b)",
    re.I,
)

# 目录、索引、广告册这类东西不是期刊正文。
JUNK = re.compile(
    r"\b(index|indexes|catalogue|catalog|directory|almanac|year.?book|"
    r"advertiser|advertising|prospectus|publisher'?s circular|"
    r"list of|bibliography|dictionary)\b",
    re.I,
)

# 名字里带 journal / review 的日记、游记、文集、传记，不是期刊。
BOOK_LIKE = re.compile(
    r"\b(diary|memoirs?|autobiography|prose works|works of|life of|"
    r"history of|papers|essays|letters)\b|"
    r"\bjournal of (a|an)\b|"
    r"\bjournal of the .{0,40}\b(campaign|war|expedition|voyage|march|"
    r"siege|residence|journey|tour)\b|"
    r"\bjournal d'un(e)?\b|"
    r"^the journal of (?!the\b)[a-z]",
    re.I,
)


def quality(title: str, subtitle: str, size: int) -> int:
    text = f"{title} {subtitle}"
    score = 10
    if MAGAZINE_NAMES.search(text):
        score += 5
    if SERIAL_MARKER.search(text):
        score += 3
    if size > 600_000:
        score -= 2
    elif size < 20_000:
        score -= 1
    return max(1, score)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=400)
    parser.add_argument("--max-size", type=int, default=2_000_000)
    args = parser.parse_args()

    entries = bc.parse_gutindex(os.path.join(ROOT, ".cache", "gutenberg", "GUTINDEX.ALL"))
    filemap = bc.parse_filelist(os.path.join(ROOT, ".cache", "gutenberg", "main-filelist.csv.bz2"))
    print(f"[parse] entries={len(entries)} files={len(filemap)}")

    counters = Counter()
    candidates = []
    seen = set()
    per_series = Counter()
    series_cap = max(6, args.limit // 10)

    for entry in entries:
        counters["total"] += 1
        if entry["lang"] not in ("en", "fr"):
            counters["skip_language"] += 1
            continue
        if entry["copyright"]:
            counters["skip_copyright"] += 1
            continue
        title, author = bc.split_author(entry["line"], entry["author_meta"])
        title = re.sub(r"\s+", " ", title).strip()
        subtitle = entry["subtitle"] or ""
        text = f"{title} {subtitle}"
        if len(title) < 8:
            counters["skip_short"] += 1
            continue
        if JUNK.search(text):
            counters["skip_junk"] += 1
            continue
        if BOOK_LIKE.search(text):
            counters["skip_book_like"] += 1
            continue
        named_match = MAGAZINE_NAMES.search(title)
        # 刊名必须压在标题最前面（允许前置 The），否则像 "Daughters of Belgravia"
        # 这种把地名撞进刊名表的书就会被误收。
        named_ok = bool(named_match) and (
            named_match.start() <= 4 or bool(re.match(r"^the\s+", title, re.I))
        )
        generic_ok = bool(GENERIC_NOUN.search(title)) and bool(
            PERIODICAL_WORDS.search(title)
        )
        # 期刊名和卷期/日期必须同时出现在标题里，避免把带副标题的专著收进来。
        if not (named_ok or generic_ok):
            counters["skip_not_periodical"] += 1
            continue
        if not SERIAL_MARKER.search(title):
            counters["skip_no_serial"] += 1
            continue
        series = named_match.group(1).lower() if named_ok else re.split(r"[,:]", title)[0].lower()
        if per_series[series] >= series_cap:
            counters["skip_series_cap"] += 1
            continue
        fileinfo = filemap.get(entry["n"])
        if not fileinfo:
            counters["skip_no_file"] += 1
            continue
        size = fileinfo["size"]
        if size < 5_000 or size > args.max_size:
            counters["skip_size"] += 1
            continue
        key = bc.norm(title)[:90]
        if key in seen:
            counters["skip_duplicate"] += 1
            continue
        seen.add(key)
        per_series[series] += 1
        candidates.append(
            {
                "id": entry["n"],
                "title": title,
                "author": re.sub(r"\s+", " ", author).strip() or "佚名",
                "language": entry["lang"],
                "domain": "期刊",
                "path": fileinfo["path"],
                "size": size,
                "quality": quality(title, subtitle, size),
            }
        )
        counters["candidates"] += 1

    candidates.sort(key=lambda item: (-item["quality"], -item["size"], item["id"]))
    selected = candidates[: args.limit]
    print(f"[select] candidates={len(candidates)} selected={len(selected)}")
    print(json.dumps(counters, ensure_ascii=False, indent=2))

    payload = {
        "meta": {
            "name": "词刻公版期刊",
            "source": "Project Gutenberg · GUTINDEX",
            "count": len(selected),
            "domains": {"期刊": len(selected)},
            "languages": dict(Counter(item["language"] for item in selected)),
            "bytes": sum(item["size"] for item in selected),
        },
        "books": selected,
    }
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    with open(MANIFEST, encoding="utf-8") as handle:
        manifest = json.load(handle)
    manifest["books"] = [book for book in manifest["books"] if book.get("domain") != "期刊"]
    manifest["books"].extend(selected)
    manifest["meta"]["domains"]["期刊"] = {
        "slug": "periodicals",
        "count": len(selected),
        "available": len(selected),
    }
    manifest["meta"]["count"] = len(manifest["books"])
    manifest["meta"]["languages"] = dict(Counter(book["language"] for book in manifest["books"]))
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, ensure_ascii=False, separators=(",", ":"))

    print(json.dumps(payload["meta"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())