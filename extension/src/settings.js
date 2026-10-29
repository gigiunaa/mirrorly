// Shared by the service worker, the isolated-world bridge, and the popup.
(() => {
  'use strict';

  const OUTGOING = Object.freeze(['mirrored', 'normal']);
  const SELF_VIEW = Object.freeze(['match', 'mirror']);

  // outgoing: what other people in the call see.
  // selfView: what I see of myself, relative to what they see.
  const DEFAULTS = Object.freeze({ outgoing: 'mirrored', selfView: 'match' });

  function normalize(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      outgoing: OUTGOING.includes(value.outgoing) ? value.outgoing : DEFAULTS.outgoing,
      selfView: SELF_VIEW.includes(value.selfView) ? value.selfView : DEFAULTS.selfView,
    };
  }

  globalThis.MirrorlySettings = Object.freeze({ DEFAULTS, OUTGOING, SELF_VIEW, normalize });
})();
