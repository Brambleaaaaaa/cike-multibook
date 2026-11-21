#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EPUB 编码修复（分类型、默认写新文件、修复后验证）。

默认行为:
    读取源 EPUB，把修复后的版本写入 --out 目录，原文件完全不动。
    这本身就是最稳妥的“备份优先”：原件永远保留。

用法:
    # 试点三本
    python fix_epub_encoding.py a.epub b.epub c.epub --out D:/fixed

    # 整个目录
    python fix_epub_encoding.py "C:/Users/pc/Downloads/小说" --out D:/fixed

    # 只看计划，不落盘
    python fix_epub_encoding.py <root> --dry-run

处理规则:
    A  声明编码与实际字节不符 -> 按实际编码解码，统一写成 UTF-8，
       并把 XML 声明 / <meta charset> 改成 utf-8。
    B  mojibake 双重编码 -> 尝试 latin-1/cp1252/gb18030/big5 -> utf-8，
       仅当乱码评分降到原来 40% 以下才采用。
    C  U+FFFD / 锟斤拷 -> 不修复，写入报告（严重/局部）。
    OK 原样复制。

依赖: pip install charset-normalizer
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_epub_encoding import (  # noqa: E402
    CONTENT_SUFFIXES,
    decode_bytes,
    detect_actual,
    detect_declared,
    mojibake_stats,
    read_opf_language,
    try_reversal,
)

ENCODING_DECL_RE = re.compile(rb'(<\?xml[^>]{0,200}encoding=["\'])([\w.:-]+)(["\'])', re.I)
META_CHARSET_RE = re.compile(rb'(<meta[^>]{0,200}charset=["\']?)([\w.:-]+)', re.I)
META_HTTP_RE = re.compile(
    rb'(<meta[^>]{0,200}content=["\'][^"\']{0,120}charset=)([\w.:-]+)', re.I
)


@dataclass
class FileAction:
    inner: str
    kind: str
    severity: str
    before: float
    after: float
    changed: bool
    reason: str = ""


@dataclass
class BookResult:
    source: str
    output: str
    status: str
    files_changed: int = 0
    files_skipped_c: int = 0
    files_ok: int = 0
    before: float = 0.0
    after: float = 0.0
    notes: list[str] = field(default_factory=list)
    actions: list[FileAction] = field(default_factory=list)


def rewrite_declarations(data: bytes) -> bytes:
    data = ENCODING_DECL_RE.sub(rb"\1utf-8\3", data, count=1)
    data, count = META_CHARSET_RE.subn(rb"\1utf-8", data, count=1)
    if count == 0:
        data = META_HTTP_RE.sub(rb"\1utf-8", data, count=1)
    return data


def repair_document(data: bytes) -> tuple[bytes | None, str, str, float, float]:
    """返回 (新字节 or None, 类型, 说明, 修复前分数, 修复后分数)。"""
    declared, _ = detect_declared(data)
    actual, _ = detect_actual(data)
    text = decode_bytes(data, actual)
    stats = mojibake_stats(text)
    before = stats["score"]

    if stats["lost_cjk"] > 0 or stats["replacement"] >= 50 or stats["replacement_ratio"] >= 0.001:
        return None, "C", "严重字符丢失，未修复", before, before
    if stats["replacement"] > 0 or stats["question_runs"] >= 5:
        return None, "C", "局部字符丢失，未修复", before, before

    candidate = text
    kind = "OK"
    reason = "无需修改"

    if stats["score"] >= 2.0:
        fixed = try_reversal(text)
        if fixed:
            candidate, chain, new_stats = fixed
            if new_stats["score"] <= before * 0.4:
                kind = "B"
                reason = f"mojibake 反向还原：{chain}"
            else:
                return None, "B", "反向还原收益不足，跳过", before, before
        else:
            return None, "B", "无法反向还原，跳过", before, before
    elif declared and actual and declared != actual and any(b > 0x7F for b in data):
        kind = "A"
        reason = f"按实际编码 {actual} 重写为 UTF-8"
    else:
        if decode_utf8_ok(data):
            return None, "OK", "无需修改", before, before

    encoded = candidate.encode("utf-8")
    encoded = rewrite_declarations(encoded)
    new_text = encoded.decode("utf-8", errors="replace")
    after = mojibake_stats(new_text)["score"]
    if after > before and kind == "A":
        return None, kind, "重写后评分反而升高，回滚", before, before
    return encoded, kind, reason, before, after


