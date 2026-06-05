// background.js
// The service worker handles the one thing content scripts can't do cleanly: downloads.
// Content script sends a message with the video URL + a filename; we save it to Downloads.

// Shopify detection results, cached by hostname for the worker's lifetime so we
// fetch each store at most once. Only reached when the user has opted into
// network detection (and thus granted the optional host permission).
const shopifyCache = new Map();

async function checkShopify(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (_) {
    return { ok: false, error: "bad url" };
  }
  if (shopifyCache.has(host)) return { ok: true, shopify: shopifyCache.get(host) };

  let shopify = false;
  try {
    const res = await fetch(url, { redirect: "follow", credentials: "omit" });
    // Final redirected host can already give it away (…/.myshopify.com).
    try {
      if (/(^|\.)myshopify\.com$/.test(new URL(res.url).hostname.toLowerCase())) shopify = true;
    } catch (_) {}
    // Shopify storefront responses carry telltale headers.
    if (!shopify && (res.headers.get("x-shopify-stage") || res.headers.get("x-shopid"))) {
      shopify = true;
    }
    // Otherwise sniff the HTML for Shopify fingerprints.
    if (!shopify) {
      const text = (await res.text()).slice(0, 200000);
      shopify = /cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.theme|myshopify\.com|window\.Shopify/i.test(text);
    }
  } catch (_) {
    // Blocked, offline, or CORS without permission — treat as "not detected"
    // rather than failing the whole filter.
  }

  shopifyCache.set(host, shopify);
  return { ok: true, shopify };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "DOWNLOAD_VIDEO") {
    const { url, filename } = msg;
    chrome.downloads.download(
      {
        url: url,
        filename: filename, // goes to default Downloads folder (or subpath if filename has a slash)
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
    return true; // keep the message channel open for the async sendResponse
  }

  if (msg.type === "SHOPIFY_CHECK") {
    checkShopify(msg.url).then(sendResponse);
    return true; // async sendResponse
  }
});
