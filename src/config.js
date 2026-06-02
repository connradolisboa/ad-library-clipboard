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
  // "Open all Ads" target URL builder.
  // Builds an Ad Library URL scoped to one advertiser's FULL history.
  // Preserves the `country` filter from the current page when present.
  // --------------------------------------------------------------------------
  CONFIG.buildPageUrl = function buildPageUrl(pageId) {
    let country = "ALL";
    try {
      const current = new URL(window.location.href).searchParams.get("country");
      if (current) country = current;
    } catch (_) {}

    const params = new URLSearchParams({
      active_status: "all",
      ad_type: "all",
      country,
      view_all_page_id: String(pageId),
      search_type: "page",
      media_type: "all"
    });
    return `https://www.facebook.com/ads/library/?${params.toString()}`;
  };

  ALC.CONFIG = CONFIG;
})();
