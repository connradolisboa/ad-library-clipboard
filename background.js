// background.js
// The service worker handles the one thing content scripts can't do cleanly: downloads.
// Content script sends a message with the video URL + a filename; we save it to Downloads.

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
});
