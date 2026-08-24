// src/utils.js — Ad Library Clipper
// Small dependency-free helpers shared across the other modules.

(() => {
  "use strict";

  const ALC = (window.__ALC = window.__ALC || {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A single shared, screen-reader-announced toast region. Reusing one element
  // (with aria-live) means assistive tech announces updates instead of us
  // spawning a fresh, unannounced node each time.
  let toastEl = null;
  let toastHideTimer = null;

  function toast(message, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("role", "alert");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.className = "alc-toast" + (isError ? " alc-toast-error" : "");
    toastEl.textContent = message;
    // Force reflow so re-triggering the same element re-runs the transition.
    requestAnimationFrame(() => toastEl.classList.add("alc-show"));

    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      toastEl.classList.remove("alc-show");
    }, 2600);
  }

  function escapeHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Slugify advertiser name for a clean filename.
  function slugify(s) {
    return (s || "ad")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "ad";
  }

  Object.assign(ALC, { sleep, toast, escapeHtml, slugify });
})();
