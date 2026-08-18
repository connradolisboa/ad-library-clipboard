// src/config.js — Ad Library Clipper
// ----------------------------------------------------------------------------
// CONFIG — every selector / pattern that depends on Meta's markup lives here.
// Meta changes the Ad Library DOM often. When something stops working, this is
// the FIRST place to look. Everything tagged // [TUNE] is fair game to adjust.
// ----------------------------------------------------------------------------

(() => {
  "use strict";

  const ALC = (window.__ALC = window.__ALC || {});

  const CONFIG = {
    // A card is detected heuristically: a container that holds a "Library ID"
    // string is almost always one ad unit. We climb up from that text node.
    cardMarkerText: /Library ID/i,                  // [TUNE] text that marks an ad card

    // "expand body" button text (multi-language).
    seeMoreText: /see more|ver mais|mehr ansehen|voir plus|ver más/i, // [TUNE]

    // How long to wait (ms) after clicking "See more" for the DOM to update.
    seeMoreDelayMs: 120,                            // [TUNE]

    // How long to wait (ms) after calling video.play() for Meta to expose the
    // video file URL before we re-read it.
    videoLoadDelayMs: 350,                          // [TUNE]

    // Metadata text blocks that are NOT the ad body. Used to filter candidates
    // when picking the longest "real" body block.
    bodyNoise: /(Library ID|Sponsored|Started running|Platforms|This ad has|See ad details|See summary|Open Drop-down|Active|Inactive|See more|See less)/i, // [TUNE]

    // Minimum length for a text block to be considered the ad body.
    bodyMinLength: 25,                              // [TUNE]

    // Known CTA button labels Meta uses. Matched exact-first, then contains.
    ctaLabels: [
      "Shop Now", "Learn More", "Sign Up", "Download", "Book Now",
      "Get Offer", "Get Quote", "Subscribe", "Apply Now", "Contact Us",
      "Send Message", "Watch More", "Listen Now", "Order Now", "Play Game",
      "Install Now", "Use App", "Get Showtimes", "Buy Tickets", "See Menu",
      "Get Directions", "Call Now", "Donate Now", "Request Time", "See More",
      "Comprar agora", "Saiba mais", "Cadastre-se", "Baixar", "Reservar",
      "Fale conosco", "Enviar mensagem", "Inscreva-se", "Comprar"
    ]                                               // [TUNE]
  };

  // Minimum natural dimensions for an <img> to count as the creative (vs avatar).
  CONFIG.minCreativeSize = 200;                     // [TUNE]

  // --------------------------------------------------------------------------
  // Permalink to a SINGLE ad, keyed by its Library ID (ad_archive_id).
  // Opening this URL lands on that ad's advertiser with their full ad history
  // loaded in the background and this ad focused as a popup — so it also
  // serves as the "open all ads from this advertiser" link (see main.js's
  // handleOpenAll). Without a `country` param Facebook falls back to the
  // viewer's account locale, which can land on the wrong country's results —
  // so default to US (preserving the current page's country filter when set).
  // --------------------------------------------------------------------------
  CONFIG.buildAdUrl = function buildAdUrl(libraryId) {
    let country = "US";
    try {
      const current = new URL(window.location.href).searchParams.get("country");
      if (current) country = current;
    } catch (_) {}

    const params = new URLSearchParams({ id: String(libraryId), country });
    return `https://www.facebook.com/ads/library/?${params.toString()}`;
  };

  ALC.CONFIG = CONFIG;
})();
