#!/usr/bin/env bash
set -u
DIR="C:/Users/pc/Documents/ChatGPT/englishstudy/.cache/wordbank"
mkdir -p "$DIR"
BASE_FREQ="https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018"
BASE_IPA="https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data"

fetch() {
  local name="$1" url="$2" min="${3:-1024}"
  local out="$DIR/$name"
  if [ -f "$out" ]; then
    local size=$(wc -c < "$out" | tr -d ' ')
    if [ "$size" -ge "$min" ]; then echo "skip $name ($size)"; return 0; fi
  fi
  for i in 1 2 3 4 5; do
    curl -sL --retry 3 --retry-delay 2 --max-time 300 -o "$out.part" "$url"
    local size=$(wc -c < "$out.part" 2>/dev/null | tr -d ' ' || echo 0)
    if [ "${size:-0}" -ge "$min" ]; then
      mv "$out.part" "$out"; echo "ok $name $size"; return 0
    fi
    echo "retry $i $name ($size)"
    sleep 2
  done
  echo "FAILED $name"; return 1
}

fetch fr_50k.txt "$BASE_FREQ/fr/fr_50k.txt" 100000
fetch es_50k.txt "$BASE_FREQ/es/es_50k.txt" 100000
fetch de_50k.txt "$BASE_FREQ/de/de_50k.txt" 100000
fetch it_50k.txt "$BASE_FREQ/it/it_50k.txt" 100000
fetch ja_full.txt "$BASE_FREQ/ja/ja_full.txt" 100000
fetch fr_FR.txt "$BASE_IPA/fr_FR.txt" 1000000
fetch es_ES.txt "$BASE_IPA/es_ES.txt" 1000000
fetch de.txt "$BASE_IPA/de.txt" 1000000
fetch ja.txt "$BASE_IPA/ja.txt" 1000000
fetch yue.txt "$BASE_IPA/yue.txt" 500000
fetch it_wikipron.tsv "https://raw.githubusercontent.com/CUNY-CL/wikipron/master/data/scrape/tsv/ita_latn_broad.tsv" 500000
fetch yue_freq.tsv "https://raw.githubusercontent.com/AlienKevin/cantonese_frequency_list/master/freq.tsv" 300000
fetch la_words.json "https://raw.githubusercontent.com/ericianni/latin-diederich-vocab/main/data/words.json" 100000

echo "--- sizes ---"
ls -la "$DIR"