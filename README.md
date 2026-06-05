# JSBot

基于Discord.js的Discord bot项目，提供服务器管理、楼主自动化等功能。

## 📋 环境要求

- Node.js 18.x 或更高版本
- pnpm 包管理器
- PM2 进程管理器（生产环境）
- PostgreSQL 数据库（运行时数据统一存储在 PostgreSQL）

### 本地开发

1. **安装依赖**

```bash
# 安装pnpm
npm install -g pnpm

# 安装项目依赖
pnpm install
```

2. **配置文件**

在根目录创建 `config.json`：
- 参考 `config.example.json` 填写配置
- 包含 Discord bot token 和服务器配置
- 不需要的模块将 `enabled` 设置为 `false`

创建 `pg.config.json`：
- 参考 `pg.config.example.json` 填写 PostgreSQL 连接信息
- Bot 的主配置、惩罚记录、流程/投票状态、监控消息 ID、轮播状态、用户黑名单、自助身份组放弃名单和发言统计都会写入 PostgreSQL

3. **运行Bot**

```bash
pnpm start
```

> ⚠️ **Windows用户注意**：由于 `discord.js` 的限制，在 Windows 下必须开启 TUN 代理模式才能正常运行。

---

## 🐧 Linux生产环境部署

### 1. 环境准备

```bash
# 安装全局工具
npm install -g pnpm pm2

# （可选）安装jq用于监控内存使用
sudo apt install jq
```

### 2. 部署Bot

```bash
# 克隆或上传项目到服务器
cd /path/to/jsbot

# 安装依赖
pnpm install

# 添加脚本执行权限
chmod +x start.sh update.sh

# 配置config.json（参考config.example.json）
# 配置pg.config.json（参考pg.config.example.json）

# 启动Bot
./start.sh
```

### 3. 管理命令

#### 基本操作

```bash
# 查看Bot状态
pm2 status

# 查看日志
pm2 logs gatekeeper

# 查看最近50行日志
pm2 logs gatekeeper --lines 50

# 重启Bot
pm2 restart gatekeeper

# 停止Bot
pm2 stop gatekeeper

# 删除Bot进程
pm2 delete gatekeeper
```

#### 更新Bot

```bash
# 拉取最新代码并重载（零停机）
./update.sh
```

#### 监控模式

启动自动监控，定期检查Bot状态和内存使用：

```bash
# 前台运行（测试用）
./start.sh --monitor

# 后台运行（推荐）
nohup ./start.sh --monitor > monitor.log 2>&1 &

# 查看监控日志
tail -f monitor.log
```

监控功能：
- 每5分钟检查Bot是否在线，异常时自动重启
- 内存使用超过900MB时自动重启
- 需要安装 `jq` 才能启用内存监控

---

## ☁️ Zeabur 部署

本仓库已提供 Zeabur 部署模板。容器会同时启动受密码保护的 Web 配置页和 Bot 子进程，适合在 Zeabur 域名中直接填写配置：

- 根目录 `Dockerfile`：Zeabur 会自动识别并按 Docker 方式构建。
- 根目录 `.dockerignore`：避免把本地密钥、数据库和日志打包进镜像。
- 根目录 `zbpack.json`：显式指定使用根目录 `Dockerfile`。
- 根目录 `zeabur-template.yaml`：一键创建 Bot 服务和 PostgreSQL 服务。
- `deploy/config-wizard/index.html`：网页配置向导；本地打开时生成配置，Zeabur 域名访问时可直接保存配置并重启 Bot。
- `deploy/zeabur/env.example`：Zeabur 环境变量模板。
- `deploy/zeabur/config.zeabur.example.json`：可复制填写的 `config.json` 示例。
- `deploy/zeabur/pg.config.zeabur.example.json`：可选 PostgreSQL 配置示例。
- `src/supervisor.js`：启动 Web 配置页并管理 Bot 子进程。
- `deploy/zeabur/entrypoint.sh`：容器启动时根据环境变量生成可选初始配置和 PostgreSQL 配置。

Zeabur 部署时建议保留这些环境变量：

```env
JSBOT_WEB_PASSWORD=ZEABUR_GENERATED_PASSWORD
JSBOT_WEB_PASSWORD_FILE=/app/data/web-password.txt
PORT=8080
JSBOT_CONFIG_PATH=/app/data/config.json
NODE_ENV=production
```

