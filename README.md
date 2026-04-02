# why me blog

一个偏安静、偏文字感的个人博客项目，前端使用原生 `HTML/CSS/JS`，后端使用原生 `Node.js`，数据持久化使用 `SQLite`。

## 项目亮点

- 接近原站气质的首页、文章页、CMS、留言、RSS 和小红书工具页，整体风格统一，开箱可用。
- 不依赖前端框架和复杂构建链，结构直白，后续自己改样式、改文案、改交互都很轻松。
- 使用 `SQLite` 持久化文章、评论和站点设置，部署简单，迁移方便，备份成本低。
- 自带后台内容管理，可以直接修改网站标题、副标题、浏览器标签标题、小红书链接和邮箱。
- 支持留言、后台回复、图片上传、RSS 输出，适合作为一个完整可运营的个人博客。
- 提供 `Docker Compose` 部署方案，服务器上只需要准备好 Docker 就能跑起来。
- 首页支持 `night / day / sunny` 三种模式；`sunny` 模式下带叶子动态效果和环境音交互。

## 功能概览

- 首页文章流
- 文章详情页
- CMS 后台登录与发文
- 评论与回复
- RSS 订阅
- 图片上传
- 小红书工具页
- 站点设置
- Docker 部署

## 存储方式

- 文章、评论、站点设置：`data/blog.sqlite`
- 上传图片：`data/uploads/`

如果 `data/` 目录中存在旧版 `posts.json` 或 `comments.json`，首次启动时会自动迁移到 `SQLite`。

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

修改 `.env` 后重新构建容器：

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
- 运行时生成的数据文件

镜像构建时不会把本地 `data/` 打进镜像，运行时统一使用宿主机挂载的 `./data` 目录。

## 数据备份

最重要的是备份这两个位置：

- `data/blog.sqlite`
- `data/uploads/`

如果想整站备份，直接打包整个 `data/` 目录即可。

## 部署建议

1. 服务器安装 Docker 和 Docker Compose。
2. 把项目上传到服务器，例如 `/opt/why-me-blog`。
3. 复制 `.env.example` 为 `.env`，修改站点地址和后台密码。
4. 执行 `docker compose up -d --build`。
5. 使用 `Nginx` 或 `Caddy` 反向代理到容器端口，并配置 HTTPS。

## 站点设置

后台可直接修改这些内容：

- 网站标题
- 首页副标题
- 浏览器标签标题
- 首页 Connect 区的小红书链接
- 首页 Connect 区的邮箱地址

小红书工具页里的昵称和头像在页面内直接修改，保存在当前浏览器的 `localStorage`。
