import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { createApp } from "../server/app.ts";
import { ContactStore, contactsCsv, nextFollowUp, today } from "../server/contacts.ts";
import type { OutreachDrafts } from "../server/drafts.ts";

const drafts: OutreachDrafts = {
  websiteHook: "",
  linkedin: { connectionNote: "Hi Dana", followUpMessage: "Thanks for connecting", why: "Short." },
  email: { subject: "Second location", body: "Hi Dana,\n\nCongrats on the \"new\" office.", why: "Specific." },
  phone: { opener: "Hi Dana", discoveryQuestions: ["How do you handle no-shows?"], voicemail: "Hi Dana", why: "Polite." },
  researchToDo: ["Check their posts"],
};

const prospect = { prospectName: "Dana Lee", prospectTitle: "Office Manager", company: "Bright Smiles Dental", industry: "healthcare" };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-contacts-"));
const file = path.join(dir, "contacts.json");
// A fixed clock keeps due dates predictable: the sequence starts on 2026-10-29.
const fixedNow = () => new Date(2026, 9, 29, 9, 30);
let store: ContactStore;

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  fs.rmSync(file, { force: true });
  store = new ContactStore(file, fixedNow);
  server = createApp(async () => drafts, async () => "", store).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => server.close());
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function api(method: string, url: string, body?: unknown) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("saves a prospect with the industry's sequence and dated follow-ups", async () => {
  const response = await api("POST", "/api/contacts", { ...prospect, drafts });
  assert.equal(response.status, 201);
  const contact = await response.json();
  assert.equal(contact.status, "active");
  assert.equal(contact.sequenceStart, "2026-10-29");
  assert.equal(contact.drafts.length, 1);
  assert.equal(contact.drafts[0].drafts.email.subject, "Second location");
  // The healthcare playbook opens with email on day 1.
  assert.equal(contact.sequence[0].channel, "Email");
  assert.equal(contact.sequence[0].due, "2026-10-29");
  assert.deepEqual(contact.nextFollowUp, { date: "2026-10-29", channel: "Email", action: contact.sequence[0].action });
  assert.ok(fs.existsSync(file));
});

test("saving the same prospect again adds to their draft history instead of duplicating", async () => {
  await api("POST", "/api/contacts", { ...prospect, drafts });
  const again = await api("POST", "/api/contacts", { ...prospect, prospectName: "dana lee ", prospectTitle: "", drafts });
  assert.equal(again.status, 200);
  const contact = await again.json();
  assert.equal(contact.drafts.length, 2);
  assert.equal(contact.prospectTitle, "Office Manager", "an empty field from the form doesn't wipe saved data");
  const { contacts } = await (await api("GET", "/api/contacts")).json();
  assert.equal(contacts.length, 1);
});

test("marking a step done moves the next follow-up to the following step", async () => {
  const saved = await (await api("POST", "/api/contacts", prospect)).json();
  const updated = await (await api("PATCH", `/api/contacts/${saved.id}`, { step: { index: 0, done: true } })).json();
  assert.ok(updated.sequence[0].doneAt);
  assert.equal(updated.nextFollowUp.date, updated.sequence[1].due);
  assert.equal(updated.progress, `1 of ${updated.sequence.length}`);
  assert.match(updated.activity.at(-1).text, /^Done: Day 1 Email/);
});

test("a manual follow-up date overrides the sequence until the next step is done", async () => {
  const saved = await (await api("POST", "/api/contacts", prospect)).json();
  let updated = await (await api("PATCH", `/api/contacts/${saved.id}`, { followUpDate: "2026-11-15" })).json();
  assert.equal(updated.nextFollowUp.date, "2026-11-15");
  updated = await (await api("PATCH", `/api/contacts/${saved.id}`, { step: { index: 0, done: true } })).json();
  assert.equal(updated.nextFollowUp.date, updated.sequence[1].due);
});

test("moving the start date shifts every due date", async () => {
  const saved = await (await api("POST", "/api/contacts", { ...prospect, industry: "" })).json();
  const updated = await (await api("PATCH", `/api/contacts/${saved.id}`, { sequenceStart: "2026-11-02" })).json();
  // The general sequence's day 3 call lands two days after the start.
  assert.equal(updated.sequence[2].day, 3);
  assert.equal(updated.sequence[2].due, "2026-11-04");
});

test("a contact who replied has no next follow-up", async () => {
  const saved = await (await api("POST", "/api/contacts", prospect)).json();
  const updated = await (await api("PATCH", `/api/contacts/${saved.id}`, { status: "replied", email: "dana@brightsmiles.example" })).json();
  assert.equal(updated.nextFollowUp, null);
  assert.equal(updated.email, "dana@brightsmiles.example");
  assert.equal(updated.prospectTitle, "Office Manager", "fields left out of an update stay as they were");
});

test("rejects bad input and unknown contacts", async () => {
  assert.equal((await api("POST", "/api/contacts", { ...prospect, company: "" })).status, 400);
  const saved = await (await api("POST", "/api/contacts", prospect)).json();
  assert.equal((await api("PATCH", `/api/contacts/${saved.id}`, { status: "won" })).status, 400);
  assert.equal((await api("PATCH", `/api/contacts/${saved.id}`, { step: { index: 99, done: true } })).status, 404);
  assert.equal((await api("PATCH", "/api/contacts/nope", { status: "paused" })).status, 404);
});

test("deletes a contact", async () => {
  const saved = await (await api("POST", "/api/contacts", prospect)).json();
  assert.equal((await api("DELETE", `/api/contacts/${saved.id}`)).status, 204);
  assert.equal((await (await api("GET", "/api/contacts")).json()).contacts.length, 0);
});

test("contacts survive a restart", () => {
  store.save({ ...prospect, prospectTitle: "", companyWebsite: "", notes: "", email: "", phone: "", linkedinUrl: "", drafts });
  const reopened = new ContactStore(file, fixedNow);
  assert.equal(reopened.list()[0].drafts[0].drafts.email.subject, "Second location");
});

test("exports contacts as CSV with quoting", async () => {
  await api("POST", "/api/contacts", { ...prospect, notes: "Opened a second office, hiring", drafts });
  const response = await api("GET", "/api/contacts.csv");
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="?sdr-contacts-\d{4}-\d{2}-\d{2}\.csv/);
  const csv = await response.text();
  const [header, row] = csv.replace(/^﻿/, "").split("\r\n");
  assert.match(header, /^Name,Title,Company,Industry,Email,Phone,LinkedIn,Website,Status,Next follow-up,Next step,/);
  assert.match(row, /^Dana Lee,Office Manager,Bright Smiles Dental,Healthcare,,,,,In sequence,2026-10-29,Email: /);
  assert.match(row, /"Opened a second office, hiring"/);
  assert.match(csv, /"Hi Dana,\r?\n\r?\nCongrats on the ""new"" office\."/);
});

test("today() uses the local date, not UTC", () => {
  assert.equal(today(new Date(2026, 0, 1, 23, 59)), "2026-01-01");
  assert.equal(today(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
});

test("CSV of an empty list is just the header", () => {
  assert.equal(contactsCsv([]).split("\r\n").filter(Boolean).length, 1);
  assert.equal(nextFollowUp({ status: "paused" } as never), null);
});
