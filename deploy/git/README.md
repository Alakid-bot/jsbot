# Git 推送保护

本仓库的开发目标是：所有推送默认进入你自己的 fork：

```text
origin -> https://github.com/Alakid-bot/jsbot.git
```

建议本地执行以下配置：

```bash
git branch --set-upstream-to=origin/main main
git config --local remote.pushDefault origin
git config --local push.default simple
git remote set-url --push origin https://github.com/Alakid-bot/jsbot.git
git remote set-url --push upstream DISABLED
```

这样：

- `git push` 默认推送到 `origin/main`。
- `git push origin ...` 推送到你的 fork。
- `git push upstream ...` 会失败，避免误推原项目。

如需进一步保护，可安装本目录的 pre-push hook：

```bash
cp deploy/git/pre-push-origin-only.sample .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

该 hook 会拒绝非 `origin` 或非 `Alakid-bot/jsbot` fork URL 的推送。
