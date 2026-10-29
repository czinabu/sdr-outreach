import { copyButton, el } from "./dom.js";
import {
  dueCount,
  findContact,
  getContact,
  loadContacts,
  onContactsChange,
  onDraftAgain,
  renderContactsView,
  renderSequence,
  saveContact,
  setIndustryLabels,
  showContact,
} from "./contacts.js";
import { draftingWith, initModelSettings, maxFileBytes, requestDrafts } from "./models.js";

const form = document.getElementById("prospect-form");
const submit = document.getElementById("submit");
const errorBox = document.getElementById("error");
const guideToggle = document.getElementById("guide-mode");
const industrySelect = document.getElementById("industry");
const fileInput = document.getElementById("attachment");

// Per-channel coaching for new SDRs, shown in Guide mode under each set of drafts.
const TIPS = {
  linkedin: {
    title: "LinkedIn tips",
    do: [
      "Look at their profile and recent activity first, and mention one real thing.",
      "Keep the connection note short and pitch-free. Its only job is getting accepted.",
      "Wait for them to accept, then send the follow-up within a day or two.",
    ],
    dont: [
      "Don't paste a sales pitch into the connection note; it gets ignored or reported.",
      "Don't send the follow-up the minute they accept. It looks automated.",
    ],
  },
  email: {
    title: "Email tips",
    do: [
      "Send Tuesday to Thursday mornings, when inboxes are lighter.",
      "Keep it under about 100 words. Read it out loud: if it sounds like an ad, cut it.",
      "Follow up by replying in the same thread, so they see the whole conversation.",
    ],
    dont: [
      "Don't add links, images or attachments to a first email; they hurt delivery and replies.",
      "Don't ask for a 30-minute meeting right away. Ask whether it's worth a look.",
    ],
  },
  phone: {
    title: "Calling tips",
    do: [
      "Stand up and smile when you dial; it changes how you sound.",
      "Say who you are and admit it's a cold call. Honesty gets people to stay on the line.",
      "Ask a question, then stop talking and let them answer.",
    ],
    dont: [
      "Don't ask \"How are you?\" or \"Is this a bad time?\" first; both make it easy to hang up.",
      "Don't read the script word for word. Know the opener, then have a conversation.",
    ],
  },
  voicemail: {
    title: "Voicemail tips",
    do: [
      "Keep it under 25 seconds and say your name and number slowly, twice.",
      "Mention the email you're sending so they connect the two.",
    ],
    dont: ["Don't pitch in the voicemail. Give one reason to call back, and that's it."],
  },
  objections: {
    title: "Common objections",
    pairs: [
      ["\"I'm not interested.\"", "\"Totally fair. Is that because you've already got this covered, or it's just not a priority right now?\""],
      ["\"Just send me an email.\"", "\"Happy to. So I send something useful, what's the biggest headache with [the problem you solve] right now?\""],
      ["\"We already use someone for that.\"", "\"Makes sense. What do you like about them, and is there anything you wish worked better?\""],
      ["\"Now's not a good time.\"", "\"No problem. When's a better time this week for a two-minute call?\""],
    ],
  },
};

// Remember the SDR's own details and guide preference between visits.
const SAVED_FIELDS = ["yourName", "yourOffer", "goal", "tone", "industry"];

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the app still works without it.
  }
}

// --- Guide mode --------------------------------------------------------------

function renderTips() {
  for (const box of document.querySelectorAll("[data-tips]")) {
    const tips = TIPS[box.dataset.tips];
    box.replaceChildren(el("h4", "", tips.title));
    if (tips.pairs) {
      const list = el("dl", "objections");
      for (const [objection, answer] of tips.pairs) list.append(el("dt", "", objection), el("dd", "", answer));
      box.append(list);
      continue;
    }
    const grid = el("div", "tip-grid");
    for (const [kind, label] of [["do", "Do"], ["dont", "Avoid"]]) {
      const column = el("div", `tip-col ${kind}`);
      column.append(el("p", "tip-label", label));
      const list = el("ul");
      for (const tip of tips[kind]) list.append(el("li", "", tip));
      column.append(list);
      grid.append(column);
    }
    box.append(grid);
  }
}

