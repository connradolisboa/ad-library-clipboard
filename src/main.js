// src/main.js — Ad Library Clipper
// Wires everything together: the click handlers, the two injected buttons, and
// the MutationObserver that re-scans as Meta lazy-loads more ads.

(() => {
  "use strict";

  const ALC = window.__ALC || {};
  const {
    CONFIG, toast, slugify,
    getAllCards, getBodyText, getCTA, getLink, getAdvertiser, getPageId, getCreative,
    writeAdToClipboard
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
  function handleOpenAll(card) {
    const pageId = getPageId(card);
    if (!pageId) {
      toast("Couldn't find this advertiser's page ID. Scroll the card fully into view and try again.", true);
      return;
    }
    window.open(CONFIG.buildPageUrl(pageId), "_blank", "noopener");
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
    card.appendChild(clipBtn);
    card.appendChild(openAllBtn);
  }

  function scanAndInject() {
    getAllCards().forEach(injectButton);
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

  scanAndInject();
  toast("Ad Library Clipper ready — hover a card and click 📎 Clip or 🗂 All ads.");
})();
