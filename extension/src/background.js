importScripts('settings.js');

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const stored = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set(MirrorlySettings.normalize(stored));

  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});
