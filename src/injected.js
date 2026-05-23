(() => {
  if (window.__xVideoDownloaderInstalled) return;
  window.__xVideoDownloaderInstalled = true;

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    inspectResponse(response.clone());
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__xvdUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function send(...args) {
    this.addEventListener("load", () => {
      const contentType = this.getResponseHeader("content-type") || "";
      if (!contentType.includes("json")) return;
      parsePayload(this.responseText);
    });

    return originalSend.apply(this, args);
  };

  async function inspectResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) return;

    try {
      parsePayload(await response.text());
    } catch {
      // Ignore non-readable or already-consumed responses.
    }
  }

  function parsePayload(text) {
    if (!text || !text.includes("video_info")) return;

    try {
      const payload = JSON.parse(text);
      const videos = extractVideos(payload);
      if (videos.length) {
        window.postMessage({ source: "xvd-page", videos }, "*");
      }
    } catch {
      // Some API responses are not JSON despite their headers.
    }
  }

  function extractVideos(root) {
    const results = [];
    const seen = new Set();
    walk(root, null);
    return results;

    function walk(value, activeTweetId) {
      if (!value || typeof value !== "object") return;

      const tweetId = getTweetId(value) || activeTweetId;
      const media = Array.isArray(value.media) ? value.media : null;
      const extendedMedia = Array.isArray(value.extended_entities?.media)
        ? value.extended_entities.media
        : null;

      for (const item of [...(media || []), ...(extendedMedia || [])]) {
        collectMedia(item, tweetId);
      }

      if (value.video_info) collectMedia(value, tweetId);

      for (const child of Object.values(value)) {
        walk(child, tweetId);
      }
    }

    function collectMedia(media, tweetId) {
      const variants = media?.video_info?.variants;
      if (!tweetId || !Array.isArray(variants)) return;

      for (const variant of variants) {
        if (!variant?.url || !variant.url.includes(".mp4")) continue;

        const key = `${tweetId}:${variant.url}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          tweetId,
          url: variant.url,
          bitrate: Number(variant.bitrate) || 0,
          quality: qualityFromUrl(variant.url, variant.bitrate)
        });
      }
    }
  }

  function getTweetId(value) {
    const candidates = [
      value.rest_id,
      value.id_str,
      value.conversation_id_str,
      value.legacy?.id_str,
      value.legacy?.conversation_id_str
    ];

    return candidates.find((candidate) => typeof candidate === "string" && /^\d{10,}$/.test(candidate));
  }

  function qualityFromUrl(url, bitrate) {
    const match = url.match(/\/vid\/([^/]+)\//);
    if (match) {
      const size = match[1].match(/(\d+)x(\d+)/);
      return size ? `${size[2]}p` : match[1];
    }
    return bitrate ? `${bitrate}bps` : "video";
  }
})();
