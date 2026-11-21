#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把桌面上的 BGM 母带转成应用内可用的 m4a，并输出曲目清单。

母带多是 44.1kHz 立体声 WAV，单首二三十到九十 MB，直接放进包体太重。
这里统一转 AAC 96kbps，既保留背景音乐该有的细节，又把体积压到几 MB。

用法：
  python tools/import-bgm.py --dry-run
  python tools/import-bgm.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio", "bgm")
FFMPEG = r"C:\Program Files\EVCapture\ffmpeg.exe"

DESKTOP = r"C:\Users\pc\Desktop\02_个人素材\音频"
TRACKS = [
    ("exile", "流亡", os.path.join(DESKTOP, "音乐", "流亡.wav")),
    ("snowfall", "Snowfall", os.path.join(DESKTOP, "音乐", "Snowfall.ogg")),
    ("evo", "Evo", os.path.join(DESKTOP, "Evo.wav")),
    ("siren", "斯人", os.path.join(DESKTOP, "音乐搜集包整合（乌鸦", "④轻音乐&Gal包", "斯人.wav")),
    ("pingfeng", "萍逢", os.path.join(DESKTOP, "音乐搜集包整合（乌鸦", "④轻音乐&Gal包", "萍逢.wav")),
    ("gin", "GIN", os.path.join(DESKTOP, "音乐搜集包整合（乌鸦", "④轻音乐&Gal包", "GIN.wav")),
    ("gudichou", "故敌愁", os.path.join(DESKTOP, "音乐搜集包整合（乌鸦", "⑥中国风音乐包", "故敌愁.wav")),
    ("huaqiao", "画桥雨下", os.path.join(DESKTOP, "音乐搜集包整合（乌鸦", "⑥中国风音乐包", "画桥雨下.wav")),
    ("bear-apple", "小 熊 貓 和 蘋 果", os.path.join(DESKTOP, "音乐", "小 熊 貓 和 蘋 果.wav")),
    ("south-dust", "南方尘埃", os.path.join(DESKTOP, "音乐", "南方尘埃.wav")),
]

DURATION = re.compile(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)")


def probe(path: str) -> tuple[float, int]:
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path],
        capture_output=True,
    )
    text = result.stderr.decode("utf-8", "replace")
    match = DURATION.search(text)
    seconds = 0.0
    if match:
        hours, minutes, secs, _ = match.groups()
        seconds = int(hours) * 3600 + int(minutes) * 60 + int(secs)
    return seconds, os.path.getsize(path)


def clock(seconds: float) -> str:
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--bitrate", default="96k")
    args = parser.parse_args()

    os.makedirs(OUT, exist_ok=True)
    summary = []
    for track_id, title, source in TRACKS:
        if not os.path.exists(source):
            print(f"[missing] {track_id}: {source}", flush=True)
            continue
        seconds, source_bytes = probe(source)
        target = os.path.join(OUT, f"{track_id}.m4a")
        if not args.dry_run:
            tmp = target + ".part"
            command = [
                FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
                "-i", source,
                "-vn", "-ac", "2", "-ar", "44100",
                "-c:a", "aac", "-b:a", args.bitrate,
                "-movflags", "+faststart",
                "-f", "mp4",
                tmp,
            ]
            result = subprocess.run(command)
            if result.returncode != 0:
                print(f"[failed] {track_id} ffmpeg exit {result.returncode}", flush=True)
                continue
            os.replace(tmp, target)
        out_bytes = os.path.getsize(target) if os.path.exists(target) else 0
        summary.append(
            {
                "id": track_id,
                "title": title,
                "duration": clock(seconds),
                "sourceMB": round(source_bytes / 1048576, 1),
                "outMB": round(out_bytes / 1048576, 2),
            }
        )
        print(
            f"[{ 'check' if args.dry_run else 'done' }] {track_id:<12} {title:<10} "
            f"{clock(seconds):>5}  {source_bytes/1048576:6.1f}MB -> {out_bytes/1048576:5.2f}MB",
            flush=True,
        )

    total = sum(item["outMB"] for item in summary)
    print(f"[total] {len(summary)} tracks, {total:.1f} MB")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())