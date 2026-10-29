// Isolated world: forwards settings from chrome.storage to inject.js in the page's world.
(() => {
  'use strict';

  const { DEFAULTS, normalize } = globalThis.MirrorlySettings;
  const FROM_PAGE = 'mirrorly:page';
  const FROM_BRIDGE = 'mirrorly:bridge';

  let current = null;

  function post() {
    if (!current) return;
    window.postMessage({ source: FROM_BRIDGE, type: 'settings', settings: current }, '*');
  }

  async function load() {
    try {
      current = normalize(await chrome.storage.sync.get(DEFAULTS));
    } catch {
      // Extension was updated or removed while this page stayed open; keep the last values.
      return;
    }
    post();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === FROM_PAGE && data.type === 'request-settings') post();
  });

  try {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === 'sync') load();
    });
    // Lets the popup tell "running here" apart from "tab was open before install".
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'mirrorly:ping' && window === window.top) sendResponse({ ok: true });
    });
  } catch {
    // Context invalidated; nothing to listen to.
  }

  load();
})();
