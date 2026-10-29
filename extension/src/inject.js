// Runs in the page's own world on Meet / Zoom web, before any page script.
// 1. Wraps getUserMedia so the camera track sent to others can be mirrored, frame by frame.
// 2. Adjusts the page's self-view <video> so I see either exactly what others see, or its mirror.
// Any failure falls back to the untouched camera: a call must never break because of us.
(() => {
  'use strict';

  const INSTALLED = Symbol.for('mirrorly.installed');
  if (window[INSTALLED]) return;
  Object.defineProperty(window, INSTALLED, { value: true });

  if (!window.MediaDevices || !window.MediaStreamTrack || !window.HTMLMediaElement) return;

  const FROM_PAGE = 'mirrorly:page';
  const FROM_BRIDGE = 'mirrorly:bridge';
  const SETTINGS_WAIT_MS = 1000;
  const SWEEP_INTERVAL_MS = 500;
  const LOG_PREFIX = '[Mirrorly]';

  // ---------------------------------------------------------------- settings

  const settings = { outgoing: 'mirrored', selfView: 'match' };
  let markSettingsReady;
  const settingsReady = new Promise((resolve) => { markSettingsReady = resolve; });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== FROM_BRIDGE || data.type !== 'settings' || !data.settings) return;
    const next = data.settings;
    if (next.outgoing === 'mirrored' || next.outgoing === 'normal') settings.outgoing = next.outgoing;
    if (next.selfView === 'match' || next.selfView === 'mirror') settings.selfView = next.selfView;
    markSettingsReady();
    scheduleSweep();
  });
  window.postMessage({ source: FROM_PAGE, type: 'request-settings' }, '*');

  function waitForSettings() {
    return Promise.race([settingsReady, new Promise((resolve) => setTimeout(resolve, SETTINGS_WAIT_MS))]);
  }

  // ---------------------------------------------------------------- track bookkeeping

  const ourTracks = new WeakSet();     // tracks we return to the page, and their clones
  const remoteTracks = new WeakSet();  // tracks received from other people
  const displayTracks = new WeakSet(); // screen / tab / window shares
  const cameraRecords = new Set();     // live cameras we are processing

  function hookGetter(proto, prop, onValue) {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.get !== 'function') return;
    Object.defineProperty(proto, prop, {
      ...desc,
      get() {
        const value = desc.get.call(this);
        try { onValue(value); } catch { /* bookkeeping must never throw into the page */ }
        return value;
      },
    });
  }

  function markRemote(track) { if (track) remoteTracks.add(track); }
  function markRemoteStreams(streams) {
    if (streams) for (const stream of streams) for (const track of stream.getTracks()) remoteTracks.add(track);
  }

  hookGetter(window.RTCRtpReceiver && RTCRtpReceiver.prototype, 'track', markRemote);
  hookGetter(window.RTCTrackEvent && RTCTrackEvent.prototype, 'track', markRemote);
  hookGetter(window.RTCTrackEvent && RTCTrackEvent.prototype, 'streams', markRemoteStreams);

  // Mark remote tracks even when the page only reads event.streams later.
  if (typeof window.RTCPeerConnection === 'function') {
    const NativePeerConnection = window.RTCPeerConnection;
    const PeerConnection = new Proxy(NativePeerConnection, {
      construct(target, args, newTarget) {
        const pc = Reflect.construct(target, args, newTarget);
        try {
          pc.addEventListener('track', (event) => {
            markRemote(event.track);
            markRemoteStreams(event.streams);
          });
        } catch { /* ignore */ }
        return pc;
      },
    });
    window.RTCPeerConnection = PeerConnection;
    if (window.webkitRTCPeerConnection === NativePeerConnection) window.webkitRTCPeerConnection = PeerConnection;
  }

  const nativeClone = MediaStreamTrack.prototype.clone;
  defineMethod(MediaStreamTrack.prototype, 'clone', function clone() {
    const copy = nativeClone.call(this);
    try {
      if (remoteTracks.has(this)) remoteTracks.add(copy);
      if (displayTracks.has(this)) displayTracks.add(copy);
      const record = recordOf.get(this);
      if (record) attachToCamera(copy, record);
    } catch { /* ignore */ }
    return copy;
  });

  if (typeof MediaDevices.prototype.getDisplayMedia === 'function') {
    const nativeGetDisplayMedia = MediaDevices.prototype.getDisplayMedia;
    defineMethod(MediaDevices.prototype, 'getDisplayMedia', async function getDisplayMedia(...args) {
      const stream = await nativeGetDisplayMedia.apply(this, args);
      for (const track of stream.getTracks()) displayTracks.add(track);
      return stream;
    });
  }

  function defineMethod(target, name, fn) {
    Object.defineProperty(target, name, { value: fn, writable: true, configurable: true, enumerable: false });
  }

  // ---------------------------------------------------------------- outgoing mirror

  const canProcess =
    typeof window.MediaStreamTrackProcessor === 'function' &&
    typeof window.MediaStreamTrackGenerator === 'function' &&
    typeof window.VideoFrame === 'function' &&
    typeof window.OffscreenCanvas === 'function';

  // One record per real camera track; shared by the track we hand out and all its clones.
  const recordOf = new WeakMap();

  function processCamera(source) {
    const processor = new MediaStreamTrackProcessor({ track: source });
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    let canvas = null;
    let ctx = null;

    const mirror = new TransformStream({
      transform(frame, controller) {
        if (settings.outgoing !== 'mirrored') {
          controller.enqueue(frame);
          return;
        }
        let flipped;
        try {
          const width = frame.displayWidth;
          const height = frame.displayHeight;
          if (!canvas || canvas.width !== width || canvas.height !== height) {
            canvas = new OffscreenCanvas(width, height);
            ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
          }
          ctx.setTransform(-1, 0, 0, 1, width, 0);
          ctx.drawImage(frame, 0, 0, width, height);
          const init = { timestamp: frame.timestamp };
          if (frame.duration != null) init.duration = frame.duration;
          flipped = new VideoFrame(canvas, init);
        } catch (error) {
          console.warn(LOG_PREFIX, 'frame passed through unmirrored', error);
          controller.enqueue(frame);
          return;
        }
        frame.close();
        controller.enqueue(flipped);
      },
    });

    const record = { source, refs: 0 };
    cameraRecords.add(record);
    source.addEventListener('ended', () => cameraRecords.delete(record));

    processor.readable
      .pipeThrough(mirror)
      .pipeTo(generator.writable)
      .catch(() => { /* the page stopped the track, or the camera went away */ });

    attachToCamera(generator, record);
    return generator;
  }

  // Makes `track` behave like the real camera: same settings, constraints, label,
  // and stopping the last copy releases the camera.
  function attachToCamera(track, record) {
    const { source } = record;
    record.refs += 1;
    recordOf.set(track, record);
    ourTracks.add(track);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      record.refs -= 1;
      if (record.refs <= 0) {
        cameraRecords.delete(record);
        source.stop();
      }
    };

    const nativeStop = MediaStreamTrack.prototype.stop;
    defineMethod(track, 'stop', function stop() {
      nativeStop.call(this);
      release();
    });
    track.addEventListener('ended', release);

    defineMethod(track, 'getSettings', function getSettings() { return source.getSettings(); });
    defineMethod(track, 'getConstraints', function getConstraints() { return source.getConstraints(); });
    defineMethod(track, 'applyConstraints', function applyConstraints(constraints) {
      return source.applyConstraints(constraints);
    });
    if (typeof source.getCapabilities === 'function') {
      defineMethod(track, 'getCapabilities', function getCapabilities() { return source.getCapabilities(); });
    }
    Object.defineProperty(track, 'label', { get: () => source.label, configurable: true });
  }

  function hasLiveCamera() {
    for (const record of cameraRecords) if (record.source.readyState === 'live') return true;
    return false;
  }

  const nativeGetUserMedia = MediaDevices.prototype.getUserMedia;
  defineMethod(MediaDevices.prototype, 'getUserMedia', async function getUserMedia(...args) {
    const stream = await nativeGetUserMedia.apply(this, args);
    const constraints = args[0];
    if (!canProcess || !constraints || !constraints.video) return stream;

    await waitForSettings();
    for (const source of stream.getVideoTracks()) {
      let replacement;
      try {
        replacement = processCamera(source);
      } catch (error) {
        console.warn(LOG_PREFIX, 'camera left untouched', error);
        continue;
      }
      stream.removeTrack(source);
      stream.addTrack(replacement);
    }
    return stream;
  });

  // ---------------------------------------------------------------- self-view

  const watchedVideos = new Set();
  const originalScale = new WeakMap(); // video -> { value, priority } before we touched it

  const srcObjectDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (srcObjectDesc && srcObjectDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      ...srcObjectDesc,
      set(value) {
        srcObjectDesc.set.call(this, value);
        if (this instanceof HTMLVideoElement) {
          watchedVideos.add(this);
          scheduleSweep();
        }
      },
    });
  }

  // Sign of the horizontal flip a CSS transform matrix applies: -1 means mirrored.
  function matrixSign(transform) {
    if (!transform || transform === 'none') return 1;
    const match = /^matrix(3d)?\(([^)]*)\)$/.exec(transform);
    if (!match) return 1;
    const v = match[2].split(',').map(Number);
    const det = match[1] ? v[0] * v[5] - v[1] * v[4] : v[0] * v[3] - v[1] * v[2];
    return det < 0 ? -1 : 1;
  }

  function scaleSign(scale) {
    if (!scale || scale === 'none') return 1;
    const parts = scale.trim().split(/\s+/).map(Number);
    const sx = parts[0];
    const sy = parts.length > 1 ? parts[1] : parts[0];
    return sx * sy < 0 ? -1 : 1;
  }

  // `rotate: y 180deg` mirrors horizontally, `rotate: x 180deg` vertically.
  function rotateSign(rotate) {
    if (!rotate || rotate === 'none') return 1;
    const match = /^(x|y)\s+(-?[\d.]+)(deg|rad|turn|grad)$/.exec(rotate.trim());
    if (!match) return 1;
    const amount = Number(match[2]);
    const radians = { deg: amount * Math.PI / 180, rad: amount, turn: amount * 2 * Math.PI, grad: amount * Math.PI / 200 }[match[3]];
    return Math.cos(radians) < 0 ? -1 : 1;
  }

  function parentOf(node) {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode && node.getRootNode();
    return root && root.host ? root.host : null;
  }

  // How the page itself flips this video, ignoring our own `scale` on it.
  function pageFlipSign(video) {
    let sign = 1;
    for (let node = video; node; node = parentOf(node)) {
      const style = getComputedStyle(node);
      sign *= matrixSign(style.transform) * rotateSign(style.rotate);
      if (node !== video || !originalScale.has(video)) sign *= scaleSign(style.scale);
    }
    return sign;
  }

  function liveVideoTracks(video) {
    const stream = video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== 'function') return [];
    return stream.getVideoTracks().filter((track) => track.readyState === 'live');
  }

  function isSelfView(tracks, pageSign) {
    for (const track of tracks) {
      if (ourTracks.has(track)) return true;
      // A track the page derived from our camera (e.g. Meet's background blur).
      // Only trusted when the page itself mirrors it, which is how call apps mark a self-view.
      if (pageSign === -1 && hasLiveCamera() && !remoteTracks.has(track) && !displayTracks.has(track)) return true;
    }
    return false;
  }

  function setOwnScale(video, mirrored) {
    if (mirrored) {
      if (!originalScale.has(video)) {
        originalScale.set(video, {
          value: video.style.getPropertyValue('scale'),
          priority: video.style.getPropertyPriority('scale'),
        });
      }
      if (video.style.getPropertyValue('scale') !== '-1 1' || video.style.getPropertyPriority('scale') !== 'important') {
        video.style.setProperty('scale', '-1 1', 'important');
      }
    } else {
      restoreScale(video);
    }
  }

  function restoreScale(video) {
    const original = originalScale.get(video);
    if (!original) return;
    originalScale.delete(video);
    if (original.value) video.style.setProperty('scale', original.value, original.priority);
    else video.style.removeProperty('scale');
  }

  function sweep() {
    for (const video of watchedVideos) {
      try {
        const tracks = liveVideoTracks(video);
        if (!tracks.length) {
          restoreScale(video);
          if (!video.srcObject) watchedVideos.delete(video);
          continue;
        }
        if (!video.isConnected) continue;
        const pageSign = pageFlipSign(video);
        if (!isSelfView(tracks, pageSign)) {
          restoreScale(video);
          continue;
        }
        // What the page shows is the sent picture flipped by pageSign; we add our own flip on top.
        const wanted = settings.selfView === 'mirror' ? -1 : 1;
        setOwnScale(video, wanted * pageSign === -1);
      } catch (error) {
        console.warn(LOG_PREFIX, 'self-view check failed', error);
      }
    }
  }

  let sweepQueued = false;
  function scheduleSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    queueMicrotask(() => {
      sweepQueued = false;
      sweep();
    });
    // The page often sets its mirror class right after attaching the stream.
    requestAnimationFrame(() => sweep());
  }

  setInterval(() => {
    if (watchedVideos.size) sweep();
  }, SWEEP_INTERVAL_MS);
})();
