# 环境配置与恢复清单

FeishuBridge 跑起来不只靠这个仓库，还耦合了 **shell 函数、SSH、mutagen、Claude 配置、launchd、Homebrew 包**。这个目录把它们全收在一处，换机/重装时照着恢复即可。

> 路径以本机为准：仓库在 `~/Code/agent_notifier`，用户名 `csrobo`，node 走 nvm。换机时替换成你的实际值。

> **本机现状（2026-09）**：Claude 只在 claude-isolation 的隔离容器里跑（`ccc`），hooks 由容器经 bridge 调到本仓库的
> `hook-handler.js` / `live-handler.js` / `ask-handler.js`，终端目标（`CLAUDE_TMUX_TARGET=<session>@workbench-app:/wb/run`）
> 和统计目录（`CLAUDE_STATS_DIR`）也由 bridge 给出。下面第 2、3 节的 `zshrc-claude.zsh`、`claude-settings.json`、
> statusline 管线是宿主 Claude 时代的配置，留作换机/查证的完整真相源，本机不再使用。

---

## 1. 系统依赖（Homebrew + npm + Claude）

```bash
# Homebrew 包
brew install tmux fzf yq rsync                      # 本地+远程同步链路
brew install torarnv/claude-remote-shell/claude-remote-shell   # 远程 Bash 重定向，自动带 mutagen 依赖

# Node（本机用 nvm；launchd plist 里写的是绝对路径 v24.19.0）
nvm install 24 && nvm use 24

# npm 全局（statusLine 用）
npm i -g ccusage

# Claude Code 本体（官方安装器，落到 ~/.local/bin/claude）：https://docs.claude.com/claude-code
```

关键二进制及用途：

| 工具 | 路径 | 谁在用 |
|------|------|--------|
| `tmux` | `/opt/homebrew/bin/tmux` | 会话持久化、按键注入（zshrc；容器会话经 docker exec 到容器内 tmux） |
| `fzf` | `/opt/homebrew/bin/fzf` | zshrc 里交互选项目/选会话 |
| `yq` | `/opt/homebrew/bin/yq` | 从 `~/.mutagen.yml` 派生 rsync exclude |
| `rsync` | `/opt/homebrew/bin/rsync` | 远程项目拉到本地镜像（**特意用 brew 版**，非系统 `/usr/bin/rsync`） |
| `claude-remote-shell` | `/opt/homebrew/bin/claude-remote-shell` | 远程会话里把 Bash 重定向到对端，内部用 mutagen 同步 |
| `mutagen` | `/opt/homebrew/bin/mutagen` | claude-remote-shell 的运行时依赖 |
| `node` | `~/.nvm/.../v24.19.0/bin/node` | 监听器 + 所有 hook |
| `ccusage` | 同 node 目录 | statusLine 成本显示 |
| `claude` | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.158` | Claude Code 本体 |

---

## 2. 配置文件一览（本目录 → 目标位置）

| 本目录文件 | 复制到 | 作用 |
|------------|--------|------|
| `zshrc-claude.zsh` | `~/.zshrc`（source 或粘贴） | `claude` / `ccback` / `codex` 三条命令；远程主机表 |
| `ssh-config` | `~/.ssh/config`（追加） | 8 台远程主机的**脱敏模板**（HostName/User/Port 是占位符，填真实值再用），全用 `~/.ssh/id_ed25519` 免密 |
| `mutagen.yml` | `~/.mutagen.yml` | rsync/mutagen 共享的忽略列表（单一来源） |
| `claude-settings.json` | `~/.claude/settings.json`（合并） | hooks 接入点 + statusLine |
| `com.agent-notifier.feishu-listener.plist` | `~/Library/LaunchAgents/` | 飞书监听守护进程 |
| `ccusage.json` | `~/.claude/ccusage.json` | statusLine 成本统计配置（时区/燃烧率/离线） |
| `env.full.example` | `<仓库根>/.env` | 飞书凭据 + 运行时开关 |

> `claude-settings.json`、plist、`ccusage.json` 里都有硬编码的 `/Users/csrobo/...` 绝对路径（仓库路径 / node 路径 / ccusage `$schema`）——换机必改。

---

## 3. statusline + ccusage 成本显示

状态栏那行「花了多少钱 / 燃烧率」是三段管线，在 `claude-settings.json` 的 `statusLine.command` 里：

```
node src/apps/cost-capture.js | ccusage statusline | node src/apps/statusline-fix.js
```

- `cost-capture.js`、`statusline-fix.js`：本仓库 `src/apps/` 下，git 已跟踪，clone 即有。
- `ccusage`：npm 全局（`npm i -g ccusage`），中间那段算成本。
- `ccusage.json`：放 `~/.claude/ccusage.json`（**ccusage 的 auto-discovery 认这个路径，不是 `~/.config/ccusage/`**）。设了时区 `Asia/Shanghai`、emoji 燃烧率、`offline:true`（statusline 不联网取价，用本地缓存，更快）。
- `$schema` 指向 `~/.nvm/.../ccusage/config-schema.json`，换机 node 路径变了就改它，或直接删这行（仅影响编辑器补全，不影响运行）。

---

## 4. 从零恢复步骤

```bash
# 0) 装好第 1 节的依赖，clone 本仓库到 ~/Code/agent_notifier
cd ~/Code/agent_notifier && npm install

