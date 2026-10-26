(function () {
  if (window.__ecomImgExtractorInjected) return;
  window.__ecomImgExtractorInjected = true;

  const BTN_ID = "ecom-img-extractor-btn";

  function isProductPage() {
    const host = location.hostname;
    const path = location.pathname;

    // 淘宝 / 天猫详情
    if (/item\.taobao\.com|detail\.tmall\.com|detail\.taobao\.com|chaoshi\.detail\.tmall\.com/i.test(host)) {
      return true;
    }
    // 京东详情
    if (/item\.jd\.com|item\.jd\.hk|npcitem\.jd\.hk/i.test(host)) return true;
    // 拼多多商品页
    if (/yangkeduo\.com|mobile\.yangkeduo\.com/i.test(host) && /goods|goods_id/i.test(location.href)) {
      return true;
    }
    // 拼多多商家版：商品编辑 / 详情相关页
    if (/mms\.pinduoduo\.com/i.test(host)) {
      return /goods|product|detail|edit|publish|sku/i.test(path + location.hash);
    }
    // 拼多多其他商品详情路径
    if (/pinduoduo\.com/i.test(host) && /goods|detail/i.test(path + location.search)) {
      return true;
    }
    return false;
  }

  function createButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "ecom-img-extractor-fab";
    btn.setAttribute("aria-label", "获取图片");
    btn.innerHTML = `
      <span class="ecom-img-extractor-fab__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
      </span>
      <span class="ecom-img-extractor-fab__text">获取图片</span>
    `;

    btn.addEventListener("click", onClick);
    document.documentElement.appendChild(btn);
  }

  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.classList.toggle("is-loading", loading);
    const text = btn.querySelector(".ecom-img-extractor-fab__text");
    if (text) text.textContent = loading ? "提取中…" : "获取图片";
  }

  function showToast(message, type = "info") {
    let toast = document.getElementById("ecom-img-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ecom-img-extractor-toast";
      toast.className = "ecom-img-extractor-toast";
      document.documentElement.appendChild(toast);
    }
    toast.className = `ecom-img-extractor-toast ecom-img-extractor-toast--${type} is-show`;
    toast.textContent = message;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove("is-show");
    }, 2600);
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    if (btn.disabled) return;

    setLoading(btn, true);
    try {
      // 稍等懒加载图进入 DOM
      window.scrollTo({ top: document.body.scrollHeight / 3, behavior: "smooth" });
      await sleep(400);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await sleep(300);

      const result = window.EcommerceImageExtractors.extractAll();
      if (!result.images.length) {
        showToast("未找到商品图片，请滚动页面后再试", "warn");
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "OPEN_GALLERY",
        payload: result,
      });

      if (response?.ok) {
        showToast(`已提取 ${result.images.length} 张图片`, "success");
      } else {
        showToast(response?.error || "打开预览页失败", "error");
      }
    } catch (err) {
      console.error("[电商图片提取]", err);
      showToast("提取失败，请刷新页面重试", "error");
    } finally {
      setLoading(btn, false);
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function maybeMount() {
    if (!isProductPage()) return;
    createButton();
  }

  maybeMount();

  // SPA 路由变化（拼多多商家版等）
  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      const old = document.getElementById(BTN_ID);
      if (old) old.remove();
      maybeMount();
    } else if (isProductPage() && !document.getElementById(BTN_ID)) {
      createButton();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
