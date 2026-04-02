(function () {
  var config = window.XIAOGAI_CLOUDBASE_CONFIG || {};
  var page = document.body.getAttribute("data-page");
  var adminStorageKey = config.adminStorageKey || "xiaogai-admin-token";
  var siteSettingsStorageKey = config.siteSettingsStorageKey || "xiaogai-site-settings";
  var appInstance = null;
  var authInstance = null;
  var useFallback = false;
  var DEFAULT_SITE_SETTINGS = {
    siteTitle: "why me",
    browserTitle: "why me",
    siteBio: "做有意思的事情。",
    xiaohongshuUrl: "https://www.xiaohongshu.com/user/profile/6720c690000000001c01b883?xsec_token=ABRs9q5J79rkqZIGS1vjAYLPMItpArQTzpcWQTTo1KZvU=&xsec_source=pc_feed",
    emailAddress: "gainubi@gmail.com"
  };
  var currentSiteSettings = Object.assign({}, DEFAULT_SITE_SETTINGS);
  var siteSettingsPromise = null;
  var LOGO_HINTS = ["Something", "Interesting", "Thoughtful", "Writing", "Everyday", "Notes"];

  var FALLBACK_POSTS = [];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toDateTimeLocal(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    var offset = date.getTimezoneOffset();
    var localDate = new Date(date.getTime() - offset * 60000);
    return localDate.toISOString().slice(0, 16);
  }

  function markdownToHtml(markdown) {
    var lines = String(markdown || "").split(/\r?\n/);
    var blocks = [];
    var paragraph = [];
    var quote = [];

    function renderInlineMarkdown(text) {
      var html = escapeHtml(text || "");

      html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
        return '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '">';
      });

      html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
        return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + escapeHtml(label) + "</a>";
      });

      return html;
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      blocks.push("<p>" + renderInlineMarkdown(paragraph.join(" ")).replace(/\n/g, "<br>") + "</p>");
      paragraph = [];
    }

    function flushQuote() {
      if (!quote.length) return;
      blocks.push("<blockquote>" + renderInlineMarkdown(quote.join(" ")).replace(/\n/g, "<br>") + "</blockquote>");
      quote = [];
    }

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        flushQuote();
        return;
      }

      if (trimmed.indexOf(">") === 0) {
        flushParagraph();
        quote.push(trimmed.replace(/^>\s?/, ""));
        return;
      }

      flushQuote();
      paragraph.push(trimmed);
    });

    flushParagraph();
    flushQuote();

    return blocks.join("");
  }

  function excerptMarkdownToHtml(markdown) {
    return markdownToHtml(markdown || "").replace(/<img\b[^>]*>/g, "");
  }

  function stripMarkdownForExcerpt(content) {
    return String(content || "")
      .replace(/\r/g, "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/[*_~]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function excerptFromContent(content) {
    var normalized = stripMarkdownForExcerpt(content);
    if (!normalized) return "";

    var paragraphs = normalized
      .split(/\n{2,}/)
      .map(function (part) {
        return part.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
      })
      .filter(Boolean);

    var candidate = paragraphs[0] || normalized.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (!candidate) return "";

    var maxLength = 110;
    var sentenceMarks = ["。", "！", "？", "!", "?"];
    var trailingMarks = ['"', "'", "”", "’", ")", "）", "]", "】"];
    var sentenceEnd = -1;

    function isSentencePeriod(text, index) {
      var prev = text.charAt(index - 1);
      var next = text.charAt(index + 1);
      if (text.charAt(index) !== ".") return false;
      if (!prev || prev === "." || next === ".") return false;
      if (next && !/[\s"'”’)\]】}]/.test(next)) return false;
      return true;
    }

    for (var i = 0; i < candidate.length; i += 1) {
      var char = candidate.charAt(i);
      if (sentenceMarks.indexOf(char) === -1 && !isSentencePeriod(candidate, i)) continue;
      sentenceEnd = i;
      while (sentenceEnd + 1 < candidate.length && trailingMarks.indexOf(candidate.charAt(sentenceEnd + 1)) !== -1) {
        sentenceEnd += 1;
      }
      break;
    }

    if (sentenceEnd >= 0 && sentenceEnd < maxLength) {
      var firstSentence = candidate.slice(0, sentenceEnd + 1).trim();
      if (firstSentence) return firstSentence;
    }

    if (candidate.length <= maxLength) return candidate;

    var cutIndex = -1;
    var breakpoints = ["。", "！", "？", "!", "?", "，", ",", "、", ";", "；", " "];
    breakpoints.forEach(function (mark) {
      var index = candidate.lastIndexOf(mark, maxLength);
      if (index > cutIndex) cutIndex = index;
    });

    for (var periodIndex = candidate.lastIndexOf(".", maxLength); periodIndex >= 0; periodIndex = candidate.lastIndexOf(".", periodIndex - 1)) {
      if (!isSentencePeriod(candidate, periodIndex)) continue;
      if (periodIndex > cutIndex) cutIndex = periodIndex;
      break;
    }

    if (cutIndex >= 24) {
      return candidate.slice(0, cutIndex + (candidate[cutIndex] === " " ? 0 : 1)).trim();
    }

    return candidate.slice(0, maxLength).trim();
  }

  function nowShanghaiIso() {
    var now = new Date();
    var shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return shanghai.toISOString().slice(0, 19) + "+08:00";
  }

  function buildSlug(title) {
    return String(title || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[/?#%]/g, "");
  }

  function normalizeSiteSettings(settings) {
    settings = settings || {};
    var siteTitle = String(settings.siteTitle || "").trim() || DEFAULT_SITE_SETTINGS.siteTitle;
    var browserTitle = String(settings.browserTitle || "").trim() || DEFAULT_SITE_SETTINGS.browserTitle;
    var siteBio = String(settings.siteBio || "").trim() || DEFAULT_SITE_SETTINGS.siteBio;
    var xiaohongshuUrl = String(settings.xiaohongshuUrl || "").trim() || DEFAULT_SITE_SETTINGS.xiaohongshuUrl;
    var emailAddress = String(settings.emailAddress || "").trim() || DEFAULT_SITE_SETTINGS.emailAddress;
    return {
      siteTitle: siteTitle.slice(0, 30),
      browserTitle: browserTitle.slice(0, 80),
      siteBio: siteBio.slice(0, 120),
      xiaohongshuUrl: xiaohongshuUrl,
      emailAddress: emailAddress.slice(0, 320)
    };
  }

  function readCachedSiteSettings() {
    try {
      var raw = localStorage.getItem(siteSettingsStorageKey);
      if (!raw) return null;
      return normalizeSiteSettings(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function persistSiteSettingsCache(settings) {
    try {
      localStorage.setItem(siteSettingsStorageKey, JSON.stringify(normalizeSiteSettings(settings)));
    } catch (error) {}
  }

  function getCurrentSiteSettings() {
    return normalizeSiteSettings(currentSiteSettings);
  }

  async function loadSiteSettings(forceReload) {
    if (forceReload) {
      siteSettingsPromise = null;
    }

    if (siteSettingsPromise) {
      return siteSettingsPromise;
    }

    if (useFallback || !config.envId) {
      currentSiteSettings = normalizeSiteSettings(DEFAULT_SITE_SETTINGS);
      siteSettingsPromise = Promise.resolve(getCurrentSiteSettings());
      return siteSettingsPromise;
    }

    siteSettingsPromise = callApi("getSiteSettings")
      .then(function (result) {
        currentSiteSettings = normalizeSiteSettings(result.settings || {});
        return getCurrentSiteSettings();
      })
      .catch(function () {
        currentSiteSettings = normalizeSiteSettings(DEFAULT_SITE_SETTINGS);
        return getCurrentSiteSettings();
      });

    return siteSettingsPromise;
  }

  function buildLogoMarkup(title) {
    var chars = Array.from(String(title || DEFAULT_SITE_SETTINGS.siteTitle).trim() || DEFAULT_SITE_SETTINGS.siteTitle);
    var modes = ["night", "day", "sunny"];

    return chars.map(function (char, index) {
      if (!char.trim()) {
        return '<span class="logo-gap" aria-hidden="true"></span>';
      }
      return [
        '<button class="logo-letter" type="button" data-mode="' + modes[index % modes.length] + '">',
        escapeHtml(char),
        '<span class="logo-hint">' + escapeHtml(LOGO_HINTS[index % LOGO_HINTS.length]) + "</span>",
        "</button>"
      ].join("");
    }).join("");
  }

  function applyGlobalSiteSettings(settings) {
    currentSiteSettings = normalizeSiteSettings(settings);
    persistSiteSettingsCache(currentSiteSettings);

    if (page === "home") {
      document.title = currentSiteSettings.browserTitle;
      var logo = document.getElementById("site-logo");
      if (logo) {
        logo.innerHTML = buildLogoMarkup(currentSiteSettings.siteTitle);
        var compactTitleLength = Array.from(currentSiteSettings.siteTitle.replace(/\s+/g, "")).length;
        logo.classList.toggle("is-long", compactTitleLength > 3);
        logo.classList.toggle("is-very-long", compactTitleLength > 5);
      }
      var bio = document.getElementById("site-bio");
      if (bio) {
        bio.textContent = currentSiteSettings.siteBio || DEFAULT_SITE_SETTINGS.siteBio;
      }
      var rednoteLink = document.getElementById("connect-rednote-link");
      if (rednoteLink) {
        rednoteLink.href = currentSiteSettings.xiaohongshuUrl || DEFAULT_SITE_SETTINGS.xiaohongshuUrl;
      }
      var emailLink = document.getElementById("connect-email-link");
      if (emailLink) {
        emailLink.href = "mailto:" + (currentSiteSettings.emailAddress || DEFAULT_SITE_SETTINGS.emailAddress);
      }
      return;
    }

    if (page === "post") {
      document.title = "文章 | " + currentSiteSettings.browserTitle;
      return;
    }

    if (page === "admin") {
      document.title = "CMS | " + currentSiteSettings.browserTitle;
      var brandTitle = document.getElementById("admin-brand-title");
      if (brandTitle) {
        brandTitle.textContent = currentSiteSettings.siteTitle + " 内容后台";
      }
    }
  }

  function setFeedback(element, message, type) {
    if (!element) return;
    element.textContent = message || "";
    element.className = "feedback" + (type ? " " + type : "");
  }

  function readCookie(name) {
    var match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[2]) : "";
  }

  function persistMode(mode) {
    try {
      localStorage.setItem("xiaogai-display-mode", mode);
    } catch (error) {}

    try {
      document.cookie = "xiaogai-display-mode=" + encodeURIComponent(mode) + "; path=/; max-age=31536000; SameSite=Lax";
    } catch (error) {}
  }

  function getPersistedMode() {
    var mode = "";

    try {
      mode = localStorage.getItem("xiaogai-display-mode") || "";
    } catch (error) {
      mode = "";
    }

    if (!mode) {
      mode = readCookie("xiaogai-display-mode");
    }

    return ["night", "day", "sunny"].indexOf(mode) >= 0 ? mode : "";
  }

  function ensureModeControl() {
    var currentMode = getPersistedMode() || "sunny";
    var modeLabel = document.getElementById("mode-label");
    var modeOrder = ["night", "day", "sunny"];
    var video = document.getElementById("leaves-overlay");
    var audio = document.getElementById("forest-audio");
    var audioUnlocked = false;
    var fadeFrame = 0;
    var audioBaseVolume = 0.52;

    function cancelAudioFade() {
      if (!fadeFrame) return;
      cancelAnimationFrame(fadeFrame);
      fadeFrame = 0;
    }

    function fadeAudioTo(targetVolume, duration, onDone) {
      if (!audio) {
        if (typeof onDone === "function") onDone();
        return;
      }

      cancelAudioFade();

      var startVolume = Number.isFinite(audio.volume) ? audio.volume : audioBaseVolume;
      var nextVolume = Math.max(0, Math.min(1, targetVolume));
      var startTime = 0;

      function tick(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min(1, (timestamp - startTime) / Math.max(duration || 1, 1));
        audio.volume = startVolume + (nextVolume - startVolume) * progress;
        if (progress < 1) {
          fadeFrame = requestAnimationFrame(tick);
          return;
        }
        fadeFrame = 0;
        if (typeof onDone === "function") onDone();
      }

      if (duration <= 0) {
        audio.volume = nextVolume;
        if (typeof onDone === "function") onDone();
        return;
      }

      fadeFrame = requestAnimationFrame(tick);
    }

    function stopSummerMedia(options) {
      options = options || {};
      var resetPlayback = options.resetPlayback !== false;
      var resetVideo = options.resetVideo !== false;
      var fadeDuration = options.fadeDuration == null ? 280 : options.fadeDuration;

      if (video) {
        video.pause();
        if (resetVideo) {
          try {
            video.currentTime = 0;
          } catch (error) {}
        }
      }

      if (!audio) return;

      function finalizeStop() {
        audio.pause();
        if (resetPlayback) {
          try {
            audio.currentTime = 0;
          } catch (error) {}
        }
        audio.volume = audioBaseVolume;
      }

      if (!audio.paused && audio.volume > 0.01) {
        fadeAudioTo(0, fadeDuration, finalizeStop);
        return;
      }

      finalizeStop();
    }

    function maybePlaySummerMedia() {
      if (currentMode !== "sunny" || document.hidden) return;

      if (video) {
        video.play().catch(function () {});
      }

      if (!audio || !audioUnlocked) return;

      if (!audio.paused) {
        fadeAudioTo(audioBaseVolume, 180);
        return;
      }

      cancelAudioFade();
      audio.volume = 0;
      audio.play()
        .then(function () {
          fadeAudioTo(audioBaseVolume, 320);
        })
        .catch(function () {});
    }

    function setMode(mode) {
      currentMode = mode;
      document.body.classList.remove("light", "sunny");
      ["night", "day", "sunny"].forEach(function (item) {
        var dot = document.getElementById("dot-" + item);
        if (dot) dot.classList.remove("active");
      });

      if (mode === "day") {
        document.body.classList.add("light");
        document.getElementById("dot-day").classList.add("active");
        if (modeLabel) modeLabel.textContent = "day";
        stopSummerMedia();
      } else if (mode === "sunny") {
        document.body.classList.add("light", "sunny");
        document.getElementById("dot-sunny").classList.add("active");
        if (modeLabel) modeLabel.textContent = "sunny";
        maybePlaySummerMedia();
      } else {
        document.getElementById("dot-night").classList.add("active");
        if (modeLabel) modeLabel.textContent = "night";
        stopSummerMedia();
      }

      persistMode(currentMode);
    }

    function cycleMode() {
      var currentIndex = modeOrder.indexOf(currentMode);
      var nextIndex = currentIndex >= 0 ? (currentIndex + 1) % modeOrder.length : 0;
      setMode(modeOrder[nextIndex]);
    }

    document.addEventListener("keydown", function (event) {
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.key === "d" || event.key === "D") setMode("day");
      if (event.key === "n" || event.key === "N") setMode("night");
      if (event.key === "s" || event.key === "S") setMode("sunny");
    });

    document.addEventListener("pointerdown", function () {
      audioUnlocked = true;
      if (currentMode === "sunny") {
        maybePlaySummerMedia();
      }
    }, { once: true, passive: true });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopSummerMedia({ resetPlayback: false, resetVideo: false, fadeDuration: 180 });
        return;
      }
      if (currentMode === "sunny") {
        maybePlaySummerMedia();
      }
    });

    document.querySelectorAll(".logo-letter").forEach(function (el) {
      el.addEventListener("click", function () {
        cycleMode();
        if (typeof el.blur === "function") {
          el.blur();
        }
      });
    });

    ["night", "day", "sunny"].forEach(function (mode) {
      var dot = document.getElementById("dot-" + mode);
      if (!dot) return;
      dot.addEventListener("click", function () {
        setMode(mode);
      });
    });

    setMode(currentMode);
  }

  // 直接通过 HTTP 触发器调用云函数，无需 SDK 和 access_token
  async function callApi(action, data) {
    var apiUrl = config.apiUrl;
    if (!apiUrl) {
      throw new Error("CloudBase API 尚未配置，请在 cloudbase-config.js 中填写 apiUrl");
    }

    var body = Object.assign({ action: action }, data || {});

    var response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    var result = await response.json();

    if (result.ok === false) {
      throw new Error(result.message || "请求失败");
    }

    return result;
  }

  function getFallbackPost(identifier) {
    return FALLBACK_POSTS.find(function (item) {
      return item.id === identifier || item.slug === identifier;
    }) || null;
  }

  async function listPosts(opts) {
    opts = opts || {};
    if (useFallback || !config.envId) {
      var fallback = FALLBACK_POSTS.slice();
      return { posts: fallback, total: fallback.length };
    }

    try {
      var params = {};
      if (opts.page) params.page = opts.page;
      if (opts.pageSize) params.pageSize = opts.pageSize;
      var result = await callApi("listPosts", params);
      return {
        posts: result.posts || [],
        total: result.total || 0
      };
    } catch (error) {
      console.warn(error);
      useFallback = true;
      var fb = FALLBACK_POSTS.slice();
      return { posts: fb, total: fb.length };
    }
  }

  async function getPost(identifier) {
    if (useFallback || !config.envId) {
      return { post: getFallbackPost(identifier), comments: [] };
    }

    try {
      var result = await callApi("getPost", { slug: identifier, id: identifier });
      return { post: result.post || null, comments: result.comments || [] };
    } catch (error) {
      console.warn(error);
      useFallback = true;
      return { post: getFallbackPost(identifier), comments: [] };
    }
  }

  function animateEntries(selector) {
    var entries = document.querySelectorAll(selector);
    if (!entries.length || !("IntersectionObserver" in window)) {
      entries.forEach(function (entry) { entry.classList.add("visible"); });
      return;
    }

    var observer = new IntersectionObserver(function (items) {
      items.forEach(function (item) {
        if (item.isIntersecting) item.target.classList.add("visible");
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

    entries.forEach(function (entry) {
      observer.observe(entry);
    });
  }

  function bindEntryCards(selector) {
    document.querySelectorAll(selector).forEach(function (entry) {
      var href = entry.getAttribute("data-entry-href");
      if (!href) return;

      entry.addEventListener("click", function (event) {
        if (event.target && event.target.closest("a, button, input, textarea, select, label")) return;
        window.location.href = href;
      });

      entry.addEventListener("keydown", function (event) {
        if (event.target !== entry) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        window.location.href = href;
      });
    });
  }

  async function initHomePage() {
    var pageSize = 10;
    var params = new URLSearchParams(window.location.search);
    var currentPage = Math.max(parseInt(params.get("page") || "1", 10) || 1, 1);
    var list = document.getElementById("posts-list");
    var empty = document.getElementById("posts-empty");
    var pagination = document.getElementById("home-posts-pagination");
    var total = 0;

    async function loadPage(page) {
      var data = await listPosts({ page: page, pageSize: pageSize });
      total = data.total;
      return data.posts;
    }

    var posts = await loadPage(currentPage);
    var totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (currentPage > totalPages) {
      currentPage = totalPages;
      posts = await loadPage(currentPage);
    }

    function updateHomePageUrl(page) {
      var next = new URL(window.location.href);
      if (page <= 1) {
        next.searchParams.delete("page");
      } else {
        next.searchParams.set("page", String(page));
      }
      window.history.replaceState(null, "", next.pathname + next.search + next.hash);
    }

    function renderHomePagination() {
      if (!pagination) return;

      if (totalPages <= 1) {
        pagination.innerHTML = "";
        return;
      }

      var prevDisabled = currentPage <= 1 ? " disabled" : "";
      var nextDisabled = currentPage >= totalPages ? " disabled" : "";
      pagination.innerHTML = [
        '<button class="button button-ghost home-page-button" type="button" data-home-page="prev"' + prevDisabled + '>上一页</button>',
        '<div class="home-page-indicator">第 ' + currentPage + ' / ' + totalPages + ' 页</div>',
        '<button class="button button-ghost home-page-button" type="button" data-home-page="next"' + nextDisabled + '>下一页</button>'
      ].join("");

      pagination.querySelectorAll("[data-home-page]").forEach(function (button) {
        button.addEventListener("click", async function () {
          var action = button.getAttribute("data-home-page");
          if (action === "prev" && currentPage > 1) currentPage -= 1;
          if (action === "next" && currentPage < totalPages) currentPage += 1;
          updateHomePageUrl(currentPage);
          var newPosts = await loadPage(currentPage);
          renderHomePosts(newPosts);
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      });
    }

    function renderHomePosts(postsToRender) {
      postsToRender = postsToRender || posts;

      if (!postsToRender.length) {
        empty.classList.remove("hidden");
        list.innerHTML = "";
        if (pagination) pagination.innerHTML = "";
        return;
      }

      empty.classList.add("hidden");
      list.innerHTML = postsToRender.map(function (post) {
        var href = "./post.html?id=" + encodeURIComponent(post.id);
        return [
          '<article class="entry-card" tabindex="0" role="link" aria-label="查看文章《' + escapeHtml(post.title) + '》" data-entry-href="' + href + '">',
          '  <div class="entry-link">',
          '    <h2 class="entry-title">' + escapeHtml(post.title) + "</h2>",
          '    <div class="entry-excerpt">' + excerptMarkdownToHtml(excerptFromContent(post.content || post.excerpt || "")) + "</div>",
          '    <div class="entry-meta">',
          '      <span class="meta-chip">' + escapeHtml(formatDate(post.publishedAt)) + "</span>",
          "    </div>",
          "  </div>",
          "</article>"
        ].join("");
      }).join("");

      renderHomePagination();
      animateEntries(".entry-card");
      bindEntryCards(".entry-card[data-entry-href]");
    }

    updateHomePageUrl(currentPage);
    renderHomePosts();
  }

  async function initPostPage() {
    var params = new URLSearchParams(window.location.search);
    var postId = params.get("id") || params.get("slug");
    var hasIdParam = Boolean(params.get("id"));
    var shell = document.getElementById("post-view");
    var empty = document.getElementById("post-empty");
    var editLink = document.getElementById("post-edit-link");
    var commentsList = document.getElementById("comments-list");
    var commentsEmpty = document.getElementById("comments-empty");
    var form = document.getElementById("comment-form");
    var feedback = document.getElementById("comment-feedback");
    var isAdmin = Boolean(getAdminToken());

    if (!postId) {
      empty.classList.remove("hidden");
      return;
    }

    var data = await getPost(postId);
    if (!data.post) {
      empty.classList.remove("hidden");
      return;
    }

    if (!hasIdParam && data.post.id) {
      var canonicalUrl = "./post.html?id=" + encodeURIComponent(data.post.id);
      window.history.replaceState(null, "", canonicalUrl);
    }

    document.title = data.post.title + " | " + getCurrentSiteSettings().browserTitle;
    shell.classList.remove("hidden");
    document.getElementById("post-title").textContent = data.post.title;
    if (editLink && getAdminToken() && data.post.id) {
      editLink.href = "./admin.html?edit=" + encodeURIComponent(data.post.id);
      editLink.classList.remove("hidden");
    }
    document.getElementById("post-meta").innerHTML = [
      '<span class="meta-chip">' + escapeHtml(formatDate(data.post.publishedAt)) + "</span>"
    ].join("");
    document.getElementById("post-content").innerHTML = markdownToHtml(data.post.content || "");

    function sortCommentsByTime(items, direction) {
      return (items || []).slice().sort(function (a, b) {
        var at = new Date(a.createdAt || "").getTime() || 0;
        var bt = new Date(b.createdAt || "").getTime() || 0;
        return direction === "asc" ? at - bt : bt - at;
      });
    }

    function buildCommentTree(items) {
      var byId = {};
      var roots = [];

      (items || []).forEach(function (comment) {
        byId[comment.id] = Object.assign({}, comment, { replies: [], replyTo: "" });
      });

      // 真正的树形嵌套：每条回复直接挂到父评论下；同时注入 replyTo 用于显示 @名字
      Object.keys(byId).forEach(function (id) {
        var comment = byId[id];
        if (comment.parentId && byId[comment.parentId]) {
          var parent = byId[comment.parentId];
          comment.replyTo = parent.author || "匿名";
          parent.replies.push(comment);
        } else {
          roots.push(comment);
        }
      });

      function sortBranch(list) {
        list.sort(function (a, b) {
          return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
        });
        list.forEach(function (c) {
          if (c.replies && c.replies.length) sortBranch(c.replies);
        });
      }

      roots.sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
      roots.forEach(function (c) {
        if (c.replies && c.replies.length) sortBranch(c.replies);
      });
      return roots;
    }

    function renderCommentNodes(items, depth) {
      return (items || []).map(function (comment) {
        var badge = comment.isAuthor ? '<span class="comment-badge">作者</span>' : "";
        // @ 标签：有 replyTo 字段时展示（拍平时注入）
        var replyToTag = comment.replyTo ? '<span class="comment-reply-to">@ ' + escapeHtml(comment.replyTo) + '</span> ' : "";
        // 管理员删除按钮
        var deleteBtn = isAdmin
          ? '<button class="subtle-link subtle-button comment-delete-button" type="button" data-comment-delete="' + escapeHtml(comment.id) + '">删除</button>'
          : "";
        // 深度最多 4 层缩进（防止手机端过窄）
        var depthClass = depth ? "comment-depth-" + Math.min(depth, 4) : "";
        return [
          '<article class="comment-card ' + depthClass + '" data-comment-id="' + escapeHtml(comment.id) + '" data-author="' + escapeHtml(comment.author || "匿名") + '">',
          '  <div class="comment-meta"><span class="comment-author-name">' + escapeHtml(comment.author || "匿名") + "</span>" + badge + " · " + escapeHtml(formatDate(comment.createdAt)) + "</div>",
          '  <div class="comment-content">' + replyToTag + escapeHtml(comment.content || "") + "</div>",
          '  <div class="comment-actions">',
          '    <button class="subtle-link subtle-button comment-reply-button" type="button" data-reply-toggle="' + escapeHtml(comment.id) + '">回复</button>',
          deleteBtn,
          '  </div>',
          '  <form class="comment-reply-form hidden" data-reply-form="' + escapeHtml(comment.id) + '">',
          '    <div class="field-row"><label class="field-label" for="reply-author-' + escapeHtml(comment.id) + '">名字</label><input id="reply-author-' + escapeHtml(comment.id) + '" name="author" maxlength="24" placeholder="怎么称呼你"></div>',
          '    <div class="field-row"><label class="field-label" for="reply-content-' + escapeHtml(comment.id) + '">回复</label><textarea id="reply-content-' + escapeHtml(comment.id) + '" name="content" rows="3" maxlength="600" placeholder="说点什么"></textarea></div>',
          '    <div class="comment-reply-actions"><button class="button" type="submit">提交回复</button><button class="button button-ghost" type="button" data-reply-cancel="' + escapeHtml(comment.id) + '">取消</button></div>',
          '    <div class="feedback"></div>',
          "  </form>",
          comment.replies && comment.replies.length ? '<div class="comment-children">' + renderCommentNodes(comment.replies, (depth || 0) + 1) + "</div>" : "",
          "</article>"
        ].join("");
      }).join("");
    }

    async function reloadComments() {
      var latest = await getPost(data.post.id);
      comments = latest.comments || [];
      renderComments(comments);
    }

    function renderComments(items) {
      commentsList.innerHTML = renderCommentNodes(buildCommentTree(items || []), 0);

      commentsEmpty.classList.toggle("hidden", Boolean((items || []).length));

      commentsList.querySelectorAll("[data-reply-toggle]").forEach(function (button) {
        button.addEventListener("click", function () {
          var id = button.getAttribute("data-reply-toggle");
          var replyForm = commentsList.querySelector('[data-reply-form="' + id + '"]');
          if (!replyForm) return;
          replyForm.classList.toggle("hidden");
          if (!replyForm.classList.contains("hidden")) {
            var textarea = replyForm.querySelector("textarea");
            if (textarea) textarea.focus();
          }
        });
      });

      commentsList.querySelectorAll("[data-reply-cancel]").forEach(function (button) {
        button.addEventListener("click", function () {
          var id = button.getAttribute("data-reply-cancel");
          var replyForm = commentsList.querySelector('[data-reply-form="' + id + '"]');
          if (!replyForm) return;
          replyForm.reset();
          replyForm.classList.add("hidden");
          setFeedback(replyForm.querySelector(".feedback"), "");
        });
      });

      commentsList.querySelectorAll("[data-reply-form]").forEach(function (replyForm) {
        replyForm.addEventListener("submit", async function (event) {
          event.preventDefault();
          var authorInput = replyForm.querySelector('[name="author"]');
          var contentInput = replyForm.querySelector('[name="content"]');
          var localFeedback = replyForm.querySelector(".feedback");
          var payload = {
            postId: data.post.id,
            slug: data.post.slug,
            parentId: replyForm.getAttribute("data-reply-form"),
            author: ((authorInput && authorInput.value) || "").trim(),
            content: ((contentInput && contentInput.value) || "").trim()
          };

          if (!payload.author || !payload.content) {
            setFeedback(localFeedback, "名字和内容都要填。", "error");
            return;
          }

          try {
            await callApi("createComment", payload);
            await reloadComments();
          } catch (error) {
            setFeedback(localFeedback, error.message || "回复失败", "error");
          }
        });
      });

      // 管理员删除留言
      if (isAdmin) {
        commentsList.querySelectorAll("[data-comment-delete]").forEach(function (button) {
          button.addEventListener("click", async function () {
            var id = button.getAttribute("data-comment-delete");
            var commentItem = button.closest("[data-comment-id]");
            var author = commentItem ? commentItem.getAttribute("data-author") || "这条留言" : "这条留言";
            var confirmed = await showConfirmDialog("确定删除「" + author + "」吗？此操作不可恢复。");
            if (!confirmed) return;
            try {
              await callApi("adminUpdateCommentStatus", { token: getAdminToken(), id: id, status: "deleted" });
              await reloadComments();
            } catch (err) {
              alert("删除失败：" + (err.message || "未知错误"));
            }
          });
        });
      }
    }

    var comments = data.comments || [];
    renderComments(comments);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      var payload = {
        postId: data.post.id,
        slug: data.post.slug,
        author: (form.author.value || "").trim(),
        content: (form.content.value || "").trim()
      };

      if (!payload.author || !payload.content) {
        setFeedback(feedback, "名字和内容都要填。", "error");
        return;
      }

      if (!config.envId) {
        setFeedback(feedback, "当前是本地演示数据，先配置 CloudBase 再开启留言。", "error");
        return;
      }

      try {
        var result = await callApi("createComment", payload);
        await reloadComments();
        form.reset();
        setFeedback(feedback, (result && result.message) || "留言已提交，已显示在下方。", "success");
      } catch (error) {
        setFeedback(feedback, error.message || "留言提交失败", "error");
      }
    });
  }

  function getAdminToken() {
    return localStorage.getItem(adminStorageKey) || "";
  }

  function syncAdminSessionCookie(token) {
    var encoded = encodeURIComponent(token || "");
    var expires = token ? "; max-age=2592000" : "; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = adminStorageKey + "=" + encoded + expires + "; path=/; SameSite=Lax";
  }

  function setAdminToken(token) {
    if (token) {
      localStorage.setItem(adminStorageKey, token);
    } else {
      localStorage.removeItem(adminStorageKey);
    }
    syncAdminSessionCookie(token);
  }

  async function initAdminPage() {
    var adminParams = new URLSearchParams(window.location.search);
    var editPostId = adminParams.get("edit") || "";
    var nextUrl = adminParams.get("next") || "";
    var loginShell = document.getElementById("admin-login-shell");
    var adminShell = document.getElementById("admin-shell");
    var postsView = document.getElementById("admin-posts-view");
    var commentsView = document.getElementById("admin-comments-view");
    var settingsView = document.getElementById("admin-settings-view");
    var editorView = document.getElementById("admin-editor-view");
    var postsViewButton = document.getElementById("admin-view-posts");
    var commentsViewButton = document.getElementById("admin-view-comments");
    var settingsViewButton = document.getElementById("admin-view-settings");
    var loginForm = document.getElementById("admin-login-form");
    var loginFeedback = document.getElementById("admin-login-feedback");
    var postForm = document.getElementById("post-form");
    var postFormTitle = document.getElementById("post-form-title");
    var postFormSubtitle = document.getElementById("post-form-subtitle");
    var postSubmitButton = document.getElementById("post-submit-button");
    var postFeedback = document.getElementById("post-form-feedback");
    var postsList = document.getElementById("admin-posts-list");
    var postsPagination = document.getElementById("admin-posts-pagination");
    var commentsList = document.getElementById("admin-comments-list");
    var commentsFeedback = document.getElementById("admin-comments-feedback");
    var postsSummary = document.getElementById("admin-posts-summary");
    var commentsSummary = document.getElementById("admin-comments-summary");
    var postsCountBadge = document.getElementById("admin-posts-count");
    var commentsCountBadge = document.getElementById("admin-comments-count");
      var postSearchInput = document.getElementById("admin-post-search");
      var postSortSelect = document.getElementById("admin-post-sort");
      var commentSearchInput = document.getElementById("admin-comment-search");
      var commentPostFilter = document.getElementById("admin-comment-post-filter");
    var commentsPagination = document.getElementById("admin-comments-pagination");
    var newPostButton = document.getElementById("new-post-button");
    var cancelPostEditButton = document.getElementById("cancel-post-edit");
    var logoutButton = document.getElementById("logout-button");
    var siteSettingsForm = document.getElementById("site-settings-form");
    var siteSettingsFeedback = document.getElementById("site-settings-feedback");
    var siteTitleInput = document.getElementById("setting-site-title");
    var browserTitleInput = document.getElementById("setting-browser-title");
    var siteBioInput = document.getElementById("setting-site-bio");
    var xiaohongshuUrlInput = document.getElementById("setting-xiaohongshu-url");
    var emailAddressInput = document.getElementById("setting-email-address");
    var settingsPreviewSiteTitle = document.getElementById("settings-preview-site-title");
    var settingsPreviewBrowserTitle = document.getElementById("settings-preview-browser-title");
    var settingsPreviewSiteBio = document.getElementById("settings-preview-site-bio");
    var settingsPreviewRednoteLink = document.getElementById("settings-preview-rednote-link");
    var settingsPreviewEmailLink = document.getElementById("settings-preview-email-link");
    var adminPosts = [];
    var adminComments = [];
    var adminSiteSettings = getCurrentSiteSettings();
    var currentPostPage = 1;
    var currentCommentPage = 1;
    var currentAdminView = "comments";

    function redirectToNext() {
      if (!nextUrl || nextUrl.charAt(0) !== "/" || nextUrl.indexOf("//") === 0) return false;
      window.location.href = nextUrl;
      return true;
    }

    if (!config.envId) {
      setFeedback(loginFeedback, "先在 cloudbase-config.js 里填好 envId，再部署云函数。", "error");
    }

    function setAdminView(view) {
      currentAdminView = view;
      postsView.classList.toggle("hidden", view !== "posts");
      commentsView.classList.toggle("hidden", view !== "comments");
      settingsView.classList.toggle("hidden", view !== "settings");
      editorView.classList.toggle("hidden", view !== "editor");
      postsViewButton.classList.toggle("is-active", view === "posts");
      commentsViewButton.classList.toggle("is-active", view === "comments");
      settingsViewButton.classList.toggle("is-active", view === "settings");
    }

    function getDraftSiteSettings() {
      return normalizeSiteSettings({
        siteTitle: (siteTitleInput && siteTitleInput.value) || "",
        browserTitle: (browserTitleInput && browserTitleInput.value) || "",
        siteBio: (siteBioInput && siteBioInput.value) || "",
        xiaohongshuUrl: (xiaohongshuUrlInput && xiaohongshuUrlInput.value) || "",
        emailAddress: (emailAddressInput && emailAddressInput.value) || ""
      });
    }

    function renderSiteSettingsPreview(settings) {
      settings = normalizeSiteSettings(settings);
      if (settingsPreviewSiteTitle) {
        settingsPreviewSiteTitle.textContent = settings.siteTitle;
      }
      if (settingsPreviewBrowserTitle) {
        settingsPreviewBrowserTitle.textContent = "浏览器标签：" + settings.browserTitle;
      }
      if (settingsPreviewSiteBio) {
        settingsPreviewSiteBio.textContent = "副标题：" + settings.siteBio;
      }
      if (settingsPreviewRednoteLink) {
        settingsPreviewRednoteLink.textContent = "小红书：" + settings.xiaohongshuUrl;
      }
      if (settingsPreviewEmailLink) {
        settingsPreviewEmailLink.textContent = "邮箱：" + settings.emailAddress;
      }
    }

    function populateSiteSettingsForm(settings) {
      adminSiteSettings = normalizeSiteSettings(settings);
      if (siteTitleInput) siteTitleInput.value = adminSiteSettings.siteTitle;
      if (browserTitleInput) browserTitleInput.value = adminSiteSettings.browserTitle;
      if (siteBioInput) siteBioInput.value = adminSiteSettings.siteBio;
      if (xiaohongshuUrlInput) xiaohongshuUrlInput.value = adminSiteSettings.xiaohongshuUrl;
      if (emailAddressInput) emailAddressInput.value = adminSiteSettings.emailAddress;
      renderSiteSettingsPreview(adminSiteSettings);
    }

    function resetPostForm() {
      postForm.reset();
      document.getElementById("post-id").value = "";
      document.getElementById("post-slug").value = "";
      document.getElementById("post-excerpt").value = "";
      document.getElementById("post-published-at").value = "";
      postFormTitle.textContent = "新建文章";
      postFormSubtitle.textContent = "只需要填写标题和正文";
      postSubmitButton.textContent = "发布文章";
      setFeedback(postFeedback, "");
    }

    function updateSummary(element, visibleCount, totalCount, label) {
      if (!element) return;
      if (visibleCount === totalCount) {
        element.textContent = ""; // badge already shows the total
      } else {
        element.textContent = "显示 " + visibleCount + " / " + totalCount + " 条" + label;
      }
    }

    function showConfirmDialog(message) {
      return new Promise(function (resolve) {
        var modal = document.getElementById("confirm-modal");
        var messageEl = document.getElementById("confirm-modal-message");
        var okBtn = document.getElementById("confirm-modal-ok");
        var cancelBtn = document.getElementById("confirm-modal-cancel");

        messageEl.textContent = message;
        modal.classList.remove("hidden");
        okBtn.focus();

        function cleanup() {
          modal.classList.add("hidden");
          okBtn.removeEventListener("click", onOk);
          cancelBtn.removeEventListener("click", onCancel);
          modal.removeEventListener("click", onOverlayClick);
        }

        function onOk() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }
        function onOverlayClick(e) {
          if (e.target === modal) { cleanup(); resolve(false); }
        }

        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        modal.addEventListener("click", onOverlayClick);
      });
    }

    function openPostEditor(post) {
      if (!post) return;
      document.getElementById("post-id").value = post.id || "";
      document.getElementById("post-slug").value = post.slug || "";
      document.getElementById("post-title-input").value = post.title || "";
      document.getElementById("post-excerpt").value = post.excerpt || "";
      document.getElementById("post-published-at").value = toDateTimeLocal(post.publishedAt || post.updatedAt || "");
      document.getElementById("post-content-input").value = post.content || "";
      postFormTitle.textContent = "编辑文章";
      postFormSubtitle.textContent = "修改后会保留这篇文章原有发布时间";
      postSubmitButton.textContent = "保存文章";
      setAdminView("editor");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function renderPostsList(items) {
      postsList.innerHTML = (items || []).map(function (post) {
        return [
          '<article class="admin-item">',
          '  <div class="admin-item-title"><a class="admin-post-link" href="./post.html?id=' + escapeHtml(post.id) + '" target="_blank">' + escapeHtml(post.title) + "</a></div>",
          '  <div class="admin-meta">' + escapeHtml(formatDate(post.publishedAt || post.updatedAt)) + "</div>",
          '  <div class="admin-item-excerpt">' + escapeHtml(excerptFromContent(post.content || post.excerpt || "")) + "</div>",
          '  <div class="admin-item-actions">',
          '    <button class="button button-secondary" type="button" data-edit-post="' + escapeHtml(post.id) + '">编辑</button>',
          '    <button class="button button-danger" type="button" data-delete-post="' + escapeHtml(post.id) + '">删除</button>',
          "  </div>",
          "</article>"
        ].join("");
      }).join("") || '<div class="empty-state">没有符合条件的文章</div>';

      postsList.querySelectorAll("[data-edit-post]").forEach(function (button) {
        button.addEventListener("click", function () {
          var id = button.getAttribute("data-edit-post");
          var post = adminPosts.find(function (item) { return item.id === id; });
          openPostEditor(post);
        });
      });

      postsList.querySelectorAll("[data-delete-post]").forEach(function (button) {
        button.addEventListener("click", async function () {
          var id = button.getAttribute("data-delete-post");
          var post = adminPosts.find(function (item) { return item.id === id; });
          var postTitle = post ? post.title : "这篇文章";
          var confirmed = await showConfirmDialog("确定删除《" + postTitle + "》吗？此操作不可恢复。");
          if (!confirmed) return;
          try {
            await callApi("adminDeletePost", { token: getAdminToken(), id: id });
            resetPostForm();
            setFeedback(postFeedback, "文章已删除。", "success");
            await loadAdminData();
          } catch (error) {
            setFeedback(postFeedback, error.message || "删除失败", "error");
          }
        });
      });
    }

    function renderCommentsList(items) {
      commentsList.innerHTML = (items || []).map(function (comment) {
        var authorBadge = comment.authorRole === "author" ? ' <span class="comment-badge">作者</span>' : "";
        return [
          '<article class="admin-item" data-comment-id="' + escapeHtml(comment.id) + '" data-author="' + escapeHtml(comment.author || "匿名") + '">',
          '  <div class="admin-item-title">' + escapeHtml(comment.author || "匿名") + authorBadge + "</div>",
          '  <div class="admin-meta">' + (comment.postId ? '<a class="admin-post-link" href="./post.html?id=' + escapeHtml(comment.postId) + '" target="_blank">' + escapeHtml(comment.postTitle || comment.postSlug || "查看文章") + '</a>' : escapeHtml(comment.postTitle || comment.postSlug || "")) + " · " + escapeHtml(formatDate(comment.createdAt)) + "</div>",
          '  <div class="admin-item-excerpt">' + escapeHtml(comment.content || "") + "</div>",
          '  <div class="admin-item-actions">',
          '    <button class="button button-ghost" type="button" data-admin-comment-reply="' + escapeHtml(comment.id) + '">回复</button>',
          '    <button class="button button-danger" type="button" data-admin-comment-delete="' + escapeHtml(comment.id) + '">删除</button>',
          "  </div>",
          '  <form class="comment-reply-form hidden" data-admin-reply-form="' + escapeHtml(comment.id) + '">',
          '    <div class="field-row"><label class="field-label" for="admin-reply-content-' + escapeHtml(comment.id) + '">回复内容</label><textarea id="admin-reply-content-' + escapeHtml(comment.id) + '" name="content" rows="4" maxlength="600" placeholder="以 why me 身份回复"></textarea></div>',
          '    <div class="comment-reply-actions"><button class="button" type="submit">发布回复</button><button class="button button-ghost" type="button" data-admin-reply-cancel="' + escapeHtml(comment.id) + '">取消</button></div>',
          '    <div class="feedback"></div>',
          "  </form>",
          "</article>"
        ].join("");
      }).join("") || '<div class="empty-state">没有符合条件的留言</div>';

      commentsList.querySelectorAll("[data-admin-comment-reply]").forEach(function (button) {
        button.addEventListener("click", function () {
          var id = button.getAttribute("data-admin-comment-reply");
          var form = commentsList.querySelector('[data-admin-reply-form="' + id + '"]');
          if (!form) return;
          form.classList.toggle("hidden");
          if (!form.classList.contains("hidden")) {
            var textarea = form.querySelector("textarea");
            if (textarea) textarea.focus();
          }
        });
      });

      commentsList.querySelectorAll("[data-admin-reply-cancel]").forEach(function (button) {
        button.addEventListener("click", function () {
          var id = button.getAttribute("data-admin-reply-cancel");
          var form = commentsList.querySelector('[data-admin-reply-form="' + id + '"]');
          if (!form) return;
          form.reset();
          form.classList.add("hidden");
          setFeedback(form.querySelector(".feedback"), "");
        });
      });

      commentsList.querySelectorAll("[data-admin-reply-form]").forEach(function (replyForm) {
        replyForm.addEventListener("submit", async function (event) {
          event.preventDefault();
          var commentId = replyForm.getAttribute("data-admin-reply-form");
          var currentComment = (adminComments || []).find(function (item) { return item.id === commentId; });
          var localFeedback = replyForm.querySelector(".feedback");
          var content = ((replyForm.querySelector('[name="content"]') || {}).value || "").trim();

          if (!currentComment || !content) {
            setFeedback(localFeedback, "回复内容不能为空。", "error");
            return;
          }

          try {
            await callApi("createComment", {
              token: getAdminToken(),
              postId: currentComment.postId,
              slug: currentComment.postSlug,
              parentId: currentComment.id,
              content: content
            });
            replyForm.reset();
            replyForm.classList.add("hidden");
            await loadAdminData();
            setFeedback(commentsFeedback, "回复已发布。", "success");
            setAdminView("comments");
          } catch (error) {
            setFeedback(localFeedback, error.message || "回复失败", "error");
          }
        });
      });

      commentsList.querySelectorAll("[data-admin-comment-delete]").forEach(function (button) {
        button.addEventListener("click", async function () {
          var id = button.getAttribute("data-admin-comment-delete");
          var commentItem = button.closest("[data-comment-id]");
          var author = commentItem ? commentItem.getAttribute("data-author") || "这条留言" : "这条留言";
          var confirmed = await showConfirmDialog("确定删除「" + author + "」及其所有回复吗？此操作不可恢复。");
          if (!confirmed) return;

          try {
            await callApi("adminUpdateCommentStatus", {
              token: getAdminToken(),
              id: id,
              status: "deleted"
            });
            await loadAdminData();
            setFeedback(commentsFeedback, "留言已删除。", "success");
            setAdminView("comments");
          } catch (error) {
            setFeedback(commentsFeedback, error.message || "删除失败", "error");
          }
        });
      });
    }

    function comparePosts(a, b, sortValue) {
      function timeValue(value) {
        var time = new Date(value || "").getTime();
        return Number.isNaN(time) ? 0 : time;
      }

      if (sortValue === "publishedAt-desc") {
        return timeValue(b.publishedAt || b.updatedAt) - timeValue(a.publishedAt || a.updatedAt);
      }

      if (sortValue === "title-asc") {
        return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
      }

      return timeValue(b.updatedAt || b.publishedAt) - timeValue(a.updatedAt || a.publishedAt);
    }

    function renderPostsPagination(totalItems, pageSize, currentPage) {
      var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      if (totalItems <= pageSize) {
        postsPagination.innerHTML = "";
        return;
      }

      var prevDisabled = currentPage <= 1 ? " disabled" : "";
      var nextDisabled = currentPage >= totalPages ? " disabled" : "";
      postsPagination.innerHTML = [
        '<button class="button button-ghost admin-page-button" type="button" data-page-action="prev"' + prevDisabled + '>上一页</button>',
        '<div class="admin-page-indicator">第 ' + currentPage + ' / ' + totalPages + ' 页</div>',
        '<button class="button button-ghost admin-page-button" type="button" data-page-action="next"' + nextDisabled + '>下一页</button>'
      ].join("");

      postsPagination.querySelectorAll("[data-page-action]").forEach(function (button) {
        button.addEventListener("click", function () {
          var action = button.getAttribute("data-page-action");
          if (action === "prev" && currentPostPage > 1) currentPostPage -= 1;
          if (action === "next" && currentPostPage < totalPages) currentPostPage += 1;
          applyAdminFilters();
        });
      });
    }

    function renderCommentsPagination(totalFiltered, pageSize, currentPage) {
      if (!commentsPagination) return;
      var totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));

      if (totalPages <= 1) {
        commentsPagination.innerHTML = "";
        return;
      }

      var prevDisabled = currentPage <= 1 ? " disabled" : "";
      var nextDisabled = currentPage >= totalPages ? " disabled" : "";
      commentsPagination.innerHTML = [
        '<button class="button button-ghost admin-page-button" type="button" data-comment-page-action="prev"' + prevDisabled + '>上一页</button>',
        '<div class="admin-page-indicator">第 ' + currentPage + ' / ' + totalPages + ' 页</div>',
        '<button class="button button-ghost admin-page-button" type="button" data-comment-page-action="next"' + nextDisabled + '>下一页</button>'
      ].join("");

      commentsPagination.querySelectorAll("[data-comment-page-action]").forEach(function (button) {
        button.addEventListener("click", function () {
          var action = button.getAttribute("data-comment-page-action");
          if (action === "prev" && currentCommentPage > 1) currentCommentPage -= 1;
          if (action === "next" && currentCommentPage < totalPages) currentCommentPage += 1;
          applyAdminFilters();
        });
      });
    }

    function syncCommentPostFilter(comments) {
      var currentValue = commentPostFilter.value || "all";
      var options = ["<option value=\"all\">全部文章</option>"];
      var seen = {};

      (comments || []).forEach(function (comment) {
        var value = comment.postSlug || comment.postTitle || "";
        var label = comment.postTitle || comment.postSlug || "未命名文章";
        if (!value || seen[value]) return;
        seen[value] = true;
        options.push('<option value="' + escapeHtml(value) + '">' + escapeHtml(label) + "</option>");
      });

      commentPostFilter.innerHTML = options.join("");
      commentPostFilter.value = seen[currentValue] ? currentValue : "all";
    }

    function applyAdminFilters() {
      var postKeyword = (postSearchInput.value || "").trim().toLowerCase();
      var postSort = postSortSelect.value || "updatedAt-desc";
      var pageSize = 10;
      var filteredPosts = adminPosts.filter(function (post) {
        var haystack = [post.title, post.excerpt, post.content].join(" ").toLowerCase();
        var matchesKeyword = !postKeyword || haystack.indexOf(postKeyword) !== -1;
        return matchesKeyword;
      }).sort(function (a, b) {
        return comparePosts(a, b, postSort);
      });

      var totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));
      if (currentPostPage > totalPages) currentPostPage = totalPages;
      var startIndex = (currentPostPage - 1) * pageSize;
      var paginatedPosts = filteredPosts.slice(startIndex, startIndex + pageSize);

      renderPostsList(paginatedPosts);
      updateSummary(postsSummary, filteredPosts.length, adminPosts.length, "文章");
      if (postsCountBadge) postsCountBadge.textContent = adminPosts.length + " 篇";
      renderPostsPagination(filteredPosts.length, pageSize, currentPostPage);

      var commentKeyword = (commentSearchInput.value || "").trim().toLowerCase();
      var commentPost = commentPostFilter.value || "all";
      var filteredComments = adminComments.filter(function (comment) {
        var belongsToPost = commentPost === "all"
          || (comment.postSlug || "") === commentPost
          || (comment.postTitle || "") === commentPost;
        var haystack = [comment.author, comment.content, comment.postTitle, comment.postSlug].join(" ").toLowerCase();
        var matchesKeyword = !commentKeyword || haystack.indexOf(commentKeyword) !== -1;
        return belongsToPost && matchesKeyword;
      });

      var commentPageSize = 10;
      var commentTotalPages = Math.max(1, Math.ceil(filteredComments.length / commentPageSize));
      if (currentCommentPage > commentTotalPages) currentCommentPage = commentTotalPages;
      var commentStartIndex = (currentCommentPage - 1) * commentPageSize;
      var paginatedComments = filteredComments.slice(commentStartIndex, commentStartIndex + commentPageSize);

      renderCommentsList(paginatedComments);
      updateSummary(commentsSummary, filteredComments.length, adminComments.length, "留言");
      if (commentsCountBadge) commentsCountBadge.textContent = adminComments.length + " 条";
      renderCommentsPagination(filteredComments.length, commentPageSize, currentCommentPage);
    }

    async function loadAdminData() {
      var token = getAdminToken();
      if (!token) return;

      try {
        adminSiteSettings = await loadSiteSettings(true);
        populateSiteSettingsForm(adminSiteSettings);
        applyGlobalSiteSettings(adminSiteSettings);

        var postsResult = await callApi("adminListPosts", { token: token });
        adminPosts = postsResult.posts || [];

        var commentsResult = await callApi("adminListComments", { token: token });
        adminComments = commentsResult.comments || [];
        syncCommentPostFilter(adminComments);
        applyAdminFilters();
        if (editPostId) {
          openPostEditor(adminPosts.find(function (item) { return item.id === editPostId; }));
        }
        syncAdminSessionCookie(token);

      } catch (error) {
        setAdminToken("");
        adminShell.classList.add("hidden");
        loginShell.classList.remove("hidden");
        setFeedback(loginFeedback, error.message || "登录已失效，请重新输入口令。", "error");
      }
    }

    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var password = (loginForm.password.value || "").trim();
      if (!password) {
        setFeedback(loginFeedback, "请输入后台口令。", "error");
        return;
      }

      try {
        var result = await callApi("adminLogin", { password: password });
        setAdminToken(result.token);
        loginShell.classList.add("hidden");
        adminShell.classList.remove("hidden");
        setFeedback(loginFeedback, "");
        resetPostForm();
        setAdminView("comments");
        await loadAdminData();
        if (redirectToNext()) return;
      } catch (error) {
        setFeedback(loginFeedback, error.message || "登录失败", "error");
      }
    });

    postForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var token = getAdminToken();
      var postId = document.getElementById("post-id").value || "";
      var existingSlug = document.getElementById("post-slug").value.trim();
      var title = document.getElementById("post-title-input").value.trim();
      var content = document.getElementById("post-content-input").value.trim();
      var existingExcerpt = document.getElementById("post-excerpt").value.trim();
      var existingPublishedAt = document.getElementById("post-published-at").value;
      var post = {
        id: postId,
        slug: existingSlug || buildSlug(title),
        title: title,
        excerpt: excerptFromContent(content),
        publishedAt: existingPublishedAt || nowShanghaiIso(),
        content: content
      };

      if (!post.title || !post.content) {
        setFeedback(postFeedback, "标题和正文都要填。", "error");
        return;
      }

      try {
        await callApi("adminSavePost", { token: token, post: post });
        setFeedback(postFeedback, postId ? "文章已保存。" : "文章已发布。", "success");
        resetPostForm();
        await loadAdminData();
        setAdminView("posts");
      } catch (error) {
        setFeedback(postFeedback, error.message || "保存失败", "error");
      }
    });

    newPostButton.addEventListener("click", function () {
      resetPostForm();
      setAdminView("editor");
    });

    cancelPostEditButton.addEventListener("click", function () {
      resetPostForm();
      setAdminView("posts");
    });

    postsViewButton.addEventListener("click", function () {
      setAdminView("posts");
    });

    commentsViewButton.addEventListener("click", function () {
      setAdminView("comments");
    });

    settingsViewButton.addEventListener("click", function () {
      setAdminView("settings");
    });

    [siteTitleInput, browserTitleInput, xiaohongshuUrlInput, emailAddressInput].forEach(function (element) {
      if (!element) return;
      element.addEventListener("input", function () {
        renderSiteSettingsPreview(getDraftSiteSettings());
      });
    });

    [postSearchInput, postSortSelect].forEach(function (element) {
      element.addEventListener("input", function () {
        currentPostPage = 1;
        applyAdminFilters();
      });
      element.addEventListener("change", function () {
        currentPostPage = 1;
        applyAdminFilters();
      });
    });

    [commentSearchInput, commentPostFilter].forEach(function (element) {
      element.addEventListener("input", function () {
        currentCommentPage = 1;
        applyAdminFilters();
      });
      element.addEventListener("change", function () {
        currentCommentPage = 1;
        applyAdminFilters();
      });
    });

    siteSettingsForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var nextSettings = getDraftSiteSettings();

      try {
        var result = await callApi("adminSaveSiteSettings", {
          token: getAdminToken(),
          settings: nextSettings
        });
        adminSiteSettings = normalizeSiteSettings(result.settings || nextSettings);
        currentSiteSettings = adminSiteSettings;
        siteSettingsPromise = Promise.resolve(adminSiteSettings);
        populateSiteSettingsForm(adminSiteSettings);
        applyGlobalSiteSettings(adminSiteSettings);
        setFeedback(siteSettingsFeedback, "站点设置已保存。", "success");
      } catch (error) {
        setFeedback(siteSettingsFeedback, error.message || "保存失败", "error");
      }
    });

    logoutButton.addEventListener("click", function () {
      setAdminToken("");
      adminShell.classList.add("hidden");
      loginShell.classList.remove("hidden");
      resetPostForm();
      setAdminView("comments");
      setFeedback(loginFeedback, "已退出后台。", "success");
      setFeedback(siteSettingsFeedback, "");
    });

    // 图片上传
    var imageUploadInput = document.getElementById("image-upload-input");
    var imageUploadStatus = document.getElementById("image-upload-status");
    var contentTextarea = document.getElementById("post-content-input");

    if (imageUploadInput) {
      imageUploadInput.addEventListener("change", async function () {
        var file = imageUploadInput.files && imageUploadInput.files[0];
        if (!file) return;

        // 重置 input，允许重复选同一个文件
        imageUploadInput.value = "";

        // 大小限制 5MB
        if (file.size > 20 * 1024 * 1024) {
          imageUploadStatus.textContent = "图片不能超过 20MB";
          imageUploadStatus.className = "editor-toolbar-status error";
          return;
        }

        imageUploadStatus.textContent = "上传中…";
        imageUploadStatus.className = "editor-toolbar-status uploading";

        try {
          // 读取为 base64
          var base64 = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (e) {
              // dataURL = "data:image/jpeg;base64,xxx"，取逗号后面的部分
              resolve(e.target.result.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          var result = await callApi("adminUploadImage", {
            token: getAdminToken(),
            filename: file.name,
            base64: base64,
            mimeType: file.type
          });

          // 在光标位置插入 Markdown 图片语法
          var mdImg = "\n![" + file.name.replace(/\.[^.]+$/, "") + "](" + result.url + ")\n";
          var start = contentTextarea.selectionStart;
          var end = contentTextarea.selectionEnd;
          var val = contentTextarea.value;
          contentTextarea.value = val.slice(0, start) + mdImg + val.slice(end);
          contentTextarea.selectionStart = contentTextarea.selectionEnd = start + mdImg.length;
          contentTextarea.focus();

          imageUploadStatus.textContent = "上传成功 ✓";
          imageUploadStatus.className = "editor-toolbar-status success";
          setTimeout(function () {
            imageUploadStatus.textContent = "";
            imageUploadStatus.className = "editor-toolbar-status";
          }, 3000);
        } catch (err) {
          imageUploadStatus.textContent = "上传失败：" + (err.message || "未知错误");
          imageUploadStatus.className = "editor-toolbar-status error";
        }
      });
    }

    if (getAdminToken()) {
      loginShell.classList.add("hidden");
      adminShell.classList.remove("hidden");
      resetPostForm();
      setAdminView("comments");
      await loadAdminData();
      if (redirectToNext()) return;
    }
  }

  async function init() {
    var cachedSiteSettings = readCachedSiteSettings();
    if (cachedSiteSettings) {
      applyGlobalSiteSettings(cachedSiteSettings);
    }
    applyGlobalSiteSettings(await loadSiteSettings());
    if (page !== "admin") {
      ensureModeControl();
    }
    if (page === "home") await initHomePage();
    if (page === "post") await initPostPage();
    if (page === "admin") await initAdminPage();
  }

  init();
})();

