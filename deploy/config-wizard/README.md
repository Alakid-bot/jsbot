# JSBot 配置向导

这是 JSBot 的网页配置向导：

- 本地直接打开时：生成 `config.json` 和 Zeabur 环境变量 `JSBOT_CONFIG_JSON_BASE64`。
- Zeabur 域名访问时：通过受密码保护的后端 API 保存 `data/config.json`，并自动启动/重启 Bot。

## 使用方式

本地模式直接用浏览器打开：

```text
deploy/config-wizard/index.html
```

然后填写：

- Discord Bot Token
- Discord 服务器 ID
- 管理员/版主角色 ID
- 常用频道、Thread、Category ID
- Forum / Thread 自动化配置
- 身份组申请配置
- AI 答疑接口：FastGPT、OpenAI 兼容 API、SK/API Key、模型名
- 社区治理 / 投票系统配置：法院频道、提案/辩论 Forum、支持数和投票时长
- Bot 运行监控配置：状态频道、被监控角色、角色显示名

页面会自动生成：

- `config.json`
- `JSBOT_CONFIG_JSON_BASE64`
- 可直接复制到 Zeabur 的环境变量片段

## Zeabur 在线模式

推荐 Zeabur 环境变量：

```env
JSBOT_WEB_PASSWORD=ZEABUR_GENERATED_16_CHAR_PASSWORD
JSBOT_WEB_PASSWORD_FILE=/app/data/web-password.txt
PORT=8080
JSBOT_CONFIG_PATH=/app/data/config.json
NODE_ENV=production
```

一键部署模板会生成 16 位随机密码并写入 `JSBOT_WEB_PASSWORD`。配置页只校验密码，不校验用户名；如果浏览器 Basic Auth 登录框显示用户名，留空或填写任意内容都可以。如果不设置 `JSBOT_WEB_PASSWORD`，容器会自动生成 fallback 密码，保存到 `JSBOT_WEB_PASSWORD_FILE`，并打印在 Zeabur 的 `jsbot` 服务日志里。部署后打开 Zeabur 域名，登录后可直接修改 AI 答疑、投票系统、运行监控等配置并保存重启 Bot。如果使用仓库根目录的 `zeabur-template.yaml`，PostgreSQL 会自动创建，通常不需要额外填写 `JSBOT_PG_CONFIG_JSON_BASE64`。

## 安全说明

本地模式不需要服务器，不依赖外部 CDN，所有数据都只在浏览器本地处理。Zeabur 在线模式会把配置保存到服务器持久化目录，因此必须使用强密码保护；未设置 `JSBOT_WEB_PASSWORD` 时容器会自动生成。不要把真实 Token、Key、`config.json` 或 `.env` 文件提交到 GitHub。
