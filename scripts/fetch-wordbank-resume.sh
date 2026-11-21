#!/usr/bin/env bash
set -u
DIR="C:/Users/pc/Documents/ChatGPT/englishstudy/.cache/wordbank"
mkdir -p "$DIR"

resume() {
  local name="$1" url="$2" min="$3"
  local out="$DIR/$name"
  local idle=0
  local last=0
  for i in $(seq 1 60); do
    local size=$(stat -c%s "$out" 2>/dev/null || echo 0)
    if [ "$size" -ge "$min" ]; then echo "DONE $name $size"; return 0; fi
    if [ "$size" -eq "$last" ]; then idle=$((idle+1)); else idle=0; fi
    last=$size
    if [ "$idle" -ge 6 ]; then echo "STALLED $name at $size"; return 1; fi
    curl -sL --http1.1 -C - --retry 2 --retry-delay 2 --max-time 90 -o "$out" "$url" || true
  done
  echo "GAVEUP $name $(stat -c%s "$out" 2>/dev/null || echo 0)"
  return 1
}

B="https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data"
F="https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018"

resume es_50k.txt "$F/es/es_50k.txt" 600000
resume de_50k.txt "$F/de/de_50k.txt" 600000
resume it_50k.txt "$F/it/it_50k.txt" 600000
resume ja_full.txt "$F/ja/ja_full.txt" 350000
resume fr_FR.txt "$B/fr_FR.txt" 6000000
resume es_ES.txt "$B/es_ES.txt" 15000000
resume de.txt "$B/de.txt" 28000000
resume ja.txt "$B/ja.txt" 6500000
resume yue.txt "$B/yue.txt" 1700000
resume it_wikipron.tsv "https://raw.githubusercontent.com/CUNY-CL/wikipron/master/data/scrape/tsv/ita_latn_broad.tsv" 2500000
resume yue_freq.tsv "https://raw.githubusercontent.com/AlienKevin/cantonese_frequency_list/master/freq.tsv" 1400000

echo "--- final ---"
ls -la "$DIR"