# 1) SSH 密钥与主机
#    确保 ~/.ssh/id_ed25519 存在，公钥已发到各远程主机 authorized_keys
#    ssh-config 是脱敏模板：先把 <...> 占位符填成真实 HostName/User/Port，再追加
cp setup/ssh-config /tmp/ssh-config && $EDITOR /tmp/ssh-config && cat /tmp/ssh-config >> ~/.ssh/config

# 2) shell 集成
echo 'source ~/Code/agent_notifier/setup/zshrc-claude.zsh' >> ~/.zshrc

# 3) mutagen 忽略列表
cp setup/mutagen.yml ~/.mutagen.yml

# 4) Claude 配置（已有 settings.json 就手动合并 hooks/statusLine 段，别整覆盖）
cp setup/claude-settings.json ~/.claude/settings.json   # 注意改路径
cp setup/ccusage.json ~/.claude/ccusage.json            # statusLine 成本统计；注意改 $schema 路径

# 5) 环境变量（填真实飞书凭据）
cp setup/env.full.example .env && $EDITOR .env

# 6) 守护进程
cp setup/com.agent-notifier.feishu-listener.plist ~/Library/LaunchAgents/   # 注意改路径
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agent-notifier.feishu-listener.plist

# 改完 .env 或代码后重启监听器（唯一正确姿势）：
launchctl kickstart -k "gui/$(id -u)/com.agent-notifier.feishu-listener"
```

新机也可直接跑仓库根的 `install.sh`（幂等），它会处理 hooks 注入和 codex PTY 中继；本目录是「手动/查证」用的完整真相来源。
飞书端文本命令：`ccc`（本地项目菜单）、`ccc <host>`（远程项目菜单，如 `ccc tx_248 --resume`，尾随参数透传给 claude）起 detached 容器会话；`ccc back` 接回正在跑的会话。会话表来自 hook 落盘的 `/tmp/claude-tmux-<session>.json`，本机 tmux 和容器 tmux 都认。

---

## 5. 几个容易忘的耦合点

- **rsync 必须用 brew 版**：zshrc 写死 `/opt/homebrew/bin/rsync`（3.4.3）；新版 macOS 自带的 `/usr/bin/rsync` 实为 `openrsync`，部分 GNU 选项不兼容。
- **`hpc` 项目在 home 根**：不在 `~/Code`，所以 zshrc 有 `CLAUDE_REMOTE_BASE_OVERRIDE=( [hpc]='~' )`。
- **远程主机表两处同源**：`zshrc-claude.zsh` 的 `CLAUDE_REMOTE_HOSTS` 与 `ssh-config` 的 `Host` 必须对齐（飞书端的启动器已移除：Claude 只在容器里启动）。
- **mutagen 忽略是单一来源**：改 `~/.mutagen.yml`，zshrc 的 rsync exclude 会跟着变。
- **重启监听器只用 `launchctl kickstart`**，不要用 `npm run feishu-listener:start`（会和 launchd 抢进程）。
- **首次远程启动新目录**会弹 Claude 的 trust 确认；`remote-launch.js` 已自动替你回车（匹配 “trust this folder”）。
