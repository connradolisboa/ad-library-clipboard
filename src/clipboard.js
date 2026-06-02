// src/clipboard.js — Ad Library Clipper
// Assemble the harvested fields into a single Notion-friendly clipboard write.

(() => {
  "use strict";

  const ALC = (window.__ALC = window.__ALC || {});
  const { escapeHtml } = ALC;

  // Build the HTML payload in the sequence: Body, CTA, Link, Creative.
  // Body is emitted as ONE block (a single <div> using <br> for line breaks)
  // so Notion pastes it as a single text block instead of one block per line.
  function buildHtml({ body, cta, link, imageUrl }) {
    const parts = [];
    if (body) {
      const bodyHtml = escapeHtml(body)
        .replace(/\n{2,}/g, "\n") // blank lines -> single line break
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

  // Fetch an image and return a PNG blob (Notion pastes image/png as an image
  // block). Already-PNG bytes are passed through untouched to avoid a lossy
  // canvas round-trip; everything else is re-encoded.
  async function fetchImageBlob(url) {
    const res = await fetch(url, { credentials: "include" });
    const blob = await res.blob();
    if (blob.type === "image/png") return blob;
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      if (typeof bmp.close === "function") bmp.close();
    }
  }

  // One consolidated writer. Always writes HTML + plain text; when an imageUrl
  // is present it additionally tries to embed the real image bytes so Notion
  // makes a true image block (falling back to the HTML <img src> if blocked).
  async function writeAdToClipboard({ body, cta, link, imageUrl }) {
    const items = {
      "text/html": new Blob([buildHtml({ body, cta, link, imageUrl })], { type: "text/html" }),
      "text/plain": new Blob([buildPlain({ body, cta, link })], { type: "text/plain" })
    };

    if (imageUrl) {
      try {
        const pngBlob = await fetchImageBlob(imageUrl);
        if (pngBlob) items["image/png"] = pngBlob;
      } catch (e) {
        console.warn("[ALC] image fetch failed, falling back to HTML img tag:", e);
      }
    }

    await navigator.clipboard.write([new ClipboardItem(items)]);
  }

  Object.assign(ALC, { buildHtml, buildPlain, fetchImageBlob, writeAdToClipboard });
})();
