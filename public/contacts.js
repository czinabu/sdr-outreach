// The contact list: saved prospects, their draft history and their follow-up dates.
// Everything is kept in this browser (see contact-store.js); nothing about your prospects is stored on a server.
import { ContactStore, STATUSES, contactsCsv, today, withSchedule } from "./contact-store.js";
import { copyButton, dueLabel, el, formatDate } from "./dom.js";

const store = new ContactStore(window.localStorage);
const state = { today: "", statuses: STATUSES, contacts: [] };
const listeners = new Set();
let selectedId = null;
let draftAgain = () => {};
let industryLabels = {};

function changed() {
  for (const listener of listeners) listener();
}

function refresh() {
  state.today = today();
  state.contacts = store.list().map(withSchedule);
  changed();
}

export function onContactsChange(listener) {
  listeners.add(listener);
}

export function getContact(id) {
  return state.contacts.find((c) => c.id === id);
}

/** The saved contact for this name and company, if there is one. */
export function findContact(prospectName, company) {
  const key = (name, co) => `${name.trim().toLowerCase()}|${co.trim().toLowerCase()}`;
  return state.contacts.find((c) => key(c.prospectName, c.company) === key(prospectName, company));
}

/** Industry names for the CSV export, from /api/industries. */
export function setIndustryLabels(labels) {
  industryLabels = labels;
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showListError(message) {
  const box = document.getElementById("contacts-error");
  box.textContent = message;
  box.hidden = !message;
}

document.getElementById("export-csv").addEventListener("click", () => {
  download(`sdr-contacts-${today()}.csv`, "text/csv", contactsCsv(store.list(), industryLabels));
});
document.getElementById("backup-contacts").addEventListener("click", () => {
  download(`sdr-contacts-backup-${today()}.json`, "application/json", store.backup());
});
document.getElementById("restore-contacts").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const added = store.importContacts(JSON.parse(await file.text()).contacts ?? []);
    showListError("");
    refresh();
    document.getElementById("due-summary").textContent = `Restored ${added} contact${added === 1 ? "" : "s"} from ${file.name}.`;
  } catch (error) {
    showListError(error instanceof SyntaxError ? `${file.name} isn't an SDR Outreach backup.` : error.message);
  }
});

export async function loadContacts() {
  refresh();
  // Ask the browser not to clear this site's storage when space runs low.
  navigator.storage?.persist?.().catch(() => {});
  await importLegacyContacts();
}

// Another tab saved or changed a contact.
window.addEventListener("storage", (event) => {
  if (event.key !== null && event.key !== "sdr-outreach:contacts") return;
  store.reload();
  refresh();
});

/**
 * Contacts used to be saved in data/contacts.json by the app's server. When the app runs on your own computer
 * and that file exists, copy it into this browser once.
 */
async function importLegacyContacts() {
  if (state.contacts.length > 0) return;
  try {
    const response = await fetch("/api/legacy-contacts");
    if (!response.ok) return;
    const added = store.importContacts((await response.json()).contacts ?? []);
    if (added) refresh();
  } catch {
    // No old file, or a hosted copy of the app: nothing to bring over.
  }
}

/** cadence is the industry's follow-up sequence, from the drafts response. */
export async function saveContact(prospect, drafts, cadence) {
  const { contact } = store.save(prospect, drafts, cadence);
  refresh();
  return getContact(contact.id);
}

export async function updateContact(id, changes) {
  store.update(id, changes);
  refresh();
  return getContact(id);
}

export function dueCount() {
  return state.contacts.filter((c) => c.nextFollowUp && c.nextFollowUp.date <= state.today).length;
}

// --- Sequence ------------------------------------------------------------------

/** Renders a contact's sequence with due dates and a checkbox per step. Used in the Sequence tab and on the contact page. */
export function renderSequence(list, contact, onError) {
  const nextIndex = contact.status === "active" ? contact.sequence.findIndex((s) => !s.doneAt) : -1;
  list.replaceChildren(
    ...contact.sequence.map((step, index) => {
      const item = el("li", `cadence-step dated ${step.channel.toLowerCase()}`);
      if (step.doneAt) item.classList.add("done");
      if (index === nextIndex) item.classList.add("next");

      const check = el("input");
      check.type = "checkbox";
      check.checked = Boolean(step.doneAt);
      check.setAttribute("aria-label", `Mark day ${step.day} ${step.channel} done`);
      check.addEventListener("change", async () => {
        check.disabled = true;
        try {
          await updateContact(contact.id, { step: { index, done: check.checked } });
        } catch (error) {
          check.checked = !check.checked;
          check.disabled = false;
          onError(error.message);
        }
      });

      const when = el("span", "day");
      when.append(el("strong", "", `Day ${step.day}`), el("span", "date", formatDate(step.due)));
      const due = !step.doneAt && contact.status === "active" ? dueLabel(step.due, state.today) : null;
      const action = el("span", "action", step.action);
      if (due && (due.state === "overdue" || due.state === "today")) action.append(el("span", `due ${due.state}`, due.text));

      item.append(check, when, el("span", "channel", step.channel), action);
      return item;
    }),
  );
}

