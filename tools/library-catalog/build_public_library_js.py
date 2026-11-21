#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把已下载的公版书索引打包成应用可直接加载的 public-library.js。"""

from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX = os.path.join(ROOT, "library", "public", "index.json")
COMICS = os.path.join(ROOT, "library", "public", "comics.json")
MANIFEST = os.path.join(ROOT, "library-catalog", "manifest.json")
OUTPUT = os.path.join(ROOT, "public-library.js")

DOMAIN_ORDER = ["小说", "漫画", "期刊", "科学", "自然", "地理", "金融", "时尚", "艺术", "政治时讯"]

# 小说 / 漫画的主题标签。公版书没有现成题材字段，这里按书名和作者做关键词归类，
# 只用于资料发现页的筛选项，不会改动书名和正文。
GENRE_ORDER = ["悬疑", "科幻", "恐怖", "幻想", "冒险", "爱情", "青春", "成长", "幽默", "诗歌", "历史", "其他"]
GENRE_RULES = [
    ("悬疑", r"mystery|mysteries|murder|detective|crime|criminal|clue|sherlock|poirot|whodunit|secret of|case of|the hound|strange case|myst[èe]re|meurtre|[ée]nigme"),
    ("科幻", r"science fiction|scientific romance|time machine|war of the worlds|invisible man|island of doctor moreau|first men in the moon|robot|space|planet|future|twenty thousand leagues|from the earth to the moon|science-fiction|anticipation"),
    ("恐怖", r"horror|ghost|vampire|dracula|frankenstein|monster|haunted|werewolf|zombie|fant[ôo]me|horreur|monstre"),
    ("幻想", r"fairy|fantasy|wonderland|magic|magical|dragon|wizard|witch|\boz\b|neverland|arabian nights|goblin|king arthur|narnia|looking-glass|conte de f[ée]es?|f[ée]erie|merveilleux"),
    ("冒险", r"adventure|voyage|journey|treasure|island|captain|pirate|explorer|crusoe|castaway|buccaneer|aventure|tr[ée]sor|naufrage"),
    ("爱情", r"\blove\b|romance|lover|marriage|courtship|pride and prejudice|emma|jane eyre|wuthering|sense and sensibility|mansfield park|persuasion|northanger|amour|amoureux|mariage"),
    ("青春", r"\byouth\b|boyhood|girlhood|school|college|childhood|tom sawyer|huckleberry|little women|anne of green gables|what katy did|jeunesse|enfance|[ée]cole"),
    ("成长", r"coming of age|apprenticeship|education of|life and adventures|growing up"),
    ("幽默", r"comic|comical|humour|humor|funny|nonsense|satire|burlesque|joke|jest"),
    ("诗歌", r"poems|poetry|sonnet|verse|ballads?|rhymes|po[ée]sies?|po[èe]mes?"),
    ("历史", r"historical|history of|chronicle|memoirs of|reign of|war of the roses"),
]

# 公版书里同一批作者反复出现，作者名比书名更能稳定判断题材。
AUTHOR_GENRE_RULES = [
    ("悬疑", r"conan doyle|wilkie collins|edgar allan poe|chesterton|gaston leroux|maurice leblanc|gaboriau|anna katharine green|m\. r\. james|sheridan le fanu|emile gaboriau"),
    ("科幻", r"\bjules verne\b|\bh\. g\. wells\b|mary shelley|edgar rice burroughs|bulwer-lytton"),
    ("恐怖", r"bram stoker|mary shelley|edgar allan poe|sheridan le fanu|lovecraft|m\. r\. james"),
    ("幻想", r"l\. frank baum|lewis carroll|george macdonald|lord dunsany|e\. nesbit|edith nesbit|andrew lang|grimm|hans christian andersen|kenneth grahame|j\. m\. barrie"),
    ("冒险", r"robert louis stevenson|jack london|daniel defoe|h\. rider haggard|rudyard kipling|james fenimore cooper|alexandre dumas|walter scott|jules verne"),
    ("爱情", r"jane austen|charlotte bront[eë]|emily bront[eë]|elizabeth gaskell|anthony trollope|thomas hardy|george meredith|gustave flaubert"),
    ("青春", r"louisa may alcott|l\. m\. montgomery|susan coolidge|frances hodgson burnett|johanna spyri|mark twain"),
    ("成长", r"charles dickens|horatio alger|jane austen"),
    ("幽默", r"jerome k\. jerome|\bmark twain\b|w\. m\. thackeray|p\. g\. wodehouse"),
    ("历史", r"walter scott|alexandre dumas|leo tolstoy|victor hugo"),
]


