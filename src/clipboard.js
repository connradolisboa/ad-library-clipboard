// src/clipboard.js — Ad Library Clipper
// Assemble the harvested fields into a single Notion-friendly clipboard write.

(() => {
  "use strict";

  const ALC = (window.__ALC = window.__ALC || {});
  const { escapeHtml } = ALC;

  // Build the HTML payload in the sequence: Body, CTA, Link, Creative.
  // The body keeps its original structure: a blank line (2+ newlines) starts a
  // new paragraph (its own <div>, which Notion pastes as a separate block),
  // while a single newline inside a paragraph stays a soft line break (<br>).
  function buildHtml({ body, cta, link, imageUrl }) {
    const parts = [];
    if (body) {
      escapeHtml(body)
        .replace(/\r\n/g, "\n")
        .split(/\n{2,}/) // blank line separates paragraphs
        .map((p) => p.trim().replace(/\n/g, "<br>")) // soft breaks within one
        .filter(Boolean)
        .forEach((p) => parts.push(`<div>${p}</div>`));
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

  // Copy a single ad permalink. Writes BOTH a plain-text URL (pastes as a raw
  // link anywhere) and a rich HTML anchor labeled with `label` (pastes into
  // Notion/docs as a clickable named link). Falls back to writeText if the
  // richer ClipboardItem path is unavailable.
  async function writeLinkToClipboard({ url, label }) {
    const text = label ? `${label} ${url}` : url;
    const anchorText = escapeHtml(label || url);
    const html = `<a href="${escapeHtml(url)}">${anchorText}</a>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        })
      ]);
    } catch (e) {
      await navigator.clipboard.writeText(text);
    }
  }

  Object.assign(ALC, { buildHtml, buildPlain, fetchImageBlob, writeAdToClipboard, writeLinkToClipboard });
})();
