import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.ts";
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

type Server = ReturnType<ReturnType<typeof createApp>["listen"]>;
let server: Server;
let hostedServer: Server;
let baseUrl: string;
let hostedUrl: string;

const legacyFile = path.join(fs.mkdtempSync(path.join(tmpdir(), "sdr-legacy-")), "contacts.json");
fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, contacts: [{ id: "1", prospectName: "Dana Lee" }] }));

const neverDrafts = async () => {
  throw new Error("the server shouldn't draft when the browser calls the model");
};
const fakeWebsite = async () => "Bright Smiles just opened in Austin.";

async function start(app: ReturnType<typeof createApp>): Promise<[Server, string]> {
  const listening = app.listen(0);
  await new Promise((resolve) => listening.once("listening", resolve));
  return [listening, `http://127.0.0.1:${(listening.address() as AddressInfo).port}`];
}

before(async () => {
  [server, baseUrl] = await start(createApp(neverDrafts, fakeWebsite, { legacyContactsFile: legacyFile }));
  [hostedServer, hostedUrl] = await start(createApp(neverDrafts, fakeWebsite, { hosted: true, legacyContactsFile: legacyFile }));
});

after(() => {
  server.close();
  hostedServer.close();
});

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
  assert.deepEqual(await response.json(), { provider: "claude", hasApiKey: false, hosted: false, maxFileBytes: 10 * 1024 * 1024 });
});

test("sends a strict content security policy", async () => {
  const response = await fetch(`${baseUrl}/`);
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/api\.anthropic\.com http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("on your own computer, refuses requests addressed to another host name (DNS rebinding)", async () => {
  const { port } = server.address() as AddressInfo;
  assert.equal(await getStatus(port, "/api/legacy-contacts", "attacker.example"), 403);
  assert.equal(await getStatus(port, "/api/industries", "localhost:3005"), 200);
});

function getStatus(port: number, urlPath: string, host: string) {
  return new Promise<number>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: urlPath, headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

test("hands old saved contacts to the page on your own computer, so it can move them into the browser", async () => {
  const response = await fetch(`${baseUrl}/api/legacy-contacts`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).contacts[0].prospectName, "Dana Lee");
});

test("a public copy answers on its own domain, never serves saved contacts and takes smaller files", async () => {
  const { port } = hostedServer.address() as AddressInfo;
  assert.equal(await getStatus(port, "/api/industries", "sdr-outreach.vercel.app"), 200);
  assert.deepEqual(await (await fetch(`${hostedUrl}/api/legacy-contacts`)).json(), { contacts: [] });
  const model = await (await fetch(`${hostedUrl}/api/model`)).json();
  assert.equal(model.hosted, true);
  assert.equal(model.maxFileBytes, 3 * 1024 * 1024);
});

test("a public copy limits how often one visitor can draft", async () => {
  let last = 0;
  for (let i = 0; i < 21; i++) {
    const response = await fetch(`${hostedUrl}/api/drafts/parse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    last = response.status;
  }
  assert.equal(last, 429);
});
