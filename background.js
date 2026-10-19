"use strict";

const HOLD_SHOW_MS = 150;
const IDLE_COMMIT_MS = 300;
const SAFETY_COMMIT_MS = 8000;
const CTRL_STATE_GRACE_MS = 40;
const SESSION_MAX_AGE_MS = 10000;
const SESSION_KEY = "mruSession";

/** @type {null | {
 *   windowId: number,
 *   originTabId: number,
 *   tabIds: number[],
 *   index: number,
 *   overlayMode: boolean,
 *   overlayVisible: boolean,
 *   updatedAt: number
 * }} */
let session = null;

/** @type {Map<number, { down: boolean, at: number }>} */
const ctrlState = new Map();
const CTRL_FRESH_MS = 800;

let suppressActivation = null;
let showTimer = null;
let idleTimer = null;
let safetyTimer = null;

let tail = Promise.resolve();

function enqueue(fn) {
  const run = tail.then(fn);
  tail = run.catch((err) => {
    console.error("MRU tab switcher", err);
  });
  return run;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearTimers() {
  clearTimeout(showTimer);
  clearTimeout(idleTimer);
  clearTimeout(safetyTimer);
  showTimer = null;
  idleTimer = null;
  safetyTimer = null;
}

async function persist() {
  if (session) await chrome.storage.session.set({ [SESSION_KEY]: session });
  else await chrome.storage.session.remove(SESSION_KEY);
}

function stepIndex(index, direction, length) {
  return (index + direction + length) % length;
}

async function notify(tabId, message) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function probeTab(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "probe" }, { frameId: 0 });
    if (res && res.ok) return res;
  } catch {
    // The declared script is not in this page yet, or the page cannot host one.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["overlay.js"],
    });
  } catch {
    return null;
  }

  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "probe" }, { frameId: 0 });
    if (res && res.ok) return res;
  } catch {
    return null;
  }
  return null;
}

function safeIcon(url) {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("https:") || url.startsWith("http:")) return url;
  return "";
}

function toMeta(tab) {
  let host = "";
  try {
    host = new URL(tab.url || "").hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  return {
    id: tab.id,
    title: tab.title || host || "Untitled",
    favIconUrl: safeIcon(tab.favIconUrl),
  };
}

async function metasFor(ids) {
  const metas = [];
  for (const id of ids) {
    try {
      const tab = await chrome.tabs.get(id);
      metas.push(toMeta(tab));
    } catch {
      metas.push(null);
    }
  }
  return metas;
}

function compactSession(metas) {
  const selectedId = session.tabIds[session.index];
  const live = [];
  for (let i = 0; i < session.tabIds.length; i++) {
    if (metas[i]) live.push(metas[i]);
  }
  session.tabIds = live.map((meta) => meta.id);
  const next = session.tabIds.indexOf(selectedId);
  session.index = next === -1 ? 0 : next;
  return live;
}

async function activeTab(commandTab) {
  if (commandTab && commandTab.id != null && commandTab.windowId != null) return commandTab;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

function snapshotIds(tabs, activeId) {
  const ordered = tabs
    .filter((tab) => tab.id != null)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const rest = ordered.map((tab) => tab.id).filter((id) => id !== activeId);
  return [activeId, ...rest];
}

function classifyCtrl(tabId, probe) {
  const now = Date.now();
  const state = ctrlState.get(tabId);
  const stateFresh = Boolean(state && now - state.at < CTRL_FRESH_MS);
  if (stateFresh && state.down) return "held";
  if (probe?.ctrlDown) return "held";
  if (stateFresh && !state.down) return "released";
  if (probe?.lastCtrlAt && now - probe.lastCtrlAt < CTRL_FRESH_MS) return "released";
  return "untracked";
}

function armIdle(ms) {
  clearTimeout(idleTimer);
  const current = session;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    enqueue(async () => {
      if (session !== current || !session || session.overlayMode) return;
      await commitSession();
    });
  }, ms);
}

function armSafety() {
  clearTimeout(safetyTimer);
  const current = session;
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    enqueue(async () => {
      if (session !== current || !session || !session.overlayMode) return;
      await commitSession();
    });
  }, SAFETY_COMMIT_MS);
}

function scheduleShow() {
  if (showTimer || !session || session.overlayVisible) return;
  const current = session;
  showTimer = setTimeout(() => {
    showTimer = null;
    enqueue(async () => {
      if (session !== current || !session.overlayMode) return;
      await revealOverlay();
    });
  }, HOLD_SHOW_MS);
}

async function revealOverlay() {
  if (!session) return;
  const current = session;
  const fetched = await metasFor(current.tabIds);
  if (session !== current) return;
  const metas = compactSession(fetched);
  if (!session) return;
  if (session.tabIds.length < 2) {
    await cancelSession();
    return;
  }
  session.overlayVisible = true;
  session.updatedAt = Date.now();
  await persist();
  const ok = await notify(session.originTabId, {
    type: "show",
    tabs: metas,
    index: session.index,
  });
  if (!ok && session) {
    session.overlayMode = false;
    session.overlayVisible = false;
    session.updatedAt = Date.now();
    await persist();
    clearTimeout(safetyTimer);
    safetyTimer = null;
    armIdle(IDLE_COMMIT_MS);
  }
}

async function commitSession() {
  const current = session;
  if (!current) return;
  clearTimers();
  session = null;
  await persist();
  await notify(current.originTabId, { type: "hide" });

  const targetId = current.tabIds[current.index];
  if (targetId == null || targetId === current.originTabId) return;

  suppressActivation = targetId;
  try {
    await chrome.tabs.update(targetId, { active: true });
  } catch {
    suppressActivation = null;
  }
}

