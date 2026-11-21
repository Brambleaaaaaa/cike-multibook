#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 Project Gutenberg 的插图版 HTML 压缩包（{id}-h.zip）抓下来，
拆成按页排列的图片，供应用里以「图片书 / 漫画」的方式阅读。

用法：
  python tools/library-catalog/fetch_illustrated.py --limit 5
  python tools/library-catalog/fetch_illustrated.py --workers 6

产物：
  library/public/comics/{pgId}/001.png ...
  library/public/comics.json
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX = os.path.join(ROOT, "library", "public", "index.json")
COMIC_DIR = os.path.join(ROOT, "library", "public", "comics")
OUTPUT = os.path.join(ROOT, "library", "public", "comics.json")

MIRRORS = [
    "https://www.mirrorservice.org/sites/ftp.ibiblio.org/pub/docs/books/gutenberg",
    "https://gutenberg.pglaf.org",
    "https://mirror.csclub.uwaterloo.ca/gutenberg",
]

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp")
SKIP_RE = re.compile(r"(logo|icon|spacer|bullet|button|exlibris)", re.I)
# 太小的图多半是装饰线条、花体首字母，不当作漫画页。
MIN_BYTES = 25 * 1024
# 单页扫描图可能很大。为了控制应用包体和加载速度，只保留页数、体积适中的图册。
MAX_PAGES = 160
KEEP_MAX_PAGES = 48
KEEP_MAX_BYTES = 12 * 1024 * 1024

UA = "Mozilla/5.0 (compatible; CikeLibrary/1.0; +local offline reader)"


def fetch(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def natural_key(name: str):
    parts = re.split(r"(\d+)", name)
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def base_url(source: str) -> str:
    return source.rsplit("/", 1)[0] + "/"


def load_index():
    with open(INDEX, encoding="utf-8") as handle:
        return json.load(handle)


def collect_candidates(index):
    candidates = []
    for item in index.get("books", []):
        if item.get("domain") != "漫画":
            continue
        pg_id = item.get("pgId")
        source = item.get("source") or ""
        if not pg_id or not source:
            continue
        candidates.append(item)
    return candidates


def extract_book(item, session_lock):
    pg_id = item["pgId"]
    target_dir = os.path.join(COMIC_DIR, str(pg_id))
    if os.path.isdir(target_dir) and os.listdir(target_dir):
        existing = sorted(os.listdir(target_dir))
        return {
            "pgId": pg_id,
            "status": "skip",
            "pages": len(existing),
            "bytes": sum(os.path.getsize(os.path.join(target_dir, name)) for name in existing),
        }

    zip_name = f"{pg_id}-h.zip"
    base = base_url(item["source"])
    data = None
    last_error = ""
    for mirror in MIRRORS:
        relative = base.split("/gutenberg/", 1)[-1]
        url = f"{mirror}/{relative}{zip_name}"
        try:
            data = fetch(url)
            break
        except Exception as error:  # noqa: BLE001
            last_error = f"{type(error).__name__}: {error}"
            continue
    if data is None:
        return {"pgId": pg_id, "status": "fail", "error": last_error}

    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return {"pgId": pg_id, "status": "fail", "error": "bad zip"}

    entries = []
    for info in archive.infolist():
        name = info.filename
        lower = name.lower()
        if info.is_dir() or not lower.endswith(IMAGE_EXTS):
            continue
        if lower.rsplit("/", 1)[-1].startswith("."):
            continue
        if SKIP_RE.search(lower):
            continue
        if info.file_size < MIN_BYTES:
            continue
        entries.append(info)
    entries.sort(key=lambda info: natural_key(info.filename.rsplit("/", 1)[-1]))
    if len(entries) < 3:
        return {"pgId": pg_id, "status": "fail", "error": f"only {len(entries)} images"}
    entries = entries[:MAX_PAGES]

    os.makedirs(target_dir, exist_ok=True)
    pages = []
    total = 0
    for position, info in enumerate(entries, start=1):
        ext = os.path.splitext(info.filename)[1].lower()
        filename = f"{position:03d}{ext}"
        payload = archive.read(info)
        with open(os.path.join(target_dir, filename), "wb") as handle:
            handle.write(payload)
        total += len(payload)
        pages.append(
            {
                "title": f"第 {position} 页",
                "image": filename,
                "text": "",
            }
        )
    return {
        "pgId": pg_id,
        "status": "ok",
        "pages": pages,
        "bytes": total,
        "title": item.get("title"),
        "author": item.get("author"),
        "language": item.get("language"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    index = load_index()
    candidates = collect_candidates(index)
    if args.limit:
        candidates = candidates[: args.limit]
    print(f"[plan] {len(candidates)} illustrated candidates, workers={args.workers}")

    os.makedirs(COMIC_DIR, exist_ok=True)
    results = {}
    if os.path.exists(OUTPUT):
        try:
            with open(OUTPUT, encoding="utf-8") as handle:
                for record in json.load(handle).get("books", []):
                    results[record["pgId"]] = record
        except Exception:  # noqa: BLE001
            results = {}

    lock = Lock()
    done = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(extract_book, item, lock): item for item in candidates}
        for future in as_completed(futures):
            item = futures[future]
            done += 1
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001
                result = {"pgId": item["pgId"], "status": "fail", "error": str(error)}
            if result["status"] == "ok":
                results[result["pgId"]] = {
                    "id": f"pg{result['pgId']}",
                    "pgId": result["pgId"],
                    "title": result.get("title") or item.get("title"),
                    "author": result.get("author") or item.get("author"),
                    "language": result.get("language") or item.get("language"),
                    "domain": "漫画",
                    "kind": "image",
                    "type": "comic",
                    "assetBase": f"comics/{result['pgId']}/",
                    "pages": result["pages"],
                    "bytes": result["bytes"],
                    "license": "Public Domain · Project Gutenberg",
                }
            if done % 10 == 0 or done == len(candidates):
                rate = done / max(0.001, time.time() - started)
                ok = sum(1 for r in results.values() if r.get("pages"))
                print(f"[{done}/{len(candidates)}] books={ok} avg={rate:.2f}/s")

    books = [
        record
        for record in results.values()
        if len(record.get("pages", [])) <= KEEP_MAX_PAGES
        and int(record.get("bytes", 0)) <= KEEP_MAX_BYTES
    ]
    books.sort(key=lambda record: record["pgId"])
    payload = {
        "meta": {
            "name": "词刻公版图像书",
            "source": "Project Gutenberg · illustrated HTML",
            "count": len(books),
            "pages": sum(len(book.get("pages", [])) for book in books),
            "bytes": sum(int(book.get("bytes", 0)) for book in books),
        },
        "books": books,
    }
    with open(OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(payload["meta"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())