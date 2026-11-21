#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""细分 politics==2 的构成：高置信史传 vs 泛政治词。只读。"""

import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_catalog as bc

entries = bc.parse_gutindex(bc.ensure_file("GUTINDEX.ALL", f"{bc.BASE}/GUTINDEX.ALL"))
filemap = bc.parse_filelist(bc.ensure_file("main-filelist.csv.bz2", f"{bc.BASE}/main-filelist.csv.bz2"))

HIGH = re.compile(
    r"\b(history of|historical|memoirs?|biography|autobiography|life of|"
    r"diary|letters|correspondence|reminiscences|chronicle|chronicles|annals|"
    r"civil war|regiment|revolution|narrative of the life)\b", re.I)
FICTION_SERIES = re.compile(
    r"\b(motor boys|airplane boys|boy scouts|girl scouts|high school|freshmen|"
    r"at play|at school|in camp|in the woods|in the rockies|in hollywood)\b", re.I)

buckets = Counter()
samples = {"high": [], "series": [], "other": []}

for entry in entries:
    if entry["lang"] not in ("en", "fr") or entry["copyright"]:
        continue
    title, author = bc.split_author(entry["line"], entry["author_meta"])
    raw_all = f"{title} {entry['subtitle']} {author}"
    if len(title) < 6 or len(raw_all) < 12:
        continue
    if bc.HARD_JUNK.search(raw_all) or bc.VOLUME_JUNK.search(title) or not filemap.get(entry["n"]):
        continue
    domain, _strength, _raw = bc.classify(title, entry["subtitle"], author)
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
    if scores.get("政治时讯", 0) != 2:
        continue
    if FICTION_SERIES.search(raw_title):
        buckets["series"] += 1
        if len(samples["series"]) < 12:
            samples["series"].append(f"#{entry['n']} {title} | {author}")
    elif HIGH.search(raw_title):
        buckets["high"] += 1
        if len(samples["high"]) < 20:
            samples["high"].append(f"#{entry['n']} {title} | {author} | {filemap[entry['n']]['size']//1024}KB")
    else:
        buckets["other"] += 1
        if len(samples["other"]) < 20:
            samples["other"].append(f"#{entry['n']} {title} | {author} | {filemap[entry['n']]['size']//1024}KB")

print(dict(buckets))
for key, values in samples.items():
    print("\n---", key)
    for value in values:
        print(value)