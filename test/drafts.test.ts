import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.ts";
import { buildUserPrompt, claudeGenerator, type OutreachDrafts } from "../server/drafts.ts";
import { WebsiteError } from "../server/website.ts";

const sampleDrafts: OutreachDrafts = {
  websiteHook: "",
  linkedin: { connectionNote: "Hi Dana", followUpMessage: "Thanks for connecting", why: "Short and specific." },
  email: { subject: "Second location", body: "Hi Dana,", why: "Leads with their news." },
  phone: { opener: "Hi Dana, it's Caleb", discoveryQuestions: ["How do you handle no-shows?"], voicemail: "Hi Dana", why: "Asks permission." },
  researchToDo: ["Check their recent posts"],
};

let nextResponse: { stop_reason: string; parsed_output: OutreachDrafts | null };
let lastParams: Record<string, unknown> | undefined;

const fakeClient = {
  beta: {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        lastParams = params;
        return nextResponse;
      },
    },
  },
} as unknown as Anthropic;

const fakeReadWebsite = async (url: string) => {
  if (url.includes("down")) throw new WebsiteError("Couldn't reach down.example.");
  return "Bright Smiles just opened a second location in Austin.";
};

function promptSent(): string {
  const messages = lastParams?.messages as { content: string }[];
  return messages[0].content;
}

const validBody = {
  prospectName: "Dana Lee",
  prospectTitle: "Office Manager",
  company: "Bright Smiles Dental",
  notes: "Just opened a second location",
  yourName: "Caleb",
  yourOffer: "Scheduling software that cuts no-shows",
  tone: "friendly",
};

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

before(async () => {
  server = createApp(claudeGenerator(fakeClient), fakeReadWebsite).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function postDrafts(body: unknown) {
  return fetch(`${baseUrl}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns drafts for a valid prospect", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const response = await postDrafts(validBody);
  assert.equal(response.status, 200);
  const { cadence, channelTip, ...drafts } = await response.json();
  assert.deepEqual(drafts, sampleDrafts);
  assert.equal(cadence[0].action, "Send the connection request");
  assert.match(channelTip, /LinkedIn, email and phone/);
  assert.equal(lastParams?.model, "claude-opus-5-5");
  assert.equal(lastParams?.fallbacks, "default");
});

test("rejects a request missing required fields", async () => {
  const response = await postDrafts({ ...validBody, company: "" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Company is required/);
});

test("reports a refusal as a readable error", async () => {
  nextResponse = { stop_reason: "refusal", parsed_output: null };
  const response = await postDrafts(validBody);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /declined/);
});

test("serves the page", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Draft my outreach/);
});

test("prompt falls back gracefully when notes are empty", () => {
  const prompt = buildUserPrompt({ ...validBody, industry: "", notes: "", goal: "Book a call", tone: "direct", companyWebsite: "", attachmentDescription: "" });
  assert.match(prompt, /nothing beyond their name, title and company/);
  assert.doesNotMatch(prompt, /Industry:/);
});

test("uses the company website as a soft opener source", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const response = await postDrafts({ ...validBody, companyWebsite: "brightsmiles.example" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).websiteNote, undefined);
  assert.match(promptSent(), /<website>\nBright Smiles just opened a second location in Austin\.\n<\/website>/);
});

test("still drafts when the website can't be read", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const response = await postDrafts({ ...validBody, companyWebsite: "down.example" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.linkedin.connectionNote, "Hi Dana");
  assert.match(body.websiteNote, /Couldn't reach down\.example\. These drafts don't use the website/);
  assert.doesNotMatch(promptSent(), /<website>/);
});

test("adds the industry playbook to the prompt and returns its cadence", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const response = await postDrafts({ ...validBody, industry: "healthcare" });
  const body = await response.json();
  assert.match(promptSent(), /Industry: Healthcare\n/);
  assert.match(promptSent(), /Industry playbook \(Healthcare\):\n- What lands: .*no-shows/);
  assert.equal(body.cadence[0].channel, "Email");
});

test("free-text industries get the general cadence and no playbook", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const body = await (await postDrafts({ ...validBody, industry: "Dental" })).json();
  assert.match(promptSent(), /Industry: Dental\n/);
  assert.doesNotMatch(promptSent(), /Industry playbook/);
  assert.equal(body.cadence.length, 8);
});

test("lists industries for the picker", async () => {
  const industries = await (await fetch(`${baseUrl}/api/industries`)).json();
  assert.deepEqual(industries[0], { key: "general", label: "General / not sure" });
  assert.ok(industries.some((i: { key: string }) => i.key === "manufacturing"));
});

test("uses an attached file and its description as context", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const attachment = { name: "pricing.txt", data: Buffer.from("Starter plan is $49 a month").toString("base64") };
  const body = await (await postDrafts({ ...validBody, attachment, attachmentDescription: "Our pricing sheet" })).json();
  assert.equal(body.attachmentNote, undefined);
  assert.match(promptSent(), /Attached file "pricing\.txt" \(the SDR says: Our pricing sheet\):\n<file>\nStarter plan is \$49 a month\n<\/file>/);
});

test("still drafts when the attached file can't be read", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const attachment = { name: "deck.pptx", data: Buffer.from("x").toString("base64") };
  const response = await postDrafts({ ...validBody, attachment });
  assert.equal(response.status, 200);
  assert.match((await response.json()).attachmentNote, /deck\.pptx isn't a supported file type.*These drafts don't use the file\./);
  assert.doesNotMatch(promptSent(), /<file>/);
});
