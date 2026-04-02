import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = clampInt(process.env.PORT, 3000, 1, 65535);
const ADMIN_PASSWORD = process.env.BLOG_ADMIN_PASSWORD || "leaf";
const SITE_URL = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const SQLITE_FILE = path.join(DATA_DIR, "blog.sqlite");
const LEGACY_POSTS_FILE = path.join(DATA_DIR, "posts.json");
const LEGACY_COMMENTS_FILE = path.join(DATA_DIR, "comments.json");

const MAX_REQUEST_BODY = 26 * 1024 * 1024;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SITE_SETTINGS_META_KEY = "site_settings_v1";
const LEAF_BRAND_MIGRATION_META_KEY = "leaf_brand_migrated_v1";
const DEFAULT_SITE_SETTINGS = Object.freeze({
  siteTitle: "leaf",
  browserTitle: "leaf",
  siteBio: "做有意思的事情。",
  xiaohongshuUrl: "https://www.xiaohongshu.com/user/profile/6720c690000000001c01b883?xsec_token=ABRs9q5J79rkqZIGS1vjAYLPMItpArQTzpcWQTTo1KZvU=&xsec_source=pc_feed",
  emailAddress: "gainubi@gmail.com"
});

const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = createDatabase();
const statements = createStatements(db);
runLegacyMigration();
runLeafBrandMigration();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, error.status || 500, {
      ok: false,
      message: error.publicMessage || error.message || "服务器开小差了"
    });
  });
});

server.listen(PORT, () => {
  console.log(`leaf blog listening on http://localhost:${PORT}`);
  console.log(`SQLite database: ${SQLITE_FILE}`);
});

