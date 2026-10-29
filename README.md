# Mirrorly

Look in video calls the way you see yourself in the mirror.

In Google Meet you see yourself mirrored, but everyone else sees you un-mirrored, and many people
dislike that version of their face. Mirrorly is a Chrome / Edge extension with two independent,
remembered controls:

1. **What others see:** normal, or mirrored (the way you see yourself in a mirror).
2. **What I see of myself:** exactly what others see, or mirrored.

Changes apply instantly, even during a call. Everything runs on your computer: no video and no
data is sent anywhere.

Works in **Google Meet** and the **Zoom web client** (in Chrome or Edge).
The Zoom desktop app is not supported yet.

[ქართულად](README.ka.md)

## Install

1. On this page, click the green **Code** button, then **Download ZIP**.
2. Unzip the downloaded file.
3. In Chrome, type `chrome://extensions` in the address bar and press Enter.
   (In Edge: `edge://extensions`.)
4. Turn on **Developer mode** (top right in Chrome, left side in Edge).
5. Click **Load unpacked** and select the `extension` folder inside the unzipped folder.
6. Click the puzzle icon in the toolbar and pin **Mirrorly** so it is always visible.

## Use

1. Open Google Meet and join or start a call.
   If Meet was already open before installing, reload the tab.
2. Click the Mirrorly icon and choose what others see and what you see of yourself.
3. To check what others see, join the same call from your phone.

## Development

Requires Node.js 18+.

```
npm install
npm test            # end-to-end tests in Chromium with a fake camera
npm run icons       # re-render the icons
npm run package     # dist/mirrorly-<version>.zip for the Chrome Web Store
```

Design notes: [docs/design.md](docs/design.md).

## License

MIT, see [LICENSE](LICENSE).
