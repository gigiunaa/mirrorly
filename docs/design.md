# Mirrorly — design and plan

Working name: **Mirrorly** (placeholder, set in `extension/_locales/*/messages.json` → `appName`).

## Status (2026-10-29)

- Phase 1 (browser extension) built: `extension/`. 9 automated end-to-end tests pass (`npm test`):
  all 4 setting combinations switched live mid-call, a page-derived self-view (like Meet's
  background blur), remote videos untouched, settings persist, camera settings/constraints/stop
  behave like the real camera. Store zip: `npm run package`.
- Verified by the user on real Google Meet in their Chrome: works well (2026-10-29).
  Zoom web client not yet checked by hand.
- Phase 2 and 3 not started; they need the decisions listed below.

## Intent

People look at themselves mirrored every day. In a video call they see a mirrored self-view, while everyone else sees them un-mirrored, and many people dislike that version of their face. They usually find out by accident, for example when someone shares a screen or a recording and they suddenly see the "other" face.

Mirrorly gives two independent, remembered controls:

1. **What others see:** normal (camera as-is) or mirrored.
2. **What I see of myself:** exactly what others see, or the mirror of that.

No OBS, no setup per call.

## Goals

- Google Meet in Chrome/Edge works out of the box (send mirrored + honest self-view).
- Zoom web client in Chrome/Edge works the same way.
- Zoom desktop app on Windows (phase 2, virtual camera).
- Settings change live, mid-call, and persist (`chrome.storage.sync`).
- Never break a call: on any internal error, fall back to the untouched camera.
- English and Georgian UI.

## Non-goals (for now)

- Beauty filters, backgrounds, framing, any other video effect.
- Teams / other apps (later; Teams and Zoom already have their own self-view mirror setting).
- macOS desktop app (needs Apple developer account + notarization).

## Anti-goals

- Adding visible latency or frozen video when the Meet tab is in the background.
- Breaking camera selection, resolution changes, or turning the camera off/on in Meet.
- Touching remote participants' videos or screen shares.

## Phase 1 — browser extension (Chrome / Edge, Manifest V3)

### How the outgoing flip works

- A `MAIN`-world content script at `document_start` wraps `MediaDevices.prototype.getUserMedia`.
- For each requested camera track it builds
  `MediaStreamTrackProcessor → TransformStream → MediaStreamTrackGenerator`.
  Each frame is drawn flipped into an `OffscreenCanvas` and re-emitted as a `VideoFrame`
  with the original timestamp. When "normal" is selected frames pass through untouched.
  This is stream-driven, not timer-driven, so it keeps running in background tabs
  (a `requestAnimationFrame` + `canvas.captureStream` approach would freeze).
- The returned track proxies `getSettings`, `getCapabilities`, `getConstraints`,
  `applyConstraints`, `label` and `stop` to the real camera track, so the page still sees
  the right device, can change resolution, and stopping it releases the camera.
- Fallback when the processor/generator API is missing: return the camera untouched.

### How the self-view works

- Self-view is shown by the page in a `<video>` with a CSS mirror. We find local camera videos by
  hooking the `srcObject` setter, and classify tracks: remote (seen via `RTCRtpReceiver.track` /
  `RTCTrackEvent.track`) and screen share (`getDisplayMedia`) are ignored; everything else showing
  video while our camera is live is a self-view.
- For each self-view we compute the effective horizontal flip from the computed `transform`
  and `scale` of the element and its ancestors (sign of the 2×2 determinant), then set the
  element's own CSS `scale` property (`!important`) so the final picture is either exactly the
  sent picture or its mirror. Using `scale` instead of `transform` keeps the page's own transforms.
- Re-checked on every `srcObject` change, every settings change, and every 500 ms.

### Settings bridge

`MAIN` world cannot read `chrome.storage`. An `ISOLATED`-world script reads
`chrome.storage.sync` and forwards values with `window.postMessage`; `MAIN` asks for them on
start (handshake works in either load order). `getUserMedia` waits up to 1 s for settings.

Defaults: others see **mirrored**, I see **what others see**.

### Sites

`https://meet.google.com/*`, `https://*.zoom.us/*`, `https://zoom.us/*` — all frames.

### UI

- Popup: two segmented choices with small illustrations, status line for the current tab,
  a note that changes apply live.
- Welcome page on install: what it does, reload/rejoin open calls, how to pin the icon.

### Testing

Playwright with the bundled Chromium, extension loaded unpacked, fake camera fed from an
asymmetric Y4M file (left white / right black). The test serves a fake page on the
`meet.google.com` origin that mirrors its self-view in CSS and loops the camera through two
`RTCPeerConnection`s to act as "the other person". It checks pixels of both the received video
and the on-screen self-view for all 4 setting combinations, live switching via the popup,
`getSettings().deviceId`, and that `stop()` releases the camera.

## Phase 2 — Windows virtual camera for Zoom desktop (needs your decision first)

- Windows 11 `MFCreateVirtualCamera` + a Media Foundation media source COM DLL (C++), plus a
  small tray app with the same two controls. Zoom desktop then picks "Mirrorly Camera".
- Self-view in Zoom desktop: Zoom's own "Mirror my video" setting.
- **Blocker:** Smart App Control blocks unsigned DLLs/EXEs, including ones built locally.
  Testing and selling both require a code-signing certificate (e.g. Azure Trusted Signing,
  ~$10/month, or an OV/EV certificate). Decision needed before phase 2 starts.

## Phase 3 — selling (decisions pending)

- Payment/licensing provider for the extension (e.g. ExtensionPay/Stripe, Lemon Squeezy, Paddle).
- Chrome Web Store + Edge Add-ons listings, store screenshots, privacy policy
  (the extension sends no data anywhere; all processing is local).
- Final name and brand.

## Default decisions (not yet confirmed)

- Browser extension first, Windows app second, macOS later.
- Working name "Mirrorly".
- Payment added after the extension works end-to-end.
- Defaults: others see mirrored, self-view matches what others see.
