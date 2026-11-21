#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清掉公版正文开头的 Gutenberg 工序说明，只留书刊自己的第一行。

下载器已经按 START/END 标记切过正文，但老文件把 "Produced by …"、
"Note: Project Gutenberg also has an HTML version …" 这类说明写在 START
之后，于是读者打开第一页看到的是一段校对说明。这里按行清理开头，遇到
第一行真正内容就停手，不改动正文中间的任何文字。

用法：
  python tools/library-catalog/clean_frontmatter.py --dry-run
  python tools/library-catalog/clean_frontmatter.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, "library", "public")

# 只在文件开头连续命中时删除；命中顺序不要求固定。
FRONT = re.compile(
    r"^(?:"
    r"produced by\b|"
    r"e-?text prepared by\b|"
    r"transcribed from\b|"
    r"prepared by\b|"
    r"credits?:|"
    r"note:|"
    r"character set encoding|"
    r"encoding:|"
    r"this e-?book is for the use|"
    r"release date|"
    r"posting date|"
    r"language:|"
    r"title:|"
    r"author:|"
    r"editor:|"
    r"translator:|"
    r"illustrator:|"
    r"\*\*\* ?start of"
    r")",
    re.I,
)


def strip_front(text: str) -> tuple[str, int]:
    lines = text.split("\n")
    index = 0
    removed = 0
    while index < len(lines) and index < 80:
        while index < len(lines) and not lines[index].strip():
            index += 1
        if index >= len(lines):
            break
        if not FRONT.match(lines[index].strip()):
            break
        # Gutenberg 的说明按段落写，整段删掉才不会留下 "email …" 这类残句。
        while index < len(lines) and lines[index].strip():
            index += 1
            removed += 1
    # 有些文件在说明段后面还留一行小写残句（图片清单、校对备注、pg 页码），
    # 只在开头出现，同样清掉；遇到真正的标题行就停。
    while index < len(lines) and index < 80:
        cursor = index
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        if cursor >= len(lines):
            break
        end = cursor
        while end < len(lines) and lines[end].strip():
            end += 1
        chunk = [line for line in lines[cursor:end] if line.strip()]
        if (
            len(chunk) == 1
            and len(chunk[0].strip()) < 100
            and chunk[0].strip()[:1].islower()
        ):
            removed += end - index
            index = end
            continue
        break
    if not removed:
        return text, 0
    rest = "\n".join(lines[index:]).lstrip("\n")
    if not rest.strip() or len(rest) < len(text) * 0.5:
        return text, 0
    return rest, removed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    changed = 0
    samples = []
    for domain in sorted(os.listdir(LIB)):
        folder = os.path.join(LIB, domain)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".txt"):
                continue
            path = os.path.join(folder, name)
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
            new_text, removed = strip_front(text)
            if not removed or len(new_text) < 256:
                continue
            changed += 1
            if len(samples) < 8:
                samples.append(
                    {
                        "file": f"{domain}/{name}",
                        "removed": removed,
                        "before": text.strip().split("\n")[0][:60],
                        "after": new_text.strip().split("\n")[0][:60],
                    }
                )
            if not args.dry_run:
                tmp = path + ".part"
                with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
                    handle.write(new_text)
                os.replace(tmp, path)

    print(f"[{'dry-run' if args.dry_run else 'clean'}] files={changed}")
    for item in samples:
        print(f"  {item['file']}  -{item['removed']} 行")
        print(f"    {item['before']!r} -> {item['after']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())