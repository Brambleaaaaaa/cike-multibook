#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EPUB 编码体检（只读）。

用法:
    python diagnose_epub_encoding.py "C:/Users/pc/Downloads/小说" -o report.csv

输出四类:
    A  编码声明与实际字节不符（可修）
    B  疑似 mojibake / 双重编码（可尝试反向修复）
    C  含大量 U+FFFD / 锟斤拷（不可逆，需重新获取源文件）
    OK 未发现异常

依赖: pip install charset-normalizer
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

try:
    from charset_normalizer import from_bytes
except ImportError:  # pragma: no cover
    from_bytes = None

CONTENT_SUFFIXES = (".html", ".xhtml", ".htm")
XML_DECL_RE = re.compile(rb'<\?xml[^>]{0,200}encoding=["\']([\w.:-]+)["\']', re.I)
META_CHARSET_RE = re.compile(rb'<meta[^>]{0,200}charset=["\']?\s*([\w.:-]+)', re.I)
META_HTTP_RE = re.compile(
    rb'<meta[^>]{0,200}content=["\'][^"\']{0,120}charset=([\w.:-]+)', re.I
)
ROOT_TAG_RE = re.compile(r"<\s*([a-zA-Z][\w:.-]*)")

MOJIBAKE_RE = re.compile(
    "(Ã[\\u0080-\\u00BF]|Â[\\u0080-\\u00BF]|â[\\u0080-\\u00BF\\u2018-\\u203A]|"
    "æ[\\u0080-\\u00BF]|ç[\\u0080-\\u00BF]|è[\\u0080-\\u00BF]|é[\\u0080-\\u00BF]|"
    "ä[\\u0080-\\u00BF]|å[\\u0080-\\u00BF]|ð[\\u0080-\\u00BF]|ï[\\u0080-\\u00BF])"
)

TYPE_LABELS = {
    "A": "声明不符",
    "B": "疑似mojibake",
    "C": "不可逆",
    "OK": "正常",
}


def normalize_encoding(name: str | None) -> str:
    if not name:
        return ""
    value = name.strip().lower().replace("_", "-")
    aliases = {
        "utf8": "utf-8",
        "utf-8-sig": "utf-8",
        "gb2312": "gb18030",
        "gbk": "gb18030",
        "x-gbk": "gb18030",
        "cp936": "gb18030",
        "big5-hkscs": "big5",
        "shift-jis": "shift_jis",
        "sjis": "shift_jis",
        "euc-kr": "euc-kr",
        "ks_c_5601": "euc-kr",
        "cp1252": "cp1252",
        "windows-1252": "cp1252",
        "iso-8859-1": "latin-1",
        "latin1": "latin-1",
        "ascii": "ascii",
    }
    return aliases.get(value, value)


def detect_bom(data: bytes) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8"
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return "utf-16"
    return ""


def detect_declared(data: bytes) -> tuple[str, str]:
    head = data[:4096]
    bom = detect_bom(data)
    if bom:
        return bom, "BOM"
    match = XML_DECL_RE.search(head)
    if match:
        return normalize_encoding(match.group(1).decode("latin-1")), "xml-decl"
    match = META_CHARSET_RE.search(head) or META_HTTP_RE.search(head)
    if match:
        return normalize_encoding(match.group(1).decode("latin-1")), "meta-charset"
    return "", ""


def detect_actual(data: bytes) -> tuple[str, str]:
    bom = detect_bom(data)
    if bom:
        return bom, "bom"
    try:
        data.decode("utf-8")
        return "utf-8", "utf8-ok"
    except UnicodeDecodeError:
        pass
    if from_bytes is not None:
        best = from_bytes(data).best()
        if best is not None and best.encoding:
            return normalize_encoding(best.encoding), "charset-normalizer"
    for candidate in ("gb18030", "big5", "shift_jis", "euc-kr", "cp1252", "latin-1"):
        try:
            data.decode(candidate)
            return candidate, "fallback"
        except UnicodeDecodeError:
            continue
    return "latin-1", "assumed"


