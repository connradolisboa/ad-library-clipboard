# Ad Library Clipper — v1

Copies a Meta Ad Library ad's **Body → CTA → Link → Creative** to your clipboard
as one paste into Notion. Image ads copy fully (including the image). Video ads
copy the text/link/CTA and auto-download the .mp4 to `Downloads/ad-library/`.

## Install (unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right) ON
3. Click **Load unpacked**
4. Select this folder (`ad-library-clipper`)
5. Go to the Meta Ad Library: https://www.facebook.com/ads/library/
6. Each ad card gets a gold **📎 Clip** button and a blue **🗂 All ads** button in
   its top-right corner.

## How to use

- **Image ad:** Click 📎 Clip → paste (Cmd/Ctrl+V) into a Notion page. Body, CTA,
  link, and image land in sequence.
- **Video ad:** Click 📎 Clip. The extension nudges the video into loading and, if
  it can grab the .mp4, copies the text/link/CTA and downloads the video to
  `Downloads/ad-library/`. If Meta still hasn't exposed the file, the text plus the
  video's **thumbnail** are copied — press **play** on the video, then Clip again to
  get the full mp4. Paste the text into Notion, then drag the downloaded mp4 in.
- **🗂 All ads:** Opens the Meta Ad Library filtered to that advertiser's **full ad
  history** (active + inactive) in a new tab. The current `country` filter is
  preserved.

## Why video can't paste directly

The OS clipboard has no video flavor Notion understands. There's no way to put a
playable video on the clipboard and have Notion turn it into a video block — so
video is download + manual drag. (Full auto video→Notion needs the Notion API;
that's v2.)

## How the code is organized

The content script is split into small, dependency-free files loaded in order by
the manifest (no bundler, no build step):

- `src/config.js` — the `CONFIG` block (every Meta-specific selector) + the
  "Open all Ads" URL builder.
- `src/utils.js` — `sleep`, `escapeHtml`, `slugify`, and the accessible toast.
- `src/harvest.js` — card detection and field extraction (body, CTA, link,
  advertiser, page id, creative).
- `src/clipboard.js` — HTML/plain assembly and the single clipboard writer.
- `src/main.js` — click handlers, button injection, and the scroll observer.

## When it breaks (it will, eventually)

Meta changes the Ad Library markup regularly. Everything that depends on their
DOM is in the `CONFIG` block in `src/config.js`, tagged `// [TUNE]`:

- `cardMarkerText` — the text used to detect an ad card ("Library ID")
- `seeMoreText` — the "expand folded body" button label (multi-language)
- `seeMoreDelayMs` / `videoLoadDelayMs` — how long to wait after expanding a body
  or nudging a video to load before re-reading the DOM
- `bodyNoise` / `bodyMinLength` — filter and length threshold for picking the body
- `ctaLabels` — the list of CTA button labels to match against
- `minCreativeSize` — minimum px size for an image to count as the creative

If buttons stop appearing, check `cardMarkerText`.
If the body comes back empty or wrong, check `seeMoreText` and `bodyNoise`.
If 🗂 All ads can't find a page, the page-ID heuristics live in `getPageId`
(`src/harvest.js`).

## Known limitations (v1)

- Video URL grab depends on the video having loaded. The extension tries to nudge
  it (muted autoplay), but if Meta still hasn't exposed the file you'll get the
  thumbnail — press play on the ad video, then click Clip again for the mp4.
- Image embed uses `fetch` with credentials; if Meta's CORS blocks the bytes,
  the paste falls back to an `<img src>` HTML tag (still renders in Notion, but
  references Meta's CDN rather than embedding the file).
- Whether the body stays a single block on paste ultimately depends on Notion's
  paste parser; the extension emits the strongest possible "one block" signal.
- One ad at a time. Batch/multi-select and "grab N from advertiser" are v2.

## Roadmap (v2)

- Notion API integration — push ads straight to a Notion page (no manual paste),
  including automatic video upload so video→Notion is fully hands-off.
- Batch / multi-select clipping.
- "Grab N ads from a specific advertiser" with auto-scroll harvesting.

## License

MIT — see [LICENSE](LICENSE).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
