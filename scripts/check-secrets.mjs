import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const ignoredDirs = new Set([".git", ".next", "node_modules", "orthanc-data"]);
const ignoredFiles = new Set(["package-lock.json"]);
const patterns = [
  { name: "OpenAI secret-looking token", re: new RegExp("(?<!metama)s" + "k-[A-Za-z0-9_-]{8,}") },
  { name: "OpenAI key assignment with secret", re: new RegExp("OPENAI_API_KEY\\s*=\\s*s" + "k-") },
  { name: "Public OpenAI key variable", re: new RegExp("NEXT_PUBLIC_" + "OPENAI_API_KEY") },
];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else if (!ignoredFiles.has(entry.name)) found.push(path);
  }
  return found;
}

let failed = false;
for (const file of await files(root)) {
  let text = "";
  try { text = await readFile(file, "utf8"); } catch { continue; }
  const rel = relative(root, file);
  text.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of patterns) {
      if (rel === "scripts\\check-secrets.mjs" || rel === "scripts/check-secrets.mjs") continue;
      if (pattern.re.test(line)) {
        failed = true;
        console.error(`${pattern.name}: ${rel}:${index + 1}`);
      }
    }
  });
}

if (failed) process.exit(1);
console.log("No obvious secrets found.");
