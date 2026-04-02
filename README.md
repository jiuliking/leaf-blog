# why me blog

原生 HTML/CSS/JS 前端 + 原生 Node.js 后端的个人博客项目，当前使用 SQLite 持久化文章和评论，并保留首页、文章页、CMS、留言、RSS、图片上传和小红书工具页。

## 存储方式

- 文章、评论和站点设置：`data/blog.sqlite`
- 上传图片：`data/uploads/`
- 如果 `data/` 目录中存在旧版 `posts.json` 或 `comments.json`，首次启动时会自动迁移进 SQLite

## 本地启动

```bash
npm start
```

开发模式：

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

## 环境变量

- `PORT`
- `BLOG_ADMIN_PASSWORD`
- `SITE_URL`

示例：

```bash
BLOG_ADMIN_PASSWORD=whyme SITE_URL=https://your-domain.com npm start
```

默认后台密码示例是 `whyme`，正式部署前建议自行修改。

## Docker Compose

首次部署：

```bash
cp .env.example .env
docker compose up -d --build
```

改完 `.env` 后重建容器：

```bash
docker compose up -d --build --force-recreate
```

停止服务：

```bash
docker compose down
```

`docker-compose.yml` 已经把 `./data` 挂载到容器内的 `/app/data`，所以这些内容会持久化：

- SQLite 数据库
- 上传图片
- 旧版 JSON 备份文件

镜像构建时不会把本地 `data/` 打进镜像，运行时统一使用宿主机挂载的 `./data` 目录。

## 数据备份

最重要的是备份这两个位置：

- `data/blog.sqlite`
- `data/uploads/`

如果需要整体备份，也可以直接打包整个 `data/` 目录。

## 部署建议

1. 服务器安装 Docker 和 Docker Compose。
2. 上传项目到服务器，比如 `/opt/why-me-blog`。
3. 复制环境变量模板并修改站点地址和后台密码。
4. 执行 `docker compose up -d --build`。
5. 用 Nginx 或 Caddy 反代到容器端口并配置 HTTPS。

## 站点设置

后台可以直接修改这些内容：

- 网站标题
- 首页副标题
- 浏览器标签标题
- 首页 Connect 区的小红书链接
- 首页 Connect 区的邮箱地址

小红书工具页里的昵称和头像在页面内直接修改，存储在当前浏览器的 `localStorage`。
