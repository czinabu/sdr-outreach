// Builds the public copy for Vercel with the Build Output API (https://vercel.com/docs/build-output-api):
// public/ goes to Vercel's CDN, and the Express app in server.ts becomes one function that answers /api/*.
// Bundling the server here means Vercel never has to compile the TypeScript or guess how to run it.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "../server/security.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vercel", "output");
const functionDir = path.join(output, "functions", "api.func");

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), path.join(output, "static"), { recursive: true });

await build({
  entryPoints: [path.join(root, "server.ts")],
  outfile: path.join(functionDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Express and other CommonJS packages call require(), which an ES module bundle doesn't have by default.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

fs.writeFileSync(
  path.join(functionDir, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 60 }, null, 2),
);

fs.writeFileSync(
  path.join(output, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/(.*)", headers: SECURITY_HEADERS, continue: true },
        { handle: "filesystem" },
        { src: "/api/(.*)", dest: "/api" },
      ],
    },
    null,
    2,
  ),
);

console.log(`Built the Vercel output in ${path.relative(root, output)}`);
