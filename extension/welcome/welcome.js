document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = chrome.i18n.getMessage('appName');
for (const el of document.querySelectorAll('[data-i18n]')) {
  el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
}
