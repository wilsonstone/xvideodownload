chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "DOWNLOAD_VIDEO") {
    return false;
  }

  const { url, tweetId, quality } = message.payload || {};
  if (!url) {
    sendResponse({ ok: false, error: "No video URL found." });
    return false;
  }

  const cleanQuality = String(quality || "video").replace(/[^\w.-]+/g, "_");
  const filename = `x-video-${tweetId || Date.now()}-${cleanQuality}.mp4`;

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    },
    (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({ ok: false, error: error.message });
        return;
      }

      sendResponse({ ok: true, downloadId });
    }
  );

  return true;
});