def decode_bytes(data: bytes, encoding: str) -> str:
    try:
        return data.decode(encoding)
    except (LookupError, UnicodeDecodeError):
        return data.decode(encoding if encoding else "utf-8", errors="replace")


def mojibake_stats(text: str) -> dict:
    visible = text.strip()
    length = max(len(visible), 1)
    markers = len(MOJIBAKE_RE.findall(visible))
    replacement = visible.count("\ufffd")
    lost_cjk = visible.count("锟斤拷")
    question_runs = len(re.findall(r"\?{3,}", visible))
    score = (markers * 2 + replacement * 6 + lost_cjk * 10 + question_runs * 3) * 1000 / length
    return {
        "score": round(score, 2),
        "markers": markers,
        "replacement": replacement,
        "lost_cjk": lost_cjk,
        "question_runs": question_runs,
        "replacement_ratio": replacement / length,
    }


def try_reversal(text: str) -> tuple[str, str, dict] | None:
    """尝试把 mojibake 反向还原，返回 (候选文本, 链名, 统计)。"""
    base = mojibake_stats(text)
    if base["score"] < 1.0:
        return None
    best = None
    chains = (
        ("latin-1>utf-8", "latin-1", "utf-8"),
        ("cp1252>utf-8", "cp1252", "utf-8"),
        ("gb18030>utf-8", "gb18030", "utf-8"),
        ("big5>utf-8", "big5", "utf-8"),
    )
    for name, source_encoding, target_encoding in chains:
        try:
            candidate = text.encode(source_encoding).decode(target_encoding)
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        stats = mojibake_stats(candidate)
        if "\ufffd" in candidate and "\ufffd" not in text:
            continue
        if stats["score"] <= base["score"] * 0.4:
            if best is None or stats["score"] < best[2]["score"]:
                best = (candidate, name, stats)
    return best


def read_opf_language(zf: zipfile.ZipFile) -> str:
    for name in zf.namelist():
        if name.lower().endswith(".opf"):
            try:
                text = zf.read(name).decode("utf-8", errors="replace")
            except KeyError:
                continue
            match = re.search(r"<dc:language[^>]*>([^<]+)</dc:language>", text, re.I)
            if match:
                return match.group(1).strip()
    return ""


def sample_text(text: str, limit: int = 100) -> str:
    flat = re.sub(r"\s+", " ", text).strip()
    return flat[:limit]


@dataclass
class Row:
    epub: str
    inner: str
    declared: str
    declared_from: str
    actual: str
    actual_from: str
    kind: str
    score: float
    markers: int
    replacement: int
    lost_cjk: int
    opf_language: str = ""
    reversal: str = ""
    sample: str = ""
    note: str = ""
    severity: str = ""
    replacement_ratio: float = 0.0


def inspect_epub(path: Path) -> tuple[list[Row], str, int]:
    rows: list[Row] = []
    note = ""
    content_count = 0
    try:
        with zipfile.ZipFile(path) as zf:
            language = read_opf_language(zf)
            if any("META-INF/encryption.xml" == n for n in zf.namelist()):
                note = "含 encryption.xml，可能加密"
            for name in zf.namelist():
                if not name.lower().endswith(CONTENT_SUFFIXES):
                    continue
                content_count += 1
                try:
                    data = zf.read(name)
                except KeyError:
                    continue
                if not data.strip():
                    continue
                declared, declared_from = detect_declared(data)
                actual, actual_from = detect_actual(data)
                text = decode_bytes(data, actual)
                stats = mojibake_stats(text)
                reversal = ""
                kind = "OK"
                severity = ""
                if (
                    stats["lost_cjk"] > 0
                    or stats["replacement"] >= 50
                    or stats["replacement_ratio"] >= 0.001
                ):
                    kind = "C"
                    severity = "major"
                elif stats["replacement"] > 0 or stats["question_runs"] >= 5:
                    # 少量替换字符通常是原书制作时丢了几个重音字母，
                    # 只需人工核对，没必要整本重找。
                    kind = "C"
                    severity = "minor"
                else:
                    fixed = try_reversal(text)
                    if stats["score"] >= 2.0 and fixed:
                        kind = "B"
                        reversal = fixed[1]
                    elif declared and actual and declared != actual:
                        # ASCII 内容在两种编码下都合法时不算异常。
                        has_non_ascii = any(byte > 0x7F for byte in data)
                        kind = "A" if has_non_ascii else "OK"
                    elif stats["score"] >= 2.0:
                        kind = "B" if fixed else "C" if stats["replacement"] else "OK"
                rows.append(
                    Row(
                        epub=str(path),
                        inner=name,
                        declared=declared,
                        declared_from=declared_from,
                        actual=actual,
                        actual_from=actual_from,
                        kind=kind,
                        score=stats["score"],
                        markers=stats["markers"],
                        replacement=stats["replacement"],
                        lost_cjk=stats["lost_cjk"],
                        opf_language=language,
                        reversal=reversal,
                        sample=sample_text(text),
                        note=note,
                        severity=severity,
                        replacement_ratio=round(stats["replacement_ratio"], 5),
                    )
                )
    except zipfile.BadZipFile:
        rows.append(
            Row(
                epub=str(path),
                inner="",
                declared="",
                declared_from="",
                actual="",
                actual_from="",
                kind="C",
                score=0,
                markers=0,
                replacement=0,
                lost_cjk=0,
                sample="",
                note="不是合法 ZIP/EPUB",
            )
        )
    return rows, note, content_count


