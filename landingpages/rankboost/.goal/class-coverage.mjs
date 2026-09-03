// Prints class names referenced in <html> (class="..." attributes, including
// those inside inline JS strings) that have no `.name` selector in <css> or in
// the HTML file's own <style> blocks. One per line, sorted. Used by the phase
// verifiers to catch markup that lost its styling.
import { readFileSync } from "node:fs";

const [htmlPath, cssPath] = process.argv.slice(2);
if (!htmlPath || !cssPath) {
  console.error("usage: node class-coverage.mjs <html> <css>");
  process.exit(2);
}
const html = readFileSync(htmlPath, "utf8");
const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const css = readFileSync(cssPath, "utf8") + "\n" + inline;

const used = new Set();
for (const m of html.matchAll(/class=\\?"([^"\\]*)\\?"/g)) {
  for (const k of m[1].split(/\s+/)) if (k) used.add(k);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const missing = [...used].filter((k) => !new RegExp("\\." + esc(k) + "(?![\\w-])").test(css)).sort();
process.stdout.write(missing.join("\n") + (missing.length ? "\n" : ""));
