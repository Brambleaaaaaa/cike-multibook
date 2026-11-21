#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打印未能分类的条目样本，用于校准领域词典。只读分析，不改产物。"""

import os
import random
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_catalog as bc

index_path = bc.ensure_file("GUTINDEX.ALL", f"{bc.BASE}/GUTINDEX.ALL")
filelist_path = bc.ensure_file("main-filelist.csv.bz2", f"{bc.BASE}/main-filelist.csv.bz2")
entries = bc.parse_gutindex(index_path)
filemap = bc.parse_filelist(filelist_path)

reasons = Counter()
unclassified = []
for entry in entries:
    if entry["lang"] not in ("en", "fr"):
        continue
    if entry["copyright"]:
        continue
    title, author = bc.split_author(entry["line"], entry["author_meta"])
    raw_all = f"{title} {entry['subtitle']} {author}"
    if len(title) < 6 or len(raw_all) < 12:
        reasons["short"] += 1
        continue
    if bc.HARD_JUNK.search(raw_all):
        reasons["reference"] += 1
        continue
    if bc.VOLUME_JUNK.search(title):
        reasons["volume"] += 1
        continue
    if not filemap.get(entry["n"]):
        reasons["no_file"] += 1
        continue
    domain, strength, _ = bc.classify(title, entry["subtitle"], author)
    if domain:
        continue
    unclassified.append({"id": entry["n"], "title": title, "subtitle": entry["subtitle"], "author": author, "size": filemap[entry["n"]]["size"]})

print("unclassified:", len(unclassified), "reasons:", dict(reasons))
words = Counter()
for item in unclassified:
    for token in re.findall(r"[a-z]{5,}", item["title"].lower()):
        words[token] += 1
print("top tokens:")
print(", ".join(f"{w}:{c}" for w, c in words.most_common(60)))

random.seed(20261119)
print("\n--- random samples ---")
for item in random.sample(unclassified, 60):
    print(f"#{item['id']} | {item['title']} | {item['author']} | {item['subtitle']} | {item['size']}")

print("\n--- shortest 40 (likely essays / pamphlets) ---")
for item in sorted(unclassified, key=lambda x: x["size"])[:40]:
    print(f"#{item['id']} | {item['size']:>7} | {item['title']} | {item['author']}")