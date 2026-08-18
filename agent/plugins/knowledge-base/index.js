import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd(), "knowledge");
const supported = new Set([".md", ".txt"]);

async function readDocuments(paths) {
  const documents = [];
  for (const requested of paths) {
    if (typeof requested !== "string" || !requested.trim()) throw new Error("knowledge paths must be relative paths");
    const directory = resolve(root, requested);
    const rel = relative(root, directory);
    if (rel.startsWith("..") || rel.includes(":")) throw new Error("knowledge path must stay inside agent/knowledge");
    await visit(directory, documents);
  }
  return documents;
}

async function visit(directory, documents) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path, documents);
    else if (supported.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) {
      const content = await readFile(path, "utf8");
      documents.push({ path: relative(root, path).replaceAll("\\", "/"), content: content.slice(0, 200_000) });
    }
  }
}

export function createPlugin(config) {
  const paths = Array.isArray(config.paths) && config.paths.length ? config.paths : ["."];
  return {
    name: "mengnex-knowledge-base-package",
    inject: ["tools"],
    async apply(ctx) {
      const documents = await readDocuments(paths);
      return ctx.tools.register({
        name: "knowledge.search",
        description: "Search trusted local knowledge-base documents.",
        risk: "read",
        capabilities: ["knowledge.read"],
        inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
        async execute(args) {
          const terms = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20);
          return documents.map((document) => {
            const lowered = document.content.toLowerCase();
            const score = terms.reduce((sum, term) => sum + (lowered.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0), 0);
            const index = terms.length ? lowered.indexOf(terms[0]) : 0;
            return { path: document.path, score, excerpt: document.content.slice(Math.max(0, index - 300), Math.max(0, index - 300) + 1200) };
          }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
        },
      });
    },
  };
}
