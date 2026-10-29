export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function copyButton(getText) {
  const button = el("button", "copy", "Copy");
  button.type = "button";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
  return button;
}

/** "Thu, Oct 29" for a YYYY-MM-DD date. */
export function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** How a due date reads next to today: "Today", "Tomorrow", "In 3 days", "2 days overdue". */
export function dueLabel(date, today) {
  const days = daysBetween(today, date);
  if (days === 0) return { text: "Today", state: "today" };
  if (days === 1) return { text: "Tomorrow", state: "soon" };
  if (days > 1) return { text: `In ${days} days`, state: "later" };
  return { text: days === -1 ? "1 day overdue" : `${-days} days overdue`, state: "overdue" };
}
