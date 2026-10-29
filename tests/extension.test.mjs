// End-to-end: real Chromium, the unpacked extension, a fake camera whose left half is white
// and right half black, and a fake call page on the meet.google.com origin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extensionDir = path.join(root, 'extension');
const CALL_URL = 'https://meet.google.com/mirrorly-test';

let context;
let extensionId;
let tmpDir;

function writeFakeCamera(file) {
  const width = 640;
  const height = 480;
  const frames = 10;
  const y = Buffer.alloc(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) y[row * width + col] = col < width / 2 ? 235 : 16;
  }
  const uv = Buffer.alloc((width / 2) * (height / 2), 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < frames; i++) parts.push(Buffer.from('FRAME\n'), y, uv, uv);
  fs.writeFileSync(file, Buffer.concat(parts));
}

const CALL_PAGE = `<!doctype html>
<html><body style="margin:0;background:#888">
  <!-- Like Meet: the self-view is mirrored with CSS. -->
  <video id="self" autoplay muted playsinline style="display:block;width:160px;height:120px;transform:scaleX(-1)"></video>
  <!-- What the other person receives. -->
  <video id="remote" autoplay muted playsinline style="display:block;width:160px;height:120px"></video>
  <!-- A remote video inside a mirrored container must never be touched. -->
  <div style="transform:scaleX(-1)"><video id="remoteMirrored" autoplay muted playsinline style="display:block;width:160px;height:120px"></video></div>
  <!-- A self-view the page derived from the camera itself (like a background-blur pipeline). -->
  <video id="derived" autoplay muted playsinline style="display:block;width:160px;height:120px;transform:scaleX(-1)"></video>
  <video id="hidden" autoplay muted playsinline style="display:none"></video>
<script>
window.startCall = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
  window.localStream = stream;
  document.getElementById('self').srcObject = stream;

  const pc1 = new RTCPeerConnection();
  const pc2 = new RTCPeerConnection();
  pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
  pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
  pc2.ontrack = (e) => {
    document.getElementById('remote').srcObject = e.streams[0];
    document.getElementById('remoteMirrored').srcObject = e.streams[0];
  };
  for (const track of stream.getTracks()) pc1.addTrack(track, stream);
  await pc1.setLocalDescription(await pc1.createOffer());
  await pc2.setRemoteDescription(pc1.localDescription);
  await pc2.setLocalDescription(await pc2.createAnswer());
  await pc1.setRemoteDescription(pc2.localDescription);
  window.pcs = [pc1, pc2];

  // Derived self-view: copy every camera frame through a canvas, as effect pipelines do.
  const processor = new MediaStreamTrackProcessor({ track: stream.getVideoTracks()[0] });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const canvas = new OffscreenCanvas(640, 480);
  const ctx = canvas.getContext('2d');
  processor.readable.pipeThrough(new TransformStream({
    transform(frame, controller) {
      ctx.drawImage(frame, 0, 0, 640, 480);
      controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }));
      frame.close();
    },
  })).pipeTo(generator.writable).catch(() => {});
  document.getElementById('derived').srcObject = new MediaStream([generator]);
};
</script></body></html>`;

async function openCall() {
  const page = await context.newPage();
  await page.route(CALL_URL, (route) => route.fulfill({ contentType: 'text/html', body: CALL_PAGE }));
  await page.goto(CALL_URL);
  await page.evaluate(() => window.startCall());
  for (const id of ['self', 'remote', 'remoteMirrored', 'derived']) {
    await page.waitForFunction((el) => document.getElementById(el).videoWidth > 0, id, { timeout: 15000 });
  }
  return page;
}

// true when the left side of what is on screen is bright.
async function leftIsBright(page, id) {
  const png = PNG.sync.read(await page.locator(`#${id}`).screenshot());
  const luminance = (x) => {
    const y = Math.floor(png.height / 2);
    const i = (y * png.width + x) * 4;
    return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
  };
  const left = luminance(Math.floor(png.width * 0.2));
  const right = luminance(Math.floor(png.width * 0.8));
  assert.ok(Math.abs(left - right) > 100, `${id}: expected a clear left/right split, got ${left} vs ${right}`);
  return left > right;
}

async function expectLeftBright(page, id, expected) {
  const deadline = Date.now() + 8000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await leftIsBright(page, id);
      if (last === expected) return;
    } catch (error) {
      last = error.message;
    }
    await page.waitForTimeout(150);
  }
  assert.fail(`${id}: expected left side ${expected ? 'bright' : 'dark'}, last result: ${last}`);
}

