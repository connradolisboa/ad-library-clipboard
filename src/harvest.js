// src/harvest.js — Ad Library Clipper
// Card detection + pulling the pieces (body, CTA, link, advertiser, page id,
// creative) out of a single ad card. All Meta-specific patterns come from
// ALC.CONFIG so this stays tunable in one place.

(() => {
  "use strict";

  const ALC = (window.__ALC = window.__ALC || {});
  const { CONFIG, sleep } = ALC;

  // ===========================================================================
  // CARD DETECTION
  // ===========================================================================
  // An element "looks like a real ad card" if it contains BOTH a creative
  // (video or a large image) AND exactly one Library ID marker. We climb from
  // the marker until we hit the first ancestor that satisfies this — that works
  // for BOTH the grid view and the detail view, which nest differently.
  function looksLikeCard(el) {
    if (!el) return false;
    const text = el.innerText || "";
    if (!CONFIG.cardMarkerText.test(text)) return false;
    // A real card has exactly one Library ID; a grid wrapper holds many, so it
    // fails this test and we keep climbing (stopping below it).
    const markerCount = (text.match(/Library ID/gi) || []).length;
    if (markerCount > 1) return false;
    const min = CONFIG.minCreativeSize;
    const hasVideo = !!el.querySelector("video");
    const hasBigImg = [...el.querySelectorAll("img")].some(
      (img) => img.naturalWidth > min && img.naturalHeight > min
    );
    return hasVideo || hasBigImg;
  }

  function findCardRoot(fromEl) {
    let el = fromEl;
    // Climb up to a generous ceiling, returning the FIRST ancestor that looks
    // like a complete card. This adapts to whatever nesting Meta is using.
    for (let i = 0; i < 14 && el; i++) {
      if (looksLikeCard(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Find all ad cards by locating the "Library ID" markers and climbing to roots.
  function getAllCards() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return CONFIG.cardMarkerText.test(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );
    const roots = new Set();
    let n;
    while ((n = walker.nextNode())) {
      const root = findCardRoot(n.parentElement);
      if (root) roots.add(root);
    }

    // DEDUPE: if one detected card is an ancestor of another, keep only the
    // OUTERMOST one. This kills the "two buttons" bug.
    const list = [...roots];
    return list.filter((a) => !list.some((b) => b !== a && b.contains(a)));
  }

  // ===========================================================================
  // HARVESTING
  // ===========================================================================

  // Expand a folded "... See more" body if present, then read the full text.
  async function getBodyText(card) {
    const candidates = [...card.querySelectorAll('div[role="button"], span[role="button"], a')];
    const seeMore = candidates.find((c) =>
      CONFIG.seeMoreText.test((c.textContent || "").trim())
    );
    if (seeMore) {
      seeMore.click();
      await sleep(CONFIG.seeMoreDelayMs);
    }

    const blocks = [...card.querySelectorAll("div, span")]
      .map((el) => (el.innerText || "").trim())
      .filter(Boolean);

    // Primary heuristic: longest non-metadata block over the min length.
    const byLength = (a, b) => b.length - a.length;
    const primary = blocks
      .filter((t) => !CONFIG.bodyNoise.test(t) && t.length > CONFIG.bodyMinLength)
      .sort(byLength)[0];
    if (primary) return primary.trim();

    // Fallback: the single longest block of any kind beats returning "".
    const fallback = [...blocks].sort(byLength)[0];
    return (fallback || "").trim();
  }

  function getCTA(card) {
    const all = [...card.querySelectorAll('div[role="button"], a, span')]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    const lower = all.map((t) => t.toLowerCase());

    // Exact match first (most reliable).
    const exact = CONFIG.ctaLabels.find((label) =>
      lower.includes(label.toLowerCase())
    );
    if (exact) return exact;

    // Then a contains-match so minor label variations still resolve.
    return CONFIG.ctaLabels.find((label) =>
      lower.some((t) => t.includes(label.toLowerCase()))
    ) || "";
  }

  function getLink(card) {
    // The destination link is usually an <a> whose href leaves facebook
    // (Meta routes some through l.facebook.com — we unwrap that).
    const anchors = [...card.querySelectorAll("a[href]")];
    for (const a of anchors) {
      const href = a.href || "";
      if (href.includes("l.facebook.com/l.php")) {
        try {
          const real = new URL(href).searchParams.get("u");
          if (real) return decodeURIComponent(real);
        } catch (_) {}
      }
      if (
        href &&
        !href.includes("facebook.com/ads/library") &&
        !href.startsWith("https://www.facebook.com/")
      ) {
        return href;
      }
    }
    return "";
  }

  function getAdvertiser(card) {
    const a = card.querySelector('a[href*="facebook.com/"]');
    if (a && a.textContent.trim()) return a.textContent.trim();
    const strong = card.querySelector('span[style*="font-weight"], strong');
    return strong ? strong.textContent.trim() : "advertiser";
  }

  // Find the advertiser's numeric Page ID so we can open their full ad history.
  // Defensive, multi-strategy — see plan section D. Returns a string or null.
  function getPageId(card) {
    // 1) An anchor that already carries the id as a query param.
    for (const a of card.querySelectorAll("a[href]")) {
      try {
        const params = new URL(a.href).searchParams;
        const id = params.get("view_all_page_id") || params.get("page_id");
        if (id && /^\d+$/.test(id)) return id;
      } catch (_) {}
    }
    // 2) A profile link of the form facebook.com/profile.php?id=<digits>.
    for (const a of card.querySelectorAll('a[href*="profile.php"]')) {
      try {
        const id = new URL(a.href).searchParams.get("id");
        if (id && /^\d+$/.test(id)) return id;
      } catch (_) {}
    }
    // 3) Inline JSON Meta embeds in the markup, e.g. "page_id":"123456".
    const m = card.innerHTML.match(/"page_id"\s*:\s*"?(\d{6,})"?/);
    if (m) return m[1];

    return null;
  }

  // Returns { kind: 'video'|'image'|'none', url }.
  // For videos, Meta often only exposes the file URL once playback starts, so
  // we nudge it: play muted, wait briefly, re-read, then pause.
  async function getCreative(card) {
    const video = card.querySelector("video");
    if (video) {
      let url = readVideoSrc(video);
      if (!url) {
        try {
          video.muted = true;
          const playResult = video.play();
          if (playResult && typeof playResult.then === "function") {
            await playResult.catch(() => {});
          }
          await sleep(CONFIG.videoLoadDelayMs);
          url = readVideoSrc(video);
        } catch (_) {
          // Autoplay can be blocked; fall through to poster/empty handling.
        } finally {
          try { video.pause(); } catch (_) {}
        }
      }
      if (url) return { kind: "video", url };
      // No file URL yet — hand back the poster thumbnail if there is one.
      return { kind: "video", url: "", poster: video.poster || "" };
    }

    const min = CONFIG.minCreativeSize;
    const imgs = [...card.querySelectorAll("img")]
      .filter((img) => img.naturalWidth > min && img.naturalHeight > min)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    if (imgs[0]) return { kind: "image", url: imgs[0].src };
    return { kind: "none", url: "" };
  }

  function readVideoSrc(video) {
    const source = video.querySelector("source");
    return video.currentSrc || video.src || (source && source.src) || "";
  }

  Object.assign(ALC, {
    looksLikeCard,
    findCardRoot,
    getAllCards,
    getBodyText,
    getCTA,
    getLink,
    getAdvertiser,
    getPageId,
    getCreative
  });
})();
