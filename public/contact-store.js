// A light contact list: each saved prospect, the drafts written for them, and where they are in the follow-up sequence.
// Kept in this browser's storage only, so each person's contacts stay on their own device and never reach the server.
// Deals, pipelines and reporting belong in a real CRM; export to CSV for that.

export const STATUSES = {
  active: "In sequence",
  replied: "Replied",
  meeting: "Meeting booked",
  paused: "Paused",
  not_interested: "Not interested",
};

/** Fields the SDR can edit on a saved contact, with their length limits. */
const FIELDS = {
  prospectName: 200,
  prospectTitle: 200,
  company: 200,
  industry: 100,
  companyWebsite: 500,
  notes: 5000,
  email: 200,
  phone: 50,
  linkedinUrl: 500,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ContactError extends Error {}

/** Today's date on this computer, as YYYY-MM-DD. */
export function today(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function stepDue(contact, step) {
  return addDays(contact.sequenceStart, step.day - 1);
}

/** The next thing to do for this contact, or null when they're out of the sequence. */
export function nextFollowUp(contact) {
  if (contact.status !== "active") return null;
  const step = contact.sequence.find((s) => !s.doneAt);
  if (contact.followUpDate) {
    return { date: contact.followUpDate, channel: step?.channel, action: step?.action ?? "Follow up" };
  }
  if (!step) return null;
  return { date: stepDue(contact, step), channel: step.channel, action: step.action };
}

/** A contact plus what the page needs to show it: its next follow-up and each step's due date. */
export function withSchedule(contact) {
  const done = contact.sequence.filter((s) => s.doneAt).length;
  return {
    ...contact,
    nextFollowUp: nextFollowUp(contact),
    sequence: contact.sequence.map((step) => ({ ...step, due: stepDue(contact, step) })),
    progress: `${done} of ${contact.sequence.length}`,
  };
}

function clean(fields, { partial }) {
  const out = {};
  for (const [name, max] of Object.entries(FIELDS)) {
    if (fields[name] === undefined) {
      if (!partial) out[name] = "";
      continue;
    }
    const value = String(fields[name]).trim();
    if (value.length > max) throw new ContactError(`${name} is too long (${max} characters at most).`);
    out[name] = value;
  }
  if (!partial || "prospectName" in out) if (!out.prospectName) throw new ContactError("Prospect name is required");
  if (!partial || "company" in out) if (!out.company) throw new ContactError("Company is required");
  return out;
}

function sameProspect(a, b) {
  const key = (c) => `${c.prospectName.trim().toLowerCase()}|${c.company.trim().toLowerCase()}`;
  return key(a) === key(b);
}

function newId() {
  return globalThis.crypto.randomUUID();
}

export class ContactStore {
  #storage;
  #key;
  #now;
  #contacts;

  /** storage is localStorage in the page, or anything with getItem/setItem in tests. */
  constructor(storage, key = "sdr-outreach:contacts", now = () => new Date()) {
    this.#storage = storage;
    this.#key = key;
    this.#now = now;
  }

  #load() {
    if (!this.#contacts) {
      let saved = null;
      try {
        saved = JSON.parse(this.#storage.getItem(this.#key) ?? "null");
      } catch {
        // Unreadable storage: start empty rather than break the page.
      }
      this.#contacts = Array.isArray(saved?.contacts) ? saved.contacts : [];
    }
    return this.#contacts;
  }

  #save() {
    try {
      this.#storage.setItem(this.#key, JSON.stringify({ version: 1, contacts: this.#contacts }));
    } catch {
      // Put the list back the way it was on disk, so the page doesn't show changes that weren't saved.
      this.#contacts = undefined;
      throw new ContactError("This browser couldn't save your contacts. Its storage may be full: export a backup, then delete old contacts.");
    }
  }

  /** Forget the copy in memory, for when another tab changed the list. */
  reload() {
    this.#contacts = undefined;
  }

  list() {
    return this.#load();
  }

  get(id) {
    const contact = this.#load().find((c) => c.id === id);
    if (!contact) throw new ContactError("That contact doesn't exist. It may have been deleted.");
    return contact;
  }

  /**
   * Saves a prospect, or adds the drafts to their history if they're already saved (same name and company).
   * cadence is the industry's follow-up sequence, used for a new contact.
   */
  save(input, drafts, cadence = []) {
    const fields = clean(input, { partial: false });
    const now = this.#now().toISOString();
    let contact = this.#load().find((c) => sameProspect(c, fields));
    const created = !contact;
    if (!contact) {
      contact = {
        ...fields,
        id: newId(),
        createdAt: now,
        updatedAt: now,
        status: "active",
        sequenceStart: today(this.#now()),
        sequence: cadence.map(({ day, channel, action }) => ({ day, channel, action })),
        drafts: [],
        activity: [{ at: now, text: "Saved to contacts" }],
      };
      this.#contacts.push(contact);
    } else {
      // Fill in anything new from the form without wiping what the SDR already saved.
      for (const [key, value] of Object.entries(fields)) {
        if (value) contact[key] = value;
      }
      contact.updatedAt = now;
    }
    if (drafts) {
      contact.drafts.push({ id: newId(), createdAt: now, drafts });
      contact.activity.push({ at: now, text: "Drafts written" });
    }
    this.#save();
    return { contact, created };
  }

  update(id, changes) {
    const contact = this.get(id);
    const now = this.#now().toISOString();
    const { step, status, sequenceStart, followUpDate, ...rest } = changes;
    const fields = clean(rest, { partial: true });
    if (status !== undefined && !(status in STATUSES)) throw new ContactError("That status doesn't exist.");
    for (const date of [sequenceStart, followUpDate]) {
      if (date && !ISO_DATE.test(date)) throw new ContactError("Dates must look like 2026-10-29");
    }
    Object.assign(contact, fields);

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
      if (!target) throw new ContactError("That sequence step doesn't exist.");
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

  delete(id) {
    this.get(id);
    this.#contacts = this.#load().filter((c) => c.id !== id);
    this.#save();
  }

  /** Adds contacts from a backup, skipping any already saved (same id, or same name and company). Returns how many were added. */
  importContacts(contacts) {
    const list = this.#load();
    let added = 0;
    for (const contact of contacts) {
      if (!contact?.id || !contact.prospectName || !contact.company || !Array.isArray(contact.sequence) || !Array.isArray(contact.drafts)) continue;
      if (list.some((c) => c.id === contact.id || sameProspect(c, contact))) continue;
      list.push({ activity: [], status: "active", ...contact });
      added++;
    }
    if (added) this.#save();
    return added;
  }

  /** Everything, for a backup file the user keeps. */
  backup() {
    return JSON.stringify({ version: 1, exportedAt: this.#now().toISOString(), contacts: this.#load() }, null, 2);
  }
}

// --- CSV export --------------------------------------------------------------

/** labels maps industry keys to names, e.g. { healthcare: "Healthcare" }. */
function csvColumns(labels) {
  return [
    ["Name", (c) => c.prospectName],
    ["Title", (c) => c.prospectTitle],
    ["Company", (c) => c.company],
    ["Industry", (c) => labels[c.industry] ?? c.industry],
    ["Email", (c) => c.email],
    ["Phone", (c) => c.phone],
    ["LinkedIn", (c) => c.linkedinUrl],
    ["Website", (c) => c.companyWebsite],
    ["Status", (c) => STATUSES[c.status]],
    ["Next follow-up", (c) => nextFollowUp(c)?.date ?? ""],
    [
      "Next step",
      (c) => {
        const next = nextFollowUp(c);
        return next ? [next.channel, next.action].filter(Boolean).join(": ") : "";
      },
    ],
    ["Touches done", (c) => String(c.sequence.filter((s) => s.doneAt).length)],
    ["Last activity", (c) => (c.activity.length ? today(new Date(c.activity.at(-1).at)) : "")],
    ["Notes", (c) => c.notes],
    ["Last email subject", (c) => c.drafts.at(-1)?.drafts.email.subject ?? ""],
    ["Last email body", (c) => c.drafts.at(-1)?.drafts.email.body ?? ""],
    ["Added", (c) => today(new Date(c.createdAt))],
  ];
}

function csvCell(value) {
  const text = String(value ?? "");
  // Spreadsheets run a cell starting with = @ + or - as a formula, so a draft or note could hide one.
  // A leading quote mark keeps it plain text; phone numbers like +1 555 are left alone.
  const safe = /^(?:[=@\t\r]|[+-][^\d\s(])/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function contactsCsv(contacts, labels = {}) {
  const columns = csvColumns(labels);
  const rows = [columns.map(([name]) => name), ...contacts.map((c) => columns.map(([, get]) => get(c)))];
  // The byte-order mark makes Excel read accents and curly quotes correctly.
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
