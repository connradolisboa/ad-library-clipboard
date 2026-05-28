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
6. Each ad card gets a gold **📎 Clip** button in its top-right corner.

## How to use

- **Image ad:** Click 📎 Clip → paste (Cmd/Ctrl+V) into a Notion page. Body, CTA,
  link, and image land in sequence.
- **Video ad:** Press **play** on the video first (Meta only exposes the .mp4 once
  it starts playing), then click 📎 Clip. The text/link/CTA go to your clipboard
  and the video downloads to `Downloads/ad-library/`. Paste the text into Notion,
  then drag the downloaded mp4 in.

## Why video can't paste directly

The OS clipboard has no video flavor Notion understands. There's no way to put a
playable video on the clipboard and have Notion turn it into a video block — so
video is download + manual drag. (Full auto video→Notion needs the Notion API;
that's v2.)

## When it breaks (it will, eventually)

Meta changes the Ad Library markup regularly. Everything that depends on their
DOM is in the `CONFIG` block at the top of `content.js`, tagged `// [TUNE]`:

- `cardMarkerText` — the text used to detect an ad card ("Library ID")
- `cardClimbLevels` — how many parent levels up from that text the card root is
- `seeMoreText` — the "expand folded body" button label (multi-language)
- `ctaLabels` — the list of CTA button labels to match against

If buttons stop appearing, check `cardMarkerText` / `cardClimbLevels`.
If the body comes back empty or wrong, check `seeMoreText` and the `noise` regex
inside `getBodyText`.

## Known limitations (v1)

- Video URL grab depends on the video having been played (Meta lazy-loads it).
  Press play on the ad video before clicking Clip.
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
