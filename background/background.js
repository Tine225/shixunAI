const SESSION_KEY = "galleryPayload";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_GALLERY") {
    handleOpenGallery(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  // 兜底：直接用原始 URL 触发浏览器下载（不转 PNG）
  if (message?.type === "DOWNLOAD_URL") {
    const { url, filename } = message.payload || {};
    chrome.downloads
      .download({
        url,
        filename: sanitizeFilename(filename),
        saveAs: false,
        conflictAction: "uniquify",
      })
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});

async function handleOpenGallery(payload) {
  if (!payload?.images?.length) {
    throw new Error("没有可展示的图片");
  }
  await chrome.storage.session.set({ [SESSION_KEY]: payload });
  await chrome.tabs.create({
    url: chrome.runtime.getURL("gallery/gallery.html"),
  });
}

function sanitizeSegment(name) {
  return (
    String(name || "image")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "image"
  );
}

function sanitizeFilename(name) {
  return String(name || "image")
    .split(/[/\\]+/)
    .filter(Boolean)
    .map(sanitizeSegment)
    .join("/");
}
