#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
词刻 · 公版书目录构建器

数据来源（均为 Project Gutenberg 镜像公开索引）：
  - GUTINDEX.ALL         书目 + 编号 + 语言 + 副标题
  - main-filelist.csv.bz2 每本书在镜像上的 TXT/HTML 精确路径与体积

输出：
  library-catalog/manifest.json
  library-catalog/books.json
  library-catalog/domains/<slug>.json
  library-catalog/report.md

设计原则：
  - 只收 public domain（排除 GUTINDEX 中带 **** 的版权条目）
  - 只收英文 / 法文
  - 排除工具书、多卷残卷、期刊汇编、目录索引
  - 按标题/副标题/作者做加权分类，宁缺毋滥
  - 每个领域设上限，总量 20000；不足的领域如实报告，不拿垃圾凑数
"""

from __future__ import annotations

import bz2
import json
import os
import re
import sys
import urllib.request
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE = "https://mirror.csclub.uwaterloo.ca/gutenberg"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(ROOT, "library-catalog")
RAW_DIR = os.path.join(ROOT, ".cache", "gutenberg")
TARGET_TOTAL = 20000

DOMAINS = ["漫画", "时尚", "金融", "政治时讯", "科学", "自然", "地理", "艺术", "小说"]
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
}
CAPS = {
    "小说": 9000,
    "艺术": 3000,
    "政治时讯": 3000,
    "自然": 2000,
    "地理": 2000,
    "科学": 1600,
    "金融": 900,
    "时尚": 900,
    "漫画": 600,
}

# 稀缺/生活类领域放宽到 2 分；其余保持 3 分，宁可少收
MIN_SCORE = {"政治时讯": 2, "金融": 2, "时尚": 2, "漫画": 2}

# ---------------------------------------------------------------------------
# 下载与解析
# ---------------------------------------------------------------------------

def ensure_file(name: str, url: str) -> str:
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, name)
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        return path
    print(f"[download] {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "CikeCatalog/1.0 (+local library builder)"})
    with urllib.request.urlopen(req, timeout=300) as response, open(path, "wb") as output:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            output.write(chunk)
    return path


NUM_RE = re.compile(r"^(.*?)\s{2,}(\d{4,6})\s*$")
META_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")


def parse_gutindex(path: str) -> list[dict]:
    text = open(path, encoding="utf-8-sig", errors="replace").read()
    blocks = re.split(r"\n\s*\n", text)
    entries: list[dict] = []
    for block in blocks:
        lines = block.splitlines()
        if not lines or "TITLE and AUTHOR" in block or "GUTINDEX." in block[:40]:
            continue
        idx = head = number = None
        for i, line in enumerate(lines):
            match = NUM_RE.match(line)
            if match:
                idx, head, number = i, match.group(1).strip(), int(match.group(2))
                break
        if idx is None or number is None:
            continue
        preceding = [line.strip() for line in lines[:idx] if line.strip()]
        if preceding:
            head = " ".join(preceding + [head])
        meta: dict[str, str] = {}
        trailing: list[str] = []
        for line in lines[idx + 1 :]:
            match = META_RE.match(line)
            if match:
                key, _, value = match.group(1).partition(":")
                meta[key.strip()] = value.strip()
            elif line.strip() and not line.strip().startswith("["):
                trailing.append(line.strip())
        if trailing:
            head = head + " " + " ".join(trailing)
        head = re.sub(r"\s+", " ", head).strip().strip(",")
        if not head:
            continue
        language = meta.get("Language", "English")
        lang = "fr" if "French" in language else ("en" if language in ("English", "") else "xx")
        entries.append(
            {
                "n": number,
                "line": head,
                "subtitle": meta.get("Subtitle", ""),
                "author_meta": meta.get("Author", ""),
                "lang": lang,
                "copyright": "****" in block,
            }
        )
    return entries


def parse_filelist(path: str) -> dict[int, dict]:
    """id -> 最佳 TXT 路径与体积。优先 -0.txt（UTF-8），其次任意 txt，最后 html。"""
    best: dict[int, dict] = {}
    opener = bz2.open(path, "rt", encoding="utf-8", errors="replace")
    with opener as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("filename,"):
                continue
            parts = line.rsplit(",", 2)
            if len(parts) != 3:
                continue
            name, _, size_text = parts
            low = name.lower()
            if not low.endswith((".txt", ".htm", ".html")):
                continue
            base = name.rsplit("/", 1)[-1]
            match = re.match(r"^(?:pg)?(\d{1,6})(?:\D|$)", base, re.I)
            if not match:
                continue
            book_id = int(match.group(1))
            try:
                size = int(size_text)
            except ValueError:
                continue
            # 打分：-0.txt 最优，普通 txt 次之，html 兜底
            if low.endswith("-0.txt"):
                rank = 0
            elif low.endswith(".txt"):
                rank = 1
            else:
                rank = 2
            current = best.get(book_id)
            if current is None or (rank, size) < (current["rank"], current["size"]):
                best[book_id] = {"path": name, "size": size, "rank": rank}
    return best


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


def split_author(line: str, meta_author: str) -> tuple[str, str]:
    match = re.match(r"^(.*?),\s*by\s+(.+)$", line, re.I)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    if meta_author:
        return line.strip(), meta_author.strip()
    return line.strip(), ""


# ---------------------------------------------------------------------------
# 过滤与分类
# ---------------------------------------------------------------------------

HARD_JUNK = re.compile(
    r"\b(dictionary|encyclopa?edia|gazetteer|almanac|year.?book|index|bibliography|"
    r"catalogue|catalog|directory|register|digest|compilation|abstracts|"
    r"who's who|blue book|red book|telephone|postal guide)\b",
    re.I,
)
VOLUME_JUNK = re.compile(
    r"(\b(vol\.?|volume|part|pt\.?|tome|band)\s*(\d+|i{1,3}|iv|v|vi{0,3}|ix|x)\b|"
    r"\b(complete works|collected works|works of|selected works|selections|extracts|"
    r"abridged|condensed|miscellany|miscellaneous|notes and queries|"
    r"proceedings|transactions|bulletin|journal|periodical|magazine|annual report|"
    r"report of the|reports of the|list of|index to|"
    r"monthly|quarterly|weekly|supplement|scientific american|"
    r"astounding stories|fantasy fan|preface)\b)",
    re.I,
)

# 分卷/连载标题：按月、年份结尾，归并为同一部作品
SERIAL_TITLE_RE = re.compile(
    r",?\s*(?:\b(january|february|march|april|may|june|july|august|september|"
    r"october|november|december)\b.*|\b1[5-9]\d{2}\b.*|\b20\d{2}\b.*)$",
    re.I,
)

# 领域词典：[(权重, 正则)]，权重 3=强信号，2=中，1=弱
DEFINITIONS: dict[str, list[tuple[int, str]]] = {
    "漫画": [
        (3, r"\b(comic|comics|comic strip|graphic novel|caricature|caricatures|cartoon|cartoons)\b"),
        (2, r"\b(punch|funny pictures|picture book|illustrated story|nonsense verse|"
            r"picture alphabet|nursery rhymes|rhymes for|alphabet)\b"),
    ],
    "时尚": [
        (3, r"\b(fashion|fashions|costume|costumes|dress|dresses|clothing|etiquette|"
            r"millinery|tailoring|couture|toilette|jewel(le)?ry|perfume|cosmetics|"
            r"hair.?dressing|embroidery|needlework|lace|lingerie|modes?|"
            r"dressmaking|fancy work|home decoration|interior decoration)\b"),
        (2, r"\b(manners|beauty|style|hats?|shoes?|gloves?|ornament)\b"),
        (1, r"\b(social life and customs|home life|decorum)\b"),
    ],
    "金融": [
        (3, r"\b(finance|financial|banking|econom(y|ics|ic)|political economy|commerce|"
            r"stock exchange|currency|coinage|taxation|tariff|usury|insurance|"
            r"bookkeeping|accounting|investment|capital|credit)\b"),
        (2, r"\b(money|wealth|trade|trades|business|industry|industries|budget|revenue|"
            r"wages|labour|labor|market|markets|prices|profit|debt|"
            r"merchant|merchants|manufacture|manufactures|railway|railroad|canal|"
            r"post.?office|emigration)\b"),
    ],
    "政治时讯": [
        (3, r"\b(politic(s|al)|government|governance|democracy|republic|constitution|"
            r"constitutional|parliament|congress|senate|suffrage|diplomacy|diplomatic|"
            r"treaty|treaties|revolution|rebellion|socialism|communist|communism|"
            r"anarchism|anarchy|fascism|imperialism|colonial|colonies|citizenship|civics)\b"),
        (3, r"\b(history of|historical|memoirs?|biography|autobiography|life of|"
            r"reminiscences|chronicles?|annals|civil war|regiment)\b"),
        (2, r"\b(state|statesman|law|laws|legal|justice|court|election|elections|vote|voting|"
            r"war|wars|army|navy|military|empire|federation|policy|policies|reform|reforms|"
            r"public opinion|current events|government|administration|"
            r"history|letters|diary|correspondence|memorials)\b"),
    ],
    "科学": [
        (3, r"\b(science|sciences|scientific|physics|chemistry|astronomy|astronomical|"
            r"biology|biological|evolution|evolutionary|medicine|medical|physiology|"
            r"anatomy|mathematics|mathematical|geometry|algebra|calculus|mechanics|"
            r"electricity|electromagnetic|thermodynamics|psychology|anthropology|"
            r"archaeology|sociology)\b"),
        (2, r"\b(natural philosophy|microscope|telescope|experiment|experiments|"
            r"scientist|scientists|discovery|discoveries|theory|theories|"
            r"chemistry|chemical|physics|physic|diseases?|surgery|hygiene|"
            r"geology|geological|mineralogy|meteorology|sanitary)\b"),
    ],
    "自然": [
        (3, r"\b(natural history|wildlife|ornithology|botany|botanical|zoology|zoological|"
            r"entomology|ecology|ecosystem|birds|plants|flowers|trees|forests|insects|"
            r"butterflies|bees|mammals|fishes|reptiles)\b"),
        (2, r"\b(nature|animals|animal|plant|flower|tree|forest|insect|gardening|garden|"
            r"gardens|seashore|shells|country life|rural life|outdoors|wilderness|"
            r"animals? life|bird life|insect life|plant life|naturalist|parasites|"
            r"woods|rivers|seaside|mountains)\b"),
        (1, r"\b(mountains|mountain|horses|dogs|cats|pets|fish)\b"),
    ],
    "地理": [
        (3, r"\b(geography|geographic|geographical|exploration|explorer|explorers|"
            r"voyage|voyages|travel|travels|traveller|traveler|journey|journeys|"
            r"description and travel|atlas|maps|expedition|expeditions|topography)\b"),
        (2, r"\b(tour|tours|countries|country|continent|continents|islands|island|"
            r"arctic|antarctic|polar|pilgrimage|ramble|rambles|scenery|frontier|"
            r"territory|region|regions|discovery|discoveries|road.?book|"
            r"guide.?book|picturesque|wanderings|sojourn|residence in|tour through|"
            r"narrative of|account of|through)\b"),
    ],
    "艺术": [
        (3, r"\b(painting|paintings|painter|painters|sculpture|sculptor|architecture|"
            r"architect|music|musical|musician|composer|drawing|drawings|engraving|"
            r"engravings|etching|photography|drama|theatre|theater|opera|poetry|"
            r"poems|poem|design|designs|aesthetics|aesthetic|carving|pottery|"
            r"ceramics|decorative|ornament|ornaments|sketch.?book|water.?colours?|"
            r"woodcuts?|sonata|symphony|quartet|opus|overture|hymns?|ballads?|"
            r"sonnets?|odes?)\b"),
        (2, r"\b(art|arts|artist|artists|literature|criticism|essays|essay|sketch|sketches|"
            r"furniture|interior decoration|picture|pictures|illustration|illustrations|"
            r"songs|verse|gallery|museum|exhibition|portrait|portraits|"
            r"illustrations to|illustrated by)\b"),
    ],
}

for domain, rules in DEFINITIONS.items():
    DEFINITIONS[domain] = [(weight, re.compile(pattern, re.I)) for weight, pattern in rules]

FICTION_RE = re.compile(
    r"\b(novel|novels|romance|romances|tale|tales|story|stories|adventures?|"
    r"mystery|mysteries|detective|fantasy|fiction|fairy tale|fairy tales|folklore|"
    r"myth|myths|legend|legends|novelette|novella)\b",
    re.I,
)

# 弱小说信号：单独出现不足以判定（+2），需与强信号或小说家白名单叠加
FICTION_WEAK_RE = re.compile(
    r"\b(lover|lovers|bride|brides|wedding|weddings|orphan|orphans|heiress|heir|"
    r"countess|duke|duchess|baron|baroness|squire|schoolgirl|schoolboy|sweetheart|"
    r"rebel|rebels|wizard|witch|fairy|fairies|haunted|ghost|ghosts|treasure|"
    r"castle|island|peril|perils|secret|secrets|missing|stolen|twins|"
    r"girls|boys|daughter|son|wife|husband|widow)\b",
    re.I,
)

# 公版少儿/冒险系列小说的强信号
FICTION_SERIES_RE = re.compile(
    r"\b(motor boys|airplane boys|boy scouts|girl scouts|high school|freshmen|"
    r"at play|at school|in camp|in the woods|in the rockies|in hollywood|"
    r"round the campfire)\b",
    re.I,
)
SERIES_GUARD_RE = re.compile(r"\b(history|practice|manual|guide|handbook|hand-book)\b", re.I)

FICTION_AUTHORS = {
    # English / American
    "austen", "dickens", "thackeray", "eliot", "bronte", "hardy", "trollope",
    "gaskell", "scott", "doyle", "poe", "twain", "melville", "hawthorne",
    "woolf", "joyce", "conrad", "stevenson", "kipling", "wells",
    "defoe", "fielding", "richardson", "sterne", "swift", "goldsmith",
    "burney", "edgeworth", "disraeli", "bulwer", "lytton", "reade", "collins",
    "trollope", "blackmore", "meredith", "gissing", "moore",
    "conrad", "maugham", "forster", "lawrence", "huxley", "orwell",
    "wodehouse", "christie", "sayers", "chesterton", "belloc", "bennett",
    "galsworthy", "shelley", "stoker", "walpole", "radcliffe", "burney",
    # French
    "dumas", "hugo", "zola", "balzac", "flaubert", "stendhal", "maupassant",
    "sand", "george sand", "verne", "gautier", "merimee", "loti", "france",
    "proust", "voltaire", "rousseau", "chateaubriand", "colette", "murger",
    "sue", "eugene sue", "about", "droz", "feval", "gaboriau", "leroux",
    "leblanc", "prevost", "bernardin", "constant", "nerval", "vigny",
    "musset", "sandeau", "augier", "halévy", "halévy", "dumas fils",
    # Russian / other in translation
    "tolstoy", "dostoevsky", "turgenev", "gogol", "chekhov", "pushkin",
    "lermontov", "gorky", "kuprin", "leskov", "saltykov",
    "goethe", "schiller", "hoffmann", "kafka", "mann", "hesse",
    "cervantes", "manzoni", "vergílio", "camões", "alencar", "machado",
    # 公版通俗小说 / 儿童文学 / 冒险小说高产作者（仅收辨识度高的姓氏，避免误伤非虚构）
    "sophie may", "baum", "wheeler", "le feuvre", "bindloss", "mccarter",
    "hentz", "fitzhugh", "ervine", "seawell", "wiggin", "isham",
    "schubin", "ebner-eschenbach", "craine", "dundas", "conklin",
    "montgomery", "alcott", "burnett", "nesbit", "lofting", "grahame",
    "henty", "fenn", "curwood", "mulford", "wister", "rinehart",
    "leblanc", "leroux", "gaboriau", "crofts", "wentworth",
    "oliphant", "yonge", "sewell", "marryat", "ainsworth",
    "braddon", "ouida", "corelli", "hatherton", "du maurier",
    "malot", "barbusse", "rolland", "martin du gard", "becque",
    "mirbeau", "huysmans", "villiers", "l'isle-adam", "rachilde",
    "lorrain", "bazin", "daudet", "theuriet", "aurevilly",
    "griffith", "garnett", "hancock", "richmond", "carleton", "porter",
    "johnston", "cather", "wharton", "stowe", "harte", "garland",
    "norris", "jewett", "chopin", "hurston", "dunbar",
    "optic", "stratemeyer", "cutcliffe", "tuttle", "haycox", "altsheler",
    "alger", "mary jane holmes", "dehan", "balch", "barbour",
    "clarence young", "payson", "herbert carter", "henry james", "haggard",
    "jerome k jerome", "groner", "macdonald", "jack london", "w w jacobs",
    "j s fletcher", "mary wilkins freeman", "standish", "fergus hume",
    "owen johnson", "bertrand sinclair", "michael arlen", "barrington",
    "edgar rice burroughs",
}

# 领域作者白名单：命中可直接加权
DOMAIN_AUTHORS = {
    "科学": {"darwin", "huxley", "tyndall", "faraday", "maxwell", "galileo", "newton",
             "kepler", "laplace", "humboldt", "arago", "clerk maxwell", "pasteur",
             "frazer", "tylor", "spencer", "wallace", "lyell", "buckland"},
    "自然": {"thoreau", "john burroughs", "mabie", "seton", "hudson",
             "fabre", "bates", "wallace", "darwin", "gilbert white", "selous"},
    "地理": {"livingstone", "speke", "nansen", "shackleton", "peary",
             "hedin", "marco polo", "polo", "huc", "henry stanley",
             "richard burton"},
    "金融": {"adam smith", "david ricardo", "malthus", "bastiat",
             "thorstein veblen", "john maynard keynes", "bagehot"},
    "政治时讯": {"edmund burke", "thomas paine", "tocqueville", "montesquieu", "thomas hobbes",
                 "john locke", "rousseau", "machiavelli", "thomas jefferson", "alexander hamilton",
                 "james madison", "abraham lincoln", "george washington", "lenin", "marx", "engels",
                 "kropotkin", "bakunin", "wollstonecraft"},
    "艺术": {"ruskin", "pater", "wilde", "sainte-beuve", "lessing", "winckelmann",
             "vasari", "reynolds", "hogarth", "berenson", "symonds"},
    "时尚": set(),
    "漫画": {"lewis carroll", "edward lear", "cruikshank", "leech",
             "du maurier", "tenniel"},
}

# 作者名匹配：单姓按词边界；含空格的全名要求完全相等，
# 避免 "George Adam Smith" 命中 "adam smith"、"Washington Irving" 命中 "washington"。
def author_hit(normalized_author: str, names: set[str]) -> bool:
    for name in names:
        if " " in name:
            if normalized_author == name:
                return True
        elif re.search(r"\b" + re.escape(name) + r"\b", normalized_author):
            return True
    return False

LOW_VALUE = re.compile(
    r"\b(a lecture|an address|a speech|lecture delivered|address delivered|"
    r"a paper read|pamphlet|bulletin|circular|memorial|petition|"
    r"annual report|report|reports|proceedings|minutes|"
    r"selections|extracts|appendix|supplement|notes)\b",
    re.I,
)

SKIP_SHORT = re.compile(r"^(the|a|an|of|on|in|to|and)\b", re.I)


def classify(title: str, subtitle: str, author: str) -> tuple[str | None, int, str]:
    raw_title = f"{title} {subtitle}".strip()
    raw_all = f"{raw_title} {author}".strip()
    normalized_author = norm(author)

    scores: dict[str, int] = {}
    hit_counts: Counter = Counter()
    for domain, rules in DEFINITIONS.items():
        score = 0
        for weight, regex in rules:
            matches = regex.findall(raw_title)
            if matches:
                score += weight * min(2, len(matches))
                hit_counts[domain] += len(matches)
        # 作者白名单
        if author_hit(normalized_author, DOMAIN_AUTHORS.get(domain, set())):
            score += 6
        # 标题命中权重更高
        if score:
            scores[domain] = score

    best_domain = None
    best_score = 0
    for domain in DOMAINS:
        if domain == "小说":
            continue
        score = scores.get(domain, 0)
        if score > best_score:
            best_domain, best_score = domain, score

    # 小说：明确的小说词 / 小说家，且没有被强非虚构信号压过
    fiction_score = 0
    if FICTION_RE.search(raw_title):
        fiction_score += 4
    if FICTION_WEAK_RE.search(raw_title):
        fiction_score += 2
    if FICTION_SERIES_RE.search(raw_title) and not SERIES_GUARD_RE.search(raw_title):
        fiction_score += 4
    if author_hit(normalized_author, FICTION_AUTHORS):
        fiction_score += 6
    if fiction_score >= 4 and (best_score < 6 or best_domain is None):
        best_domain = "小说"
        best_score = fiction_score
    elif fiction_score >= 8:
        best_domain = "小说"
        best_score = fiction_score

    if best_domain is None or best_score < MIN_SCORE.get(best_domain, 3):
        return None, 0, raw_all
    return best_domain, best_score, raw_all


def quality(entry: dict, domain: str, strength: int) -> int:
    score = 5 + min(6, strength)
    title = entry["title"]
    author_norm = norm(entry["author"])
    if author_hit(author_norm, DOMAIN_AUTHORS.get(domain, set())):
        score += 5
    if author_hit(author_norm, FICTION_AUTHORS) and domain == "小说":
        score += 4
    if entry["subtitle"]:
        score += 1
    if 18 <= len(title) <= 150:
        score += 1
    if LOW_VALUE.search(title):
        score -= 3
    if len(title) < 14:
        score -= 2
    if re.search(r"\b(illustrated|with illustrations|with plates|coloured plates)\b", title, re.I):
        score += 1
    if entry["lang"] == "fr":
        score += 1
    return score


def dedupe_key(title: str, author: str) -> tuple[str, str]:
    title_norm = norm(re.sub(r"^(the|a|an)\s+", "", title, flags=re.I))
    title_norm = re.sub(r"\b(or|and)\b.*$", "", title_norm).strip()
    return title_norm[:70], norm(author.split(",")[0])[:32]


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    index_path = ensure_file("GUTINDEX.ALL", f"{BASE}/GUTINDEX.ALL")
    filelist_path = ensure_file("main-filelist.csv.bz2", f"{BASE}/main-filelist.csv.bz2")

    entries = parse_gutindex(index_path)
    filemap = parse_filelist(filelist_path)
    print(f"[parse] GUTINDEX entries={len(entries)} filemap={len(filemap)}", flush=True)

    counters = Counter()
    candidates: list[dict] = []
    seen = set()

    for entry in entries:
        counters["total"] += 1
        if entry["lang"] not in ("en", "fr"):
            counters["skip_language"] += 1
            continue
        if entry["copyright"]:
            counters["skip_copyright"] += 1
            continue
        title, author = split_author(entry["line"], entry["author_meta"])
        raw_all = f"{title} {entry['subtitle']} {author}"
        if len(title) < 6 or len(raw_all) < 12:
            counters["skip_short"] += 1
            continue
        if HARD_JUNK.search(raw_all):
            counters["skip_reference"] += 1
            continue
        if VOLUME_JUNK.search(title):
            counters["skip_volume_or_serial"] += 1
            continue
        if not filemap.get(entry["n"]):
            counters["skip_no_file"] += 1
            continue
        domain, strength, _ = classify(title, entry["subtitle"], author)
        if not domain:
            counters["skip_unclassified"] += 1
            continue
        key = dedupe_key(title, author)
        if key in seen:
            counters["skip_duplicate"] += 1
            continue
        seen.add(key)
        fileinfo = filemap[entry["n"]]
        candidates.append(
            {
                "id": entry["n"],
                "title": re.sub(r"\s+", " ", title).strip(),
                "author": re.sub(r"\s+", " ", author).strip() or "佚名",
                "language": entry["lang"],
                "domain": domain,
                "subtitle": entry["subtitle"],
                "path": fileinfo["path"],
                "size": fileinfo["size"],
                "strength": strength,
                "quality": quality(
                    {"title": title, "subtitle": entry["subtitle"], "author": author, "lang": entry["lang"]},
                    domain,
                    strength,
                ),
            }
        )
        counters["candidates"] += 1

    # 分卷/连载归并：同一部作品按月份或年份拆分的条目只保留信息量最大的一条
    serial_groups: dict[tuple[str, str], dict] = {}
    compact: list[dict] = []
    for item in candidates:
        if not SERIAL_TITLE_RE.search(item["title"]):
            compact.append(item)
            continue
        base = SERIAL_TITLE_RE.sub("", item["title"]).strip(" ,;:-")
        key = (norm(base)[:70], norm(item["author"].split(",")[0])[:32])
        current = serial_groups.get(key)
        if current is None or (item["quality"], item["size"]) > (current["quality"], current["size"]):
            serial_groups[key] = item
    if serial_groups:
        counters["merged_serials"] = len(candidates) - len(compact) - len(serial_groups)
    candidates = compact + list(serial_groups.values())

    # 配额选择：先按上限收敛，再用高质量候选补足 20000
    by_domain: dict[str, list[dict]] = defaultdict(list)
    for item in candidates:
        by_domain[item["domain"]].append(item)
    for items in by_domain.values():
        items.sort(key=lambda item: (-item["quality"], item["size"], item["id"]))

    selected: list[dict] = []
    for domain in DOMAINS:
        selected.extend(by_domain[domain][: CAPS.get(domain, 0)])

    if len(selected) < TARGET_TOTAL:
        chosen_ids = {item["id"] for item in selected}
        pool = [item for item in candidates if item["id"] not in chosen_ids]
        pool.sort(key=lambda item: (-item["quality"], item["size"], item["id"]))
        selected.extend(pool[: TARGET_TOTAL - len(selected)])
    elif len(selected) > TARGET_TOTAL:
        # 从超出最多的领域尾部裁剪
        while len(selected) > TARGET_TOTAL:
            counts = Counter(item["domain"] for item in selected)
            domain = max(counts, key=counts.get)
            for index in range(len(selected) - 1, -1, -1):
                if selected[index]["domain"] == domain:
                    selected.pop(index)
                    break

    selected.sort(key=lambda item: (DOMAINS.index(item["domain"]), -item["quality"], item["id"]))

    os.makedirs(DATA_DIR, exist_ok=True)
    domain_dir = os.path.join(DATA_DIR, "domains")
    os.makedirs(domain_dir, exist_ok=True)

    def book_record(item: dict) -> dict:
        return {
            "id": item["id"],
            "title": item["title"],
            "author": item["author"],
            "language": item["language"],
            "domain": item["domain"],
            "path": item["path"],
            "size": item["size"],
            "quality": item["quality"],
        }

    books = [book_record(item) for item in selected]
    manifest = {
        "meta": {
            "name": "词刻公版书库",
            "source": "Project Gutenberg (public domain)",
            "mirror": BASE,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "target": TARGET_TOTAL,
            "count": len(books),
            "domains": {
                domain: {
                    "slug": SLUG[domain],
                    "count": sum(1 for book in books if book["domain"] == domain),
                    "available": len(by_domain[domain]),
                }
                for domain in DOMAINS
            },
            "languages": dict(Counter(book["language"] for book in books)),
            "bytes": sum(book["size"] for book in books),
        },
        "books": books,
    }
    with open(os.path.join(DATA_DIR, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_DIR, "books.json"), "w", encoding="utf-8") as handle:
        json.dump({"books": books}, handle, ensure_ascii=False, separators=(",", ":"))
    for domain in DOMAINS:
        items = [book_record(item) for item in selected if item["domain"] == domain]
        with open(os.path.join(domain_dir, f"{SLUG[domain]}.json"), "w", encoding="utf-8") as handle:
            json.dump({"domain": domain, "count": len(items), "books": items}, handle, ensure_ascii=False, separators=(",", ":"))

    # 报告
    total_bytes = manifest["meta"]["bytes"]
    lines = [
        "# 词刻公版书库构建报告",
        "",
        f"- 生成时间：{manifest['meta']['generatedAt']}",
        f"- 数据源：{BASE}/GUTINDEX.ALL",
        f"- 索引条目：{len(entries):,}",
        f"- 候选（英/法、公版、可下载、已分类、去重）：{len(candidates):,}",
        f"- 入选：{len(books):,} / 目标 {TARGET_TOTAL:,}",
        f"- 全文体积：{total_bytes / 1024 / 1024 / 1024:.2f} GB（未下载，仅为镜像体积）",
        "",
        "## 各领域",
        "",
        "| 领域 | 入选 | 可用候选 | 上限 |",
        "| --- | ---: | ---: | ---: |",
    ]
    for domain in DOMAINS:
        lines.append(
            f"| {domain} | {manifest['meta']['domains'][domain]['count']} | "
            f"{manifest['meta']['domains'][domain]['available']} | {CAPS.get(domain, 0)} |"
        )
    lines += ["", "## 各领域样例", ""]
    for domain in DOMAINS:
        items = [item for item in selected if item["domain"] == domain][:8]
        lines.append(f"### {domain}")
        for item in items:
            lines.append(f"- #{item['id']} {item['title']} — {item['author']} ({item['language']})")
        lines.append("")
    lines += [
        "## 说明",
        "",
        "- 分类基于标题、副标题、作者的加权关键词，不读取全文；作者名按词边界匹配，避免 worth 命中 Galsworthy 这类误判。",
        "- 政治时讯收录政治、法律、军事、历史与人物传记；小说由标题/作者双信号判定。",
        "- 按月或年份拆分的连载（如《Pepys 日记》）已归并为一条；期刊、增刊、年度报告已排除。",
        "- 多卷残卷、工具书、目录索引被排除，宁缺毋滥。",
        "- 漫画、时尚、金融在古登堡公版库中天然稀缺，未用无关内容凑数；小说占比较高是公版库的客观结构。",
        "- 本目录仅含元数据与镜像相对路径，全文需用 download_books.py 另行下载（全量约 7.5 GB）。",
        "",
    ]
    with open(os.path.join(DATA_DIR, "report.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")

    print(json.dumps({k: counters[k] for k in sorted(counters)}, ensure_ascii=False, indent=2))
    print(json.dumps(manifest["meta"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())