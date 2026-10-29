import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.ts";
import { ContactStore } from "../server/contacts.ts";
import type { OutreachDrafts } from "../server/drafts.ts";

const drafts: OutreachDrafts = {
  websiteHook: "their Austin office",
  linkedin: { connectionNote: "Hi Dana", followUpMessage: "Thanks for connecting", why: "Short." },
  email: { subject: "Austin", body: "Hi Dana,", why: "Specific." },
  phone: { opener: "Hi Dana", discoveryQuestions: ["How do you handle no-shows?"], voicemail: "Hi Dana", why: "Polite." },
  researchToDo: ["Check their posts"],
};

const prospect = {
  prospectName: "Dana Lee",
  prospectTitle: "Office Manager",
  company: "Bright Smiles Dental",
  industry: "healthcare",
  yourName: "Caleb",
  yourOffer: "Scheduling software",
  companyWebsite: "brightsmiles.example",
};

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

before(async () => {
  const neverDrafts = async () => {
    throw new Error("the server shouldn't draft when the browser calls the model");
  };
  const store = new ContactStore(path.join(tmpdir(), `sdr-browser-model-${process.pid}.json`));
  server = createApp(neverDrafts, async () => "Bright Smiles just opened in Austin.", store, { provider: "claude", hasApiKey: false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("builds Claude and local request bodies with the website text", async () => {
  const response = await post("/api/drafts/prompt", prospect);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.claude.model, undefined);
  assert.equal(body.claude.output_config.format.type, "json_schema");
  assert.equal(body.claude.output_config.format.schema.additionalProperties, false);
  assert.match(body.claude.messages[0].content, /opened in Austin/);
  assert.equal(body.local.messages[0].role, "system");
  assert.equal(body.local.response_format.type, "json_schema");
});

test("checks a model reply and adds the industry's sequence", async () => {
  const response = await post("/api/drafts/parse", { industry: "healthcare", content: "```json\n" + JSON.stringify(drafts) + "\n```" });
  assert.equal(response.status, 200);
  const { cadence, channelTip, ...rest } = await response.json();
  assert.deepEqual(rest, drafts);
  assert.ok(cadence.length > 0);
  assert.ok(channelTip);
});

test("explains a model reply in the wrong shape", async () => {
  const response = await post("/api/drafts/parse", { content: '{"linkedin":"hi"}' });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /expected format/);
});

test("tells the page what the server drafts with, without any key", async () => {
  const response = await fetch(`${baseUrl}/api/model`);
  assert.deepEqual(await response.json(), { provider: "claude", hasApiKey: false });
});

test("sends a strict content security policy", async () => {
  const response = await fetch(`${baseUrl}/`);
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/api\.anthropic\.com http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("refuses requests addressed to another host name (DNS rebinding)", async () => {
  const { port } = server.address() as AddressInfo;
  const status = await new Promise<number>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: "/api/contacts", headers: { Host: "attacker.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
  assert.equal(status, 403);
});