def decode_utf8_ok(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def build_epub(source: Path, output: Path, dry_run: bool) -> BookResult:
    result = BookResult(source=str(source), output=str(output), status="未处理")
    try:
        with zipfile.ZipFile(source) as zin:
            names = zin.namelist()
            if "META-INF/encryption.xml" in names:
                result.status = "跳过"
                result.notes.append("含 encryption.xml（加密/DRM），不改动")
                return result

            replacements: dict[str, bytes] = {}
            for name in names:
                if not name.lower().endswith(CONTENT_SUFFIXES):
                    continue
                data = zin.read(name)
                if not data.strip():
                    continue
                new_data, kind, reason, before, after = repair_document(data)
                result.before = max(result.before, before)
                if new_data is None:
                    if kind == "C":
                        result.files_skipped_c += 1
                    else:
                        result.files_ok += 1
                    if kind in ("B", "C"):
                        result.actions.append(
                            FileAction(name, kind, "major" if "严重" in reason else "minor", before, after, False, reason)
                        )
                    continue
                replacements[name] = new_data
                result.files_changed += 1
                result.after = max(result.after, after)
                result.actions.append(
                    FileAction(name, kind, "", before, after, True, reason)
                )

            if not replacements:
                result.status = "无需修复" if result.files_skipped_c == 0 else "部分不可修"
                if dry_run:
                    result.status = "[预演] " + result.status
                return result

            if dry_run:
                result.status = "[预演] 将修复"
                result.after = max(result.after, result.before)
                return result

            output.parent.mkdir(parents=True, exist_ok=True)
            tmp = output.with_suffix(output.suffix + ".tmp")
            with zipfile.ZipFile(tmp, "w") as zout:
                mimetype_info = next((info for info in zin.infolist() if info.filename == "mimetype"), None)
                if mimetype_info is not None:
                    info = zipfile.ZipInfo("mimetype", date_time=mimetype_info.date_time)
                    info.compress_type = zipfile.ZIP_STORED
                    info.external_attr = mimetype_info.external_attr
                    zout.writestr(info, zin.read("mimetype"))
                for info in zin.infolist():
                    if info.filename == "mimetype":
                        continue
                    data = replacements.get(info.filename)
                    if data is None:
                        data = zin.read(info.filename)
                    new_info = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                    new_info.compress_type = info.compress_type
                    new_info.external_attr = info.external_attr
                    new_info.create_system = info.create_system
                    zout.writestr(new_info, data)

            with zipfile.ZipFile(tmp) as check:
                bad = check.testzip()
                if bad:
                    raise RuntimeError(f"重新打包校验失败: {bad}")
                infos = check.infolist()
                if not infos or infos[0].filename != "mimetype" or infos[0].compress_type != zipfile.ZIP_STORED:
                    raise RuntimeError("mimetype 未按要求放在首位且不压缩")
                for name in replacements:
                    check.read(name).decode("utf-8")
            shutil.move(str(tmp), str(output))
            result.status = "已修复"
    except Exception as error:  # noqa: BLE001
        result.status = "失败"
        result.notes.append(str(error))
    return result


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="EPUB 编码修复（默认输出到新目录）")
    parser.add_argument("paths", nargs="+", help="EPUB 文件或目录")
    parser.add_argument("--out", required=False, help="修复版输出目录（不能与源目录相同）")
    parser.add_argument("--dry-run", action="store_true", help="只预演，不写文件")
    parser.add_argument("--report", default="epub-encoding-fix-report.csv")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 本（试点）")
    args = parser.parse_args()

    sources: list[Path] = []
    roots: list[Path] = []
    for raw in args.paths:
        path = Path(raw)
        if path.is_file():
            sources.append(path)
            roots.append(path.parent)
        elif path.is_dir():
            roots.append(path)
            sources.extend(sorted(path.rglob("*.epub")))
        else:
            print(f"[跳过] 不存在: {path}")
    if args.limit:
        sources = sources[: args.limit]
    if not sources:
        print("没有找到 .epub 文件。")
        return 1

    common_root = Path(os_commonpath([str(p) for p in roots]))
    out_dir = Path(args.out) if args.out else common_root / "epub-encoding-fixed"
    if out_dir.resolve() == common_root.resolve():
        print("输出目录不能与源目录相同；为保护原件已退出。")
        return 2

    results: list[BookResult] = []
    for source in sources:
        try:
            relative = source.relative_to(common_root)
        except ValueError:
            relative = Path(source.name)
        output = out_dir / relative
        print(f"[处理] {relative}")
        result = build_epub(source, output, args.dry_run)
        print(
            f"       {result.status}  改动 {result.files_changed}  "
            f"不可修 {result.files_skipped_c}  评分 {result.before} -> {result.after}"
        )
        results.append(result)

    with open(args.report, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "source",
                "output",
                "status",
                "files_changed",
                "files_skipped_c",
                "max_score_before",
                "max_score_after",
                "notes",
            ]
        )
        for result in results:
            writer.writerow(
                [
                    result.source,
                    result.output,
                    result.status,
                    result.files_changed,
                    result.files_skipped_c,
                    result.before,
                    result.after,
                    " | ".join(result.notes),
                ]
            )

    print("\n=== 汇总 ===")
    for result in results:
        print(
            f"{Path(result.source).name}: {result.status} "
            f"改动 {result.files_changed} / 不可修 {result.files_skipped_c} "
            f"评分 {result.before} -> {result.after}"
        )
    print(f"\n报告: {args.report}")
    return 0


def os_commonpath(paths: list[str]) -> str:
    import os

    try:
        return os.path.commonpath(paths)
    except ValueError:
        return str(Path(paths[0]))


if __name__ == "__main__":
    raise SystemExit(main())