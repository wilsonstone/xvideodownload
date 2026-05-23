const SCRIPT_ID = "x-video-downloader-injected";
const BUTTON_CLASS = "xvd-download-button";
const ATTR_BOUND = "data-xvd-bound";

const videoStore = new Map();

injectNetworkObserver();
installMessageBridge();
startPageObserver();

function injectNetworkObserver() {
  if (document.getElementById(SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = chrome.runtime.getURL("src/injected.js");
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
}

function installMessageBridge() {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "xvd-page") return;

    const videos = Array.isArray(event.data.videos) ? event.data.videos : [];
    for (const video of videos) {
      if (!video.tweetId || !video.url) continue;
      const previous = videoStore.get(video.tweetId) || [];
      videoStore.set(video.tweetId, mergeVariants(previous, [video]));
    }

    bindVisibleVideos();
  });
}

function startPageObserver() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindVisibleVideos, { once: true });
  } else {
    bindVisibleVideos();
  }

  const observer = new MutationObserver(() => bindVisibleVideos());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function bindVisibleVideos() {
  const videos = document.querySelectorAll("video:not([" + ATTR_BOUND + "])");
  for (const video of videos) {
    video.setAttribute(ATTR_BOUND, "true");
    attachButton(video);
  }
}

function attachButton(video) {
  const host = video.closest("article") || video.parentElement;
  if (!host) return;

  const button = document.createElement("button");
  button.className = BUTTON_CLASS;
  button.type = "button";
  button.title = "下载这个视频";
  button.textContent = "下载";

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await downloadFromVideo(video, button);
  });

  const mediaBox = video.closest('[data-testid="videoPlayer"], [data-testid="card.wrapper"], div[role="button"]') || video.parentElement;
  if (mediaBox?.querySelector("." + BUTTON_CLASS)) return;
  if (mediaBox) {
    const position = getComputedStyle(mediaBox).position;
    if (position === "static") mediaBox.style.position = "relative";
    mediaBox.appendChild(button);
  } else {
    host.appendChild(button);
  }
}

async function downloadFromVideo(video, button) {
  setButtonState(button, "查找中", true);

  const tweetId = findTweetId(video);
  const variants = tweetId ? videoStore.get(tweetId) : [];
  let best = selectBestVariant(variants);

  if (!best && tweetId) {
    setButtonState(button, "获取中...", true);
    best = await fetchVideoFromAPI(tweetId);
  }

  if (!best) {
    setButtonState(button, "未找到", false);
    setTimeout(() => setButtonState(button, "下载", false), 1800);
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_VIDEO",
      payload: {
        url: best.url,
        tweetId,
        quality: best.quality
      }
    },
    (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response || !response.ok) {
        setButtonState(button, "失败", false);
        setTimeout(() => setButtonState(button, "下载", false), 1800);
        return;
      }

      setButtonState(button, "已开始", false);
      setTimeout(() => setButtonState(button, "下载", false), 1800);
    }
  );
}

async function fetchVideoFromAPI(tweetId) {
  try {
    const ct0 = document.cookie
      .split("; ")
      .find((row) => row.startsWith("ct0="))
      ?.split("=")[1];
    if (!ct0) return null;

    const bearer =
      "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

    const resp = await fetch(
      `https://x.com/i/api/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
      {
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Csrf-Token": ct0,
          "X-Twitter-Auth-Type": "OAuth2Session",
          "X-Twitter-Active-User": "yes",
        },
        credentials: "include",
      }
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    const media = data?.extended_entities?.media || [];

    for (const item of media) {
      if (!item.video_info) continue;
      const variants = item.video_info.variants
        .filter((v) => v.url && v.url.includes(".mp4"))
        .map((v) => ({
          tweetId,
          url: v.url,
          bitrate: Number(v.bitrate) || 0,
          quality: qualityFromBitrate(v.bitrate),
        }));
      if (variants.length) {
        const best = variants.sort((a, b) => b.bitrate - a.bitrate)[0];
        videoStore.set(tweetId, variants);
        return best;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function qualityFromBitrate(bitrate) {
  if (!bitrate) return "video";
  if (bitrate >= 2000000) return "1080p";
  if (bitrate >= 832000) return "720p";
  if (bitrate >= 320000) return "480p";
  return "360p";
}

function findTweetId(element) {
  const article = element.closest("article") || document;
  const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));

  for (const link of links) {
    const match = link.href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }

  const pageMatch = location.href.match(/\/status\/(\d+)/);
  return pageMatch ? pageMatch[1] : null;
}

function selectBestVariant(variants = []) {
  return variants
    .filter((variant) => variant.url && variant.url.includes(".mp4"))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}

function mergeVariants(existing, incoming) {
  const byUrl = new Map();
  for (const item of [...existing, ...incoming]) {
    byUrl.set(item.url, item);
  }
  return Array.from(byUrl.values());
}

function setButtonState(button, text, disabled) {
  button.textContent = text;
  button.disabled = disabled;
}
