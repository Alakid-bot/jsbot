# Zeabur 部署模板

本目录提供在 Zeabur 部署该 Discord Bot 的模板。该项目是长期运行的 Bot/Worker，不是 HTTP Web 服务，因此模板使用 Zeabur 支持的 `Dockerfile` 部署方式，不需要暴露端口。

## 文件说明

- `Dockerfile`：Zeabur 会自动识别仓库根目录的 Dockerfile 并按 Docker 部署。
- `.dockerignore`：避免把本地密钥、数据库、日志、node_modules 打进镜像。
- `deploy/zeabur/entrypoint.sh`：容器启动时从 Zeabur 环境变量生成运行所需的 `config.json`、可选 `pg.config.json` 和 `data/messageIds.json`。
- `deploy/zeabur/env.example`：Zeabur 环境变量模板。
- `deploy/zeabur/config.zeabur.example.json`：适合复制后填写的 `config.json` 模板。
- `deploy/zeabur/pg.config.basic.example.json`：普通 PostgreSQL `pg.config.json` 示例。
- `deploy/zeabur/pg.config.zeabur.example.json`：使用 Zeabur `${POSTGRES_*}` 变量的 PostgreSQL 配置模板。
- `zeabur-template.yaml`：一键部署模板，会同时创建 Bot 服务和 PostgreSQL 服务。

## Zeabur 操作步骤

1. 将代码推送到你自己的 fork：`origin`，即 `https://github.com/Alakid-bot/jsbot.git`。
2. 在 Zeabur 新建 Project，选择 **GitHub** 服务，并选择你的 fork 仓库。
3. Zeabur 会检测根目录 `Dockerfile`，按 Dockerfile 构建并运行。
4. 在 Zeabur 服务的 **Environment Variables** 添加环境变量。
5. 建议添加持久化 Volume，挂载到 `/app/data`，用于保存 SQLite 数据库、`messageIds.json`、答疑日志等运行时数据。
6. 如需保留应用日志，也可以额外挂载 `/app/logs`。

## 一键部署 Bot + PostgreSQL

如果希望在 Zeabur 上创建项目时同时部署 Bot 和 PostgreSQL，可以使用仓库根目录的：

```text
zeabur-template.yaml
```

该模板会创建两个服务：

- `postgresql`：基于 `postgres:16` 的 PostgreSQL 数据库，持久化目录是 `/var/lib/postgresql/data`。
- `jsbot`：从 `Alakid-bot/jsbot` 的 `main` 分支构建并运行 Bot，持久化目录是 `/app/data` 和 `/app/logs`。

模板中的 `jsbot` 服务依赖 `postgresql` 服务，Zeabur 会先启动数据库，再启动 Bot。

使用 CLI 部署示例：

```bash
npx zeabur@latest template deploy -f zeabur-template.yaml
```

部署时需要填写：

```env
JSBOT_CONFIG_JSON_BASE64=BASE64_ENCODED_CONFIG_JSON
TZ=Asia/Shanghai
```

其中 `JSBOT_CONFIG_JSON_BASE64` 来自：

```bash
base64 -w 0 config.json
```

如果你在 Zeabur 面板手动创建服务，也可以先添加 PostgreSQL 服务，再给 Bot 服务设置下面任一方式：

1. 推荐：直接让 Zeabur 注入 PostgreSQL 变量。启动脚本支持标准 `POSTGRES_*` 名称，也支持模板中使用的 `ZEABUR_POSTGRES_*` 名称：

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

容器启动时会自动根据这些变量生成 `/app/pg.config.json`。

2. 或者手动设置完整 JSON：

```env
JSBOT_PG_CONFIG_JSON={"host":"${POSTGRES_HOST}","port":5432,"database":"${POSTGRES_DATABASE}","user":"${POSTGRES_USERNAME}","password":"${POSTGRES_PASSWORD}","logging":false}
```

## 必填环境变量

推荐使用 base64，避免 JSON 中的引号和换行在面板里被转义错误。

```bash
base64 -w 0 config.json
```

然后在 Zeabur 设置：

```env
JSBOT_CONFIG_JSON_BASE64=上一步输出的内容
NODE_ENV=production
```

如果你的系统是 macOS，没有 `-w 0` 参数，可用：

```bash
base64 < config.json | tr -d '\n'
```

## 可选 PostgreSQL 环境变量

如果使用项目的 PostgreSQL 相关功能，先准备 `pg.config.json`，然后：

```bash
base64 -w 0 pg.config.json
```

并在 Zeabur 设置：

```env
JSBOT_PG_CONFIG_JSON_BASE64=上一步输出的内容
```

不设置 PostgreSQL 配置时，项目启动会记录 PostgreSQL 初始化失败，但代码中将其作为非致命错误处理，Bot 仍会继续运行；依赖 PostgreSQL 的功能不可用。

在 Zeabur 上，如果 Bot 服务可以读取同项目 PostgreSQL 服务暴露的变量，也可以不设置 `JSBOT_PG_CONFIG_JSON_BASE64`。启动脚本会在发现以下变量时自动生成 `pg.config.json`：

```env
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DATABASE
POSTGRES_USERNAME
POSTGRES_PASSWORD
```

或对应的：

```env
ZEABUR_POSTGRES_HOST
ZEABUR_POSTGRES_PORT
ZEABUR_POSTGRES_DATABASE
ZEABUR_POSTGRES_USERNAME
ZEABUR_POSTGRES_PASSWORD
```

## 首次部署注意事项

- `config.json` 中的 `token` 必须是真实 Discord Bot Token。
- `guilds` 至少需要包含你要部署命令的服务器 ID。
- `commandsDeployed` 首次可设为 `false`，Bot 会尝试部署命令并在容器内更新 `config.json`。
- 如果没有持久化 `/app/data`，SQLite 数据库和运行时状态会在重建容器后丢失。
- 如果没有持久化或更新环境变量中的配置，容器重建后 `commandsDeployed` 可能又回到环境变量里的值；稳定运行后可把环境变量中的对应值改为 `true`，避免每次重建都重新部署命令。

## 本地生成配置示例

```bash
cp deploy/zeabur/config.zeabur.example.json config.json
# 编辑 config.json 后：
node -e "JSON.parse(require('fs').readFileSync('config.json', 'utf8')); console.log('config.json OK')"
base64 -w 0 config.json
```

不要将真实 `config.json`、`pg.config.json`、`.env` 提交到 GitHub；这些文件已在 `.gitignore` 中忽略。
