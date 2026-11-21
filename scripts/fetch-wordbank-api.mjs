import fs from "node:fs";
import path from "node:path";

const DIR = ".cache/wordbank";
fs.mkdirSync(DIR, { recursive: true });
const API = "https://api.github.com";

const files = [
  ["de_50k.txt", "hermitdave/FrequencyWords", "content/2018/de/de_50k.txt", "master"],
  ["it_50k.txt", "hermitdave/FrequencyWords", "content/2018/it/it_50k.txt", "master"],
  ["ja_full.txt", "hermitdave/FrequencyWords", "content/2018/ja/ja_full.txt", "master"],
  ["yue_freq.tsv", "AlienKevin/cantonese_frequency_list", "freq.tsv", "master"],
  ["fr_FR.txt", "open-dict-data/ipa-dict", "data/fr_FR.txt", "master"],
  ["es_ES.txt", "open-dict-data/ipa-dict", "data/es_ES.txt", "master"],
  ["de.txt", "open-dict-data/ipa-dict", "data/de.txt", "master"],
  ["ja.txt", "open-dict-data/ipa-dict", "data/ja.txt", "master"],
  ["yue.txt", "open-dict-data/ipa-dict", "data/yue.txt", "master"],
  ["it_wikipron.tsv", "CUNY-CL/wikipron", "data/scrape/tsv/ita_latn_broad.tsv", "master"],
];

async function getJson(url) {
  for (let i = 0; i < 4; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "cike-build", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.log(`retry ${i + 1} ${url}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`failed ${url}`);
}

async function download(name, repo, file, ref) {
  const out = path.join(DIR, name);
  if (fs.existsSync(out) && fs.statSync(out).size > 1024) {
    console.log(`skip ${name} ${fs.statSync(out).size}`);
    return;
  }
  const meta = await getJson(`${API}/repos/${repo}/contents/${file}?ref=${ref}`);
  const size = Number(meta.size || 0);
  if (!meta.sha) throw new Error(`no sha for ${name}`);
  if (size <= 1000000) {
    // 小文件直接取 raw
    const res = await fetch(`${API}/repos/${repo}/contents/${file}?ref=${ref}`, {
      headers: { "User-Agent": "cike-build", Accept: "application/vnd.github.v3.raw" },
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`raw HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, buf);
    console.log(`ok ${name} ${buf.length}`);
    return;
  }
  const blob = await getJson(`${API}/repos/${repo}/git/blobs/${meta.sha}`);
  const buf = Buffer.from(blob.content || "", blob.encoding === "base64" ? "base64" : "utf8");
  fs.writeFileSync(out, buf);
  console.log(`ok ${name} ${buf.length}`);
}

for (const [name, repo, file, ref] of files) {
  try {
    await download(name, repo, file, ref);
  } catch (error) {
    console.log(`FAILED ${name}: ${error.message}`);
  }
}

console.log("--- sizes ---");
for (const [name] of files) {
  const p = path.join(DIR, name);
  console.log(name, fs.existsSync(p) ? fs.statSync(p).size : "missing");
}