async function chooseSettings(outgoing, selfView) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.locator(`input[name=outgoing][value=${outgoing}]`).locator('xpath=..').click();
  await popup.locator(`input[name=selfView][value=${selfView}]`).locator('xpath=..').click();
  await popup.waitForFunction(
    async ([o, s]) => {
      const v = await chrome.storage.sync.get(['outgoing', 'selfView']);
      return v.outgoing === o && v.selfView === s;
    },
    [outgoing, selfView],
  );
  await popup.close();
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorly-'));
  const camera = path.join(tmpDir, 'camera.y4m');
  writeFakeCamera(camera);
  context = await chromium.launchPersistentContext(path.join(tmpDir, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${camera}`,
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});

after(async () => {
  await context?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('raw camera: left half is white', async () => {
  // Sanity check of the fake camera itself, on a page the extension does not run on.
  const page = await context.newPage();
  await page.route('https://example.com/raw', (route) => route.fulfill({ contentType: 'text/html', body: CALL_PAGE }));
  await page.goto('https://example.com/raw');
  await page.evaluate(() => window.startCall());
  await page.waitForFunction(() => document.getElementById('remote').videoWidth > 0);
  await expectLeftBright(page, 'remote', true);
  await expectLeftBright(page, 'self', false); // the page's own CSS mirror
  await page.close();
});

test('defaults: others see mirrored, I see what they see', async () => {
  const page = await openCall();
  await expectLeftBright(page, 'remote', false);
  await expectLeftBright(page, 'self', false);
  await expectLeftBright(page, 'derived', false);
  await page.close();
});

for (const [outgoing, selfView, remoteLeftBright, selfLeftBright] of [
  ['mirrored', 'match', false, false],
  ['mirrored', 'mirror', false, true],
  ['normal', 'match', true, true],
  ['normal', 'mirror', true, false],
]) {
  test(`others: ${outgoing}, self-view: ${selfView} (switched live during the call)`, async () => {
    const page = await openCall();
    await chooseSettings(outgoing, selfView);
    await expectLeftBright(page, 'remote', remoteLeftBright);
    await expectLeftBright(page, 'self', selfLeftBright);
    await expectLeftBright(page, 'derived', selfLeftBright);
    // Remote videos are never touched, even inside a mirrored container.
    assert.equal(await page.locator('#remote').evaluate((el) => el.style.scale), '');
    assert.equal(await page.locator('#remoteMirrored').evaluate((el) => el.style.scale), '');
    await page.close();
  });
}

test('settings survive a reload', async () => {
  await chooseSettings('normal', 'mirror');
  const page = await openCall();
  await expectLeftBright(page, 'remote', true);
  await expectLeftBright(page, 'self', false);
  await page.close();
  await chooseSettings('mirrored', 'match');
});

test('the camera track still behaves like the real camera', async () => {
  const page = await openCall();
  const info = await page.evaluate(async () => {
    const track = window.localStream.getVideoTracks()[0];
    const before = track.getSettings();
    await track.applyConstraints({ width: 320, height: 240 });
    await new Promise((r) => setTimeout(r, 800));
    const after = track.getSettings();
    const clone = track.clone();
    const cloneSettings = clone.getSettings();
    clone.stop();
    const stillLiveAfterCloneStop = track.readyState === 'live';
    track.stop();
    return {
      deviceId: before.deviceId,
      label: track.label,
      width: after.width,
      cloneDeviceId: cloneSettings.deviceId,
      stillLiveAfterCloneStop,
      endedAfterStop: track.readyState === 'ended',
    };
  });
  assert.ok(info.deviceId, 'deviceId is reported');
  assert.ok(info.label, 'label is reported');
  assert.equal(info.width, 320, 'applyConstraints reaches the real camera');
  assert.equal(info.cloneDeviceId, info.deviceId);
  assert.ok(info.stillLiveAfterCloneStop, 'stopping a clone keeps the original running');
  assert.ok(info.endedAfterStop);

  // The camera is released: a new call can start right away.
  await page.evaluate(() => window.startCall());
  await page.waitForFunction(() => document.getElementById('remote').videoWidth > 0);
  await page.close();
});

test('popup reflects the saved choices and its pictures follow them', async () => {
  await chooseSettings('normal', 'mirror');
  const popup = await context.newPage();
  const errors = [];
  popup.on('pageerror', (error) => errors.push(error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => document.querySelector('input[name=outgoing]:checked')?.value === 'normal');
  assert.equal(await popup.locator('input[name=selfView]:checked').getAttribute('value'), 'mirror');
  assert.equal(await popup.locator('#selfMatchFace').getAttribute('data-orientation'), 'normal');
  assert.equal(await popup.locator('#selfMirrorFace').getAttribute('data-orientation'), 'mirrored');
  // Opened as a tab, the active tab is the popup itself: not a call site.
  const message = await popup.evaluate(() => chrome.i18n.getMessage('statusOtherSite'));
  assert.equal(await popup.locator('#statusText').textContent(), message);
  assert.deepEqual(errors, []);
  await popup.close();
  await chooseSettings('mirrored', 'match');
});
