/**
 * 各电商平台图片提取策略
 */
(function (global) {
  const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)(\?|$)/i;
  const IGNORE_HINT =
    /avatar|logo|icon|sprite|blank|loading|placeholder|qrcode|qr_|emoticon|emoji|banner_ad|ads?_|_ads|pixel|1x1|spacer/i;

  function absolutize(url) {
    if (!url || typeof url !== "string") return null;
    let u = url.trim().replace(/^["']|["']$/g, "");
    if (!u || u.startsWith("data:") || u.startsWith("blob:")) return null;
    if (u.startsWith("//")) u = location.protocol + u;
    try {
      return new URL(u, location.href).href;
    } catch {
      return null;
    }
  }

  /** 尽量拿到原图 / 高清尺寸 */
  function upgradeUrl(url) {
    if (!url) return url;
    let u = url;

    // 淘宝 / 天猫 CDN
    u = u.replace(/_\d+x\d+[a-zA-Z]*(\.(jpe?g|png|webp|gif))/i, "$1");
    u = u.replace(/\.(jpe?g|png|webp)_[^/?#.]+/i, ".$1");
    u = u.replace(/_\.webp$/i, "");
    u = u.replace(/\.jpg_\.webp/i, ".jpg");
    u = u.replace(/\.png_\.webp/i, ".png");

    // 京东 CDN：去掉尺寸后缀如 s800x800_ / !q70
    u = u.replace(/\/s\d+x\d+_/g, "/");
    u = u.replace(/!q\d+/g, "");
    u = u.replace(/\.dpg$/i, ".jpg");
    u = u.replace(/\.avif$/i, ".jpg");

    // 拼多多
    u = u.replace(/\/resize\/[^/]+\//, "/");
    u = u.replace(/\?imageView2[^#]*/, "");
    u = u.replace(/\?imageMogr2[^#]*/, "");

    return u;
  }

  function isLikelyProductImage(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (IGNORE_HINT.test(lower)) return false;
    if (lower.includes("alicdn.com") || lower.includes("tbcdn")) return true;
    if (lower.includes("360buyimg.com") || lower.includes("jd.com")) return true;
    if (lower.includes("pddpic") || lower.includes("pinduoduo") || lower.includes("yangkeduo"))
      return true;
    return IMG_EXT.test(lower) || lower.includes("img") || lower.includes("image");
  }

  function collectFromSrcset(srcset) {
    if (!srcset) return [];
    return srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function pickAttr(el) {
    const attrs = [
      "src",
      "data-src",
      "data-lazy-src",
      "data-lazy",
      "data-original",
      "data-img",
      "data-url",
      "data-ks-lazyload",
      "data-lazyload-src",
      "data-big",
      "data-zoom-image",
      "data-large",
    ];
    const urls = [];
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v) urls.push(v);
    }
    urls.push(...collectFromSrcset(el.getAttribute("srcset")));
    urls.push(...collectFromSrcset(el.getAttribute("data-srcset")));
    // 背景图
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none") {
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/i);
      if (m) urls.push(m[1]);
    }
    return urls;
  }

  function normalizeList(rawList) {
    const seen = new Set();
    const out = [];
    for (const raw of rawList) {
      let url = absolutize(raw);
      if (!url || !isLikelyProductImage(url)) continue;
      url = upgradeUrl(url);
      // 去掉 query 中的无关缓存参数做去重 key，保留完整 URL 用于下载
      const key = url.split("?")[0].replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url);
    }
    return out;
  }

  function queryAll(selectors, root = document) {
    const set = new Set();
    for (const sel of selectors) {
      try {
        root.querySelectorAll(sel).forEach((el) => set.add(el));
      } catch {
        /* ignore invalid selector */
      }
    }
    return [...set];
  }

  function extractFromElements(elements) {
    const raw = [];
    for (const el of elements) {
      raw.push(...pickAttr(el));
      // 有些详情用 a[href] 指向大图
      if (el.tagName === "A") {
        const href = el.getAttribute("href");
        if (href && IMG_EXT.test(href)) raw.push(href);
      }
    }
    return raw;
  }

  function extractFromHtmlString(html) {
    if (!html) return [];
    const urls = [];
    const re = /(?:src|data-src|data-lazyload|data-ks-lazyload)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) urls.push(m[1]);
    const urlRe = /https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|gif|webp)/gi;
    let u;
    while ((u = urlRe.exec(html))) urls.push(u[0]);
    return urls;
  }

  function extractJsonImages(obj, depth = 0) {
    const urls = [];
    if (depth > 8 || obj == null) return urls;
    if (typeof obj === "string") {
      if (IMG_EXT.test(obj) || /alicdn|360buyimg|pddpic/i.test(obj)) urls.push(obj);
      return urls;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) urls.push(...extractJsonImages(item, depth + 1));
      return urls;
    }
    if (typeof obj === "object") {
      for (const v of Object.values(obj)) urls.push(...extractJsonImages(v, depth + 1));
    }
    return urls;
  }

  /* ---------- 淘宝 / 天猫 ---------- */
  function extractTaobao() {
    const raw = [];

    const mainSelectors = [
      "#J_UlThumb img",
      "#J_ImgBooth",
      ".tb-thumb img",
      ".tb-pic img",
      ".tb-gallery img",
      ".PicGallery img",
      "[class*='mainPic'] img",
      "[class*='MainPic'] img",
      "[class*='thumbnail'] img",
      "[class*='Thumbnail'] img",
      ".item-gallery img",
      "#detail img",
    ];
    raw.push(...extractFromElements(queryAll(mainSelectors)));

    // 详情区
    const descRoots = queryAll([
      "#description",
      "#J_DivItemDesc",
      "#J_DetailDesc",
      ".descV8-container",
      "[class*='descV']",
      "#content",
      ".content-detail",
    ]);
    for (const root of descRoots) {
      raw.push(...extractFromElements(root.querySelectorAll("img")));
      raw.push(...extractFromHtmlString(root.innerHTML));
    }

    // 页面脚本里的图片配置
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const text = s.textContent || "";
      if (!text || text.length > 500000) continue;
      if (/auctionImages|imageList|descUrl|picUrl|imgList/i.test(text)) {
        const jsonLike = text.match(/[\[{][\s\S]{20,}?[\]}]/g) || [];
        for (const chunk of jsonLike.slice(0, 30)) {
          try {
            raw.push(...extractJsonImages(JSON.parse(chunk)));
          } catch {
            raw.push(...extractFromHtmlString(chunk));
          }
        }
        raw.push(...extractFromHtmlString(text));
      }
    }

    // 兜底：页面所有足够大的图
    document.querySelectorAll("img").forEach((img) => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w >= 200 || h >= 200 || !w) {
        raw.push(...pickAttr(img));
      }
    });

    return normalizeList(raw);
  }

  /* ---------- 京东 ---------- */
  function extractJd() {
    const raw = [];

    const mainSelectors = [
      "#spec-list img",
      "#spec-img",
      "#spec-n1 img",
      ".spec-items img",
      ".lh img",
      "#preview img",
      ".product-img img",
      ".jqzoom img",
    ];
    raw.push(...extractFromElements(queryAll(mainSelectors)));

    // 主图 data-url 常在 li
    document.querySelectorAll("#spec-list li img, .spec-items img").forEach((img) => {
      raw.push(...pickAttr(img));
      const dataUrl = img.getAttribute("data-url") || img.dataset.url;
      if (dataUrl) {
        let u = dataUrl;
        if (!u.startsWith("http")) u = "https://img14.360buyimg.com/n1/" + u.replace(/^\//, "");
        raw.push(u);
        // 尝试 n0 原图
        raw.push(u.replace(/\/n\d+\//, "/n0/").replace(/\/s\d+x\d+_/, "/"));
      }
    });

    const descRoots = queryAll([
      "#J-detail-content",
      "#detail",
      ".detail-content",
      "#comm-round-form",
      ".ssd-module-wrap",
    ]);
    for (const root of descRoots) {
      raw.push(...extractFromElements(root.querySelectorAll("img")));
      raw.push(...extractFromHtmlString(root.innerHTML));
    }

    // 详情懒加载背景
    document.querySelectorAll("[data-lazyload], [style*='background']").forEach((el) => {
      raw.push(...pickAttr(el));
      const lazy = el.getAttribute("data-lazyload");
      if (lazy) raw.push(lazy);
    });

    document.querySelectorAll("img").forEach((img) => {
      const w = img.naturalWidth || img.width || 0;
      if (w >= 200 || !w) raw.push(...pickAttr(img));
    });

    return normalizeList(raw);
  }

  /* ---------- 拼多多 / 商家版 ---------- */
  function extractPdd() {
    const raw = [];

    const mainSelectors = [
      "[class*='gallery'] img",
      "[class*='Gallery'] img",
      "[class*='carousel'] img",
      "[class*='Carousel'] img",
      "[class*='sku'] img",
      "[class*='goods'] img",
      "[class*='Goods'] img",
      "[class*='detail'] img",
      "[class*='Detail'] img",
      "[class*='preview'] img",
      "[class*='Preview'] img",
      ".goods-detail img",
      ".detail-gallery img",
    ];
    raw.push(...extractFromElements(queryAll(mainSelectors)));

    // 商家后台常见结构
    const mmsSelectors = [
      ".goods-edit img",
      ".goods-detail-edit img",
      "[class*='upload'] img",
      "[class*='Upload'] img",
      ".ant-upload img",
      ".image-list img",
      "[class*='imageList'] img",
      "[class*='ImageList'] img",
      "img[src*='pddpic']",
      "img[src*='yangkeduo']",
    ];
    raw.push(...extractFromElements(queryAll(mmsSelectors)));

    document.querySelectorAll("script").forEach((s) => {
      const text = s.textContent || "";
      if (!text || text.length > 800000) return;
      if (/gallery|topGallery|detailGallery|thumbUrl|imageUrl|hd_thumb_url/i.test(text)) {
        raw.push(...extractFromHtmlString(text));
        try {
          const m = text.match(/\{[\s\S]*"gallery"[\s\S]*\}/);
          if (m) raw.push(...extractJsonImages(JSON.parse(m[0])));
        } catch {
          /* ignore */
        }
      }
    });

    document.querySelectorAll("img").forEach((img) => {
      const src = img.currentSrc || img.src || "";
      if (/pddpic|yangkeduo|pinduoduo/i.test(src)) raw.push(...pickAttr(img));
      else {
        const w = img.naturalWidth || img.width || 0;
        if (w >= 150) raw.push(...pickAttr(img));
      }
    });

    return normalizeList(raw);
  }

  function detectPlatform() {
    const host = location.hostname;
    if (/taobao\.com|tmall\.com/i.test(host)) return "taobao";
    if (/jd\.com|jd\.hk/i.test(host)) return "jd";
    if (/pinduoduo\.com|yangkeduo\.com/i.test(host)) return "pdd";
    return "unknown";
  }

  function extractAll() {
    const platform = detectPlatform();
    let urls = [];
    if (platform === "taobao") urls = extractTaobao();
    else if (platform === "jd") urls = extractJd();
    else if (platform === "pdd") urls = extractPdd();
    else {
      // 通用兜底
      const raw = [];
      document.querySelectorAll("img").forEach((img) => raw.push(...pickAttr(img)));
      urls = normalizeList(raw);
    }

    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document.title.replace(/[-_–—|].*$/, "").trim() ||
      "商品图片";

    return {
      platform,
      title: title.slice(0, 80),
      pageUrl: location.href,
      images: urls.map((url, i) => ({ id: i + 1, url })),
      extractedAt: Date.now(),
    };
  }

  global.EcommerceImageExtractors = { extractAll, detectPlatform, upgradeUrl };
})(typeof window !== "undefined" ? window : self);
