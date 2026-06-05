# Changelog

All notable changes to this project are documented here.

## [1.2.0] — 2026-06-05

### Added
- **Metadata overlay** on each card — a compact, read-only panel of research
  signals: active duration ("Active 24 days"), page likes, CTA type
  (`SHOP_NOW`), destination domain, publisher platforms, and number of ad
  versions. Any field that can't be resolved is simply omitted.
- `getAdMeta` reads these from the page's own data only — the card DOM, embedded
  `<script>` JSON, and React fiber props (`getAdObject`). No network requests
  are made, so nothing extra is sent to Meta. Falls back to DOM-derived values
  (e.g. parsing "Started running on …" for the active duration) when the
  structured ad object isn't available.

## [1.1.1] — 2026-06-05

### Fixed
- **🗂 All ads** now works from the grid view without first opening an ad's
  detail view. `getPageId` previously only read the single card's DOM, where
  the numeric page ID isn't present in the grid, causing a "couldn't find the
  advertiser page ID" error. It now also resolves the ID from the card's
  Library ID by looking it up in the page's embedded JSON (`<script>` results)
  and in React fiber props (for ads loaded via infinite scroll).

## [1.1.0] — 2026-06-01

### Added
- **🗂 All ads** button on each card — opens that advertiser's full ad history
  (active + inactive) in a new tab, preserving the current `country` filter.
  Page ID is resolved via several fallback strategies (`getPageId`).
- Poster-thumbnail fallback for video ads: if Meta still hasn't exposed the
  `.mp4`, the ad's text plus its video thumbnail are copied.
- Accessibility: both injected buttons are real, keyboard-focusable `<button>`s
  with `aria-label` and a visible focus ring; toasts use `role="alert"` /
  `aria-live`.

### Changed
- Content script split into dependency-free modules loaded in order
  (`src/config.js`, `src/utils.js`, `src/harvest.js`, `src/clipboard.js`,
  `src/main.js`) — no bundler or build step. All Meta-specific selectors now
  live in `src/config.js`.
- Video capture now nudges the player (muted autoplay) to expose the `.mp4`
  before falling back to the "press play, then clip again" flow.
- The two clipboard writers were consolidated into a single `writeAdToClipboard`.
- More robust harvesting: CTA matching falls back from exact to contains; body
  extraction falls back to the longest block instead of returning empty; the
  body-noise filter and length threshold moved into `CONFIG`.

### Fixed
- Empty cards no longer copy a blank payload — they show a "Nothing to clip"
  error toast instead.
- Image bytes that are already PNG are passed through without a lossy canvas
  re-encode.

## [1.0.0] — 2026-05-28

### Added
- Floating **📎 Clip** button injected onto each ad card in the Meta Ad Library
  (both grid view and detail view).
- One-click copy of an ad's **Body → CTA → Link → Creative** to the clipboard,
  formatted so it pastes into Notion in that sequence.
- Image ads: body, CTA, link, and image copied together in a single paste.
  Embeds the actual image bytes when CORS allows, falls back to an `<img src>`
  reference otherwise.
- Video ads: body, CTA, and link copied to clipboard; the `.mp4` auto-downloads
  to `Downloads/ad-library/` for manual drag into Notion.
- Body text emitted as a single block (one `<div>` with `<br>` line breaks,
  blank lines collapsed) so it pastes as one Notion text block.
- Auto-expands folded ad bodies ("See more") before harvesting.
- Structure-based card detection that adapts to Meta's grid and detail layouts,
  with nested-match deduplication (one button per card).
- MutationObserver re-scan to catch ads loaded via infinite scroll.

### Known limitations
- The clipboard cannot carry a playable video; video ads require the
  download-and-drag flow. Full automatic video→Notion is planned for v2 (Notion API).
- Video URL capture requires the ad video to have been played at least once
  (Meta lazy-loads the `.mp4`).
- Whether the body stays a single block on paste ultimately depends on Notion's
  paste parser.
- Selectors depend on Meta's DOM and may need tuning when Meta updates the
  Ad Library (see the `CONFIG` block in `content.js`).
