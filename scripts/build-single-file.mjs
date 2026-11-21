import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filename) => readFile(path.join(root, filename), "utf8");

const [htmlSource, styles, core, words, app] = await Promise.all([
  read("index.html"),
  read("styles.css"),
  read("core.js"),
  read("data/words.js"),
  read("app.js"),
]);

let output = htmlSource
  .replace(
    /\s*<link rel="manifest" href="manifest\.webmanifest" \/>/,
    "",
  )
  .replace(
    /\s*<link rel="icon" href="assets\/icon\.svg" type="image\/svg\+xml" \/>/,
    "",
  )
  .replace(
    /\s*<link rel="stylesheet" href="styles\.css" \/>/,
    `\n    <style>\n${styles}\n    </style>`,
  )
  .replace(
    /\s*<script src="core\.js"><\/script>/,
    `\n    <script>\n${core}\n    </script>`,
  )
  .replace(
    /\s*<script src="data\/words\.js"><\/script>/,
    `\n    <script>\n${words}\n    </script>`,
  )
  .replace(
    /\s*<script src="app\.js"><\/script>/,
    `\n    <script>\n${app}\n    </script>`,
  )
  .replace(
    "<title>词刻 CET-6 · 2000 核心词</title>",
    "<title>词刻 CET-6 · 手机单文件版</title>",
  );

if (
  /<link[^>]+rel=["']stylesheet["']/i.test(output) ||
  /<script[^>]+src=/i.test(output)
) {
  throw new Error("Single-file build still references external app files.");
}

const outputPath = path.join(root, "cet6-mobile.html");
await writeFile(outputPath, output, "utf8");

console.log(
  JSON.stringify(
    {
      output: path.relative(root, outputPath),
      bytes: Buffer.byteLength(output),
      words: (words.match(/"word":/g) || []).length,
    },
    null,
    2,
  ),
);
