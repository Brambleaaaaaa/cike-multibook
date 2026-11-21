#!/usr/bin/env python3
"""Generate the 27 missing achievement stickers in the same hand-drawn style.

Outputs 512x512 SVG files to .impeccable/sticker-svg/.
Render them to PNG with .impeccable/render-sticker-svg.mjs, then run this
script with --convert to produce assets/stickers/Nxx.webp.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SVG_DIR = ROOT / ".impeccable" / "sticker-svg"
PNG_DIR = ROOT / ".impeccable" / "sticker-render"
OUT_DIR = ROOT / "assets" / "stickers"

INK = "#2b2a26"
PAPER = "#fffaf0"
ACCENT = "#f0d56b"

FILLS = {
    "cream": "#f8f1df",
    "butter": "#f6e6ae",
    "orange": "#f3cdb8",
    "sky": "#d5ebf1",
    "sage": "#d6e9dd",
    "rose": "#f2d7dd",
    "lavender": "#e4dcf0",
    "taupe": "#e3d9cb",
}


def sparkle(x, y, size=11):
    return (
        f'<path d="M{x} {y-size} L{x+size*0.28} {y-size*0.28} L{x+size} {y} '
        f'L{x+size*0.28} {y+size*0.28} L{x} {y+size} '
        f'L{x-size*0.28} {y+size*0.28} L{x-size} {y} '
        f'L{x-size*0.28} {y-size*0.28} Z" fill="{ACCENT}" stroke-width="2.5"/>'
    )


def icon(kind):
    """Return line-art markup inside a 512x512 canvas, icon area ~y 110-260."""
    if kind == "calendar7":
        return f'''
        <rect x="166" y="118" width="180" height="150" rx="14" fill="{PAPER}"/>
        <path d="M166 158 H346"/>
        <path d="M204 102 V132 M308 102 V132"/>
        <circle cx="212" cy="196" r="8" fill="{ACCENT}"/>
        <circle cx="256" cy="196" r="8" fill="{ACCENT}"/>
        <circle cx="300" cy="196" r="8" fill="{ACCENT}"/>
        <circle cx="212" cy="232" r="8" fill="{ACCENT}"/>
        <path d="M300 226 L308 234 L324 214" stroke-width="7"/>'''
    if kind == "calendar30":
        return f'''
        <rect x="160" y="112" width="192" height="158" rx="14" fill="{PAPER}"/>
        <path d="M160 154 H352"/>
        <path d="M200 96 V128 M312 96 V128"/>
        <path d="M192 186 H312 M192 214 H312 M192 242 H312"/>
        <path d="M218 154 V270 M256 154 V270 M294 154 V270" stroke-width="3.5"/>'''
    if kind == "medal":
        return f'''
        <path d="M214 118 L238 190 M298 118 L274 190" />
        <circle cx="256" cy="196" r="52" fill="{PAPER}"/>
        <path d="M256 166 L265 185 L286 188 L270 203 L274 224 L256 213 L238 224 L242 203 L226 188 L247 185 Z" fill="{ACCENT}" stroke-width="4"/>'''
    if kind == "refresh":
        return f'''
        <path d="M200 202 A62 62 0 1 1 218 238" />
        <path d="M196 176 L200 206 L228 198" />
        <path d="M312 154 A62 62 0 0 1 300 118" />
        <path d="M318 180 L312 150 L284 158" />'''
    if kind == "refresh_tally":
        return f'''
        <path d="M200 202 A62 62 0 1 1 218 238" />
        <path d="M196 176 L200 206 L228 198" />
        <path d="M238 238 V166 M268 238 V166 M298 238 V166" stroke-width="6"/>
        <path d="M224 184 L312 220" stroke-width="6"/>'''
    if kind == "chain":
        return f'''
        <rect x="160" y="170" width="86" height="46" rx="23" fill="{PAPER}" transform="rotate(-28 203 193)"/>
        <rect x="266" y="170" width="86" height="46" rx="23" fill="{PAPER}" transform="rotate(-28 309 193)"/>
        <path d="M232 188 L282 166" stroke-width="6"/>'''
    if kind == "check":
        return f'<path d="M172 196 L232 252 L346 134" stroke-width="12"/>'
    if kind == "double_check":
        return f'''
        <path d="M150 198 L194 242 L272 160" stroke-width="10"/>
        <path d="M240 202 L284 246 L362 164" stroke-width="10"/>'''
    if kind == "medal_check":
        return f'''
        <path d="M214 118 L238 190 M298 118 L274 190" />
        <circle cx="256" cy="196" r="52" fill="{PAPER}"/>
        <path d="M230 198 L250 218 L286 176" stroke-width="8"/>'''
    if kind == "target":
        return f'''
        <circle cx="256" cy="190" r="64" fill="{PAPER}"/>
        <circle cx="256" cy="190" r="40"/>
        <circle cx="256" cy="190" r="15" fill="{ACCENT}"/>
        <path d="M256 190 L322 124 M310 124 H330 V144" stroke-width="6"/>'''
    if kind == "book_arrow":
        return f'''
        <path d="M174 200 C200 182 228 182 254 198 C280 182 308 182 334 200 L334 244 C308 226 280 226 254 242 C228 226 200 226 174 244 Z" fill="{PAPER}"/>
        <path d="M254 198 V242"/>
        <path d="M330 150 A40 40 0 0 1 340 108" />
        <path d="M342 140 L338 110 L310 118"/>'''
    if kind == "books_stack":
        return f'''
        <rect x="170" y="204" width="172" height="34" rx="7" fill="{PAPER}"/>
        <rect x="182" y="168" width="160" height="32" rx="7" fill="{PAPER}"/>
        <rect x="196" y="134" width="142" height="30" rx="7" fill="{PAPER}"/>
        <path d="M196 220 H236 M208 184 H248 M220 150 H260" stroke-width="3.5"/>'''
    if kind == "pouch":
        return f'''
        <path d="M190 168 H322 L308 246 C306 258 296 264 284 264 H228 C216 264 206 258 204 246 Z" fill="{PAPER}"/>
        <path d="M210 168 C216 140 232 124 256 124 C280 124 296 140 302 168"/>
        <path d="M230 196 L240 214 L262 188" stroke-width="5"/>
        {sparkle(298, 186, 10)}'''
    if kind == "clock":
        return f'''
        <circle cx="256" cy="190" r="64" fill="{PAPER}"/>
        <path d="M256 154 V192 L282 208" stroke-width="7"/>
        <path d="M256 112 V122 M334 190 H324 M256 268 V258 M178 190 H188" stroke-width="4"/>
        <circle cx="256" cy="190" r="5" fill="{INK}"/>'''
    if kind == "open_book":
        return f'''
        <path d="M172 160 C200 142 228 142 256 158 C284 142 312 142 340 160 L340 236 C312 218 284 218 256 234 C228 218 200 218 172 236 Z" fill="{PAPER}"/>
        <path d="M256 158 V234"/>
        <path d="M204 176 C222 168 238 168 250 176 M204 200 C222 192 238 192 250 200" stroke-width="3.5"/>'''
    if kind == "chain7":
        return f'''
        <path d="M166 208 C166 178 190 156 220 156 H244" fill="none"/>
        <path d="M166 208 C166 238 190 260 220 260 H244" fill="none"/>
        <path d="M268 156 H292 C322 156 346 178 346 208 C346 238 322 260 292 260 H268" fill="none"/>
        <circle cx="256" cy="208" r="10" fill="{ACCENT}"/>'''
    if kind == "closed_book":
        return f'''
        <rect x="184" y="132" width="148" height="146" rx="10" fill="{PAPER}"/>
        <path d="M204 132 V278" stroke-width="6"/>
        <path d="M304 140 V208 L324 192 L344 208 V140" fill="{ACCENT}"/>'''
    if kind == "bookmark":
        return f'''
        <path d="M206 122 H306 V266 L256 230 L206 266 Z" fill="{PAPER}"/>
        <path d="M256 230 V200" stroke-width="4"/>
        <circle cx="256" cy="186" r="10" fill="{ACCENT}"/>'''
    if kind == "bubbles":
        return f'''
        <path d="M156 150 H276 C288 150 296 158 296 170 V214 C296 226 288 234 276 234 H214 L184 254 V234 H156 C144 234 136 226 136 214 V170 C136 158 144 150 156 150 Z" fill="{PAPER}"/>
        <path d="M196 196 L214 168 L232 196 M202 188 H226" stroke-width="5"/>
        <path d="M300 182 H356 C368 182 376 190 376 202 V236 C376 248 368 256 356 256 H344 V274 L322 256 H300 C288 256 280 248 280 236 V202" fill="{PAPER}"/>
        <path d="M312 218 H344 M312 236 H332" stroke-width="4"/>'''
    if kind == "speech_shell":
        return f'''
        <path d="M164 146 H348 C360 146 368 154 368 166 V222 C368 234 360 242 348 242 H230 L196 264 V242 H164 C152 242 144 234 144 222 V166 C144 154 152 146 164 146 Z" fill="{PAPER}"/>
        <path d="M216 194 C216 170 240 160 256 160 C272 160 296 170 296 194 C296 214 278 224 256 236 C234 224 216 214 216 194 Z" fill="{ACCENT}"/>
        <path d="M256 190 V206 M256 206 C248 200 242 202 240 210 M256 206 C264 200 270 202 272 210" stroke-width="4"/>'''
    if kind == "magnifier_eye":
        return f'''
        <circle cx="238" cy="180" r="62" fill="{PAPER}"/>
        <path d="M282 224 L338 280" stroke-width="10"/>
        <path d="M204 180 C218 160 258 160 272 180 C258 200 218 200 204 180 Z" fill="{ACCENT}"/>
        <circle cx="238" cy="180" r="12" fill="{PAPER}"/>'''
    if kind == "pen":
        return f'''
        <path d="M196 246 L292 126 L330 154 L234 274 Z" fill="{PAPER}"/>
        <path d="M292 126 L306 110 L344 138 L330 154" fill="{ACCENT}"/>
        <path d="M196 246 L184 282 L220 270" fill="{ACCENT}"/>
        <path d="M206 256 L264 182" stroke-width="3"/>'''
    if kind == "headphones":
        return f'''
        <path d="M176 208 V184 C176 140 212 108 256 108 C300 108 336 140 336 184 V208" fill="none"/>
        <rect x="160" y="196" width="42" height="66" rx="18" fill="{PAPER}"/>
        <rect x="310" y="196" width="42" height="66" rx="18" fill="{PAPER}"/>
        <path d="M256 262 V276" stroke-width="5"/>
        <path d="M352 150 C366 166 372 184 372 202 M372 202 C372 220 366 238 352 254" stroke-width="4"/>'''
    if kind == "ear":
        return f'''
        <path d="M212 214 C212 166 238 138 276 138 C314 138 336 166 336 202 C336 232 318 246 300 258 C284 268 280 280 280 296 C280 312 266 322 252 316" fill="{PAPER}"/>
        <path d="M250 214 C250 190 264 174 286 174 C308 174 318 190 318 206 C318 222 306 230 296 240" fill="none" stroke-width="5"/>
        <path d="M356 148 C370 166 376 184 376 204 M376 204 C376 224 370 242 356 260" stroke-width="4"/>'''
    if kind == "folder_down":
        return f'''
        <path d="M160 156 H232 L250 178 H352 C364 178 372 186 372 198 V262 C372 274 364 282 352 282 H160 C148 282 140 274 140 262 V176 C140 164 148 156 160 156 Z" fill="{PAPER}"/>
        <path d="M256 196 V244 M236 226 L256 246 L276 226" stroke-width="6"/>'''
    if kind == "papers_star":
        return f'''
        <rect x="166" y="144" width="134" height="154" rx="8" fill="{PAPER}" transform="rotate(-8 233 221)"/>
        <rect x="194" y="132" width="134" height="154" rx="8" fill="{PAPER}" transform="rotate(4 261 209)"/>
        <path d="M226 176 H300 M226 202 H292 M226 228 H276" stroke-width="4"/>
        <path d="M330 160 L339 180 L360 183 L344 198 L348 219 L330 208 L312 219 L316 198 L300 183 L321 180 Z" fill="{ACCENT}" stroke-width="4"/>'''
    raise ValueError(kind)


# achievement id -> (art id, color, big text, icon kind)
ITEMS = [
    ("days-7", "N01", "cream", "7", "calendar7"),
    ("days-30", "N02", "sky", "30", "calendar30"),
    ("days-365", "N03", "butter", "365", "medal"),
    ("attempts-100", "N04", "sky", "100", "refresh"),
    ("attempts-1000", "N05", "sage", "1000", "refresh_tally"),
    ("attempts-5000", "N06", "lavender", "5000", "chain"),
    ("correct-100", "N07", "cream", "100", "check"),
    ("correct-500", "N08", "sage", "500", "double_check"),
    ("correct-2000", "N09", "butter", "2000", "medal_check"),
    ("accuracy-80", "N10", "cream", "80%", "target"),
    ("review-10", "N11", "cream", "10", "book_arrow"),
    ("review-100", "N12", "sky", "100", "refresh"),
    ("review-500", "N13", "sage", "500", "books_stack"),
    ("wordbook-20", "N14", "cream", "20", "pouch"),
    ("read-10min", "N15", "cream", "10min", "clock"),
    ("read-days-1", "N16", "cream", "1", "open_book"),
    ("read-streak-7", "N17", "sage", "7", "chain7"),
    ("book-start", "N18", "cream", "1", "closed_book"),
    ("bookmarks-5", "N19", "cream", "5", "bookmark"),
    ("translate-10", "N20", "cream", "10", "bubbles"),
    ("translate-50", "N21", "sky", "50", "speech_shell"),
    ("ocr-5", "N22", "sage", "5", "magnifier_eye"),
    ("writing-20", "N23", "butter", "20", "pen"),
    ("listening-1", "N24", "cream", "1", "headphones"),
    ("listening-10", "N25", "lavender", "10", "ear"),
    ("local-import-10", "N26", "sage", "10", "folder_down"),
    ("discover-5", "N27", "cream", "5", "papers_star"),
]


def text_size(text):
    if len(text) >= 5:
        return 58
    if len(text) == 4:
        return 68
    if len(text) == 3:
        return 78
    return 92


def svg_for(art_id, color, big, kind):
    fill = FILLS[color]
    size = text_size(big)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <filter id="drop" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="3" dy="8" stdDeviation="8" flood-color="#3b352c" flood-opacity="0.16"/>
    </filter>
    <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="{int(art_id[1:]) * 7}"/>
      <feDisplacementMap in="SourceGraphic" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g filter="url(#drop)">
    <circle cx="256" cy="252" r="228" fill="{fill}" stroke="{INK}" stroke-width="4.5"/>
  </g>
  <g filter="url(#rough)" fill="none" stroke="{INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    {icon(kind)}
  </g>
  <text x="256" y="378" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, Bradley Hand, cursive"
        font-size="{size}" font-weight="600" fill="#23211d">{big}</text>
  <path d="M168 402 H344" stroke="{INK}" stroke-width="3" opacity="0.55"/>
</svg>
'''


def write_svgs():
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    for _ach, art, color, big, kind in ITEMS:
        (SVG_DIR / f"{art}.svg").write_text(svg_for(art, color, big, kind), encoding="utf-8")
    print(f"wrote {len(ITEMS)} SVG files to {SVG_DIR}")


def convert():
    from PIL import Image

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for _ach, art, _color, _big, _kind in ITEMS:
        png = PNG_DIR / f"{art}.png"
        if not png.exists():
            raise SystemExit(f"missing render: {png}")
        img = Image.open(png).convert("RGBA")
        img = img.resize((240, 240), Image.LANCZOS)
        img.save(OUT_DIR / f"{art}.webp", "WEBP", quality=84, method=6)
        count += 1
    total = sum((OUT_DIR / f"{art}.webp").stat().st_size for _a, art, *_ in ITEMS)
    print(f"converted {count} stickers, total {total / 1024:.1f} KB")


if __name__ == "__main__":
    if "--convert" in sys.argv:
        convert()
    else:
        write_svgs()
