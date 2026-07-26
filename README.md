# Weave

一个仅自用、无需登录的视觉知识库。浏览器负责界面，Node.js 服务负责 API，
资料持久化到服务器上的 SQLite 数据库。

## 技术结构

- React + Vite：前端
- Fastify：API 与静态文件服务
- Node.js 内置 SQLite：持久化
- systemd user service：Arch Linux 后台运行

要求 Node.js `>=22.13.0`。

## 本地开发

```bash
npm ci
npm run dev
```

浏览器打开 `http://localhost:3001`。Vite 会把 `/api` 转发到本地
`127.0.0.1:3210`。

## 构建与测试

```bash
npm test
```

生产模式：

```bash
npm run build
npm start
```

默认监听 `127.0.0.1:3210`，适合由 Caddy 或 Nginx 反向代理。

## Arch Linux 首次部署

```bash
mkdir -p ~/apps
git clone https://github.com/mimothecat/weave-self-hosted.git ~/apps/weave
cd ~/apps/weave
bash deploy/install.sh
```

安装脚本会构建前端、创建并启动 `weave.service`。运行数据放在
`~/.local/share/weave/weave.db`，不会跟着代码更新被覆盖。

## 增量更新

Windows 开发机提交并推送：

```bash
git add -A
git commit -m "描述本次修改"
git push
```

Arch 服务器拉取、构建并重启：

```bash
cd ~/apps/weave
bash deploy/update.sh
```

查看状态和日志：

```bash
systemctl --user status weave
journalctl --user -u weave -f
```

健康检查：

```bash
curl http://127.0.0.1:3210/api/health
```

## 配置

首次安装会创建 `~/.config/weave/weave.env`：

```dotenv
HOST=127.0.0.1
PORT=3210
WEAVE_DATA_DIR=/home/你的用户名/.local/share/weave
DATABASE_PATH=/home/你的用户名/.local/share/weave/weave.db
```

修改配置后执行：

```bash
systemctl --user restart weave
```

## GitHub 无法直连时

如果服务器无法稳定访问 GitHub，可以在服务器创建一个裸 Git 部署仓库，再由开发机
通过 SSH 增量推送。GitHub 仍然保留为公开源码仓库。

服务器初始化一次：

```bash
mkdir -p ~/repos
git init --bare --initial-branch=main ~/repos/weave-self-hosted.git
```

Windows 开发机初始化一次（替换用户名和服务器）：

```bash
git remote add deploy ssh://用户名@服务器/home/用户名/repos/weave-self-hosted.git
git push deploy main
```

之后每次提交完可一条命令完成发布：

```powershell
powershell -ExecutionPolicy Bypass -File deploy/publish.ps1 -Server 用户名@服务器
```
