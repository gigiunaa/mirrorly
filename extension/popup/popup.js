(() => {
  'use strict';

  const { DEFAULTS, normalize } = globalThis.MirrorlySettings;
  const form = document.getElementById('form');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const selfMatchFace = document.getElementById('selfMatchFace');
  const selfMirrorFace = document.getElementById('selfMirrorFace');

  const SITES = [
    { name: 'Google Meet', test: (host) => host === 'meet.google.com' },
    { name: 'Zoom', test: (host) => host === 'zoom.us' || host.endsWith('.zoom.us') },
  ];

  function t(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions) || key;
  }

  function localize() {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  }

  function render(settings) {
    form.elements.outgoing.value = settings.outgoing;
    form.elements.selfView.value = settings.selfView;
    // The self-view pictures show the actual result, relative to what others see.
    const sent = settings.outgoing;
    const opposite = sent === 'mirrored' ? 'normal' : 'mirrored';
    selfMatchFace.dataset.orientation = sent;
    selfMirrorFace.dataset.orientation = opposite;
  }

  function readForm() {
    return normalize({
      outgoing: form.elements.outgoing.value,
      selfView: form.elements.selfView.value,
    });
  }

  form.addEventListener('change', async () => {
    const settings = readForm();
    render(settings);
    await chrome.storage.sync.set(settings);
  });

  async function showStatus() {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
      tab = null;
    }

    let site = null;
    try {
      const host = new URL(tab && tab.url ? tab.url : '').hostname;
      site = SITES.find((s) => s.test(host)) || null;
    } catch {
      site = null;
    }

    if (!site) {
      status.classList.remove('active');
      statusText.textContent = t('statusOtherSite');
      return;
    }

    let running = false;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'mirrorly:ping' });
      running = Boolean(reply && reply.ok);
    } catch {
      running = false;
    }

    status.classList.toggle('active', running);
    statusText.textContent = running ? t('statusActive', [site.name]) : t('statusReload', [site.name]);
  }

  localize();
  chrome.storage.sync.get(DEFAULTS).then((stored) => render(normalize(stored)));
  showStatus();
})();