def classify_genre(title: str, author: str, domain: str) -> str:
    if domain not in ("小说", "漫画"):
        return ""
    text = f"{title} {author}".lower()
    for genre, pattern in GENRE_RULES:
        if re.search(pattern, text):
            return genre
    for genre, pattern in AUTHOR_GENRE_RULES:
        if re.search(pattern, text):
            return genre
    return "其他"


def main() -> int:
    with open(INDEX, encoding="utf-8") as handle:
        index = json.load(handle)
    with open(MANIFEST, encoding="utf-8") as handle:
        manifest = json.load(handle)

    books = []
    for item in index["books"]:
        # Project Gutenberg 的正文都是纯文本，没有真正的图片漫画。
        # 旧版把带 "comic" 关键词的书归到漫画栏目，点进去却是文字，
        # 这里统一回到小说栏目，漫画栏目只留给用户书架里的图片/PDF 漫画。
        domain = "小说" if item["domain"] == "漫画" else item["domain"]
        books.append(
            {
                "id": item["id"],
                "title": item["title"],
                "author": item["author"],
                "language": item["language"],
                "domain": domain,
                "genre": classify_genre(item["title"], item.get("author", ""), domain),
                "type": "magazine" if domain == "期刊" else "ebook",
                "kind": "txt",
                "assetPath": "library/public/" + item["file"],
                "source": "Project Gutenberg · 公版",
                "license": item.get("license", "Public Domain"),
                "bytes": item.get("bytes", 0),
                "quality": item.get("quality", 0),
                "public": True,
            }
        )
    # 真正的图片书：Gutenberg 插图版拆出来的扫描页，按页当漫画读。
    if os.path.exists(COMICS):
        with open(COMICS, encoding="utf-8") as handle:
            comics = json.load(handle)
        for item in comics.get("books", []):
            books.append(
                {
                    "id": f"comic-{item['pgId']}",
                    "title": item["title"],
                    "author": item.get("author", ""),
                    "language": item.get("language", "en"),
                    "domain": "漫画",
                    "genre": "",
                    "type": "comic",
                    "kind": "image",
                    "assetBase": "library/public/" + item["assetBase"],
                    "pages": item.get("pages", []),
                    "source": "Project Gutenberg · 插图版",
                    "license": item.get("license", "Public Domain"),
                    "bytes": item.get("bytes", 0),
                    "quality": 0,
                    "public": True,
                }
            )
    books.sort(
        key=lambda book: (
            DOMAIN_ORDER.index(book["domain"]) if book["domain"] in DOMAIN_ORDER else 99,
            -book["quality"],
            -book["bytes"],
            book["title"].lower(),
        )
    )

    payload = {
        "meta": {
            "name": "词刻公版书库",
            "source": "Project Gutenberg",
            "count": len(books),
            "offlineBytes": sum(book["bytes"] for book in books),
            "domains": {
                domain: sum(1 for book in books if book["domain"] == domain)
                for domain in DOMAIN_ORDER
            },
            "genres": {
                genre: sum(1 for book in books if book["genre"] == genre)
                for genre in GENRE_ORDER
                if any(book["genre"] == genre for book in books)
            },
        },
        "catalog": manifest["meta"],
        "books": books,
    }
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("window.PRELOADED_PUBLIC_LIBRARY = ")
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    print(f"[public-library] {len(books)} books -> {OUTPUT}")
    print(json.dumps(payload["meta"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())