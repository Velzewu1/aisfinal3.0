import { build } from "esbuild";
import { rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
};

await build({
  ...common,
  entryPoints: [resolve(root, "background/index.ts")],
  outfile: resolve(dist, "background.js"),
});

await build({
  ...common,
  entryPoints: [resolve(root, "content/index.ts")],
  outfile: resolve(dist, "content.js"),
});

await build({
  ...common,
  entryPoints: [resolve(root, "sidepanel/main.ts")],
  outfile: resolve(dist, "sidepanel.js"),
});

console.log("[ai-rpa] extension build complete →", dist);
