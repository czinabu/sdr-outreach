const form = document.getElementById("prospect-form");
const submit = document.getElementById("submit");
const errorBox = document.getElementById("error");
const results = document.getElementById("results");
const guideToggle = document.getElementById("guide-mode");

// Remember the SDR's own details and guide preference between visits.
const SAVED_FIELDS = ["yourName", "yourOffer", "goal", "tone"];

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

for (const name of SAVED_FIELDS) {
  const saved = load(`sdr-outreach:${name}`);
  if (saved !== null) form.elements[name].value = saved;
}

function applyGuideMode() {
  document.body.classList.toggle("no-guide", !guideToggle.checked);
  save("sdr-outreach:guide", guideToggle.checked ? "on" : "off");
}
guideToggle.checked = load("sdr-outreach:guide") !== "off";
guideToggle.addEventListener("change", applyGuideMode);
applyGuideMode();

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function setList(id, items) {
  const list = document.getElementById(id);
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }),
  );
}

function addCopyButtons() {
  for (const draft of document.querySelectorAll(".draft")) {
    if (draft.nextElementSibling?.classList.contains("copy")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(draft.textContent);
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    draft.after(button);
  }
}

function showNotice(id, text) {
  const notice = document.getElementById(id);
  notice.textContent = text ?? "";
  notice.hidden = !text;
}

function render(drafts) {
  showNotice("website-note", drafts.websiteNote);
  showNotice("website-hook", !drafts.websiteNote && drafts.websiteHook && `Opener based on their website: ${drafts.websiteHook}`);
  setText("linkedin-note", drafts.linkedin.connectionNote);
  const length = drafts.linkedin.connectionNote.length;
  setText("linkedin-count", `${length} / 300 characters${length > 300 ? ". Trim this before sending." : ""}`);
  setText("linkedin-followup", drafts.linkedin.followUpMessage);
  setText("linkedin-why", drafts.linkedin.why);
  setText("email-subject", drafts.email.subject);
  setText("email-body", drafts.email.body);
  setText("email-why", drafts.email.why);
  setText("phone-opener", drafts.phone.opener);
  setList("phone-questions", drafts.phone.discoveryQuestions);
  setText("phone-voicemail", drafts.phone.voicemail);
  setText("phone-why", drafts.phone.why);
  setList("research", drafts.researchToDo);
  addCopyButtons();
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  for (const name of SAVED_FIELDS) save(`sdr-outreach:${name}`, data[name]);

  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = "Drafting...";
  try {
    const response = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
    render(body);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Draft my outreach";
  }
});
