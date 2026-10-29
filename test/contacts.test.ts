import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { ContactError, ContactStore, contactsCsv, nextFollowUp, today, withSchedule } from "../public/contact-store.js";
import type { OutreachDrafts } from "../server/drafts.ts";
import { PLAYBOOKS } from "../server/playbooks.ts";

const drafts: OutreachDrafts = {
  websiteHook: "",
  linkedin: { connectionNote: "Hi Dana", followUpMessage: "Thanks for connecting", why: "Short." },
  email: { subject: "Second location", body: "Hi Dana,\n\nCongrats on the \"new\" office.", why: "Specific." },
  phone: { opener: "Hi Dana", discoveryQuestions: ["How do you handle no-shows?"], voicemail: "Hi Dana", why: "Polite." },
  researchToDo: ["Check their posts"],
};

const prospect = { prospectName: "Dana Lee", prospectTitle: "Office Manager", company: "Bright Smiles Dental", industry: "healthcare" };
const healthcare = PLAYBOOKS.healthcare.cadence;
const general = PLAYBOOKS.general.cadence;

/** Stands in for the browser's localStorage. */
class MemoryStorage {
  items = new Map<string, string>();
  full = false;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.full) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
}

// A fixed clock keeps due dates predictable: the sequence starts on 2026-10-29.
const fixedNow = () => new Date(2026, 9, 29, 9, 30);
let storage: MemoryStorage;
let store: ContactStore;

beforeEach(() => {
  storage = new MemoryStorage();
  store = new ContactStore(storage, "contacts", fixedNow);
});

function saved(id: string) {
  return withSchedule(store.get(id));
}

test("saves a prospect with the industry's sequence and dated follow-ups", () => {
  const { contact: raw, created } = store.save(prospect, drafts, healthcare);
  assert.equal(created, true);
  const contact = withSchedule(raw);
  assert.equal(contact.status, "active");
  assert.equal(contact.sequenceStart, "2026-10-29");
  assert.equal(contact.drafts.length, 1);
  assert.equal(contact.drafts[0].drafts.email.subject, "Second location");
  // The healthcare playbook opens with email on day 1.
  assert.equal(contact.sequence[0].channel, "Email");
  assert.equal(contact.sequence[0].due, "2026-10-29");
  assert.deepEqual(contact.nextFollowUp, { date: "2026-10-29", channel: "Email", action: contact.sequence[0].action });
  assert.ok(storage.getItem("contacts"));
});

test("saving the same prospect again adds to their draft history instead of duplicating", () => {
  store.save(prospect, drafts, healthcare);
  const { contact, created } = store.save({ ...prospect, prospectName: "dana lee ", prospectTitle: "" }, drafts, healthcare);
  assert.equal(created, false);
  assert.equal(contact.drafts.length, 2);
  assert.equal(contact.prospectTitle, "Office Manager", "an empty field from the form doesn't wipe saved data");
  assert.equal(store.list().length, 1);
});

test("marking a step done moves the next follow-up to the following step", () => {
  const { contact } = store.save(prospect, undefined, healthcare);
  store.update(contact.id, { step: { index: 0, done: true } });
  const updated = saved(contact.id);
  assert.ok(updated.sequence[0].doneAt);
  assert.equal(updated.nextFollowUp?.date, updated.sequence[1].due);
  assert.equal(updated.progress, `1 of ${updated.sequence.length}`);
  assert.match(updated.activity.at(-1)!.text, /^Done: Day 1 Email/);
});

test("a manual follow-up date overrides the sequence until the next step is done", () => {
  const { contact } = store.save(prospect, undefined, healthcare);
  store.update(contact.id, { followUpDate: "2026-11-15" });
  assert.equal(saved(contact.id).nextFollowUp?.date, "2026-11-15");
  store.update(contact.id, { step: { index: 0, done: true } });
  const updated = saved(contact.id);
  assert.equal(updated.nextFollowUp?.date, updated.sequence[1].due);
});

