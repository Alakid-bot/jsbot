# Zeabur 部署模板

本目录提供在 Zeabur 部署该 Discord Bot 的模板。容器会同时启动一个受密码保护的 Web 配置页，用于在 Zeabur 域名里填写 Discord Token、服务器 ID、频道/角色 ID、AI SK / OpenAI 兼容接口、投票系统、自助身份组、发言统计查询权限、运行监控等配置；保存后同一进程会启动或重启 Bot。

## 文件说明

- `Dockerfile`：Zeabur 会自动识别仓库根目录的 Dockerfile 并按 Docker 部署。
- `.dockerignore`：避免把本地密钥、数据库、日志、node_modules 打进镜像。
- `src/supervisor.js`：启动受密码保护的 Web 配置页，并管理 Bot 子进程。
- `deploy/zeabur/entrypoint.sh`：容器启动时从 Zeabur 环境变量生成可选的初始配置和必需的 `pg.config.json`。
- `deploy/config-wizard/index.html`：网页配置向导；本地打开时生成配置，Zeabur 域名访问时可直接保存配置并重启 Bot。
- `deploy/zeabur/env.example`：Zeabur 环境变量模板。
- `deploy/zeabur/config.zeabur.example.json`：适合复制后填写的 `config.json` 模板。
- `deploy/zeabur/pg.config.zeabur.example.json`：使用 Zeabur `${POSTGRES_*}` 变量的 PostgreSQL 配置模板。
- `zeabur-template.yaml`：一键部署模板，会同时创建 Bot 服务和 PostgreSQL 服务。

## Zeabur 操作步骤

1. 将代码推送到你自己的 fork：`origin`，即 `https://github.com/Alakid-bot/jsbot.git`。
2. 在 Zeabur 新建 Project，选择 **GitHub** 服务，并选择你的 fork 仓库；或使用根目录 `zeabur-template.yaml` 一键部署。
3. Zeabur 会检测根目录 `Dockerfile`，按 Dockerfile 构建并运行。
4. 在 Zeabur 服务的 **Environment Variables** 添加环境变量。
5. 添加持久化 Volume，挂载到 `/app/data`，用于保存网页登录 fallback 密码和 Bot 启动运行副本。网页配置和运行时数据库状态统一写入 PostgreSQL。
6. 如需保留应用日志，也可以额外挂载 `/app/logs`。
7. 给 Bot 服务绑定 Zeabur 域名，打开域名后进入配置页。

## 一键部署 Bot + PostgreSQL

如果希望在 Zeabur 上创建项目时同时部署 Bot 和 PostgreSQL，可以使用仓库根目录的：

```text
zeabur-template.yaml
```

该模板会创建两个服务：

- `postgresql`：基于 `postgres:16` 的 PostgreSQL 数据库，持久化目录是 `/var/lib/postgresql/data`。
- `jsbot`：从 `Alakid-bot/jsbot` 的 `main` 分支构建并运行 Bot，暴露 `8080` HTTP 配置页，持久化目录是 `/app/data` 和 `/app/logs`。

Bot 的主配置、惩罚记录、流程/投票状态、监控消息 ID、轮播状态、用户黑名单、自助身份组放弃名单和发言统计都会写入 PostgreSQL。

模板中的 `jsbot` 服务依赖 `postgresql` 服务，Zeabur 会先启动数据库，再启动 Bot 配置页。

使用 CLI 部署示例：

```bash
npx zeabur@latest template deploy -f zeabur-template.yaml
```

部署时通常只需要填写时区：

```env
TZ=Asia/Shanghai
```

一键部署模板会把 Zeabur 生成的同一个随机密码写入 `PASSWORD` 和 `JSBOT_WEB_PASSWORD`，并在 Zeabur 的 `Web configuration password` 部署说明中以密码类型显示，方便 user 复制。配置页打开后先显示独立登录页，只有一个密码输入框；输入 Zeabur 显示的密码后进入配置控制台。

如果你想手动覆盖固定密码，可以在 Zeabur 环境变量里设置 `PASSWORD` 或 `JSBOT_WEB_PASSWORD`。推荐两个变量保持一致：

```env
PASSWORD=CHANGE_ME_16_CHARS
JSBOT_WEB_PASSWORD=CHANGE_ME_16_CHARS
```

如果你不填写 `PASSWORD` 或 `JSBOT_WEB_PASSWORD`，容器会在首次启动时自动生成一个 16 位随机密码，保存到 `/app/data/web-password.txt`，并打印在 Zeabur 的 `jsbot` 服务日志里。之后只要 `/app/data` 持久化卷还在，重启会复用同一个密码。

部署完成后：

1. 打开 Zeabur 给 `jsbot` 服务分配的域名。
2. 页面会先显示一个只有密码输入框的登录界面。
3. 密码使用 Zeabur 部署说明中的 `Web configuration password`，也就是环境变量 `PASSWORD` / `JSBOT_WEB_PASSWORD` 的同一个值；如果没有设置这些变量，则查看 Zeabur 日志里的自动生成密码。
4. 输入正确密码并点击“进入控制台”。
5. 填写 Discord Token、Guild ID、频道/角色 ID、AI 答疑接口/SK/模型、投票系统、自助身份组、发言统计查询权限、运行监控等配置。
6. 点击“保存配置并重启 Bot”。配置会写入 PostgreSQL，`/app/data/config.json` 只作为 Bot 启动时生成的运行副本。
7. 如果 Discord 的 `/` App 指令列表没有出现新命令，使用管理员账号执行 `/同步指令`。

