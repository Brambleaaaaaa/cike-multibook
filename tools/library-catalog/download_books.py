#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
词刻 · 公版书下载器

用法示例：
  python download_books.py --limit 50
  python download_books.py --domain 小说 --limit 300 --workers 6
  python download_books.py --max-size 200000 --language en

特性：
  - 多镜像回退（mirrorservice / pglaf / 原镜像）
  - 断点续传：已存在且非空的文件直接跳过
  - 多线程并发生成 .part 临时文件，成功后原子改名
  - 剥离 Project Gutenberg 页眉页脚，只保留正文
  - 输出 index.json，供应用侧生成书架目录
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from threading import Lock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_MANIFEST = os.path.join(ROOT, "library-catalog", "manifest.json")
DEFAULT_OUT = os.path.join(ROOT, "library", "public")

MIRRORS = [
    "https://www.mirrorservice.org/sites/ftp.ibiblio.org/pub/docs/books/gutenberg",
    "https://gutenberg.pglaf.org",
    "https://mirror.csclub.uwaterloo.ca/gutenberg",
]

SLUG = {
    "漫画": "comics",
    "时尚": "fashion",
    "金融": "finance",
    "政治时讯": "politics",
    "科学": "science",
    "自然": "nature",
    "地理": "geography",
    "艺术": "art",
    "小说": "fiction",
    "期刊": "periodicals",
}

START_RE = re.compile(
    r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*",
    re.I,
)
END_RE = re.compile(
    r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*",
    re.I,
)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"[ \t\u00a0]+")
BLANK_RE = re.compile(r"\n{3,}")

UA = "Mozilla/5.0 (compatible; CikeLibrary/1.0; +local offline reader)"


def fetch(url: str, timeout: int = 45) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def strip_boilerplate(text: str) -> str:
    start = START_RE.search(text)
    if start:
        text = text[start.end():]
    end = END_RE.search(text)
    if end:
        text = text[: end.start()]
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = BLANK_RE.sub("\n\n", text)
    return text.strip() + "\n"


