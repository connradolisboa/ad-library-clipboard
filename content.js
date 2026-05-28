// content.js — Ad Library Clipper
// ----------------------------------------------------------------------------
// WHAT THIS DOES
//   - Finds each ad "card" on the Meta Ad Library results page
//   - Injects a floating "Clip" button onto each one
//   - On click, harvests: body text (expanded), CTA, destination link, creative
//   - IMAGE ad  -> puts Body + CTA + Link + Image on the clipboard as ONE paste
//                  (HTML flavor, so Notion renders it in sequence: Body, CTA, Link, Creative)
//   - VIDEO ad  -> puts Body + CTA + Link on the clipboard AND auto-downloads the .mp4
//
// IMPORTANT: Meta changes this page's markup often. Every selector that depends
// on Meta's structure is grouped in the CONFIG block below and tagged // [TUNE].
// If something stops working, that's the first place to look.
// ----------------------------------------------------------------------------

(() => {
  "use strict";

  // ===========================================================================
  // CONFIG — selectors you may need to tune when Meta changes the DOM   // [TUNE]
  // ===========================================================================
  const CONFIG = {
    // A card is detected heuristically: a container that holds a "Library ID"
    // string is almost always one ad unit. We climb up from that text node.
    cardMarkerText: /Library ID/i,        // [TUNE] text that marks an ad card
    seeMoreText: /see more|ver mais|mehr ansehen/i, // [TUNE] "expand body" button text (multi-lang)
    // Known CTA button labels Meta uses. We match the ad's CTA against these.
    ctaLabels: [
      "Shop Now", "Learn More", "Sign Up", "Download", "Book Now",
      "Get Offer", "Get Quote", "Subscribe", "Apply Now", "Contact Us",
      "Send Message", "Watch More", "Listen Now", "Order Now", "Play Game",
      "Install Now", "Use App", "Get Showtimes", "Buy Tickets", "See Menu",
      "Comprar agora", "Saiba mais", "Cadastre-se", "Baixar", "Reservar"
    ]
  };

  // ===========================================================================
  // UTILITIES
  // ===========================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(message, isError = false) {
    const t = document.createElement("div");
    t.className = "alc-toast" + (isError ? " alc-toast-error" : "");
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("alc-show"));
    setTimeout(() => {
      t.classList.remove("alc-show");
      setTimeout(() => t.remove(), 250);
    }, 2600);
  }

  function escapeHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Slugify advertiser name for a clean filename
  function slugify(s) {
    return (s || "ad")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "ad";
  }

  // ===========================================================================
  // CARD DETECTION
  // ===========================================================================
  // An element "looks like a real ad card" if it contains BOTH a creative
  // (video or a large image) AND the Library ID marker. We climb from the
  // marker until we hit the first ancestor that satisfies this — that works
  // for BOTH the grid view and the detail view, which nest differently.
  function looksLikeCard(el) {
    if (!el) return false;
    const hasMarker = CONFIG.cardMarkerText.test(el.innerText || "");
    if (!hasMarker) return false;
    // Reject containers that span MORE THAN ONE ad — a real card has exactly
    // one Library ID. The grid wrapper holds many, so it fails this test and
    // we keep climbing past it... er, we stop BELOW it.
    const markerCount = (el.innerText.match(/Library ID/gi) || []).length;
    if (markerCount > 1) return false;
    const hasVideo = !!el.querySelector("video");
    const hasBigImg = [...el.querySelectorAll("img")].some(
      (img) => img.naturalWidth > 200 && img.naturalHeight > 200
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
    return null; // no qualifying card found from this marker
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
    // OUTERMOST one. This is what kills the "two buttons" bug — the inner
    // wrapper and outer wrapper both qualified, so we drop the nested one.
    const list = [...roots];
    return list.filter(
      (a) => !list.some((b) => b !== a && b.contains(a))
    );
  }

  // ===========================================================================
  // HARVESTING — pull the four pieces out of a card
  // ===========================================================================

  // Expand a folded "... See more" body if present, then read the full text.
  async function getBodyText(card) {
    // Try clicking a "See more" toggle inside this card.
    const candidates = [...card.querySelectorAll('div[role="button"], span[role="button"], a')];
    const seeMore = candidates.find((c) =>
      CONFIG.seeMoreText.test((c.textContent || "").trim())
    );
    if (seeMore) {
      seeMore.click();
      await sleep(120); // let the DOM update
    }

    // Heuristic: the ad body is usually the longest block of visible text in the
    // card that isn't metadata (Library ID, dates, platform list, CTA, etc.).
    const blocks = [...card.querySelectorAll("div, span")]
      .map((el) => (el.innerText || "").trim())
      .filter(Boolean);

    const noise = /(Library ID|Sponsored|Started running|Platforms|This ad has|See ad details|See summary|Open Drop-down|Active|Inactive)/i;
    const text = blocks
      .filter((t) => !noise.test(t) && t.length > 25)
      .sort((a, b) => b.length - a.length)[0];

    return (text || "").trim();
  }

  function getCTA(card) {
    const all = [...card.querySelectorAll('div[role="button"], a, span')]
      .map((el) => (el.textContent || "").trim());
    return CONFIG.ctaLabels.find((label) =>
      all.some((t) => t.toLowerCase() === label.toLowerCase())
    ) || "";
  }

  function getLink(card) {
    // The destination link is usually an <a> whose href leaves facebook
    // (Meta routes some through l.facebook.com — we unwrap that).
    const anchors = [...card.querySelectorAll('a[href]')];
    for (const a of anchors) {
      let href = a.href || "";
      if (href.includes("l.facebook.com/l.php")) {
        try {
          const u = new URL(href);
          const real = u.searchParams.get("u");
          if (real) return decodeURIComponent(real);
        } catch (_) {}
      }
      if (href && !href.includes("facebook.com/ads/library") && !href.startsWith("https://www.facebook.com/")) {
        return href;
      }
    }
    return "";
  }

  function getAdvertiser(card) {
    // Advertiser/page name is usually the first prominent link or strong text.
    const a = card.querySelector('a[href*="facebook.com/"]');
    if (a && a.textContent.trim()) return a.textContent.trim();
    const strong = card.querySelector('span[style*="font-weight"], strong');
    return strong ? strong.textContent.trim() : "advertiser";
  }

  // Returns { kind: 'video'|'image'|'none', url }
  function getCreative(card) {
    const video = card.querySelector("video");
    if (video) {
      // Prefer a real .mp4 src; videos sometimes use <source> or a src attr.
      const src =
        video.currentSrc ||
        video.src ||
        (video.querySelector("source") && video.querySelector("source").src) ||
        "";
      if (src) return { kind: "video", url: src };
      // Some videos only expose src via the poster + network; flag as video w/o url.
      return { kind: "video", url: "" };
    }
    // Largest image in the card is almost always the creative (not the avatar).
    const imgs = [...card.querySelectorAll("img")]
      .filter((img) => img.naturalWidth > 200 && img.naturalHeight > 200)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    if (imgs[0]) return { kind: "image", url: imgs[0].src };
    return { kind: "none", url: "" };
  }

  // ===========================================================================
  // CLIPBOARD ASSEMBLY
  // ===========================================================================

  // Build the HTML payload in the sequence: Body, CTA, Link, Creative.
  // Body is emitted as ONE block (a single <div> using <br> for line breaks)
  // so Notion pastes it as a single text block instead of one block per line.
  function buildHtml({ body, cta, link, imageUrl }) {
    const parts = [];
    if (body) {
      // Collapse 2+ consecutive newlines into a single <br> so blank lines
      // between paragraphs don't make Notion split the body into separate blocks.
      const bodyHtml = escapeHtml(body)
        .replace(/\n{2,}/g, "\n")   // blank lines -> single line break
        .replace(/\n/g, "<br>");
      parts.push(`<div>${bodyHtml}</div>`);
    }
    if (cta) parts.push(`<div><strong>CTA:</strong> ${escapeHtml(cta)}</div>`);
    if (link) parts.push(`<div><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></div>`);
    if (imageUrl) parts.push(`<div><img src="${escapeHtml(imageUrl)}"></div>`);
    return parts.join("\n");
  }

  function buildPlain({ body, cta, link }) {
    return [body, cta ? `CTA: ${cta}` : "", link].filter(Boolean).join("\n\n");
  }

  // Fetch an image and return a PNG blob (Notion pastes image/png as an image block).
  async function fetchImageBlob(url) {
    const res = await fetch(url, { credentials: "include" });
    const blob = await res.blob();
    // If it's already png, use directly; otherwise re-encode via canvas.
    if (blob.type === "image/png") return blob;
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d").drawImage(bmp, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function writeImageAdToClipboard({ body, cta, link, imageUrl }) {
    const html = buildHtml({ body, cta, link, imageUrl });
    const plain = buildPlain({ body, cta, link });

    const items = {
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" })
    };

    // Try to also include the actual image bytes so Notion makes a real image block.
    try {
      const pngBlob = await fetchImageBlob(imageUrl);
      if (pngBlob) items["image/png"] = pngBlob;
    } catch (e) {
      // If image fetch is blocked (CORS), the HTML <img src> still gives Notion
      // something to render. We just lose the embedded-bytes guarantee.
      console.warn("[ALC] image fetch failed, falling back to HTML img tag:", e);
    }

    await navigator.clipboard.write([new ClipboardItem(items)]);
  }

  async function writeTextAdToClipboard({ body, cta, link }) {
    const html = buildHtml({ body, cta, link, imageUrl: "" });
    const plain = buildPlain({ body, cta, link });
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" })
      })
    ]);
  }

  function downloadVideo(url, advertiser) {
    const filename = `ad-library/${slugify(advertiser)}-${Date.now()}.mp4`;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "DOWNLOAD_VIDEO", url, filename },
        (resp) => resolve(resp || { ok: false, error: "no response" })
      );
    });
  }

  // ===========================================================================
  // CLICK HANDLER
  // ===========================================================================
  async function handleClip(card, btn) {
    btn.classList.add("alc-busy");
    btn.textContent = "Clipping…";
    try {
      const body = await getBodyText(card);
      const cta = getCTA(card);
      const link = getLink(card);
      const advertiser = getAdvertiser(card);
      const creative = getCreative(card);

      if (creative.kind === "image") {
        await writeImageAdToClipboard({ body, cta, link, imageUrl: creative.url });
        done(btn, "Copied — paste into Notion");
        toast("Image ad copied. Paste into Notion → Body, CTA, Link, Creative.");
      } else if (creative.kind === "video") {
        await writeTextAdToClipboard({ body, cta, link });
        if (creative.url) {
          const r = await downloadVideo(creative.url, advertiser);
          if (r.ok) {
            done(btn, "Copied + video downloading");
            toast("Text copied to clipboard. Video downloading to Downloads/ad-library — drag it into Notion after pasting.");
          } else {
            done(btn, "Text copied (video failed)");
            toast("Text copied, but the video URL couldn't be grabbed (Meta hides it until play). Click play on the video, then clip again.", true);
          }
        } else {
          done(btn, "Text copied (no video URL)");
          toast("Text copied. Meta hasn't exposed the video file yet — press play on the ad video, then click Clip again.", true);
        }
      } else {
        await writeTextAdToClipboard({ body, cta, link });
        done(btn, "Text copied (no creative found)");
        toast("Copied text/link/CTA. No image or video detected in this card.", true);
      }
    } catch (e) {
      console.error("[ALC] clip failed:", e);
      btn.classList.remove("alc-busy");
      btn.classList.add("alc-error");
      btn.textContent = "Failed";
      toast("Something went wrong: " + e.message, true);
      setTimeout(() => resetBtn(btn), 2500);
    }
  }

  function done(btn, label) {
    btn.classList.remove("alc-busy");
    btn.classList.add("alc-done");
    btn.textContent = label;
    setTimeout(() => resetBtn(btn), 2500);
  }

  function resetBtn(btn) {
    btn.classList.remove("alc-busy", "alc-done", "alc-error");
    btn.textContent = "📎 Clip";
  }

  // ===========================================================================
  // BUTTON INJECTION + observe for newly-loaded cards (infinite scroll)
  // ===========================================================================
  function injectButton(card) {
    if (card.querySelector(":scope > .alc-clip-btn")) return; // already has one
    if (card.dataset.alcDone === "1") return;
    card.dataset.alcDone = "1";

    // The card needs position:relative so the absolute button anchors to it.
    const pos = getComputedStyle(card).position;
    if (pos === "static") card.style.position = "relative";

    const btn = document.createElement("button");
    btn.className = "alc-clip-btn";
    btn.textContent = "📎 Clip";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClip(card, btn);
    });
    card.appendChild(btn);
  }

  function scanAndInject() {
    getAllCards().forEach(injectButton);
  }

  // Initial pass + re-scan as the user scrolls and Meta lazy-loads more ads.
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scanAndInject();
    }, 400);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  // Kick off
  scanAndInject();
  toast("Ad Library Clipper ready — hover a card and click 📎 Clip.");
})();
