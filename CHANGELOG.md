# Changelog

All notable changes to this project are documented here.

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
