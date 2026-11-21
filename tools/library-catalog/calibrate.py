#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""统计放宽阈值/新增规则能召回多少条目，避免凭感觉调参。只读。"""

import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_catalog as bc

entries = bc.parse_gutindex(bc.ensure_file("GUTINDEX.ALL", f"{bc.BASE}/GUTINDEX.ALL"))
filemap = bc.parse_filelist(bc.ensure_file("main-filelist.csv.bz2", f"{bc.BASE}/main-filelist.csv.bz2"))

COMPLETE_RE = re.compile(r",\s*complete\b|\bcomplete\b", re.I)
SERIES_RE = re.compile(
    r"\b(motor boys|airplane boys|boy scouts|girl scouts|high school|freshmen|"
    r"sophomore|junior|senior|at play|at school|in camp|in the woods|in the rockies|"
    r"in hollywood|ranch|round the campfire|boys'|girls')\b", re.I)

buckets = Counter()
samples = {"politics2": [], "fiction3": [], "series": []}

for entry in entries:
    if entry["lang"] not in ("en", "fr") or entry["copyright"]:
        continue
    title, author = bc.split_author(entry["line"], entry["author_meta"])
    raw_all = f"{title} {entry['subtitle']} {author}"
    if len(title) < 6 or len(raw_all) < 12:
        continue
    if bc.HARD_JUNK.search(raw_all) or bc.VOLUME_JUNK.search(title) or not filemap.get(entry["n"]):
        continue
    domain, strength, _ = bc.classify(title, entry["subtitle"], author)
    if domain:
        continue

    raw_title = f"{title} {entry['subtitle']}".strip()
    normalized_author = bc.norm(author)
    scores = {}
    for dom, rules in bc.DEFINITIONS.items():
        s = 0
        for weight, regex in rules:
            m = regex.findall(raw_title)
            if m:
                s += weight * min(2, len(m))
        if bc.author_hit(normalized_author, bc.DOMAIN_AUTHORS.get(dom, set())):
            s += 6
        if s:
            scores[dom] = s

    politics = scores.get("政治时讯", 0)
    if politics == 2:
        buckets["politics==2"] += 1
        if len(samples["politics2"]) < 15:
            samples["politics2"].append(f"#{entry['n']} {title} | {author}")

    fiction = 0
    if bc.FICTION_RE.search(raw_title):
        fiction += 4
    if bc.FICTION_WEAK_RE.search(raw_title):
        fiction += 2
    if bc.author_hit(normalized_author, bc.FICTION_AUTHORS):
        fiction += 6
    if fiction == 3:
        buckets["fiction==3"] += 1
        if len(samples["fiction3"]) < 5:
            samples["fiction3"].append(f"#{entry['n']} {title} | {author}")
    if fiction >= 4:
        buckets["fiction>=4-blocked"] += 1
    if COMPLETE_RE.search(raw_title) and fiction == 0:
        buckets["complete-only"] += 1
        if len(samples["series"]) < 15:
            samples["series"].append(f"#{entry['n']} {title} | {author}")
    if SERIES_RE.search(raw_title) and fiction < 4:
        buckets["series"] += 1

print(dict(buckets))
for key, values in samples.items():
    print("\n---", key)
    for value in values:
        print(value)