function applyGuideMode() {
  document.body.classList.toggle("no-guide", !guideToggle.checked);
  save("sdr-outreach:guide", guideToggle.checked ? "on" : "off");
}

guideToggle.checked = load("sdr-outreach:guide") !== "off";
guideToggle.addEventListener("change", applyGuideMode);
applyGuideMode();
renderTips();

// --- Form setup --------------------------------------------------------------

let industryAngles = {};
const industryTip = document.getElementById("industry-tip");
const defaultIndustryTip = industryTip.textContent;

function updateIndustryTip() {
  const angles = industrySelect.value !== "general" && industryAngles[industrySelect.value];
  industryTip.textContent = angles ? `What works here: ${angles}` : defaultIndustryTip;
}

async function loadIndustries() {
  try {
    const response = await fetch("/api/industries");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const industries = await response.json();
    industrySelect.replaceChildren(...industries.map(({ key, label }) => new Option(label, key)));
    industryAngles = Object.fromEntries(industries.map(({ key, angles }) => [key, angles]));
    setIndustryLabels(Object.fromEntries(industries.map(({ key, label }) => [key, label])));
    return true;
  } catch {
    // Usually the server is still running older code after an update; keep "General" and say how to fix it.
    industryTip.removeAttribute("data-guide");
    industryTip.classList.add("warn");
    industryTip.textContent =
      "Couldn't load the industry list. If you just updated the app, stop it with Ctrl+C, run npm install and npm start, then refresh this page.";
    return false;
  }
}

function updateAboutYouSummary() {
  const name = form.elements.yourName.value.trim();
  const offer = form.elements.yourOffer.value.trim();
  document.getElementById("about-you-summary").textContent = name && offer ? `${name} · ${offer}` : "";
}

const industriesLoaded = await loadIndustries();
for (const name of SAVED_FIELDS) {
  const saved = load(`sdr-outreach:${name}`);
  if (saved !== null) form.elements[name].value = saved;
}
updateAboutYouSummary();
if (industriesLoaded) {
  updateIndustryTip();
  industrySelect.addEventListener("change", updateIndustryTip);
}
// Returning users already filled in "About you", so tuck it away.
if (form.elements.yourName.value && form.elements.yourOffer.value) document.getElementById("about-you").open = false;
form.elements.yourName.addEventListener("input", updateAboutYouSummary);
form.elements.yourOffer.addEventListener("input", updateAboutYouSummary);

// --- File attachment ---------------------------------------------------------

let attachment = null;

function setFile(file) {
  const label = document.getElementById("file-label");
  if (file && file.size > maxFileBytes()) {
    showError(`That file is over ${Math.round(maxFileBytes() / 1024 / 1024)} MB. Try a smaller one.`);
    file = null;
  }
  attachment = file ?? null;
  label.textContent = attachment ? `${attachment.name} (${Math.ceil(attachment.size / 1024)} KB)` : "Choose a PDF or text file, or drop it here";
  document.getElementById("file-drop").classList.toggle("has-file", Boolean(attachment));
  document.getElementById("file-clear").hidden = !attachment;
  document.getElementById("file-description-field").hidden = !attachment;
  if (!attachment) fileInput.value = "";
}

fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
document.getElementById("file-clear").addEventListener("click", () => setFile(null));
const drop = document.getElementById("file-drop");
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("dragging");
  setFile(event.dataTransfer.files[0]);
});

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// --- Results -----------------------------------------------------------------

