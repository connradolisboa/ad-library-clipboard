// src/filters.js — Ad Library Clipper
// A floating filter dock for the search results: minimum active-duration chips
// plus an Only/Hide Shopify toggle. Filtering is a cheap DOM read of the
// data-attributes main.js stashes on each card (data-alc-days, data-alc-shop).
//
// Shopify detection is no-network by default. The optional "Network Shopify"
// switch upgrades "unknown" cards by fetching each store once (in the service
// worker), gated behind an OPTIONAL host permission requested on toggle — so
// nobody who doesn't opt in ever grants "access all sites".

(() => {
  "use strict";

  const ALC = (window.__ALC = window.__ALC || {});

  const STORAGE_KEY = "alc_network_shopify";

  // Already-injected cards, selected by data-attribute so HIDDEN cards are still
  // found — getAllCards() relies on innerText, which is empty under display:none,
  // so a hidden card would never be found again to un-hide it.
  function injectedCards() {
    return document.querySelectorAll('[data-alc-done="1"]');
  }

  // Minimum-active-duration options (label → days).
  const DAY_OPTIONS = [
    ["3 Days", 3],
    ["1 Week", 7],
    ["2 Weeks", 14],
    ["3 Weeks", 21]
  ];

  const state = {
    minDays: 0,            // 0 = no duration filter
    shopify: "off",        // "off" | "only" | "hide"
    network: false         // network detection opted-in?
  };

  let bar = null;
  let countEl = null;

  // ===========================================================================
  // VISIBILITY
  // ===========================================================================
  function cardVisible(card) {
    if (state.minDays > 0) {
      const days = parseInt(card.dataset.alcDays || "", 10);
      if (!Number.isFinite(days) || days < state.minDays) return false;
    }
    if (state.shopify !== "off") {
      const isShopify = (card.dataset.alcShop || "unknown") === "shopify";
      if (state.shopify === "only" && !isShopify) return false;
      if (state.shopify === "hide" && isShopify) return false;
    }
    return true;
  }

  // The element to actually hide: the OUTERMOST ancestor that still wraps just
  // this one ad (the first parent up the chain holds 2+). Hiding the whole grid
  // cell — rather than the inner card — lets Facebook's grid reflow and pack the
  // remaining ads together, with no blank gaps. Cached per card.
  function hideTargetOf(card) {
    if (card.__alcCell && card.__alcCell.isConnected) return card.__alcCell;
    let el = card;
    while (el.parentElement && el.parentElement !== document.body) {
      const parent = el.parentElement;
      // textContent (not innerText) so hidden siblings still count.
      const count = (parent.textContent.match(/Library ID/gi) || []).length;
      if (count > 1) break;
      el = parent;
    }
    card.__alcCell = el;
    return el;
  }

  function apply() {
    const cards = injectedCards();
    let shown = 0;
    for (const card of cards) {
      const visible = cardVisible(card);
      hideTargetOf(card).style.display = visible ? "" : "none";
      if (visible) shown++;
    }
    if (countEl) countEl.textContent = `${shown} shown`;
    if (state.network && state.shopify !== "off") runNetworkChecks(cards);
  }

  // ===========================================================================
  // NETWORK SHOPIFY DETECTION (opt-in)
  // ===========================================================================
  // Only "unknown" cards that the active filter actually cares about get
  // checked, one request per store, concurrency-limited. Results flip
  // data-alc-shop to "shopify"/"not" and trigger a re-apply.
  let inFlight = 0;
  const MAX_INFLIGHT = 4;
  const queue = [];

  function runNetworkChecks(cards) {
    for (const card of cards) {
      if (card.dataset.alcShop !== "unknown") continue;
      if (card.dataset.alcNet) continue; // already queued/checked
      const url = card.dataset.alcUrl || "";
      if (!/^https?:\/\//i.test(url)) {
        card.dataset.alcNet = "skip";
        continue;
      }
      card.dataset.alcNet = "queued";
      queue.push(card);
    }
    pump();
  }

  function pump() {
    while (inFlight < MAX_INFLIGHT && queue.length) {
      const card = queue.shift();
      inFlight++;
      chrome.runtime.sendMessage(
        { type: "SHOPIFY_CHECK", url: card.dataset.alcUrl },
        (resp) => {
          inFlight--;
          card.dataset.alcNet = "done";
          if (resp && resp.ok) {
            card.dataset.alcShop = resp.shopify ? "shopify" : "not";
            scheduleReapply();
          }
          pump();
        }
      );
    }
  }

  let reapplyScheduled = false;
  function scheduleReapply() {
    if (reapplyScheduled) return;
    reapplyScheduled = true;
    setTimeout(() => {
      reapplyScheduled = false;
      apply();
    }, 150);
  }

  // ===========================================================================
  // TOOLBAR UI
  // ===========================================================================
  function chip(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "alc-fchip";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      onClick(b);
    });
    return b;
  }

  function buildBar() {
    bar = document.createElement("div");
    bar.className = "alc-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Ad Library Clipper filters");

    const title = document.createElement("span");
    title.className = "alc-bar-title";
    title.textContent = "Filters";
    bar.appendChild(title);

    // Active-duration group (single-select; click an active chip to clear).
    const dayChips = [];
    for (const [label, days] of DAY_OPTIONS) {
      const c = chip(label, () => {
        state.minDays = state.minDays === days ? 0 : days;
        dayChips.forEach((x) => x.classList.toggle("alc-on", Number(x.dataset.days) === state.minDays));
        apply();
      });
      c.dataset.days = String(days);
      dayChips.push(c);
      bar.appendChild(c);
    }

    const sep = document.createElement("span");
    sep.className = "alc-bar-sep";
    bar.appendChild(sep);

    // Shopify group: Only / Hide (mutually exclusive; click active to clear).
    const shopChips = {};
    const setShop = (mode) => {
      state.shopify = state.shopify === mode ? "off" : mode;
      shopChips.only.classList.toggle("alc-on", state.shopify === "only");
      shopChips.hide.classList.toggle("alc-on", state.shopify === "hide");
      apply();
    };
    shopChips.only = chip("Only Shopify", () => setShop("only"));
    shopChips.hide = chip("Hide Shopify", () => setShop("hide"));
    bar.appendChild(shopChips.only);
    bar.appendChild(shopChips.hide);

    // Network detection opt-in.
    const net = document.createElement("label");
    net.className = "alc-net";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.network;
    cb.addEventListener("change", () => onNetworkToggle(cb));
    net.appendChild(cb);
    net.appendChild(document.createTextNode("⚙ Network Shopify"));
    net.title =
      "Detect custom-domain Shopify stores by fetching each store once. " +
      "Requires the optional 'access all sites' permission.";
    bar.appendChild(net);

    countEl = document.createElement("span");
    countEl.className = "alc-bar-count";
    bar.appendChild(countEl);

    document.body.appendChild(bar);
  }

  // Enabling network detection requests an OPTIONAL host permission from a user
  // gesture; we only flip the flag on if the grant succeeds.
  function onNetworkToggle(cb) {
    if (!cb.checked) {
      state.network = false;
      persistNetwork(false);
      return;
    }
    chrome.permissions.request({ origins: ["*://*/*"] }, (granted) => {
      if (granted) {
        state.network = true;
        persistNetwork(true);
        apply();
      } else {
        cb.checked = false;
        state.network = false;
        if (ALC.toast) ALC.toast("Network Shopify detection needs the site-access permission to work.", true);
      }
    });
  }

  function persistNetwork(on) {
    try { chrome.storage.local.set({ [STORAGE_KEY]: on }); } catch (_) {}
  }

  // ===========================================================================
  // INIT
  // ===========================================================================
  function init() {
    if (bar) return;
    buildBar();
    // Restore the opt-in, but only treat it as active if the permission is
    // still actually granted (the user may have revoked it in chrome://).
    try {
      chrome.storage.local.get(STORAGE_KEY, (res) => {
        if (!res || !res[STORAGE_KEY]) return;
        chrome.permissions.contains({ origins: ["*://*/*"] }, (has) => {
          if (!has) return;
          state.network = true;
          const cb = bar.querySelector(".alc-net input");
          if (cb) cb.checked = true;
          apply();
        });
      });
    } catch (_) {}
  }

  ALC.filters = { init, apply };
})();
