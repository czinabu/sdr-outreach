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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
    const industries = await (await fetch("/api/industries")).json();
    industrySelect.replaceChildren(...industries.map(({ key, label }) => new Option(label, key)));
    industryAngles = Object.fromEntries(industries.map(({ key, angles }) => [key, angles]));
  } catch {
    // Keep the default "General" option if the list can't load.
  }
}

function updateAboutYouSummary() {
  const name = form.elements.yourName.value.trim();
  const offer = form.elements.yourOffer.value.trim();
  document.getElementById("about-you-summary").textContent = name && offer ? `${name} · ${offer}` : "";
}

await loadIndustries();
for (const name of SAVED_FIELDS) {
  const saved = load(`sdr-outreach:${name}`);
  if (saved !== null) form.elements[name].value = saved;
}
updateAboutYouSummary();
updateIndustryTip();
industrySelect.addEventListener("change", updateIndustryTip);
// Returning users already filled in "About you", so tuck it away.
if (form.elements.yourName.value && form.elements.yourOffer.value) document.getElementById("about-you").open = false;
form.elements.yourName.addEventListener("input", updateAboutYouSummary);
form.elements.yourOffer.addEventListener("input", updateAboutYouSummary);

// --- File attachment ---------------------------------------------------------

const MAX_FILE_BYTES = 10 * 1024 * 1024;
let attachment = null;

function setFile(file) {
  const label = document.getElementById("file-label");
  if (file && file.size > MAX_FILE_BYTES) {
    showError("That file is over 10 MB. Try a smaller one.");
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
    const button = el("button", "copy", "Copy");
    button.type = "button";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(draft.textContent);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select and copy";
      }
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    head.append(button);
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

  renderCadence(drafts.cadence ?? []);
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
  showState("loading");
  try {
    if (attachment) data.attachment = { name: attachment.name, data: await toBase64(attachment) };
    const response = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
    render(body);
    showState("results");
    if (window.innerWidth < 960) document.querySelector(".results-panel").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    showError(error.message);
    showState(hadResults ? "results" : "empty");
  } finally {
    submit.disabled = false;
    submit.textContent = "Draft my outreach";
  }
});
