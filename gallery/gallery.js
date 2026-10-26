const SESSION_KEY = "galleryPayload";

const platformLabel = {
  taobao: "淘宝/天猫",
  jd: "京东",
  pdd: "拼多多",
  unknown: "未知平台",
};

const state = {
  payload: null,
  selected: new Set(),
};

const el = {
  meta: document.getElementById("pageMeta"),
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  status: document.getElementById("status"),
  selectedCount: document.getElementById("selectedCount"),
  btnSelectAll: document.getElementById("btnSelectAll"),
  btnSelectNone: document.getElementById("btnSelectNone"),
  btnDownload: document.getElementById("btnDownload"),
  progress: document.getElementById("progress"),
  progressTitle: document.getElementById("progressTitle"),
  progressBar: document.getElementById("progressBar"),
  progressDesc: document.getElementById("progressDesc"),
};

init();

async function init() {
  try {
    const data = await chrome.storage.session.get(SESSION_KEY);
    const payload = data?.[SESSION_KEY];
    if (!payload?.images?.length) {
      showEmpty();
      return;
    }
    state.payload = payload;
    payload.images.forEach((img) => state.selected.add(img.id));
    renderMeta();
    renderGrid();
    updateSelectionUi();
  } catch (err) {
    showStatus(`加载失败：${err?.message || err}`, "error");
    showEmpty();
  }

  el.btnSelectAll.addEventListener("click", () => {
    state.payload?.images.forEach((img) => state.selected.add(img.id));
    syncCardSelection();
    updateSelectionUi();
  });

  el.btnSelectNone.addEventListener("click", () => {
    state.selected.clear();
    syncCardSelection();
    updateSelectionUi();
  });

  el.btnDownload.addEventListener("click", onDownload);
}

function showEmpty() {
  el.empty.hidden = false;
  el.grid.hidden = true;
  el.meta.textContent = "暂无数据";
}

function renderMeta() {
  const p = state.payload;
  const platform = platformLabel[p.platform] || p.platform;
  el.meta.textContent = `${platform} · 共 ${p.images.length} 张 · ${p.title || ""}`;
  document.title = `商品图片 · ${p.title || "预览"}`;
}

function renderGrid() {
  el.empty.hidden = true;
  el.grid.hidden = false;
  el.grid.innerHTML = "";

  const frag = document.createDocumentFragment();
  for (const image of state.payload.images) {
    frag.appendChild(createCard(image));
  }
  el.grid.appendChild(frag);
}

function createCard(image) {
  const card = document.createElement("article");
  card.className = "card" + (state.selected.has(image.id) ? " is-selected" : "");
  card.dataset.id = String(image.id);
  card.setAttribute("role", "listitem");
  card.tabIndex = 0;

  card.innerHTML = `
    <div class="card__check" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <div class="card__media">
      <img alt="商品图 ${image.id}" loading="lazy" referrerpolicy="no-referrer" />
    </div>
    <div class="card__meta">
      <span class="card__index">#${String(image.id).padStart(2, "0")}</span>
      <span>点击选择</span>
    </div>
  `;

  const img = card.querySelector("img");
  img.src = image.url;
  img.addEventListener("error", () => {
    img.classList.add("is-error");
    img.alt = "加载失败";
  });

  const toggle = () => {
    if (state.selected.has(image.id)) state.selected.delete(image.id);
    else state.selected.add(image.id);
    card.classList.toggle("is-selected", state.selected.has(image.id));
    updateSelectionUi();
  };

  card.addEventListener("click", toggle);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  return card;
}

function syncCardSelection() {
  el.grid.querySelectorAll(".card").forEach((card) => {
    const id = Number(card.dataset.id);
    card.classList.toggle("is-selected", state.selected.has(id));
  });
}

function updateSelectionUi() {
  const n = state.selected.size;
  el.selectedCount.textContent = String(n);
  el.btnDownload.disabled = n === 0;
}

function showStatus(text, type = "") {
  el.status.hidden = false;
  el.status.textContent = text;
  el.status.className = "status" + (type ? ` status--${type}` : "");
}

function setProgress(visible, current = 0, total = 0, title = "正在下载…") {
  el.progress.hidden = !visible;
  el.progressTitle.textContent = title;
  const pct = total ? Math.round((current / total) * 100) : 0;
  el.progressBar.style.width = `${pct}%`;
  el.progressDesc.textContent = `${current} / ${total}`;
}

function sanitizeFolder(name) {
  return (
    String(name)
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "电商图片"
  );
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

function buildFilename(folder, index) {
  return `${sanitizeSegment(folder)}/${String(index).padStart(3, "0")}.png`;
}

/** 拉取图片并转为 PNG Blob（在扩展页执行，避免 SW 里 blob 下载失败） */
async function fetchAsPngBlob(imageUrl) {
  let blob;
  try {
    const res = await fetch(imageUrl, {
      credentials: "omit",
      cache: "reload",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    blob = await res.blob();
  } catch (err) {
    // fetch 失败时用 Image 元素兜底（部分 CDN 对扩展 fetch 更严）
    blob = await loadViaImageElement(imageUrl);
  }

  if (!blob || blob.size === 0) {
    throw new Error("图片内容为空");
  }

  // 非图片 MIME 时仍尝试解码
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("无法解码图片（可能被防盗链拦截）");
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG 转换失败"))),
        "image/png"
      );
    });
    return pngBlob;
  } finally {
    bitmap.close();
  }
}

function loadViaImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => {
      img.src = "";
      reject(new Error("图片加载超时"));
    }, 20000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        if (!canvas.width || !canvas.height) {
          reject(new Error("图片尺寸无效"));
          return;
        }
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("画布导出失败"))),
          "image/png"
        );
      } catch (e) {
        reject(new Error("画布被污染（跨域）"));
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("图片节点加载失败"));
    };
    img.src = url;
  });
}

async function downloadPngBlob(pngBlob, filename) {
  const objectUrl = URL.createObjectURL(pngBlob);
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

async function onDownload() {
  if (!state.payload || state.selected.size === 0) return;

  const items = state.payload.images.filter((img) => state.selected.has(img.id));
  const folderPrefix = sanitizeFolder(state.payload.title || "电商图片");
  const total = items.length;

  el.btnDownload.disabled = true;
  setProgress(true, 0, total, "正在转换为 PNG 并下载…");

  let success = 0;
  let failed = 0;
  const errorSamples = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const filename = buildFilename(folderPrefix, i + 1);
    setProgress(true, i, total, `正在下载第 ${i + 1} 张…`);
    try {
      const pngBlob = await fetchAsPngBlob(item.url);
      await downloadPngBlob(pngBlob, filename);
      success += 1;
    } catch (err) {
      failed += 1;
      if (errorSamples.length < 3) {
        errorSamples.push(err?.message || String(err));
      }
      console.warn("[下载失败]", item.url, err);
    }
    setProgress(true, i + 1, total);
    // 轻微间隔，降低连续下载被拦截概率
    await delay(120);
  }

  setProgress(false);
  el.btnDownload.disabled = state.selected.size === 0;

  if (failed === 0) {
    showStatus(`已成功下载 ${success} 张 PNG 到「${folderPrefix}」文件夹`);
  } else {
    const hint = errorSamples.length ? `；原因示例：${errorSamples.join("；")}` : "";
    showStatus(`完成：成功 ${success} 张，失败 ${failed} 张${hint}`, "error");
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
