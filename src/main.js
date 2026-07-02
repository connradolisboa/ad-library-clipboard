// src/main.js — Ad Library Clipper
// Wires everything together: the click handlers, the two injected buttons, and
// the MutationObserver that re-scans as Meta lazy-loads more ads.

(() => {
  "use strict";

  const ALC = window.__ALC || {};
  const {
    CONFIG, toast, slugify,
    getAllCards, getBodyText, getCTA, getLink, getAdvertiser, getLibraryId, getAdMeta,
    getLandingUrl, getShopifyLocal, getCreative,
    writeAdToClipboard, writeLinkToClipboard
  } = ALC;

  // ===========================================================================
  // VIDEO DOWNLOAD (routed through the service worker)
  // ===========================================================================
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
  // CLIP HANDLER
  // ===========================================================================
  async function handleClip(card, btn) {
    btn.classList.add("alc-busy");
    btn.textContent = "Clipping…";
    try {
      const body = await getBodyText(card);
      const cta = getCTA(card);
      const link = getLink(card);
      const advertiser = getAdvertiser(card);
      const creative = await getCreative(card);

      // Guard: never copy an empty payload.
      const hasCreative = creative.kind === "image" || (creative.kind === "video" && (creative.url || creative.poster));
      if (!body && !cta && !link && !hasCreative) {
        btn.classList.remove("alc-busy");
        btn.classList.add("alc-error");
        btn.textContent = "Nothing to clip";
        toast("Nothing to clip — couldn't read any text or creative from this card.", true);
        setTimeout(() => resetBtn(btn), 2500);
        return;
      }

      if (creative.kind === "image") {
        await writeAdToClipboard({ body, cta, link, imageUrl: creative.url });
        done(btn, "Copied — paste into Notion");
        toast("Image ad copied. Paste into Notion → Body, CTA, Link, Creative.");
      } else if (creative.kind === "video") {
        if (creative.url) {
          await writeAdToClipboard({ body, cta, link, imageUrl: "" });
          const r = await downloadVideo(creative.url, advertiser);
          if (r.ok) {
            done(btn, "Copied + video downloading");
            toast("Text copied. Video downloading to Downloads/ad-library — drag it into Notion after pasting.");
          } else {
            done(btn, "Text copied (video failed)");
            toast("Text copied, but the video file couldn't be downloaded. Press play on the video, then clip again.", true);
          }
        } else if (creative.poster) {
          // No file URL even after nudging playback — copy the poster thumbnail.
          await writeAdToClipboard({ body, cta, link, imageUrl: creative.poster });
          done(btn, "Copied (poster only)");
          toast("Copied text + the video's thumbnail. Press play on the video, then clip again to grab the full mp4.", true);
        } else {
          await writeAdToClipboard({ body, cta, link, imageUrl: "" });
          done(btn, "Text copied (no video URL)");
          toast("Text copied. Meta hasn't exposed the video file yet — press play on the ad video, then click Clip again.", true);
        }
      } else {
        await writeAdToClipboard({ body, cta, link, imageUrl: "" });
        done(btn, "Text copied (no creative)");
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

  // ===========================================================================
  // OPEN-ALL-ADS HANDLER
  // ===========================================================================
  // ===========================================================================
  // COPY-AD-LINK HANDLER
  // ===========================================================================
  // Copies a permalink to THIS ad (Library ID → /ads/library/?id=…). Clicking
  // the copied link opens the ad's detail view in the Ad Library.
  async function handleCopyLink(card, btn) {
    const libraryId = getLibraryId(card);
    if (!libraryId) {
      toast("Couldn't read this ad's Library ID. Scroll the card fully into view and try again.", true);
      return;
    }
    const url = CONFIG.buildAdUrl(libraryId);
    const advertiser = getAdvertiser(card);
    try {
      await writeLinkToClipboard({ url, label: advertiser });
      btn.classList.add("alc-done");
      btn.textContent = "✓ Link copied";
      setTimeout(() => resetLinkBtn(btn), 2000);
      toast("Ad link copied — paste it to open this ad in the Ad Library.");
    } catch (e) {
      console.error("[ALC] copy link failed:", e);
      btn.classList.add("alc-error");
      btn.textContent = "Failed";
      setTimeout(() => resetLinkBtn(btn), 2000);
      toast("Couldn't copy the ad link: " + e.message, true);
    }
  }

  function resetLinkBtn(btn) {
    btn.classList.remove("alc-done", "alc-error");
    btn.textContent = "🔗 Link";
  }

  // Opening an ad's own permalink (?id=<Library ID>) lands on that ad's
  // advertiser with their full ad history loaded in the background and this
  // ad focused as a popup — so it doubles as a reliable "all ads" link. That
  // sidesteps hunting for the advertiser's numeric page_id (React fiber /
  // embedded JSON), which isn't always populated yet when the card is injected.
  function handleOpenAll(card) {
    const libraryId = getLibraryId(card);
    if (!libraryId) {
      toast("Couldn't read this ad's Library ID. Scroll the card fully into view and try again.", true);
      return;
    }
    window.open(CONFIG.buildAdUrl(libraryId), "_blank", "noopener");
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
  // BUTTON INJECTION
  // ===========================================================================
  function makeButton(className, label, ariaLabel, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // ===========================================================================
  // METADATA OVERLAY
  // ===========================================================================
  // A compact, read-only panel of research signals (active duration, page
  // likes, CTA type, domain, platforms, versions) pulled from data already in
  // the page. Skips any field we couldn't resolve.
  function fmtNum(n) {
    return typeof n === "number" ? n.toLocaleString() : n;
  }

  function buildMetaRows(m) {
    const rows = [];

    if (m.daysActive != null) {
      const verb = m.isActive ? "Active" : "Ran";
      rows.push([verb, `${fmtNum(m.daysActive)} day${m.daysActive === 1 ? "" : "s"}`]);
    } else if (m.isActive === false) {
      rows.push(["Status", "Inactive"]);
    }
    if (m.pageLikes != null) rows.push(["Page likes", fmtNum(m.pageLikes)]);
    if (m.ctaType) rows.push(["CTA", String(m.ctaType)]);
    if (m.domain) rows.push(["Domain", m.domain]);
    if (m.platforms && m.platforms.length) rows.push(["Platforms", m.platforms.join(" · ")]);
    if (m.versions != null && m.versions > 1) rows.push(["Versions", fmtNum(m.versions)]);

    return rows;
  }

  function injectMetaOverlay(card, meta) {
    const rows = buildMetaRows(meta);
    if (!rows.length) return; // nothing resolved — don't show an empty box

    const panel = document.createElement("div");
    panel.className = "alc-meta";
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "alc-meta-row";
      const k = document.createElement("span");
      k.className = "alc-meta-k";
      k.textContent = label;
      const v = document.createElement("span");
      v.className = "alc-meta-v";
      v.textContent = value;
      row.appendChild(k);
      row.appendChild(v);
      panel.appendChild(row);
    }
    card.appendChild(panel);
  }

  function injectButton(card) {
    if (card.dataset.alcDone === "1") return;
    card.dataset.alcDone = "1";

    // The card needs a positioning context so the absolute buttons anchor to it.
    const pos = getComputedStyle(card).position;
    if (pos === "static" || pos === "") card.style.position = "relative";

    const clipBtn = makeButton(
      "alc-clip-btn", "📎 Clip",
      "Clip this ad to clipboard",
      () => handleClip(card, clipBtn)
    );
    const openAllBtn = makeButton(
      "alc-openall-btn", "🗂 All ads",
      "Open all ads from this advertiser in a new tab",
      () => handleOpenAll(card)
    );
    const linkBtn = makeButton(
      "alc-link-btn", "🔗 Link",
      "Copy a link to this ad",
      () => handleCopyLink(card, linkBtn)
    );
    card.appendChild(clipBtn);
    card.appendChild(openAllBtn);
    card.appendChild(linkBtn);

    // Compute the ad's metadata ONCE: it feeds both the overlay and the filter
    // toolbar (stashed on data-attributes so filtering stays a cheap DOM read).
    const meta = getAdMeta(card);
    injectMetaOverlay(card, meta);
    card.dataset.alcDays = meta.daysActive == null ? "" : String(meta.daysActive);
    card.dataset.alcShop = getShopifyLocal(card); // "shopify" | "unknown"
    card.dataset.alcUrl = getLandingUrl(card);
  }

  function scanAndInject() {
    getAllCards().forEach(injectButton);
    if (ALC.filters) ALC.filters.apply();
  }

  // ===========================================================================
  // OBSERVE for newly-loaded cards (infinite scroll) + kickoff
  // ===========================================================================
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

  if (ALC.filters) ALC.filters.init();
  scanAndInject();
  toast("Ad Library Clipper ready — hover a card and click 📎 Clip or 🗂 All ads.");
})();
