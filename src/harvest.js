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

  // The card's own Library ID (a.k.a. ad_archive_id), e.g. 982763230901214.
  // This is visible in the grid view, so we can use it to look the advertiser's
  // page id up from the page's data even before any detail view is opened.
  function getLibraryId(card) {
    const text = card.innerText || card.textContent || "";
    const m = text.match(/Library ID[:\s]*(\d{5,})/i);
    return m ? m[1] : null;
  }

  // Within a JSON-ish blob, return the page_id that sits CLOSEST to this ad's
  // id. Each ad object keeps its ad_archive_id and page_id next to each other,
  // so "nearest" reliably resolves to the right advertiser even when the blob
  // holds many ads.
  function pageIdNearAdId(text, adId) {
    const idIdx = text.indexOf(adId);
    if (idIdx === -1) return null;
    const pageRe = /"(?:page_id|pageID)"\s*:\s*"?(\d{5,})"?/g;
    let best = null;
    let bestDist = Infinity;
    let m;
    while ((m = pageRe.exec(text))) {
      const dist = Math.abs(m.index - idIdx);
      if (dist < bestDist) {
        bestDist = dist;
        best = m[1];
      }
    }
    return best;
  }

  // The Ad Library ships each result as JSON inside <script> tags. Find the
  // page_id paired with THIS ad's Library ID.
  function pageIdFromEmbeddedJson(adId) {
    for (const s of document.scripts) {
      const txt = s.textContent;
      if (txt && txt.length < 5e6 && txt.indexOf(adId) !== -1) {
        const hit = pageIdNearAdId(txt, adId);
        if (hit) return hit;
      }
    }
    return null;
  }

  function reactFiber(el) {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    return key ? el[key] : null;
  }

  // Bounded DFS over a props/state object looking for a page_id (any casing).
  function deepFindPageId(obj, seen, budget) {
    if (!obj || typeof obj !== "object" || budget.n <= 0) return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    budget.n--;
    for (const key of Object.keys(obj)) {
      if (/^page_?id$/i.test(key) && /^\d{5,}$/.test(String(obj[key]))) {
        return String(obj[key]);
      }
    }
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === "object") {
        const hit = deepFindPageId(v, seen, budget);
        if (hit) return hit;
      }
      if (budget.n <= 0) break;
    }
    return null;
  }

  // Ads loaded by infinite scroll aren't in <script> tags, but React still
  // keeps their data in component props/state. Climb the fiber tree from the
  // card and dig for a page_id.
  function pageIdFromFiber(card) {
    let fiber = reactFiber(card);
    for (let i = 0; i < 40 && fiber; i++) {
      const seen = new WeakSet();
      const hit =
        deepFindPageId(fiber.memoizedProps, seen, { n: 5000 }) ||
        deepFindPageId(fiber.memoizedState, seen, { n: 5000 });
      if (hit) return hit;
      fiber = fiber.return;
    }
    return null;
  }

  // Bounded DFS for the WHOLE ad object — the node whose id field equals this
  // card's Library ID. That object (and its `snapshot`) carries every extra
  // field we surface: page likes, cta_type, caption, platforms, dates, etc.
  function deepFindAdObject(obj, adId, seen, budget) {
    if (!obj || typeof obj !== "object" || budget.n <= 0) return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    budget.n--;
    for (const k of ["ad_archive_id", "adArchiveID", "adArchiveId"]) {
      if (String(obj[k]) === adId) return obj;
    }
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === "object") {
        const hit = deepFindAdObject(v, adId, seen, budget);
        if (hit) return hit;
      }
      if (budget.n <= 0) break;
    }
    return null;
  }

  // The live ad object from React fiber, keyed by Library ID. Null if not found
  // (e.g. fiber not mounted yet) — callers fall back to DOM-derived values.
  function getAdObject(card) {
    const adId = getLibraryId(card);
    if (!adId) return null;
    let fiber = reactFiber(card);
    for (let i = 0; i < 40 && fiber; i++) {
      const obj =
        deepFindAdObject(fiber.memoizedProps, adId, new WeakSet(), { n: 8000 }) ||
        deepFindAdObject(fiber.memoizedState, adId, new WeakSet(), { n: 8000 });
      if (obj) return obj;
      fiber = fiber.return;
    }
    return null;
  }

  // ---- small typed readers, tolerant of camelCase/snake_case key spellings --
  function firstVal(names, ...objs) {
    for (const o of objs) {
      if (!o) continue;
      for (const n of names) {
        const v = o[n];
        if (v !== undefined && v !== null && v !== "") return v;
      }
    }
    return null;
  }

  function toNum(v) {
    if (v == null) return null;
    const n = Number(String(v).replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  // Meta gives dates as unix-seconds, unix-ms, or an ISO/locale string.
  function toDate(v) {
    if (v == null) return null;
    if (typeof v === "number" || /^\d+$/.test(String(v))) {
      const n = Number(v);
      return new Date(n < 1e12 ? n * 1000 : n); // seconds vs ms
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return null;
    }
  }

  const PLATFORM_LABELS = {
    FACEBOOK: "Facebook", INSTAGRAM: "Instagram", MESSENGER: "Messenger",
    AUDIENCE_NETWORK: "Audience Network", THREADS: "Threads", WHATSAPP: "WhatsApp"
  };
  function normPlatforms(v) {
    if (!v) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr
      .map((p) => PLATFORM_LABELS[String(p).toUpperCase()] || String(p))
      .filter(Boolean);
  }

  // Parse the visible "Started running on May 12, 2026" line as a fallback when
  // the fiber object isn't available.
  function startDateFromDom(card) {
    const text = card.innerText || "";
    const m = text.match(/Started running on\s+(.+?)(?:\n|·|$)/i);
    if (m) {
      const d = new Date(m[1].trim());
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  // Everything the overlay shows. Reads the structured ad object when present,
  // otherwise derives what it can from the visible DOM. Purely passive — no
  // network. Any field may be null; the renderer skips nulls.
  function getAdMeta(card) {
    const ad = getAdObject(card) || {};
    const snap = ad.snapshot || ad.snapShot || ad;

    const pageLikes = toNum(firstVal(["page_like_count", "pageLikeCount", "page_likes"], snap, ad));
    const ctaType = firstVal(["cta_type", "ctaType"], snap, ad);
    const versions = toNum(firstVal(["collation_count", "collationCount", "collation_total_count"], ad, snap));
    const title = firstVal(["title"], snap);
    const platforms = normPlatforms(firstVal(["publisher_platform", "publisherPlatform", "publisher_platforms"], ad, snap));

    let domain = firstVal(["caption"], snap);
    if (domain && /^https?:\/\//i.test(domain)) domain = hostOf(domain) || domain;
    if (!domain) domain = hostOf(firstVal(["link_url", "linkUrl"], snap) || getLink(card));

    let isActive = firstVal(["is_active", "isActive"], ad, snap);
    if (isActive == null) isActive = !/\bInactive\b/i.test(card.innerText || "");

    const startDate =
      toDate(firstVal(["start_date", "startDate", "ad_delivery_start_time"], ad, snap)) ||
      startDateFromDom(card);
    const endDate = toDate(firstVal(["end_date", "endDate", "ad_delivery_stop_time"], ad, snap));

    let daysActive = null;
    if (startDate) {
      const until = isActive || !endDate ? new Date() : endDate;
      const d = Math.floor((until - startDate) / 86400000);
      if (d >= 0) daysActive = d;
    }

    return { pageLikes, ctaType, domain, platforms, versions, title, isActive, startDate, endDate, daysActive };
  }

  // The ad's real destination URL (already unwrapped from l.facebook.com by
  // getLink). Used both for the domain readout and for network Shopify checks.
  function getLandingUrl(card) {
    const ad = getAdObject(card);
    const snap = ad && (ad.snapshot || ad.snapShot || ad);
    return firstVal(["link_url", "linkUrl"], snap) || getLink(card) || "";
  }

  // No-network Shopify detection: returns "shopify" only when we can tell from
  // data ALREADY in the page; otherwise "unknown" (a custom-domain store can't
  // be confirmed without fetching it — that's what the optional network check
  // is for). Never returns "not" — absence of proof isn't proof of absence.
  function getShopifyLocal(card) {
    const host = (function () {
      try { return new URL(getLandingUrl(card)).hostname.toLowerCase(); }
      catch (_) { return ""; }
    })();
    if (/(^|\.)myshopify\.com$/.test(host)) return "shopify";

    const re = /cdn\.shopify\.com|myshopify\.com|\/cdn\/shop\//i;
    if (re.test(card.innerHTML || "")) return "shopify";
    const ad = getAdObject(card);
    if (ad) {
      try { if (re.test(JSON.stringify(ad))) return "shopify"; } catch (_) {}
    }
    return "unknown";
  }

  // Find the advertiser's numeric Page ID so we can open their full ad history.
  // Defensive, multi-strategy: cheap DOM reads first, then look the id up from
  // the page's embedded data keyed by the card's Library ID — that last part is
  // what lets "All ads" work straight from the grid, no detail view needed.
  // Returns a string or null.
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
    // 3) Inline JSON Meta embeds in the card markup, e.g. "page_id":"123456".
    const inline = card.innerHTML.match(/"page_id"\s*:\s*"?(\d{6,})"?/);
    if (inline) return inline[1];

    // 4) + 5) Look the id up by the card's Library ID — works in the grid view.
    const adId = getLibraryId(card);
    if (adId) {
      const fromJson = pageIdFromEmbeddedJson(adId);
      if (fromJson) return fromJson;
    }
    const fromFiber = pageIdFromFiber(card);
    if (fromFiber) return fromFiber;

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
    getLibraryId,
    getPageId,
    getAdMeta,
    getLandingUrl,
    getShopifyLocal,
    getCreative
  });
})();