function createDatabase() {
  const database = new Database(SQLITE_FILE);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'published',
      published_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_status_published_at
      ON posts(status, published_at DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      post_slug TEXT NOT NULL DEFAULT '',
      post_title TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      author TEXT NOT NULL DEFAULT '匿名',
      author_role TEXT NOT NULL DEFAULT 'guest',
      is_author INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved'
    );

    CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at
      ON comments(post_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_comments_parent_id
      ON comments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_comments_status_created_at
      ON comments(status, created_at DESC);
  `);
  return database;
}

function createStatements(database) {
  return {
    getMeta: database.prepare("SELECT value FROM meta WHERE key = ?"),
    setMeta: database.prepare(`
      INSERT INTO meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    countPosts: database.prepare("SELECT COUNT(*) AS count FROM posts"),
    countComments: database.prepare("SELECT COUNT(*) AS count FROM comments"),
    insertPost: database.prepare(`
      INSERT INTO posts (id, slug, title, excerpt, content, status, published_at, updated_at)
      VALUES (@id, @slug, @title, @excerpt, @content, @status, @published_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        title = excluded.title,
        excerpt = excluded.excerpt,
        content = excluded.content,
        status = excluded.status,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at
    `),
    insertPostIgnore: database.prepare(`
      INSERT OR IGNORE INTO posts (id, slug, title, excerpt, content, status, published_at, updated_at)
      VALUES (@id, @slug, @title, @excerpt, @content, @status, @published_at, @updated_at)
    `),
    selectAllPosts: database.prepare(`
      SELECT id, slug, title, excerpt, content, status, published_at, updated_at
      FROM posts
      ORDER BY COALESCE(unixepoch(updated_at), 0) DESC, COALESCE(unixepoch(published_at), 0) DESC, id DESC
    `),
    listPublishedPosts: database.prepare(`
      SELECT id, slug, title, excerpt, content, status, published_at, updated_at
      FROM posts
      WHERE status = 'published'
      ORDER BY COALESCE(unixepoch(published_at), 0) DESC, COALESCE(unixepoch(updated_at), 0) DESC, id DESC
      LIMIT ? OFFSET ?
    `),
    countPublishedPosts: database.prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'published'"),
    selectPostById: database.prepare(`
      SELECT id, slug, title, excerpt, content, status, published_at, updated_at
      FROM posts
      WHERE id = ?
      LIMIT 1
    `),
    selectPostBySlug: database.prepare(`
      SELECT id, slug, title, excerpt, content, status, published_at, updated_at
      FROM posts
      WHERE slug = ?
      ORDER BY COALESCE(unixepoch(published_at), 0) DESC, COALESCE(unixepoch(updated_at), 0) DESC, id DESC
      LIMIT 1
    `),
    deletePostComments: database.prepare("DELETE FROM comments WHERE post_id = ?"),
    deletePost: database.prepare("DELETE FROM posts WHERE id = ?"),
    insertComment: database.prepare(`
      INSERT INTO comments (
        id, post_id, post_slug, post_title, parent_id, author, author_role, is_author, content, created_at, status
      ) VALUES (
        @id, @post_id, @post_slug, @post_title, @parent_id, @author, @author_role, @is_author, @content, @created_at, @status
      )
    `),
    insertCommentIgnore: database.prepare(`
      INSERT OR IGNORE INTO comments (
        id, post_id, post_slug, post_title, parent_id, author, author_role, is_author, content, created_at, status
      ) VALUES (
        @id, @post_id, @post_slug, @post_title, @parent_id, @author, @author_role, @is_author, @content, @created_at, @status
      )
    `),
    listPostComments: database.prepare(`
      SELECT id, post_id, post_slug, post_title, parent_id, author, author_role, is_author, content, created_at, status
      FROM comments
      WHERE post_id = ? AND status <> 'deleted'
      ORDER BY COALESCE(unixepoch(created_at), 0) ASC, id ASC
    `),
    listAdminComments: database.prepare(`
      SELECT id, post_id, post_slug, post_title, parent_id, author, author_role, is_author, content, created_at, status
      FROM comments
      WHERE status <> 'deleted'
      ORDER BY COALESCE(unixepoch(created_at), 0) DESC, id DESC
    `),
    selectCommentById: database.prepare(`
      SELECT id, post_id, post_slug, post_title, parent_id, author, author_role, is_author, content, created_at, status
      FROM comments
      WHERE id = ?
      LIMIT 1
    `),
    updateCommentStatus: database.prepare("UPDATE comments SET status = ? WHERE id = ?"),
    renameAuthorComments: database.prepare(`
      UPDATE comments
      SET author = @nextAuthor
      WHERE author_role = 'author' AND author = @previousAuthor
    `),
    deleteCommentTree: database.prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM comments WHERE id = ?
        UNION ALL
        SELECT comments.id
        FROM comments
        JOIN subtree ON comments.parent_id = subtree.id
      )
      DELETE FROM comments
      WHERE id IN (SELECT id FROM subtree)
    `)
  };
}

function runLegacyMigration() {
  const migrated = statements.getMeta.get("legacy_json_migrated_v1");
  if (migrated && migrated.value === "1") return;

  const existingPosts = Number(statements.countPosts.get().count || 0);
  const existingComments = Number(statements.countComments.get().count || 0);

  const legacyPosts = readJsonArray(LEGACY_POSTS_FILE);
  const legacyComments = readJsonArray(LEGACY_COMMENTS_FILE);
  const normalizedPosts = legacyPosts.map(normalizePostRecord).filter(Boolean);

  const migrationTx = db.transaction(() => {
    if (existingPosts === 0) {
      for (const post of normalizedPosts) {
        statements.insertPostIgnore.run(post);
      }
    }

    const postLookup = new Map();
    for (const row of statements.selectAllPosts.all()) {
      const post = toApiPost(row);
      postLookup.set(post.id, post);
      if (!postLookup.has(post.slug)) {
        postLookup.set(post.slug, post);
      }
    }

    if (existingComments === 0) {
      for (const rawComment of legacyComments) {
        const comment = normalizeCommentRecord(rawComment, postLookup);
        if (!comment) continue;
        if (!postLookup.has(comment.post_id)) continue;
        statements.insertCommentIgnore.run(comment);
      }
    }

    statements.setMeta.run("legacy_json_migrated_v1", "1");
  });

  migrationTx();
}

function runLeafBrandMigration() {
  const migrated = statements.getMeta.get(LEAF_BRAND_MIGRATION_META_KEY);
  if (migrated && migrated.value === "1") return;

  const migrationTx = db.transaction(() => {
    const currentSettings = getSiteSettings();
    const nextSettings = { ...currentSettings };
    let hasChanges = false;

    if (nextSettings.siteTitle === "why me") {
      nextSettings.siteTitle = "leaf";
      hasChanges = true;
    }

    if (nextSettings.browserTitle === "why me") {
      nextSettings.browserTitle = "leaf";
      hasChanges = true;
    }

    if (hasChanges) {
      statements.setMeta.run(SITE_SETTINGS_META_KEY, JSON.stringify(sanitizeSiteSettings(nextSettings)));
    }

    statements.renameAuthorComments.run({
      previousAuthor: "why me",
      nextAuthor: "leaf"
    });

    statements.setMeta.run(LEAF_BRAND_MIGRATION_META_KEY, "1");
  });

  migrationTx();
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = safeDecodePathname(requestUrl.pathname);

  if (pathname === "/blogApi") {
    if (requestUrl.searchParams.get("action") === "getRss" && req.method === "GET") {
      return handleRss(req, res);
    }
    if (req.method !== "POST") {
      return sendJson(res, 405, { ok: false, message: "只支持 POST 请求" });
    }
    return handleApi(req, res);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  if (pathname === "/") {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"), PUBLIC_DIR, req.method);
  }

  if (pathname.startsWith("/uploads/")) {
    const target = path.join(UPLOADS_DIR, pathname.slice("/uploads/".length));
    return serveFile(res, target, UPLOADS_DIR, req.method);
  }

  const target = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
  return serveFile(res, target, PUBLIC_DIR, req.method);
}

async function handleApi(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { ok: false, message: error.message || "请求体不是有效 JSON" });
  }

  const action = String(payload.action || "").trim();
  if (!action) {
    return sendJson(res, 400, { ok: false, message: "缺少 action" });
  }

  try {
    let result;
    switch (action) {
      case "listPosts":
        result = apiListPosts(payload);
        break;
      case "getPost":
        result = apiGetPost(payload);
        break;
      case "createComment":
        result = apiCreateComment(payload);
        break;
      case "getSiteSettings":
        result = apiGetSiteSettings();
        break;
      case "adminLogin":
        result = apiAdminLogin(payload);
        break;
      case "adminListPosts":
        result = apiAdminListPosts(payload);
        break;
      case "adminSavePost":
        result = apiAdminSavePost(payload);
        break;
      case "adminDeletePost":
        result = apiAdminDeletePost(payload);
        break;
      case "adminListComments":
        result = apiAdminListComments(payload);
        break;
      case "adminUpdateCommentStatus":
        result = apiAdminUpdateCommentStatus(payload);
        break;
      case "adminSaveSiteSettings":
        result = apiAdminSaveSiteSettings(payload);
        break;
      case "adminUploadImage":
        result = await apiAdminUploadImage(payload);
        break;
      case "getRss":
        return handleRss(req, res);
      default:
        throw new ApiError(400, "未知 action");
    }

    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendJson(res, error.status, { ok: false, message: error.message });
    }

    console.error(error);
    sendJson(res, 500, { ok: false, message: "服务器开小差了" });
  }
}

function apiListPosts(payload) {
  const page = clampInt(payload.page, 1, 1, 9999);
  const pageSize = clampInt(payload.pageSize, 10, 1, 50);
  const offset = (page - 1) * pageSize;
  const rows = statements.listPublishedPosts.all(pageSize, offset).map(toApiPost);
  const total = Number(statements.countPublishedPosts.get().count || 0);
  return { posts: rows, total };
}

function apiGetPost(payload) {
  const id = String(payload.id || "").trim();
  const slug = String(payload.slug || "").trim();
  let row = null;

  if (id) {
    row = statements.selectPostById.get(id) || null;
  }
  if (!row && slug) {
    row = statements.selectPostBySlug.get(slug) || null;
  }
  if (!row) {
    return { post: null, comments: [] };
  }

  const post = toApiPost(row);
  const comments = statements.listPostComments.all(post.id).map(toApiComment);
  return { post, comments };
}

function apiCreateComment(payload) {
  const token = String(payload.token || "").trim();
  const adminSession = token ? validateSession(token) : null;
  const content = String(payload.content || "").trim();
  if (!content) {
    throw new ApiError(400, "留言内容不能为空");
  }
  if (content.length > 600) {
    throw new ApiError(400, "留言内容不能超过 600 字");
  }

  const requestedPostId = String(payload.postId || "").trim();
  const requestedSlug = String(payload.slug || "").trim();
  const parentId = String(payload.parentId || "").trim() || null;

  let postRow = null;
  if (requestedPostId) {
    postRow = statements.selectPostById.get(requestedPostId) || null;
  }
  if (!postRow && requestedSlug) {
    postRow = statements.selectPostBySlug.get(requestedSlug) || null;
  }
  if (!postRow) {
    throw new ApiError(404, "文章不存在");
  }

  let parentComment = null;
  if (parentId) {
    parentComment = statements.selectCommentById.get(parentId) || null;
    if (!parentComment) {
      throw new ApiError(404, "要回复的留言不存在");
    }
    if (parentComment.post_id !== postRow.id) {
      throw new ApiError(400, "回复目标与文章不匹配");
    }
  }

  const author = adminSession ? "leaf" : (String(payload.author || "").trim() || "匿名");
  const authorRole = adminSession ? "author" : "guest";
  const comment = {
    id: randomId(),
    post_id: postRow.id,
    post_slug: postRow.slug,
    post_title: postRow.title,
    parent_id: parentComment ? parentComment.id : null,
    author,
    author_role: authorRole,
    is_author: adminSession ? 1 : 0,
    content,
    created_at: nowShanghaiIso(),
    status: "approved"
  };

  statements.insertComment.run(comment);

  return {
    comment: {
      id: comment.id,
      postId: comment.post_id,
      postSlug: comment.post_slug,
      postTitle: comment.post_title,
      parentId: comment.parent_id,
      author: comment.author,
      authorRole: comment.author_role,
      isAuthor: Boolean(comment.is_author),
      content: comment.content,
      createdAt: comment.created_at,
      status: comment.status
    }
  };
}

function apiGetSiteSettings() {
  return { settings: getSiteSettings() };
}

function apiAdminLogin(payload) {
  const password = String(payload.password || "");
  if (!safeCompare(password, ADMIN_PASSWORD)) {
    throw new ApiError(401, "密码不正确");
  }

  cleanupSessions();
  const token = randomId(24);
  sessions.set(token, { createdAt: Date.now() });
  return { token };
}

function apiAdminListPosts(payload) {
  requireAdmin(payload.token);
  const posts = statements.selectAllPosts.all().map(toApiPost);
  return { posts };
}

function apiAdminSavePost(payload) {
  requireAdmin(payload.token);
  const rawPost = payload.post && typeof payload.post === "object" ? payload.post : null;
  if (!rawPost) {
    throw new ApiError(400, "缺少文章内容");
  }

  const existingId = String(rawPost.id || "").trim();
  const existingRow = existingId ? statements.selectPostById.get(existingId) : null;
  const normalized = normalizePostRecord({
    ...rawPost,
    id: existingId || randomId(),
    status: rawPost.status || existingRow?.status || "published",
    publishedAt: rawPost.publishedAt || existingRow?.published_at || nowShanghaiIso(),
    updatedAt: nowShanghaiIso()
  });

  if (!normalized) {
    throw new ApiError(400, "文章标题不能为空");
  }

  statements.insertPost.run(normalized);
  return { post: toApiPost(normalized) };
}

function apiAdminDeletePost(payload) {
  requireAdmin(payload.token);
  const id = String(payload.id || "").trim();
  if (!id) {
    throw new ApiError(400, "缺少文章 ID");
  }

  const deleteTx = db.transaction((postId) => {
    statements.deletePostComments.run(postId);
    return statements.deletePost.run(postId);
  });

  const result = deleteTx(id);
  if (!result.changes) {
    throw new ApiError(404, "文章不存在");
  }

  return { deleted: true };
}

function apiAdminListComments(payload) {
  requireAdmin(payload.token);
  const comments = statements.listAdminComments.all().map(toApiComment);
  return { comments };
}

function apiAdminUpdateCommentStatus(payload) {
  requireAdmin(payload.token);
  const id = String(payload.id || "").trim();
  const status = String(payload.status || "").trim();
  if (!id) {
    throw new ApiError(400, "缺少留言 ID");
  }

  const existing = statements.selectCommentById.get(id);
  if (!existing) {
    throw new ApiError(404, "留言不存在");
  }

  if (status === "deleted") {
    statements.deleteCommentTree.run(id);
    return { deleted: true };
  }

  const nextStatus = status || "approved";
  statements.updateCommentStatus.run(nextStatus, id);
  return { updated: true };
}

function apiAdminSaveSiteSettings(payload) {
  requireAdmin(payload.token);
  const nextSettings = sanitizeSiteSettings(payload.settings);
  statements.setMeta.run(SITE_SETTINGS_META_KEY, JSON.stringify(nextSettings));
  return { settings: nextSettings };
}

async function apiAdminUploadImage(payload) {
  requireAdmin(payload.token);
  const base64 = String(payload.base64 || "").trim();
  if (!base64) {
    throw new ApiError(400, "缺少图片内容");
  }

  const mimeType = String(payload.mimeType || "").trim().toLowerCase();
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new ApiError(400, "只允许上传图片");
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (error) {
    throw new ApiError(400, "图片内容损坏");
  }

  if (!buffer.length) {
    throw new ApiError(400, "图片内容为空");
  }
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new ApiError(400, "图片不能超过 20MB");
  }

  const ext = extensionFromMime(mimeType, payload.filename);
  const filename = `${randomId()}${ext}`;
  const target = path.join(UPLOADS_DIR, filename);
  await fsp.writeFile(target, buffer);

  return { url: `/uploads/${filename}` };
}

function handleRss(req, res) {
  const baseUrl = getBaseUrl(req);
  const siteSettings = getSiteSettings();
  const posts = statements.listPublishedPosts.all(50, 0).map(toApiPost);
  const selfLink = `${baseUrl}/blogApi?action=getRss`;
  const channelDescription = `${siteSettings.siteTitle}的个人博客，${siteSettings.siteBio || "记录有意思的事情。"}`;
  const items = posts.map((post) => {
    const link = `${baseUrl}/post.html?id=${encodeURIComponent(post.id)}`;
    const description = escapeXml(post.excerpt || excerptFromContent(post.content || ""));
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${toRfc822(post.publishedAt || post.updatedAt)}</pubDate>`,
      `      <description>${description}</description>`,
      "    </item>"
    ].join("\n");
  }).join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(siteSettings.siteTitle)}</title>`,
    `    <link>${escapeXml(baseUrl)}</link>`,
    `    <description>${escapeXml(channelDescription)}</description>`,
    "    <language>zh-CN</language>",
    `    <lastBuildDate>${toRfc822(posts[0]?.updatedAt || posts[0]?.publishedAt || nowShanghaiIso())}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml"/>`,
    items,
    "  </channel>",
    "</rss>"
  ].filter(Boolean).join("\n");

  res.writeHead(200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Content-Length": Buffer.byteLength(xml)
  });
  res.end(xml);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_REQUEST_BODY) {
      throw new Error("请求体过大");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function serveFile(res, filePath, rootDir, method) {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedFile = path.resolve(filePath);

  if (!normalizedFile.startsWith(normalizedRoot + path.sep) && normalizedFile !== normalizedRoot) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(normalizedFile);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  let finalPath = normalizedFile;
  if (stat.isDirectory()) {
    finalPath = path.join(normalizedFile, "index.html");
    try {
      stat = await fsp.stat(finalPath);
    } catch (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
  }

  const contentType = getContentType(finalPath);

  if (contentType.startsWith("text/html")) {
    const html = await fsp.readFile(finalPath, "utf8");
    const body = applySiteSettingsToHtml(finalPath, html, getSiteSettings());
    const buffer = Buffer.from(body, "utf8");

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=300"
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(buffer);
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": finalPath.includes(`${path.sep}uploads${path.sep}`) ? "public, max-age=31536000, immutable" : "public, max-age=300"
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(finalPath).pipe(res);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function applySiteSettingsToHtml(filePath, html, siteSettings) {
  const basename = path.basename(filePath).toLowerCase();
  const settings = sanitizeSiteSettings(siteSettings);
  const browserTitle = escapeXml(settings.browserTitle);

  if (basename === "index.html") {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${browserTitle}</title>`);
  }

  if (basename === "post.html") {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>文章 | ${browserTitle}</title>`);
  }

  if (basename === "admin.html") {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>CMS | ${browserTitle}</title>`);
  }

  return html;
}

function toApiPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: excerptFromContent(row.content || row.excerpt || ""),
    content: row.content,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at
  };
}

function toApiComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    postSlug: row.post_slug,
    postTitle: row.post_title,
    parentId: row.parent_id || null,
    author: row.author,
    authorRole: row.author_role,
    isAuthor: Boolean(row.is_author),
    content: row.content,
    createdAt: row.created_at,
    status: row.status
  };
}

function normalizePostRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || "").trim();
  if (!title) return null;

  const content = String(raw.content || "").trim();
  const publishedAt = normalizeIsoDate(raw.publishedAt || raw.published_at || raw.createdAt || raw.created_at || raw.updatedAt || raw.updated_at || nowShanghaiIso());
  const updatedAt = normalizeIsoDate(raw.updatedAt || raw.updated_at || publishedAt, publishedAt);
  const slug = String(raw.slug || "").trim() || buildSlug(title);

  return {
    id: String(raw.id || "").trim() || randomId(),
    slug,
    title,
    excerpt: excerptFromContent(content),
    content,
    status: String(raw.status || "").trim() === "draft" ? "draft" : "published",
    published_at: publishedAt,
    updated_at: updatedAt
  };
}

function normalizeCommentRecord(raw, postLookup) {
  if (!raw || typeof raw !== "object") return null;
  const postId = String(raw.postId || raw.post_id || "").trim();
  const post = postLookup.get(postId) || postLookup.get(String(raw.postSlug || raw.post_slug || raw.slug || "").trim()) || null;
  const content = String(raw.content || "").trim();

  if (!postId || !content) return null;

  const authorRole = String(raw.authorRole || raw.author_role || "").trim() === "author" || Boolean(raw.isAuthor) ? "author" : "guest";
  const isAuthor = authorRole === "author" ? 1 : 0;

  return {
    id: String(raw.id || "").trim() || randomId(),
    post_id: postId,
    post_slug: String(raw.postSlug || raw.post_slug || post?.slug || "").trim(),
    post_title: String(raw.postTitle || raw.post_title || post?.title || "").trim(),
    parent_id: String(raw.parentId || raw.parent_id || "").trim() || null,
    author: String(raw.author || "").trim() || (isAuthor ? "leaf" : "匿名"),
    author_role: authorRole,
    is_author: isAuthor,
    content,
    created_at: normalizeIsoDate(raw.createdAt || raw.created_at || raw.updatedAt || raw.updated_at || nowShanghaiIso()),
    status: String(raw.status || "").trim() === "deleted" ? "deleted" : "approved"
  };
}

function getSiteSettings() {
  const row = statements.getMeta.get(SITE_SETTINGS_META_KEY);
  if (!row || !row.value) {
    return { ...DEFAULT_SITE_SETTINGS };
  }

  try {
    const parsed = JSON.parse(row.value);
    return sanitizeSiteSettings(parsed);
  } catch (error) {
    return { ...DEFAULT_SITE_SETTINGS };
  }
}

function sanitizeSiteSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const siteTitle = limitText(source.siteTitle, DEFAULT_SITE_SETTINGS.siteTitle, 30);
  const browserTitle = limitText(source.browserTitle, DEFAULT_SITE_SETTINGS.browserTitle, 80);
  const siteBio = limitText(source.siteBio, DEFAULT_SITE_SETTINGS.siteBio, 120);
  const xiaohongshuUrl = normalizeExternalUrl(source.xiaohongshuUrl, DEFAULT_SITE_SETTINGS.xiaohongshuUrl);
  const emailAddress = normalizeEmailAddress(source.emailAddress, DEFAULT_SITE_SETTINGS.emailAddress);

  return {
    siteTitle,
    browserTitle,
    siteBio,
    xiaohongshuUrl,
    emailAddress
  };
}

function getBaseUrl(req) {
  if (SITE_URL) return SITE_URL;
  const protoHeader = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = protoHeader || "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function requireAdmin(token) {
  const session = validateSession(token);
  if (!session) {
    throw new ApiError(401, "请先登录后台");
  }
  return session;
}

function validateSession(token) {
  cleanupSessions();
  const key = String(token || "").trim();
  if (!key) return null;
  return sessions.get(key) || null;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session || now - Number(session.createdAt || 0) > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readJsonArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`Failed to read JSON array from ${filePath}:`, error.message);
    return [];
  }
}

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function nowShanghaiIso() {
  return toShanghaiIsoString(new Date());
}

function normalizeIsoDate(value, fallback = nowShanghaiIso()) {
  const text = String(value || "").trim();
  if (!text) return fallback;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00:00+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return `${text}:00+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
    return `${text}+08:00`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return toShanghaiIsoString(parsed);
}

function toShanghaiIsoString(date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+08:00`;
}

function buildSlug(value) {
  const slug = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[/?#%]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `post-${randomId(6)}`;
}

function excerptFromContent(content) {
  const normalized = String(content || "")
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

  if (!normalized) return "";

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const candidate = paragraphs[0] || normalized.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!candidate) return "";

  const maxLength = 110;
  const sentenceMarks = ["。", "！", "？", "!", "?"];
  const trailingMarks = ['"', "'", "”", "’", ")", "）", "]", "】"];
  let sentenceEnd = -1;

  function isSentencePeriod(text, index) {
    const prev = text.charAt(index - 1);
    const next = text.charAt(index + 1);
    if (text.charAt(index) !== ".") return false;
    if (!prev || prev === "." || next === ".") return false;
    if (next && !/[\s"'”’)\]】}]/.test(next)) return false;
    return true;
  }

  for (let i = 0; i < candidate.length; i += 1) {
    const char = candidate.charAt(i);
    if (!sentenceMarks.includes(char) && !isSentencePeriod(candidate, i)) continue;
    sentenceEnd = i;
    while (sentenceEnd + 1 < candidate.length && trailingMarks.includes(candidate.charAt(sentenceEnd + 1))) {
      sentenceEnd += 1;
    }
    break;
  }

  if (sentenceEnd >= 0 && sentenceEnd < maxLength) {
    const firstSentence = candidate.slice(0, sentenceEnd + 1).trim();
    if (firstSentence) return firstSentence;
  }

  if (candidate.length <= maxLength) return candidate;

  let cutIndex = -1;
  for (const mark of ["。", "！", "？", "!", "?", "，", ",", "、", ";", "；", " "]) {
    const index = candidate.lastIndexOf(mark, maxLength);
    if (index > cutIndex) cutIndex = index;
  }

  for (let periodIndex = candidate.lastIndexOf(".", maxLength); periodIndex >= 0; periodIndex = candidate.lastIndexOf(".", periodIndex - 1)) {
    if (!isSentencePeriod(candidate, periodIndex)) continue;
    if (periodIndex > cutIndex) cutIndex = periodIndex;
    break;
  }

  if (cutIndex >= 24) {
    return candidate.slice(0, cutIndex + (candidate[cutIndex] === " " ? 0 : 1)).trim();
  }

  return candidate.slice(0, maxLength).trim();
}

function extensionFromMime(mimeType, filename) {
  const normalizedName = sanitizeFilename(filename);
  const extFromName = path.extname(normalizedName).toLowerCase();
  if (extFromName) return extFromName;

  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif"
  };

  return map[mimeType] || ".bin";
}

function sanitizeFilename(filename) {
  return path.basename(String(filename || "upload")).replace(/[^\w.\-]+/g, "-");
}

function limitText(value, fallback, maxLength) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeExternalUrl(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (!/^https?:\/\//i.test(text)) return fallback;
  return text.slice(0, 1000);
}

function normalizeEmailAddress(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return fallback;
  return text.slice(0, 320);
}


function toRfc822(value) {
  const parsed = new Date(value || nowShanghaiIso());
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toUTCString();
  }
  return parsed.toUTCString();
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    return pathname;
  }
}

function getContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
