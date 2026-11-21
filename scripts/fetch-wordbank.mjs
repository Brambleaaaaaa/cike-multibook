import fs from "node:fs";
import path from "node:path";

const dir = ".cache/wordbank";
fs.mkdirSync(dir, { recursive: true });

const files = [
  ["fr_50k.txt", "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt"],
  ["es_50k.txt", "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt"],
  ["de_50k.txt", "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt"],
  ["it_50k.txt", "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/it/it_50k.txt"],
  ["ja_full.txt", "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ja/ja_full.txt"],
  ["fr_FR.txt", "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/fr_FR.txt"],
  ["es_ES.txt", "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/es_ES.txt"],
  ["de.txt", "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/de.txt"],
  ["ja.txt", "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/ja.txt"],
  ["yue.txt", "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/yue.txt"],
  ["it_wikipron.tsv", "https://raw.githubusercontent.com/CUNY-CL/wikipron/master/data/scrape/tsv/ita_latn_broad.tsv"],
  ["yue_freq.tsv", "https://raw.githubusercontent.com/AlienKevin/cantonese_frequency_list/master/freq.tsv"],
];

async function download(name, url) {
  const out = path.join(dir, name);
  if (fs.existsSync(out) && fs.statSync(out).size > 1024) {
    console.log(`skip ${name} (${fs.statSync(out).size} bytes)`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(240000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error(`too small: ${buf.length}`);
      fs.writeFileSync(out, buf);
      console.log(`ok ${name} ${buf.length} bytes`);
      return;
    } catch (error) {
      console.log(`retry ${attempt} ${name}: ${error.message}`);
    }
  }
  throw new Error(`failed ${name}`);
}

for (const [name, url] of files) {
  await download(name, url);
}

console.log("done");
for (const [name] of files) {
  const st = fs.statSync(path.join(dir, name));
  console.log(name, Math.round(st.size / 1024) + "KB");
}