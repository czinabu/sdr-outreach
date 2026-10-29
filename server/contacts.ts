// A light contact list: each saved prospect, the drafts written for them, and where they are in the follow-up sequence.
// Stored as one JSON file on this computer. Deals, pipelines and reporting belong in a real CRM; export to CSV for that.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OutreachDrafts } from "./drafts.ts";
import { PLAYBOOKS, playbookFor, type CadenceStep } from "./playbooks.ts";

export const STATUSES = {
  active: "In sequence",
  replied: "Replied",
  meeting: "Meeting booked",
  paused: "Paused",
  not_interested: "Not interested",
} as const;
export type Status = keyof typeof STATUSES;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like 2026-10-29");

const text = (max: number) => z.string().trim().max(max);
const required = (message: string) => z.string().trim().min(1, message).max(200);

/** Fields the SDR can edit on a saved contact. */
const editable = {
  prospectName: required("Prospect name is required"),
  prospectTitle: text(200),
  company: required("Company is required"),
  industry: text(100),
  companyWebsite: text(500),
  notes: text(5000),
  email: text(200),
  phone: text(50),
  linkedinUrl: text(500),
};

export const ContactFields = z.object({
  ...editable,
  prospectTitle: editable.prospectTitle.default(""),
  industry: editable.industry.default(""),
  companyWebsite: editable.companyWebsite.default(""),
  notes: editable.notes.default(""),
  email: editable.email.default(""),
  phone: editable.phone.default(""),
  linkedinUrl: editable.linkedinUrl.default(""),
});

export const NewContact = ContactFields.extend({ drafts: OutreachDrafts.optional() });

export const ContactUpdate = z.object(editable).partial().extend({
  status: z.enum(Object.keys(STATUSES) as [Status, ...Status[]]).optional(),
  sequenceStart: IsoDate.optional(),
  /** Overrides the next follow-up date from the sequence. null goes back to the sequence's date. */
  followUpDate: IsoDate.nullable().optional(),
  /** Mark one sequence step done (true) or not done (false). */
  step: z.object({ index: z.number().int().min(0), done: z.boolean() }).optional(),
});

export type SequenceStep = CadenceStep & { doneAt?: string };

export type Contact = z.infer<typeof ContactFields> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  /** Day 1 of the sequence. Each step is due on sequenceStart + (day - 1). */
  sequenceStart: string;
  sequence: SequenceStep[];
  followUpDate?: string;
  drafts: { id: string; createdAt: string; drafts: OutreachDrafts }[];
  activity: { at: string; text: string }[];
};

export type NextFollowUp = { date: string; channel?: string; action: string };

export class ContactNotFound extends Error {}

