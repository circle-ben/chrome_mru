(() => {
  if (window.__mruTabSwitcher) return;
  if (!chrome?.runtime?.onMessage) return;
  window.__mruTabSwitcher = true;

  let isTop = true;
  try {
    isTop = window.top === window;
  } catch {
    isTop = false;
  }
  let ctrlDown = false;
  let lastCtrlAt = 0;
  let gesture = false;
  let host = null;
  let overlayEl = null;

  const CSS = `
    :host { all: initial; }
    .panel {
      position: fixed;
      left: 50%;
      top: 46%;
      transform: translate(-50%, -50%) scale(0.98);
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: max-content;
      max-width: min(920px, calc(100vw - 48px));
      padding: 16px 16px 12px;
      box-sizing: border-box;
      background: rgba(22, 22, 26, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(28px) saturate(1.4);
      -webkit-backdrop-filter: blur(28px) saturate(1.4);
      color: rgba(255, 255, 255, 0.96);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      opacity: 0;
      transition: opacity 120ms ease, transform 120ms ease;
      pointer-events: none;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    .panel.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    .row {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      max-width: 100%;
      scrollbar-width: none;
    }
    .row::-webkit-scrollbar { display: none; }
    .card {
      flex: 0 0 116px;
      width: 116px;
      min-height: 108px;
      padding: 12px 10px 10px;
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid transparent;
      background: rgba(255, 255, 255, 0.04);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .card.current { opacity: 0.55; }
    .card.highlighted {
      opacity: 1;
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.42);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .icon img {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }
    .letter {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0;
      color: rgba(255, 255, 255, 0.92);
    }
    .title {
      width: 100%;
      font-size: 12px;
      font-weight: 550;
      line-height: 1.3;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      font-size: 11px;
      line-height: 1.3;
      text-align: center;
      color: rgba(255, 255, 255, 0.62);
    }
  `;

  function post(message) {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  function letterFor(title) {
    const ch = (title || "").trim().charAt(0).toUpperCase();
    return ch || "?";
  }

  function hide() {
    gesture = false;
    if (host) host.remove();
    host = null;
    overlayEl = null;
  }

  function paint(tabs, index) {
    if (!overlayEl) return;
    const row = overlayEl.querySelector(".row");
    row.textContent = "";
    tabs.forEach((tab, i) => {
      const card = document.createElement("div");
      card.className = "card";
      if (i === index) card.classList.add("highlighted");
      else if (i === 0) card.classList.add("current");

      const icon = document.createElement("div");
      icon.className = "icon";
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = letterFor(tab.title);
      if (tab.favIconUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.src = tab.favIconUrl;
        img.onerror = () => {
          img.remove();
          icon.appendChild(letter);
        };
        icon.appendChild(img);
      } else {
        icon.appendChild(letter);
      }
      card.appendChild(icon);

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = tab.title || "Untitled";
      card.appendChild(title);
      row.appendChild(card);
    });

    const selected = row.querySelector(".card.highlighted");
    selected?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function show(tabs, index) {
    gesture = true;
    if (!host) {
      host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = CSS;
      shadow.appendChild(style);

      overlayEl = document.createElement("div");
      overlayEl.className = "panel";
      const row = document.createElement("div");
      row.className = "row";
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Release Control to switch  ·  Esc cancels";
      overlayEl.appendChild(row);
      overlayEl.appendChild(hint);
      shadow.appendChild(overlayEl);

      const parent = document.documentElement || document.body;
      if (!parent) return;
      parent.appendChild(host);
      requestAnimationFrame(() => {
        if (overlayEl) overlayEl.classList.add("visible");
      });
    }
    paint(tabs, index);
  }

  function highlight(index) {
    if (!overlayEl) return;
    const cards = overlayEl.querySelectorAll(".card");
    cards.forEach((card, i) => {
      card.classList.toggle("highlighted", i === index);
      card.classList.toggle("current", i === 0 && i !== index);
    });
    overlayEl.querySelector(".card.highlighted")?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Control" && !event.repeat) {
      ctrlDown = true;
      lastCtrlAt = Date.now();
      post({ type: "ctrl", down: true });
    }
    if (event.key === "Escape" && (gesture || ctrlDown)) {
      if (isTop && gesture) {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
      post({ type: "cancel" });
    }
  }, true);

  window.addEventListener("keyup", (event) => {
    if (event.key !== "Control") return;
    ctrlDown = false;
    lastCtrlAt = Date.now();
    post({ type: "ctrl", down: false });
  }, true);

  if (isTop) {
    window.addEventListener("blur", () => {
      ctrlDown = false;
      if (!gesture && !host) return;
      hide();
      post({ type: "blur" });
    }, true);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "probe") {
      sendResponse({ ok: true, ctrlDown, lastCtrlAt });
      return;
    }
    if (!isTop) return;

    if (msg.type === "arm") gesture = true;
    else if (msg.type === "show") show(msg.tabs || [], msg.index || 0);
    else if (msg.type === "highlight") highlight(msg.index || 0);
    else if (msg.type === "hide") hide();
    sendResponse({ ok: true });
  });
})();