如果你仍想用环境变量预置初始配置，也可以本地生成：

```bash
base64 -w 0 config.json
```

然后设置：

```env
JSBOT_CONFIG_JSON_BASE64=BASE64_ENCODED_CONFIG_JSON
```

## 推荐环境变量

在线配置页必须有访问密码。一键部署模板会生成随机密码并写入固定的 `PASSWORD` 和 `JSBOT_WEB_PASSWORD`，同时在 Zeabur 部署说明中显示为 `Web configuration password` 供复制。如果这些变量未设置，容器会自动生成 16 位 fallback 密码，保存到 `JSBOT_WEB_PASSWORD_FILE` 并打印到启动日志。

```env
PASSWORD=ZEABUR_GENERATED_PASSWORD
JSBOT_WEB_PASSWORD=ZEABUR_GENERATED_PASSWORD
JSBOT_WEB_PASSWORD_FILE=/app/data/web-password.txt
PORT=8080
JSBOT_CONFIG_PATH=/app/data/config.json
NODE_ENV=production
```

## 在线配置页

Zeabur 部署后访问 Bot 服务域名，即可看到配置页。页面支持：

- 读取服务器已有 `config.json`
- 填写或修改 Discord Token、服务器 ID、频道/角色 ID
- 填写 FastGPT 或 OpenAI 兼容接口 URL、SK/API Key、模型名
- 调整 AI 答疑、社区投票系统、自助身份组、发言统计查询权限和运行监控配置
- 生成并预览 `config.json` / `JSBOT_CONFIG_JSON_BASE64`
- 保存到 PostgreSQL，并生成 `/app/data/config.json` 运行副本
- 保存后自动启动或重启 Bot
- 查看 Bot 是否运行、PID、配置路径等状态

自助身份组和发言统计对应这些 App 指令：

- `/发送自助身份组面板`：管理员发送身份组领取面板，用户点击按钮领取或取消配置好的身份组。每个分组可设置可选的近 7 天最低发言数门槛，用于实现黄桃、白桃等活跃身份组。
- `/发言统计`：普通用户私密查询自己的近 7 天发言数，白名单 DCID 可私密查询任意用户。

安全注意：

- 配置页是公开域名可访问的，必须使用强密码。模板会把 Zeabur 生成的同一个随机密码写入 `PASSWORD` 和 `JSBOT_WEB_PASSWORD`。
- 如果没有设置 `PASSWORD` 或 `JSBOT_WEB_PASSWORD`，启动脚本会自动生成 fallback 密码并打印在 Zeabur 日志里；保存好后不要公开分享日志。
- 推荐使用 Zeabur 的 HTTPS 域名访问。
- 不要把真实 `config.json`、Token、Key 提交到 GitHub。

## 必需 PostgreSQL 环境变量

PostgreSQL 是运行时数据库，Bot 启动时必须能生成 `/app/pg.config.json`。如果使用 `zeabur-template.yaml`，PostgreSQL 会自动创建，通常不需要手动设置 `JSBOT_PG_CONFIG_JSON_BASE64`。Bot 服务会读取 Zeabur 暴露的变量并生成 `/app/pg.config.json`。

启动脚本支持标准 `POSTGRES_*` 名称，也支持模板中使用的 `ZEABUR_POSTGRES_*` 名称：

```env
POSTGRES_HOST=${POSTGRES_HOST}
POSTGRES_PORT=${POSTGRES_PORT}
POSTGRES_DATABASE=${POSTGRES_DATABASE}
POSTGRES_USERNAME=${POSTGRES_USERNAME}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
```

或者：

```env
ZEABUR_POSTGRES_HOST=${POSTGRES_HOST}
ZEABUR_POSTGRES_PORT=${POSTGRES_PORT}
ZEABUR_POSTGRES_DATABASE=${POSTGRES_DATABASE}
ZEABUR_POSTGRES_USERNAME=${POSTGRES_USERNAME}
ZEABUR_POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
```

也可以手动设置完整 JSON：

```env
JSBOT_PG_CONFIG_JSON={"host":"${POSTGRES_HOST}","port":5432,"database":"${POSTGRES_DATABASE}","user":"${POSTGRES_USERNAME}","password":"${POSTGRES_PASSWORD}","logging":false}
```

## 本地生成配置示例

```bash
cp deploy/zeabur/config.zeabur.example.json config.json
# 编辑 config.json 后：
node -e "JSON.parse(require('fs').readFileSync('config.json', 'utf8')); console.log('config.json OK')"
base64 -w 0 config.json
```

macOS 没有 `-w 0` 参数时可用：

```bash
base64 < config.json | tr -d '\n'
```

## 首次部署注意事项

- `config.json` 中的 `token` 必须是真实 Discord Bot Token。
- `guilds` 至少需要包含你要部署命令的服务器 ID。
- `commandsDeployed` 首次可设为 `false`，Bot 会尝试部署命令并在容器内更新 `config.json`。
- 如果没有持久化 `/app/data`，fallback 登录密码和 Bot 运行副本会在重建容器后丢失；网页保存的主配置和运行时状态由 PostgreSQL 持久化。
- 稳定运行后可把 `commandsDeployed` 改为 `true`，避免每次重建都重新部署命令。

不要将真实 `config.json`、`pg.config.json`、`.env` 提交到 GitHub；这些文件已在 `.gitignore` 中忽略。
