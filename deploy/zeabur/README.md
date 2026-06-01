# Zeabur 部署模板

本目录提供在 Zeabur 部署该 Discord Bot 的模板。该项目是长期运行的 Bot/Worker，不是 HTTP Web 服务，因此模板使用 Zeabur 支持的 `Dockerfile` 部署方式，不需要暴露端口。

## 文件说明

- `Dockerfile`：Zeabur 会自动识别仓库根目录的 Dockerfile 并按 Docker 部署。
- `.dockerignore`：避免把本地密钥、数据库、日志、node_modules 打进镜像。
- `deploy/zeabur/entrypoint.sh`：容器启动时从 Zeabur 环境变量生成运行所需的 `config.json`、可选 `pg.config.json` 和 `data/messageIds.json`。
- `deploy/zeabur/env.example`：Zeabur 环境变量模板。
- `deploy/zeabur/config.zeabur.example.json`：适合复制后填写的 `config.json` 模板。
- `deploy/zeabur/pg.config.zeabur.example.json`：可选 PostgreSQL 配置模板。

## Zeabur 操作步骤

1. 将代码推送到你自己的 fork：`origin`，即 `https://github.com/Alakid-bot/jsbot.git`。
2. 在 Zeabur 新建 Project，选择 **GitHub** 服务，并选择你的 fork 仓库。
3. Zeabur 会检测根目录 `Dockerfile`，按 Dockerfile 构建并运行。
4. 在 Zeabur 服务的 **Environment Variables** 添加环境变量。
5. 建议添加持久化 Volume，挂载到 `/app/data`，用于保存 SQLite 数据库、`messageIds.json`、答疑日志等运行时数据。
6. 如需保留应用日志，也可以额外挂载 `/app/logs`。

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