// --- Contacts view -------------------------------------------------------------

const listEl = document.getElementById("contact-list");
const searchInput = document.getElementById("contact-search");
const filterSelect = document.getElementById("contact-filter");
const detail = document.getElementById("contact-detail");

function sortKey(contact) {
  // People with a follow-up come first, soonest first; everyone else after, most recently touched first.
  return contact.nextFollowUp ? `0${contact.nextFollowUp.date}` : `1${String(9e15 - Date.parse(contact.updatedAt)).padStart(16, "0")}`;
}

function visibleContacts() {
  const query = searchInput.value.trim().toLowerCase();
  return state.contacts
    .filter((c) => !query || `${c.prospectName} ${c.company} ${c.prospectTitle}`.toLowerCase().includes(query))
    .filter((c) => filterSelect.value !== "due" || (c.nextFollowUp && c.nextFollowUp.date <= state.today))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function followUpText(contact) {
  if (!contact.nextFollowUp) return { text: state.statuses[contact.status] ?? "", state: "none" };
  const due = dueLabel(contact.nextFollowUp.date, state.today);
  return { text: `${due.text} · ${contact.nextFollowUp.channel ?? "Follow up"}`, state: due.state };
}

function renderList() {
  const contacts = visibleContacts();
  document.getElementById("contacts-empty").hidden = state.contacts.length > 0;
  document.getElementById("export-csv").hidden = state.contacts.length === 0;

  const due = dueCount();
  const overdue = state.contacts.filter((c) => c.nextFollowUp && c.nextFollowUp.date < state.today).length;
  document.getElementById("due-summary").textContent = state.contacts.length
    ? due
      ? `${due} to follow up with today${overdue ? `, ${overdue} of them overdue` : ""}.`
      : "Nobody is due today."
    : "";

  listEl.replaceChildren(
    ...contacts.map((contact) => {
      const item = el("li");
      const button = el("button", "contact-row");
      button.type = "button";
      if (contact.id === selectedId) button.setAttribute("aria-current", "true");
      const who = el("span", "who");
      who.append(el("strong", "", contact.prospectName), el("span", "muted", [contact.prospectTitle, contact.company].filter(Boolean).join(" at ")));
      const next = followUpText(contact);
      button.append(who, el("span", `next ${next.state}`, next.text));
      button.addEventListener("click", () => showContact(contact.id));
      item.append(button);
      return item;
    }),
  );
  if (state.contacts.length && !contacts.length) listEl.append(el("li", "muted", "No contacts match."));
}

searchInput.addEventListener("input", renderList);
filterSelect.addEventListener("change", renderList);

function field(label, name, contact, options = {}) {
  const wrapper = el("label", "", label);
  const input = el(options.multiline ? "textarea" : "input");
  if (options.multiline) input.rows = 3;
  if (options.type) input.type = options.type;
  input.name = name;
  input.value = contact[name] ?? "";
  if (options.placeholder) input.placeholder = options.placeholder;
  input.addEventListener("change", () => save({ [name]: input.value }, input));
  wrapper.append(input);
  return wrapper;
}

let detailError;

async function save(changes, control) {
  detailError.hidden = true;
  if (control) control.disabled = true;
  try {
    await updateContact(selectedId, changes);
  } catch (error) {
    detailError.textContent = error.message;
    detailError.hidden = false;
    if (control) control.disabled = false;
  }
}

function draftEntry(entry, open) {
  const d = entry.drafts;
  const box = el("details", "history-entry");
  box.open = open;
  const when = new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  box.append(el("summary", "", `${when} · ${d.email.subject}`));
  const parts = [
    ["LinkedIn connection note", d.linkedin.connectionNote],
    ["LinkedIn follow-up", d.linkedin.followUpMessage],
    ["Email subject", d.email.subject],
    ["Email body", d.email.body],
    ["Phone opener", d.phone.opener],
    ["Voicemail", d.phone.voicemail],
  ];
  for (const [title, text] of parts) {
    const head = el("div", "draft-head");
    head.append(el("h3", "", title), copyButton(() => text));
    box.append(head, el("div", "draft", text));
  }
  return box;
}

function renderDetail() {
  const contact = getContact(selectedId);
  if (!contact) {
    selectedId = null;
    detail.replaceChildren(el("p", "muted empty-detail", state.contacts.length ? "Pick a contact to see their drafts and follow-ups." : ""));
    return;
  }
  const focused = document.activeElement?.name;

  const header = el("div", "detail-head");
  const title = el("div");
  title.append(el("h2", "", contact.prospectName), el("p", "muted", [contact.prospectTitle, contact.company].filter(Boolean).join(" at ")));
  const again = el("button", "secondary", "Write new drafts");
  again.type = "button";
  again.addEventListener("click", () => draftAgain(contact));
  header.append(title, again);

  detailError = el("p", "error");
  detailError.hidden = true;
  detailError.setAttribute("role", "alert");

  // Status and next follow-up
  const statusRow = el("div", "row");
  const statusLabel = el("label", "", "Status");
  const status = el("select");
  status.name = "status";
  for (const [value, label] of Object.entries(state.statuses)) status.append(new Option(label, value, false, value === contact.status));
  status.addEventListener("change", () => save({ status: status.value }, status));
  statusLabel.append(status);

  const followLabel = el("label", "", "Next follow-up");
  const follow = el("input");
  follow.type = "date";
  follow.name = "followUpDate";
  follow.value = contact.nextFollowUp?.date ?? "";
  follow.disabled = contact.status !== "active";
  follow.addEventListener("change", () => save({ followUpDate: follow.value || null }, follow));
  followLabel.append(follow);
  if (contact.status !== "active") {
    followLabel.append(el("small", "", "Set the status back to In sequence to schedule follow-ups."));
  } else if (contact.followUpDate) {
    const reset = el("button", "link-button", "Use the sequence date instead");
    reset.type = "button";
    reset.addEventListener("click", () => save({ followUpDate: null }, reset));
    followLabel.append(reset);
  } else if (contact.nextFollowUp) {
    followLabel.append(el("small", "", `${contact.nextFollowUp.channel}: ${contact.nextFollowUp.action}`));
  }
  statusRow.append(statusLabel, followLabel);

  // Contact details
  const info = el("div", "detail-section");
  const contactRow = el("div", "row");
  contactRow.append(field("Email", "email", contact, { type: "email" }), field("Phone", "phone", contact, { type: "tel" }));
  info.append(
    contactRow,
    field("LinkedIn profile", "linkedinUrl", contact, { placeholder: "linkedin.com/in/..." }),
    field("Company website", "companyWebsite", contact),
    field("Notes", "notes", contact, { multiline: true }),
  );

  // Sequence
  const sequence = el("div", "detail-section");
  const sequenceHead = el("div", "section-head");
  sequenceHead.append(el("h3", "", `Follow-up sequence · ${contact.progress} done`));
  const startLabel = el("label", "inline", "Day 1 was");
  const start = el("input");
  start.type = "date";
  start.name = "sequenceStart";
  start.value = contact.sequenceStart;
  start.addEventListener("change", () => start.value && save({ sequenceStart: start.value }, start));
  startLabel.append(start);
  sequenceHead.append(startLabel);
  const steps = el("ol", "cadence");
  renderSequence(steps, contact, (message) => {
    detailError.textContent = message;
    detailError.hidden = false;
  });
  sequence.append(sequenceHead, steps);

  // Draft history
  const history = el("div", "detail-section");
  history.append(el("h3", "", `Drafts (${contact.drafts.length})`));
  if (!contact.drafts.length) history.append(el("p", "muted", "No drafts saved yet. Press Write new drafts to make some."));
  contact.drafts
    .slice()
    .reverse()
    .forEach((entry, i) => history.append(draftEntry(entry, i === 0 && contact.drafts.length === 1)));

  // Activity
  const activity = el("div", "detail-section");
  activity.append(el("h3", "", "Activity"));
  const log = el("ul", "activity");
  for (const item of contact.activity.slice().reverse()) {
    const when = new Date(item.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    log.append(el("li", "", `${when}: ${item.text}`));
  }
  activity.append(log);

  const remove = el("button", "link-button danger", "Delete this contact");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (remove.dataset.confirm !== "yes") {
      remove.dataset.confirm = "yes";
      remove.textContent = "Press again to delete their drafts and history for good";
      return;
    }
    try {
      store.delete(contact.id);
      selectedId = null;
      refresh();
    } catch (error) {
      detailError.textContent = error.message;
      detailError.hidden = false;
    }
  });

  detail.replaceChildren(header, detailError, statusRow, info, sequence, history, activity, remove);
  if (focused) detail.querySelector(`[name="${focused}"]`)?.focus();
}

export function renderContactsView() {
  renderList();
  renderDetail();
}

export function showContact(id) {
  selectedId = id;
  renderContactsView();
  if (window.innerWidth < 960) detail.scrollIntoView({ behavior: "smooth" });
}

export function onDraftAgain(handler) {
  draftAgain = handler;
}
