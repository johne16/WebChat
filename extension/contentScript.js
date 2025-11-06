// ============================================================================
// DEPRECATED: This file is no longer used.
// Web page content extraction is now handled by Crawl4AI via server/server.js
// See extension/react.js executeFetchURL() function
// ============================================================================

// content-script.js
// Listens for a request and returns the page's raw HTML.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'GET_RAW_HTML') {
        sendResponse({ html: document.documentElement.outerHTML });
    }
    // No async work, so no need to return true.
});