function selectTab(name) {
  for (const tab of document.querySelectorAll("[data-tab]")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
}

for (const tab of document.querySelectorAll("[data-tab]")) tab.addEventListener("click", () => selectTab(tab.dataset.tab));

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function setList(id, items) {
  document.getElementById(id).replaceChildren(...items.map((item) => el("li", "", item)));
}

function showNotice(id, text) {
  const notice = document.getElementById(id);
  notice.textContent = text || "";
  notice.hidden = !text;
}

function addCopyButtons() {
  for (const draft of document.querySelectorAll(".draft")) {
    const head = draft.previousElementSibling;
    if (head.querySelector(".copy")) continue;
    head.append(copyButton(() => draft.textContent));
  }
}

function renderCadence(steps) {
  document.getElementById("cadence").replaceChildren(
    ...steps.map((step) => {
      const item = el("li", `cadence-step ${step.channel.toLowerCase()}`);
      item.append(el("span", "day", `Day ${step.day}`), el("span", "channel", step.channel), el("span", "action", step.action));
      return item;
    }),
  );
}

// --- Saving to contacts --------------------------------------------------------

const PROSPECT_FIELDS = ["prospectName", "prospectTitle", "company", "industry", "companyWebsite", "notes"];
const DRAFT_FIELDS = ["websiteHook", "linkedin", "email", "phone", "researchToDo"];
let lastCadence = [];
/** The prospect and drafts on screen, and the saved contact they belong to (if any). */
let current = { prospect: null, drafts: null, contactId: null };

function renderSequenceTab() {
  const contact = current.contactId && getContact(current.contactId);
  document.getElementById("cadence-hint").hidden = Boolean(contact);
  if (contact) renderSequence(document.getElementById("cadence"), contact, showSaveError);
  else renderCadence(lastCadence);
}

function renderSaveBar(message) {
  const contact = current.contactId && getContact(current.contactId);
  const saveButton = document.getElementById("save-contact");
  saveButton.hidden = Boolean(contact);
  saveButton.disabled = false;
  document.getElementById("open-contact").hidden = !contact;
  const status = document.getElementById("save-status");
  status.classList.remove("error");
  if (contact) {
    const next = contact.nextFollowUp;
    const when = next && new Date(`${next.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    status.textContent = `${message ?? "Saved to contacts."}${next ? ` Next: ${next.channel ? `${next.channel}, ` : ""}${next.action.toLowerCase()} on ${when}.` : ""}`;
  } else {
    status.textContent = "Save this prospect to keep these drafts and put dates on the follow-up sequence.";
  }
}

function showSaveError(message) {
  const status = document.getElementById("save-status");
  status.textContent = message;
  status.classList.add("error");
}

async function storeDrafts(button) {
  if (button) button.disabled = true;
  try {
    const existing = Boolean(current.contactId);
    const contact = await saveContact(current.prospect, current.drafts, lastCadence);
    current.contactId = contact.id;
    renderSaveBar(existing ? `Added to ${contact.prospectName}'s draft history.` : undefined);
    renderSequenceTab();
  } catch (error) {
    if (button) button.disabled = false;
    showSaveError(error.message);
  }
}

document.getElementById("save-contact").addEventListener("click", (event) => storeDrafts(event.currentTarget));
document.getElementById("open-contact").addEventListener("click", () => {
  showView("contacts");
  showContact(current.contactId);
});

/** After drafting: if this prospect is already a contact, add the drafts to their history automatically. */
async function afterDrafting(data, drafts) {
  current = {
    prospect: Object.fromEntries(PROSPECT_FIELDS.map((name) => [name, data[name] ?? ""])),
    drafts: Object.fromEntries(DRAFT_FIELDS.map((name) => [name, drafts[name]])),
    contactId: findContact(data.prospectName, data.company)?.id ?? null,
  };
  renderSaveBar();
  renderSequenceTab();
  if (current.contactId) await storeDrafts();
}

onContactsChange(() => {
  const badge = document.getElementById("due-badge");
  const due = dueCount();
  badge.textContent = String(due);
  badge.hidden = due === 0;
  badge.title = `${due} due today or overdue`;
  if (current.contactId && !getContact(current.contactId)) current.contactId = null;
  if (current.drafts) {
    renderSaveBar();
    renderSequenceTab();
  }
  if (!document.getElementById("contacts-view").hidden) renderContactsView();
});

// "Write new drafts" on a contact: fill in the form, show their latest drafts and go back to the Draft view.
onDraftAgain((contact) => {
  for (const name of PROSPECT_FIELDS) {
    if (form.elements[name] && contact[name] !== undefined) form.elements[name].value = contact[name];
  }
  updateIndustryTip();
  const latest = contact.drafts.at(-1);
  if (latest) {
    current = { prospect: Object.fromEntries(PROSPECT_FIELDS.map((n) => [n, contact[n]])), drafts: latest.drafts, contactId: contact.id };
    render({ ...latest.drafts, cadence: contact.sequence });
    renderSaveBar("Showing their latest saved drafts. Press Draft my outreach for new ones.");
    showState("results");
  } else {
    current = { prospect: null, drafts: null, contactId: null };
    showState("empty");
  }
  showView("draft");
  form.elements.notes.focus();
});

// --- Views ---------------------------------------------------------------------

const VIEWS = ["draft", "contacts", "model"];

function showView(name) {
  for (const view of VIEWS) document.getElementById(`${view}-view`).hidden = view !== name;
  for (const button of document.querySelectorAll("[data-view]")) {
    if (button.dataset.view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (name === "contacts") renderContactsView();
  const hash = name === "draft" ? "" : `#${name}`;
  if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
}

for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => showView(button.dataset.view));

function render(drafts) {
  showNotice("website-note", drafts.websiteNote);
  showNotice("attachment-note", drafts.attachmentNote);
  showNotice("website-hook", !drafts.websiteNote && drafts.websiteHook && `Opener based on their website: ${drafts.websiteHook}`);

  setText("linkedin-note", drafts.linkedin.connectionNote);
  const length = drafts.linkedin.connectionNote.length;
  setText("linkedin-count", `${length} / 300 characters${length > 300 ? " · trim before sending" : ""}`);
  document.getElementById("linkedin-count").classList.toggle("over", length > 300);
  setText("linkedin-followup", drafts.linkedin.followUpMessage);
  setText("linkedin-why", drafts.linkedin.why);

  setText("email-subject", drafts.email.subject);
  setText("email-body", drafts.email.body);
  setText("email-count", `${drafts.email.body.split(/\s+/).filter(Boolean).length} words`);
  setText("email-why", drafts.email.why);

  setText("phone-opener", drafts.phone.opener);
  setList("phone-questions", drafts.phone.discoveryQuestions);
  setText("phone-voicemail", drafts.phone.voicemail);
  setText("phone-why", drafts.phone.why);

  lastCadence = drafts.cadence ?? [];
  renderSequenceTab();
  setText("channel-tip", drafts.channelTip ? `For this industry: ${drafts.channelTip}` : "");
  setList("research", drafts.researchToDo);

  addCopyButtons();
  selectTab("linkedin");
}

function showState(state) {
  document.getElementById("empty-state").hidden = state !== "empty";
  document.getElementById("loading").hidden = state !== "loading";
  document.getElementById("results").hidden = state !== "results";
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) {
    // Open any collapsed section that hides the missing field.
    form.querySelector(":invalid")?.closest("details")?.setAttribute("open", "");
    form.reportValidity();
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  delete data.attachment;
  for (const name of SAVED_FIELDS) save(`sdr-outreach:${name}`, data[name]);

  showError("");
  submit.disabled = true;
  submit.textContent = "Drafting...";
  const hadResults = !document.getElementById("results").hidden;
  setText("loading-model", `Drafting with ${draftingWith()}. This takes a few seconds with Claude and up to a few minutes with a local model.`);
  showState("loading");
  try {
    if (attachment) data.attachment = { name: attachment.name, data: await toBase64(attachment) };
    const body = await requestDrafts(data);
    render(body);
    showState("results");
    await afterDrafting(data, body);
    if (window.innerWidth < 960) document.querySelector(".results-panel").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    showError(error.message);
    showState(hadResults ? "results" : "empty");
  } finally {
    submit.disabled = false;
    submit.textContent = "Draft my outreach";
  }
});

await Promise.all([loadContacts(), initModelSettings()]);
const startView = location.hash.slice(1);
if (VIEWS.includes(startView) && startView !== "draft") showView(startView);
