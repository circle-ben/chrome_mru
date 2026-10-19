# MRU Tab Switcher

A Chrome extension that cycles tabs by most recently used order instead of left-to-right tab-strip order.

Hold Control and press Tab to move through the tabs you used most recently. Release Control to switch. Shift reverses direction. Escape cancels. A name strip appears while Control is held.

Given tabs visited as Tab1, then Tab2, then Tab3:

- Tap Control+Tab on Tab3 to land on Tab2.
- Tap it again to land back on Tab3.
- Hold Control and press Tab twice to land on Tab1 when you release.

The order is frozen when the gesture starts, so a second separate tap toggles the last two tabs. The list is per window and comes from Chrome’s `tab.lastAccessed`.

On `chrome://` pages and in the address bar, Chrome cannot show the strip. The same frozen list still applies, and the switch happens shortly after the last Tab.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.

## Bind Control+Tab

Chrome rejects Control+Tab on the shortcuts page, so the binding is a one-time step. Open the extension’s toolbar popup, copy the snippet, then on `chrome://extensions` open DevTools and paste it into the console.

In that console, `Ctrl` is the Control key:

```js
chrome.developerPrivate.updateExtensionCommand({
  extensionId: "<extension id from the popup>",
  commandName: "cycle-forward",
  keybinding: "Ctrl+Tab"
});
chrome.developerPrivate.updateExtensionCommand({
  extensionId: "<extension id from the popup>",
  commandName: "cycle-backward",
  keybinding: "Ctrl+Shift+Tab"
});
```

The popup shows the shortcuts as bound after this. Chrome stores the binding in your profile, so you do not need to paste it again on each launch. Paste it again only if the shortcuts disappear, for example after removing the extension or loading it from a different folder.

Command+Tab stays the macOS app switcher.