test("moving the start date shifts every due date", () => {
  const { contact } = store.save({ ...prospect, industry: "" }, undefined, general);
  store.update(contact.id, { sequenceStart: "2026-11-02" });
  const updated = saved(contact.id);
  // The general sequence's day 3 call lands two days after the start.
  assert.equal(updated.sequence[2].day, 3);
  assert.equal(updated.sequence[2].due, "2026-11-04");
});

test("a contact who replied has no next follow-up", () => {
  const { contact } = store.save(prospect, undefined, healthcare);
  store.update(contact.id, { status: "replied", email: "dana@brightsmiles.example" });
  const updated = saved(contact.id);
  assert.equal(updated.nextFollowUp, null);
  assert.equal(updated.email, "dana@brightsmiles.example");
  assert.equal(updated.prospectTitle, "Office Manager", "fields left out of an update stay as they were");
});

test("rejects bad input and unknown contacts", () => {
  assert.throws(() => store.save({ ...prospect, company: "" }), ContactError);
  const { contact } = store.save(prospect, undefined, healthcare);
  assert.throws(() => store.update(contact.id, { status: "won" }), ContactError);
  assert.throws(() => store.update(contact.id, { step: { index: 99, done: true } }), ContactError);
  assert.throws(() => store.update(contact.id, { followUpDate: "next week" }), ContactError);
  assert.throws(() => store.update("nope", { status: "paused" }), ContactError);
});

test("deletes a contact", () => {
  const { contact } = store.save(prospect, undefined, healthcare);
  store.delete(contact.id);
  assert.equal(store.list().length, 0);
});

test("contacts survive a reload of the page", () => {
  store.save(prospect, drafts, healthcare);
  const reopened = new ContactStore(storage, "contacts", fixedNow);
  assert.equal(reopened.list()[0].drafts[0].drafts.email.subject, "Second location");
});

test("explains a full browser storage and keeps the last saved list", () => {
  store.save(prospect, drafts, healthcare);
  storage.full = true;
  assert.throws(() => store.save({ ...prospect, prospectName: "Sam" }, drafts, healthcare), /storage may be full/);
  assert.equal(store.list().length, 1);
});

test("a backup restores into another browser without duplicates", () => {
  store.save(prospect, drafts, healthcare);
  const other = new ContactStore(new MemoryStorage(), "contacts", fixedNow);
  other.save({ ...prospect, prospectName: "Sam Ortiz" }, drafts, healthcare);
  const { contacts } = JSON.parse(store.backup());
  assert.equal(other.importContacts(contacts), 1);
  assert.equal(other.importContacts(contacts), 0);
  assert.equal(other.list().length, 2);
  assert.equal(other.importContacts([{ prospectName: "No id" }, null]), 0);
});

test("exports contacts as CSV with quoting and industry names", () => {
  store.save({ ...prospect, notes: "Opened a second office, hiring" }, drafts, healthcare);
  const csv = contactsCsv(store.list(), { healthcare: "Healthcare" });
  const [header, row] = csv.replace(/^﻿/, "").split("\r\n");
  assert.match(header, /^Name,Title,Company,Industry,Email,Phone,LinkedIn,Website,Status,Next follow-up,Next step,/);
  assert.match(row, /^Dana Lee,Office Manager,Bright Smiles Dental,Healthcare,,,,,In sequence,2026-10-29,Email: /);
  assert.match(row, /"Opened a second office, hiring"/);
  assert.match(csv, /"Hi Dana,\r?\n\r?\nCongrats on the ""new"" office\."/);
});

test("CSV cells can't run as spreadsheet formulas, but phone numbers stay as typed", () => {
  const { contact } = store.save({ ...prospect, notes: '=HYPERLINK("http://evil.example","x")' }, undefined, healthcare);
  store.update(contact.id, { phone: "+1 555 0100" });
  const csv = contactsCsv(store.list());
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil\.example"",""x""\)"/);
  assert.match(csv, /,\+1 555 0100,/);
});

test("today() uses the local date, not UTC", () => {
  assert.equal(today(new Date(2026, 0, 1, 23, 59)), "2026-01-01");
  assert.equal(today(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
});

test("CSV of an empty list is just the header", () => {
  assert.equal(contactsCsv([]).split("\r\n").filter(Boolean).length, 1);
  assert.equal(nextFollowUp({ status: "paused" } as never), null);
});