def summarize(rows: list[Row]) -> dict:
    books: dict[str, dict] = {}
    for row in rows:
        item = books.setdefault(
            row.epub, {"counts": {"A": 0, "B": 0, "C": 0, "OK": 0}, "score": 0.0}
        )
        item["counts"][row.kind] += 1
        item["score"] = max(item["score"], row.score)
    return books


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="EPUB 编码体检（只读，不改文件）")
    parser.add_argument("root", help="EPUB 文件或包含 EPUB 的目录")
    parser.add_argument("-o", "--output", default="epub-encoding-report.csv")
    parser.add_argument(
        "--only-bad",
        action="store_true",
        help="只输出 A/B/C 行，跳过正常文件",
    )
    args = parser.parse_args()

    root = Path(args.root)
    if root.is_file():
        files = [root]
    else:
        files = sorted(root.rglob("*.epub"))
    if not files:
        print("没有找到 .epub 文件。")
        return 1

    all_rows: list[Row] = []
    for path in files:
        rows, note, count = inspect_epub(path)
        bad = sum(1 for row in rows if row.kind != "OK")
        print(f"[扫描] {path.name}  内容文件 {count}  异常 {bad}  {note}")
        all_rows.extend(rows)

    out_rows = [row for row in all_rows if not args.only_bad or row.kind != "OK"]
    with open(args.output, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "epub",
                "inner_file",
                "declared",
                "declared_from",
                "actual",
                "actual_from",
                "type",
                "type_label",
                "severity",
                "score",
                "markers",
                "replacement",
                "replacement_ratio",
                "lost_cjk",
                "opf_language",
                "reversal",
                "sample",
                "note",
            ]
        )
        for row in out_rows:
            writer.writerow(
                [
                    row.epub,
                    row.inner,
                    row.declared,
                    row.declared_from,
                    row.actual,
                    row.actual_from,
                    row.kind,
                    TYPE_LABELS.get(row.kind, row.kind),
                    row.severity,
                    row.score,
                    row.markers,
                    row.replacement,
                    row.replacement_ratio,
                    row.lost_cjk,
                    row.opf_language,
                    row.reversal,
                    row.sample,
                    row.note,
                ]
            )

    books = summarize(all_rows)
    print("\n=== 书级汇总 ===")
    for epub, info in sorted(books.items()):
        counts = info["counts"]
        print(
            f"{Path(epub).name}: A={counts['A']} B={counts['B']} "
            f"C={counts['C']} OK={counts['OK']} max_score={info['score']}"
        )
    major = sum(1 for row in all_rows if row.kind == "C" and row.severity == "major")
    minor = sum(1 for row in all_rows if row.kind == "C" and row.severity == "minor")
    print(f"不可逆文件: 严重 {major} 个，局部丢失 {minor} 个")
    print(f"\n明细已写入: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())