async function cancelSession() {
  const current = session;
  if (!current) return;
  clearTimers();
  session = null;
  ctrlState.delete(current.originTabId);
  await persist();
  await notify(current.originTabId, { type: "hide" });
}

async function advance(direction) {
  if (!session || session.tabIds.length < 2) return;
  session.index = stepIndex(session.index, direction, session.tabIds.length);
  session.updatedAt = Date.now();
  await persist();

  if (!session.overlayMode) {
    armIdle(IDLE_COMMIT_MS);
    return;
  }

  armSafety();
  if (session.overlayVisible) {
    const ok = await notify(session.originTabId, {
      type: "highlight",
      index: session.index,
    });
    if (!ok) await revealOverlay();
  }
}

async function onCycle(direction, commandTab) {
  const tab = await activeTab(commandTab);
  if (!tab || tab.id == null || tab.windowId == null) return;

  if (session && session.windowId !== tab.windowId) await cancelSession();
  if (session && session.originTabId !== tab.id) await cancelSession();

  if (session) {
    await advance(direction);
    return;
  }

  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const tabIds = snapshotIds(tabs, tab.id);
  if (tabIds.length < 2) return;

  session = {
    windowId: tab.windowId,
    originTabId: tab.id,
    tabIds,
    index: direction > 0 ? 1 : tabIds.length - 1,
    overlayMode: true,
    overlayVisible: false,
    updatedAt: Date.now(),
  };
  await persist();
  const current = session;

  let probe = await probeTab(tab.id);
  if (session !== current) return;

  let kind = probe ? classifyCtrl(tab.id, probe) : "untracked";
  if (kind === "untracked") {
    await delay(CTRL_STATE_GRACE_MS);
    if (session !== current) return;
    if (!probe) probe = await probeTab(tab.id);
    if (session !== current) return;
    kind = probe ? classifyCtrl(tab.id, probe) : "untracked";
  }

  if (kind !== "held") {
    session.overlayMode = false;
    session.updatedAt = Date.now();
    await persist();
    if (kind === "released") await commitSession();
    else armIdle(IDLE_COMMIT_MS);
    return;
  }

  await notify(tab.id, { type: "arm" });
  if (session !== current) return;
  scheduleShow();
  armSafety();
}

async function onCtrlReleased(tabId) {
  if (!session || session.originTabId !== tabId || !session.overlayMode) return;
  await commitSession();
}

async function onTabRemoved(tabId) {
  ctrlState.delete(tabId);
  if (!session) return;
  if (tabId === session.originTabId) {
    await cancelSession();
    return;
  }

  const selectedId = session.tabIds[session.index];
  const idx = session.tabIds.indexOf(tabId);
  if (idx === -1) return;

  session.tabIds.splice(idx, 1);
  if (session.tabIds.length < 2) {
    await cancelSession();
    return;
  }

  const next = session.tabIds.indexOf(selectedId);
  session.index = next === -1 ? Math.min(idx, session.tabIds.length - 1) : next;
  session.updatedAt = Date.now();
  await persist();
  if (session.overlayVisible) await revealOverlay();
}

async function onActivated(info) {
  if (suppressActivation === info.tabId) {
    suppressActivation = null;
    return;
  }
  if (session && info.windowId === session.windowId && info.tabId !== session.originTabId) {
    await cancelSession();
  }
}

async function recoverSession() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  session = stored[SESSION_KEY] || null;
  if (!session) return;
  if (Date.now() - session.updatedAt > SESSION_MAX_AGE_MS) {
    const originTabId = session.originTabId;
    session = null;
    await persist();
    await notify(originTabId, { type: "hide" });
    return;
  }

  const current = session;
  const probe = await probeTab(session.originTabId);
  if (session !== current) return;

  const kind = probe ? classifyCtrl(session.originTabId, probe) : "untracked";
  if (kind !== "held") {
    if (kind === "released") await commitSession();
    else {
      session.overlayMode = false;
      session.overlayVisible = false;
      armIdle(IDLE_COMMIT_MS);
    }
    return;
  }

  await notify(session.originTabId, { type: "arm" });
  if (session !== current) return;
  if (session.overlayVisible) await revealOverlay();
  else scheduleShow();
  armSafety();
}

chrome.commands.onCommand.addListener((command, tab) => {
  const direction = command === "cycle-forward" ? 1 : command === "cycle-backward" ? -1 : 0;
  if (!direction) return;
  enqueue(() => onCycle(direction, tab));
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type || !sender.tab || sender.tab.id == null) return;
  const tabId = sender.tab.id;

  if (msg.type === "ctrl") {
    ctrlState.set(tabId, { down: msg.down === true, at: Date.now() });
    if (msg.down !== true) enqueue(() => onCtrlReleased(tabId));
    return;
  }

  if (msg.type === "cancel" || msg.type === "blur") {
    ctrlState.delete(tabId);
    enqueue(async () => {
      if (session && session.originTabId === tabId) await cancelSession();
    });
  }
});

chrome.tabs.onActivated.addListener((info) => {
  enqueue(() => onActivated(info));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => onTabRemoved(tabId));
});

chrome.windows.onRemoved.addListener((windowId) => {
  enqueue(async () => {
    if (session && session.windowId === windowId) await cancelSession();
  });
});

enqueue(() => recoverSession());