/** Today's date on this computer, as YYYY-MM-DD. */
export function today(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function stepDue(contact: Contact, step: CadenceStep): string {
  return addDays(contact.sequenceStart, step.day - 1);
}

/** The next thing to do for this contact, or null when they're out of the sequence. */
export function nextFollowUp(contact: Contact): NextFollowUp | null {
  if (contact.status !== "active") return null;
  const step = contact.sequence.find((s) => !s.doneAt);
  if (contact.followUpDate) {
    return { date: contact.followUpDate, channel: step?.channel, action: step?.action ?? "Follow up" };
  }
  if (!step) return null;
  return { date: stepDue(contact, step), channel: step.channel, action: step.action };
}

function sameProspect(a: { prospectName: string; company: string }, b: { prospectName: string; company: string }) {
  const key = (c: typeof a) => `${c.prospectName.trim().toLowerCase()}|${c.company.trim().toLowerCase()}`;
  return key(a) === key(b);
}

export class ContactStore {
  readonly file: string;
  #contacts: Contact[] | undefined;
  #now: () => Date;

  constructor(file: string, now: () => Date = () => new Date()) {
    this.file = file;
    this.#now = now;
  }

  #load(): Contact[] {
    if (!this.#contacts) {
      try {
        this.#contacts = JSON.parse(fs.readFileSync(this.file, "utf8")).contacts;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.#contacts = [];
      }
    }
    return this.#contacts!;
  }

  #save() {
    // Write to a temp file and rename, so a crash mid-write never leaves a half-written contact list.
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, contacts: this.#contacts }, null, 2));
    fs.renameSync(temp, this.file);
  }

  list(): Contact[] {
    return this.#load();
  }

  get(id: string): Contact {
    const contact = this.#load().find((c) => c.id === id);
    if (!contact) throw new ContactNotFound("That contact doesn't exist. It may have been deleted.");
    return contact;
  }

  /** Saves a prospect, or adds the drafts to their history if they're already saved (same name and company). */
  save(input: z.infer<typeof NewContact>): { contact: Contact; created: boolean } {
    const { drafts, ...fields } = input;
    const now = this.#now().toISOString();
    let contact = this.#load().find((c) => sameProspect(c, fields));
    const created = !contact;
    if (!contact) {
      const playbook = playbookFor(fields.industry) ?? PLAYBOOKS.general;
      contact = {
        ...fields,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        status: "active",
        sequenceStart: today(this.#now()),
        sequence: playbook.cadence.map((step) => ({ ...step })),
        drafts: [],
        activity: [{ at: now, text: "Saved to contacts" }],
      };
      this.#contacts!.push(contact);
    } else {
      // Fill in anything new from the form without wiping what the SDR already saved.
      for (const [key, value] of Object.entries(fields) as [keyof typeof fields, string][]) {
        if (value) contact[key] = value;
      }
      contact.updatedAt = now;
    }
    if (drafts) {
      contact.drafts.push({ id: randomUUID(), createdAt: now, drafts });
      contact.activity.push({ at: now, text: "Drafts written" });
    }
    this.#save();
    return { contact, created };
  }

  update(id: string, changes: z.infer<typeof ContactUpdate>): Contact {
    const contact = this.get(id);
    const now = this.#now().toISOString();
    const { step, status, sequenceStart, followUpDate, ...fields } = changes;
    Object.assign(contact, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));

    if (status && status !== contact.status) {
      contact.status = status;
      contact.activity.push({ at: now, text: `Status: ${STATUSES[status]}` });
    }
    if (sequenceStart) contact.sequenceStart = sequenceStart;
    if (followUpDate !== undefined) {
      if (followUpDate) contact.followUpDate = followUpDate;
      else delete contact.followUpDate;
    }
    if (step) {
      const target = contact.sequence[step.index];
      if (!target) throw new ContactNotFound("That sequence step doesn't exist.");
      if (step.done && !target.doneAt) {
        target.doneAt = now;
        contact.activity.push({ at: now, text: `Done: Day ${target.day} ${target.channel}, ${target.action.toLowerCase()}` });
        // A manual follow-up date was for this touch; the next one comes from the sequence again.
        delete contact.followUpDate;
      } else if (!step.done && target.doneAt) {
        delete target.doneAt;
        contact.activity.push({ at: now, text: `Undone: Day ${target.day} ${target.channel}` });
      }
    }
    contact.updatedAt = now;
    this.#save();
    return contact;
  }

  delete(id: string) {
    this.get(id);
    this.#contacts = this.#load().filter((c) => c.id !== id);
    this.#save();
  }
}

// --- CSV export --------------------------------------------------------------

const CSV_COLUMNS: [string, (c: Contact) => string][] = [
  ["Name", (c) => c.prospectName],
  ["Title", (c) => c.prospectTitle],
  ["Company", (c) => c.company],
  ["Industry", (c) => playbookFor(c.industry)?.label ?? c.industry],
  ["Email", (c) => c.email],
  ["Phone", (c) => c.phone],
  ["LinkedIn", (c) => c.linkedinUrl],
  ["Website", (c) => c.companyWebsite],
  ["Status", (c) => STATUSES[c.status]],
  ["Next follow-up", (c) => nextFollowUp(c)?.date ?? ""],
  ["Next step", (c) => {
    const next = nextFollowUp(c);
    return next ? [next.channel, next.action].filter(Boolean).join(": ") : "";
  }],
  ["Touches done", (c) => String(c.sequence.filter((s) => s.doneAt).length)],
  ["Last activity", (c) => (c.activity.length ? today(new Date(c.activity.at(-1)!.at)) : "")],
  ["Notes", (c) => c.notes],
  ["Last email subject", (c) => c.drafts.at(-1)?.drafts.email.subject ?? ""],
  ["Last email body", (c) => c.drafts.at(-1)?.drafts.email.body ?? ""],
  ["Added", (c) => today(new Date(c.createdAt))],
];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function contactsCsv(contacts: Contact[]): string {
  const rows = [CSV_COLUMNS.map(([name]) => name), ...contacts.map((c) => CSV_COLUMNS.map(([, get]) => get(c)))];
  // The byte-order mark makes Excel read accents and curly quotes correctly.
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
