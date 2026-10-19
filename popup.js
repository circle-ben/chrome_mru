"use strict";

const statusEl = document.querySelector("#status");
const snippetEl = document.querySelector("#snippet");
const setupEl = document.querySelector("#setup");
const copyButton = document.querySelector("#copy");

const snippet = `chrome.developerPrivate.updateExtensionCommand({
  extensionId: "${chrome.runtime.id}",
  commandName: "cycle-forward",
  keybinding: "Ctrl+Tab"
});
chrome.developerPrivate.updateExtensionCommand({
  extensionId: "${chrome.runtime.id}",
  commandName: "cycle-backward",
  keybinding: "Ctrl+Shift+Tab"
});`;

snippetEl.textContent = snippet;

function line(label, shortcut) {
  const row = document.createElement("div");
  row.className = "row";
  const name = document.createElement("span");
  name.textContent = label;
  const key = document.createElement("span");
  key.className = "key";
  key.textContent = shortcut || "Not bound";
  row.append(name, key);
  return row;
}

chrome.commands.getAll().then((commands) => {
  const byName = new Map((commands || []).map((command) => [command.name, command.shortcut || ""]));
  const forward = byName.get("cycle-forward") || "";
  const backward = byName.get("cycle-backward") || "";
  const ready = Boolean(forward && backward);

  statusEl.replaceChildren();
  statusEl.classList.add(ready ? "ready" : "missing");
  statusEl.append(
    line("Next tab", forward),
    line("Previous tab", backward)
  );
  setupEl.open = !ready;
}).catch(() => {
  statusEl.textContent = "Could not read shortcuts.";
  setupEl.open = true;
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(snippet);
  } catch {
    const area = document.createElement("textarea");
    area.value = snippet;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  copyButton.textContent = "Copied";
});
