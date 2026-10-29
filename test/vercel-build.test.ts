import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { SECURITY_HEADERS } from "../server/security.ts";

const root = path.join(import.meta.dirname, "..");
const output = path.join(root, ".vercel", "output");

test("the Vercel build serves the page from the CDN and runs the API as one bundled function", async () => {
  execFileSync(process.execPath, ["scripts/build-vercel.ts"], { cwd: root, stdio: "pipe" });

  assert.ok(fs.existsSync(path.join(output, "static", "index.html")));
  const config = JSON.parse(fs.readFileSync(path.join(output, "config.json"), "utf8"));
  assert.deepEqual(config.routes[0].headers, SECURITY_HEADERS);
  assert.deepEqual(config.routes.at(-1), { src: "/api/(.*)", dest: "/api" });

  // Vercel calls the bundle's default export with each request, like a plain Node HTTP handler.
  const { default: handler } = await import(path.join(output, "functions", "api.func", "index.mjs"));
  const server = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const industries = await (await fetch(`${base}/api/industries`)).json();
    assert.ok(industries.some((i: { key: string }) => i.key === "healthcare"));
    const model = await (await fetch(`${base}/api/model`)).json();
    assert.equal(model.hosted, true);
    assert.equal(model.hasApiKey, false);
  } finally {
    server.close();
  }
});
