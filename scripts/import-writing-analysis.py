"""把六级作文 / 翻译解析 PDF 渲染为页面图，供词刻应用内查看。

运行：
    python scripts/import-writing-analysis.py

输出：
    analysis/writing/<essay|trans>-YYYY-MM/pNNN.webp
    analysis/writing/manifest.js  （window.CIKE_WRITING_ANALYSIS）

用法与 analysis/listening 保持一致：1100px 宽 WebP，中文按页面栅格化，
避免 PDF 缺字体或扫描件无文本层造成乱码。
"""
from __future__ import annotations

import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "writing"
WIDTH = 1100
QUALITY = 68

SOURCES = [
    (
        "essay",
        Path(r"D:\BaiduNetdiskDownload\六级【写译】\六级写作真题+范文\六级作文解析"),
    ),
    (
        "trans",
        Path(r"D:\BaiduNetdiskDownload\六级【写译】\六级翻译真题+范文\翻译解析"),
    ),
]


def session_key(kind: str, name: str) -> str:
    match = re.match(r"(20\d{2})\.(\d{1,2})", name)
    if not match:
        raise ValueError(f"无法从文件名识别考试场次：{name}")
    year, month = match.group(1), int(match.group(2))
    return f"{kind}-{year}-{month:02d}"


def render_pdf(kind: str, pdf: Path) -> dict:
    key = session_key(kind, pdf.name)
    doc = pymupdf.open(pdf)
    target = OUT / key
    target.mkdir(parents=True, exist_ok=True)

    heights: list[int] = []
    total_bytes = 0
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        scale = WIDTH / page.rect.width
        pix = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),
            colorspace=pymupdf.csRGB,
            alpha=False,
        )
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=QUALITY, method=4)
        data = buffer.getvalue()
        (target / f"p{page_index + 1:03d}.webp").write_bytes(data)
        heights.append(pix.height)
        total_bytes += len(data)

    pages = doc.page_count
    doc.close()
    return {
        "key": key,
        "source": pdf.name,
        "pages": pages,
        "width": WIDTH,
        "heights": heights,
        "mb": round(total_bytes / 1024 / 1024, 2),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    papers: dict[str, dict] = {}
    failures: list[str] = []

    for kind, directory in SOURCES:
        if not directory.is_dir():
            print(f"缺少目录：{directory}", file=sys.stderr)
            return 1
        for pdf in sorted(directory.glob("*.pdf")):
            try:
                info = render_pdf(kind, pdf)
            except Exception as error:  # noqa: BLE001
                failures.append(f"{pdf.name}: {error}")
                print(f"失败 {pdf.name}: {error}", file=sys.stderr)
                continue
            key = info.pop("key")
            papers[key] = info
            print(f"{key}\t{info['pages']}p\t{info['mb']}MB\t{info['source']}")

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "width": WIDTH,
        "papers": dict(sorted(papers.items())),
    }
    body = json.dumps(manifest, ensure_ascii=False, indent=2)
    (OUT / "manifest.js").write_text(
        "/* 由 scripts/import-writing-analysis.py 生成，请勿手改。\n"
        " * 解析 PDF 已按页渲染为 WebP，避免中文文本层缺失导致乱码。 */\n"
        "window.CIKE_WRITING_ANALYSIS = " + body + ";\n",
        encoding="utf-8",
    )
    print(f"\n共 {len(papers)} 套解析，失败 {len(failures)} 套")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())