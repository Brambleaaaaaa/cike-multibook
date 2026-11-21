import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const [, , indexArg, outputArg] = process.argv;
if (!indexArg || !outputArg) {
  throw new Error(
    "Usage: node download-typewords.mjs <word-index.json> <output-directory>",
  );
}

const outputDir = path.resolve(outputArg);
await mkdir(outputDir, { recursive: true });
const books = JSON.parse(await readFile(path.resolve(indexArg), "utf8"));
const baseUrl = "https://files.typewords.cc/dicts/en/word/";
const concurrency = 5;
const results = [];
let cursor = 0;

async function existsAndValid(file) {
  try {
    await access(file);
    const data = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(data);
  } catch {
    return false;
  }
}

async function download(book) {
  const filename = `${String(book.id).replaceAll(/[\\/:*?"<>|]/g, "_")}.json`;
  const destination = path.join(outputDir, filename);
  if (await existsAndValid(destination)) {
    const data = JSON.parse(await readFile(destination, "utf8"));
    return { book, filename, count: data.length, cached: true };
  }

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(`${baseUrl}${encodeURIComponent(book.url)}`, {
        signal: AbortSignal.timeout(120000),
        headers: { "user-agent": "Cike-Offline-Builder/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Wordbook is not an array.");
      await writeFile(destination, JSON.stringify(data), "utf8");
      return { book, filename, count: data.length, cached: false };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    }
  }
  return { book, filename, error: String(lastError) };
}

async function worker() {
  while (cursor < books.length) {
    const index = cursor++;
    const result = await download(books[index]);
    results[index] = result;
    console.log(
      `${String(index + 1).padStart(3, "0")}/${books.length} ${result.book.id} ${result.error ? `FAIL ${result.error}` : `${result.count} words${result.cached ? " cache" : ""}`}`,
    );
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const failed = results.filter((result) => result.error);
await writeFile(
  path.join(outputDir, "_download-report.json"),
  JSON.stringify(
    {
      totalBooks: books.length,
      downloadedBooks: results.length - failed.length,
      totalRows: results.reduce((sum, result) => sum + (result.count || 0), 0),
      failed,
    },
    null,
    2,
  ),
  "utf8",
);
if (failed.length) {
  console.error(`Failed ${failed.length} wordbooks.`);
  process.exitCode = 1;
} else {
  console.log(
    `Downloaded ${books.length} TypeWords wordbooks with ${results.reduce((sum, result) => sum + result.count, 0)} rows.`,
  );
}
