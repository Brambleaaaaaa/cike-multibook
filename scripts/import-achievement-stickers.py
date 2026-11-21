"""把 stickers/*.png 原画转为应用内的 WebP 贴纸资源。

源图放在项目根目录 stickers/，输出到 assets/stickers/<aid>.webp。
边长压到 240px：贴纸墙最大 92px，三倍屏也够清晰，同时把 41MB PNG 压到 1MB 级。
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "stickers"
TARGET = ROOT / "assets" / "stickers"
SIZE = 240
QUALITY = 84


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    crops = json.loads((SOURCE / "crops.json").read_text(encoding="utf-8"))
    aids = [item["aid"] for item in crops]
    total = 0
    for aid in aids:
        source = SOURCE / f"{aid}.png"
        if not source.exists():
            raise FileNotFoundError(source)
        with Image.open(source) as image:
            image = image.convert("RGB")
            image = image.resize((SIZE, SIZE), Image.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, "WEBP", quality=QUALITY, method=6)
        data = buffer.getvalue()
        (TARGET / f"{aid}.webp").write_bytes(data)
        total += len(data)
    print(f"stickers: {len(aids)}, total: {total / 1024 / 1024:.2f}MB")


if __name__ == "__main__":
    main()