def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?i)<br\s*/?>", "\n", html)
    html = re.sub(r"(?i)</p\s*>", "\n\n", html)
    html = TAG_RE.sub(" ", html)
    text = (
        html.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return SPACE_RE.sub(" ", text)


def safe_name(value: str, limit: int = 48) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[\\/:*?\"<>|\n\r]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value[:limit] or "untitled"


def download_one(book: dict, out_dir: str, max_size: int, strip: bool) -> dict:
    slug = SLUG[book["domain"]]
    domain_dir = os.path.join(out_dir, slug)
    os.makedirs(domain_dir, exist_ok=True)
    target = os.path.join(domain_dir, f"{book['id']}.txt")
    if os.path.exists(target) and os.path.getsize(target) > 512:
        return {"id": book["id"], "status": "skip", "file": target}

    encoded = urllib.parse.quote(book["path"].lstrip("/"), safe="/")
    last_error = None
    for base in MIRRORS:
        url = f"{base}/{encoded}"
        try:
            raw = fetch(url)
            if not raw:
                raise ValueError("empty response")
            if len(raw) > max_size:
                return {"id": book["id"], "status": "too-large", "bytes": len(raw)}
            if book["path"].lower().endswith((".htm", ".html")):
                text = html_to_text(raw.decode("utf-8", errors="replace"))
            else:
                text = raw.decode("utf-8", errors="replace")
            if strip:
                text = strip_boilerplate(text)
            if len(text.strip()) < 256:
                raise ValueError("too little text")
            tmp = target + ".part"
            with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
            os.replace(tmp, target)
            return {
                "id": book["id"],
                "status": "ok",
                "file": target,
                "bytes": os.path.getsize(target),
                "source": url,
            }
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
            last_error = f"{type(error).__name__}: {error}"
            time.sleep(1)
    return {"id": book["id"], "status": "failed", "error": last_error}


def main() -> int:
    parser = argparse.ArgumentParser(description="下载词刻公版书库正文")
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--domain", default="all")
    parser.add_argument("--language", default="all")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-size", type=int, default=2_000_000)
    parser.add_argument("--min-size", type=int, default=1024)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--order", choices=["quality", "size", "id"], default="quality")
    parser.add_argument("--no-strip", action="store_true")
    parser.add_argument("--index-only", action="store_true", help="只扫描已下载文件重建 index.json，不联网")
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as handle:
        manifest = json.load(handle)
    all_books = manifest["books"]
    books = all_books

    if args.domain != "all":
        books = [book for book in books if book["domain"] == args.domain]
    if args.language != "all":
        books = [book for book in books if book["language"] == args.language]
    books = [book for book in books if args.min_size <= book["size"] <= args.max_size]
    if args.order == "quality":
        books.sort(key=lambda book: (-book.get("quality", 0), book["size"], book["id"]))
    elif args.order == "size":
        books.sort(key=lambda book: (book["size"], book["id"]))
    else:
        books.sort(key=lambda book: book["id"])
    if args.limit:
        books = books[: args.limit]

    os.makedirs(args.out, exist_ok=True)
    results = []
    lock = Lock()
    done = 0

    if args.index_only:
        print(f"[index-only] 扫描 {args.out}", flush=True)
    else:
        print(f"[plan] {len(books)} books, workers={args.workers}, out={args.out}", flush=True)

    started = time.time()
    if not args.index_only:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(download_one, book, args.out, args.max_size, not args.no_strip): book
                for book in books
            }
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                with lock:
                    done += 1
                    if done % 10 == 0 or done == len(books):
                        elapsed = max(1, time.time() - started)
                        print(
                            f"[{done}/{len(books)}] ok={sum(1 for r in results if r['status'] == 'ok')} "
                            f"skip={sum(1 for r in results if r['status'] == 'skip')} "
                            f"fail={sum(1 for r in results if r['status'] == 'failed')} "
                            f"avg={done / elapsed:.2f}/s",
                            flush=True,
                        )

    # 索引以磁盘为准：多次分域下载、增量补书都不会互相覆盖
    index = []
    for book in all_books:
        path = os.path.join(args.out, SLUG[book["domain"]], f"{book['id']}.txt")
        if not os.path.exists(path) or os.path.getsize(path) <= 512:
            continue
        index.append(
            {
                "id": f"pg{book['id']}",
                "pgId": book["id"],
                "title": book["title"],
                "author": book["author"],
                "language": book["language"],
                "domain": book["domain"],
                "kind": "txt",
                "file": os.path.relpath(path, args.out).replace("\\", "/"),
                "bytes": os.path.getsize(path),
                "license": "Public Domain · Project Gutenberg",
                "source": f"{MIRRORS[0]}/{urllib.parse.quote(book['path'].lstrip('/'), safe='/')}",
                "quality": book.get("quality", 0),
            }
        )

    index_path = os.path.join(args.out, "index.json")
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "meta": {
                    "name": "词刻公版书库 · 离线正文",
                    "count": len(index),
                    "domains": dict(Counter(item["domain"] for item in index)),
                    "bytes": sum(item["bytes"] for item in index),
                },
                "books": index,
            },
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    failures = [r for r in results if r["status"] in ("failed", "too-large")]
    if failures:
        with open(os.path.join(args.out, "failures.json"), "w", encoding="utf-8") as handle:
            json.dump(failures, handle, ensure_ascii=False, indent=2)

    print(json.dumps(
        {
            "ok": sum(1 for r in results if r["status"] == "ok"),
            "skip": sum(1 for r in results if r["status"] == "skip"),
            "failed": sum(1 for r in results if r["status"] == "failed"),
            "too_large": sum(1 for r in results if r["status"] == "too-large"),
            "indexed": len(index),
            "index": index_path,
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0 if not any(r["status"] == "failed" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())