一键部署模板会生成随机密码并同时写入 `PASSWORD` 和 `JSBOT_WEB_PASSWORD`，Zeabur 的 `Web configuration password` 部署说明会显示同一个值，方便复制。配置页打开后会先显示独立登录页，只有一个密码输入框；输入 Zeabur 显示的这个密码后进入配置控制台。如果没有设置 `PASSWORD` 或 `JSBOT_WEB_PASSWORD`，容器启动时会自动生成一个 16 位 fallback 密码，保存到 `/app/data/web-password.txt`，并打印在 Zeabur 的 `jsbot` 服务日志里。部署后给 `jsbot` 服务绑定 Zeabur 域名，打开域名并输入密码，然后在网页中填写 Discord Token、服务器 ID、频道/角色 ID、AI SK / OpenAI 兼容接口、投票系统、自助身份组、发言统计查询权限和运行监控等信息，点击“保存配置并重启 Bot”。配置会保存到 PostgreSQL，`/app/data/config.json` 只作为 Bot 启动时生成的运行副本。

自助身份组和发言统计会注册为 Discord App 指令：管理员使用 `/发送自助身份组面板` 在频道发送身份组领取面板；每个自助身份组都可以设置可选的近 7 天最低发言数门槛，用于实现黄桃、白桃等活跃身份组。用户使用 `/发言统计` 私密查询自己的发言数，白名单 DCID 可查询任意用户。部署更新后如果 Discord 的 `/` 指令列表仍有旧命令或没有出现新命令，请先用管理员账号执行 `/同步指令`，或在网页控制台点击“同步 Discord 指令”。

如果你想预置初始配置，也可以直接用浏览器打开 `deploy/config-wizard/index.html`，填写信息后复制页面生成的 `JSBOT_CONFIG_JSON_BASE64` 到 Zeabur 环境变量。

PostgreSQL 现在是必需运行时数据库。如果不使用一键部署模板自动创建数据库，可以手动提供：

```env
# JSBOT_PG_CONFIG_JSON_BASE64=BASE64_ENCODED_PG_CONFIG_JSON
```

如果使用 `zeabur-template.yaml` 一键部署，则会同时创建 PostgreSQL 16 服务；Bot 启动时会根据 Zeabur 暴露的 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DATABASE`、`POSTGRES_USERNAME`、`POSTGRES_PASSWORD` 自动生成 `pg.config.json`，通常不需要手动设置 `JSBOT_PG_CONFIG_JSON_BASE64`。

当前 Zeabur 模板会暴露 `8080` HTTP 端口用于设置页面。详细步骤见 `deploy/zeabur/README.md`。

---

## 📁 项目结构

```
jsbot/
├── src/                  # 源代码目录
│   ├── commands/        # Discord命令
│   ├── events/          # Discord事件处理
│   ├── handlers/        # 交互处理器（按钮、模态框、定时任务）
│   ├── services/        # 业务逻辑服务
│   ├── pg/              # PostgreSQL 连接和同步模型
│   ├── sqlite/          # PostgreSQL runtime 兼容层（历史路径名）
│   └── utils/           # 工具函数
├── data/                # 数据存储目录
├── logs/                # 日志文件
├── config.json          # 主配置文件（需自行创建）
├── start.sh             # 启动脚本
└── update.sh            # 更新脚本
```

---

## ⚙️ 配置说明

### config.json

主配置文件，包含：
- `token`: Discord Bot Token
- `guilds`: 服务器配置，支持多服务器
  - 命令权限配置
  - 功能模块开关
  - 频道和角色ID配置

详细配置项请参考 `config.example.json`。

### 环境变量

脚本中的关键配置（可在 `start.sh` 中修改）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_NAME` | `gatekeeper` | PM2应用名称 |
| `MAX_MEMORY` | `1G` | 最大内存限制 |
| `CRON_RESTART` | `0 0 */7 * *` | 定时重启（每7天） |
| `MONITOR_INTERVAL` | `300` | 监控检查间隔（秒） |
| `MEMORY_THRESHOLD` | `900000000` | 内存重启阈值（字节） |

---

## 🔧 故障排除

### Bot无法启动

```bash
# 检查日志
pm2 logs gatekeeper --err

# 检查配置文件
cat config.json

# 验证Node.js版本
node -v

# 重新安装依赖
pnpm install
```

### 内存占用过高

```bash
# 调整内存限制（编辑start.sh）
MAX_MEMORY="2G"  # 改为2GB

# 手动重启
pm2 restart gatekeeper
```

### 监控脚本不工作

```bash
# 检查jq是否安装
jq --version

# 安装jq
sudo apt install jq

# 查看监控日志
pm2 logs gatekeeper
```
