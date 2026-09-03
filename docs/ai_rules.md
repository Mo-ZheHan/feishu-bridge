# AI 开发规则

## 1. 文档与语言

- 本项目 AI 相关文档、对话、代码注释、CLI 输出、提交信息统一使用中文。
- 代码标识符、目录名、脚本名保持英文。
- 面向 AI 的说明优先写在 `docs/ai_rules.md` 与 `docs/ai_docs/`，避免把关键背景只放在聊天记录里。

## 2. 当前支持范围

本仓库当前支持两个交互宿主：

- `Claude`：基于 hooks 的本地集成
- `Codex CLI`：基于本地终端会话与 session 文件的集成

当前明确不支持：

- `codex_app` 云端任务模式

## 3. 代码结构约束

- 新的运行时代码统一放在 `src/` 下。
- 仓库根目录脚本只保留轻量入口，不要继续堆业务逻辑：
  - `hook-handler.js`
  - `ask-handler.js`
  - `live-handler.js`
  - `feishu-listener.js`
- 宿主专属逻辑分层放置：
  - Claude 相关适配放在 `src/adapters/claude`
  - Codex 相关适配放在 `src/adapters/codex`
- 飞书通道层统一放在 `src/channels/feishu`
- Codex 运行态应用统一放在 `src/apps`
- 所有飞书卡片都必须带宿主身份，至少能区分 `Claude` 与 `Codex`
- 旧卡片不能因为新卡片出现而被无条件废弃；交互卡要靠超时、提交、取消来收敛

## 4. Codex / Claude 链路约束

### Claude

- Claude 的实时摘要基于 hook 事件与 transcript
- `FEISHU_LIVE_CAPTURE` 语义来源于 Claude 的实现，是全项目的基准语义
- Claude 只在 claude-isolation 的隔离容器里跑。飞书端 `ccc` / `ccc <host>` 起会话时，
  `src/apps/launcher.js` 调 `host/launch_session.sh --detached`（本地）或 `ccc <host> <proj> --detached`
  （远程，ccc 负责 rsync 播种）在容器里建 detached tmux 会话；绝不在宿主机起 Claude
- 终端注入目标形如 `<session>@workbench-app:/wb/run`（容器 tmux，经 docker exec），由 bridge 经
  `CLAUDE_TMUX_TARGET` 下发；`ccc back` 的会话表来自 hook 落盘的 `/tmp/claude-tmux-<session>.json`

### Codex

- Codex 的交互卡由 `src/apps/codex-watcher.js` 处理
- Codex 的实时摘要由 `src/apps/codex-live.js` 处理
- Codex 的真实 assistant 输出来自 `~/.codex/sessions/*.jsonl`
- `src/apps/codex-session-watcher.js` 负责把 session 中的 assistant message 与 token 信息写入 live buffer
- `pty-relay.py` 只负责 PTY/输入桥接与 live capture 启动，不应继续承担“猜测 assistant 正文”的主职责

## 5. 飞书实时摘要语义

- `FEISHU_LIVE_CAPTURE=1` 或 `true`
  - 开启全部实时摘要采集
- `FEISHU_LIVE_CAPTURE=tools,output,results`
  - `tools`：工具/命令摘要
  - `output`：助手输出文字
  - `results`：工具结果摘要

Codex 的实时摘要规则：

- 同一任务：`patch` 同一张卡
- 新任务：`create` 新卡
- 任务边界由 `assistant_key` 决定，不靠 PTY 文本前缀猜测

## 6. 卡片展示约束

### Codex 实时摘要卡

- 纯助手输出卡不显示伪造的“步骤表”
- `final_answer` 使用绿色完成卡
- 长文本必须分块，避免飞书截断
- footer 统一包含：
  - `🤖 Codex`
  - `🖥 pts/x`
  - `📁 项目名`
  - `⏱ 当前任务总时长`
  - `⏰ 时间`
  - `📊 输入 / 输出 / 缓存读 / 缓存写(仅在有数据时显示) / 总计`

### Codex 交互卡

- 文本输入、审批、单选、多选都要能通过飞书回流到终端
- 回流逻辑由 `src/channels/feishu/feishu-interaction-handler.js` 和 `src/adapters/codex/cli-input-bridge.js` 统一处理

## 7. 测试与验证

运行全量测试（Node ≥ 22，`--test` 自带 glob 展开；引号不能省，否则 sh 把 `**` 当 `*`，三层目录下的用例静默跳过）：

```bash
npm test          # node --test "tests/**/*.test.js"
```

### 测试目录结构

```
tests/
├── adapters/codex/
│   ├── cli-input-bridge.test.js       # Codex 输入桥接：文本/审批/单选/多选注入
│   └── cli-output-parser.test.js      # Codex 终端输出解析
├── apps/
│   ├── claude-ask.test.js             # Claude AskUserQuestion form 卡与回放元数据
│   ├── claude-hook.test.js            # Claude Stop/StopFailure 卡、问卷检测、会话登记
│   ├── claude-live.test.js            # Claude 执行摘要卡与 turn 重建
│   ├── launcher.test.js               # 飞书起 ccc 会话：命令解析、主机表、会话名
│   ├── codex-live.test.js             # Codex 实时摘要卡片
│   ├── codex-session-watcher.test.js  # Codex session 文件监控
│   └── codex-watcher.test.js          # Codex PTY 输出监控与交互卡
├── channels/
│   ├── codex-feishu-interaction-scenarios.test.js  # Codex 飞书交互端到端场景
│   ├── feishu-interaction-handler.test.js          # 飞书交互处理器单元测试
│   └── resolve-chat-id.test.js                     # 群 id 解析
└── lib/
    ├── askq-replay.test.js            # 问卷回放键序规划
    ├── card.test.js                   # 终端 id 显示（本机/容器目标）
    ├── session-state.test.js          # 状态文件：__meta__ 合并、封顶
    ├── terminal-inject.test.js        # tmux 键分组、目标串解析
    ├── transcript-utils.test.js       # 窗口式倒序读 transcript
    └── …                              # 卡片构建的其余用例
```

### 专项测试

- Codex 解析/桥接：`node --test "tests/adapters/codex/*.test.js"`
- Claude 链路：`node --test "tests/apps/claude-*.test.js" "tests/lib/*.test.js"`
- 飞书交互链路：`node --test "tests/channels/*.test.js"`
- Python 语法检查：`python3 -m py_compile bin/pty-relay.py`

### 原则

- 改解析器时，先补测试再改实现
- 改交互桥时，要覆盖文本、审批、单选、多选
- 改飞书卡片时，除了单测，还应做真机弹窗验证
- 终端注入使用 `\r`(CR) 作为 Enter，不用 `\n`(LF) — PTY raw mode 下 LF 不是 Enter
- 读 transcript 只用 `lib/transcript-utils` 的尾部窗口读，不要 `readFileSync` 整文件——它会长到几百 MB

## 8. 运行与联调

Codex + 飞书联调至少需要这些进程在线：

- `node feishu-listener.js`
- `python3 pty-relay.py codex ...`
- `node src/apps/codex-session-watcher.js --pts <N>` 或由 `pty-relay.py` 自动拉起
- `node src/apps/codex-watcher.js`（交互卡与提示解析）

如果启动脚本提示 PID 存在但进程很快退出，优先直接前台启动排错：

- `node feishu-listener.js`
- `node src/apps/codex-watcher.js`
- `node src/apps/codex-session-watcher.js --pts <N>`

## 9. 真机验证脚本

- `scripts/send-codex-feishu-test-cards.js`
  - 发送 Codex 文本输入、审批、单选、多选交互卡
- `scripts/send-codex-assistant-direct.js`
  - 直接发送一张 Codex 文本卡，适合对账
- `scripts/send-codex-assistant-feed.js`
  - 通过 feed 方式发送 Codex assistant 摘要
- `npm run ask:e2e:card`
  - 发送 Claude 风格方案选择卡，适合验证 Claude 按钮注入

注意：

- `send-codex-feishu-test-cards.js` 只负责交互卡，不生成 `execution_summary`
- 要验证 Codex 实时摘要，应触发真实 session 输出，或向 `/tmp/codex-live-<pts>.jsonl` 写入受控测试数据

## 10. 提交原则

- 只提交与当前目标直接相关的文件
- 不要把运行产物、pid、缓存目录、临时日志带进提交
- 文档更新优先同步到：
  - `README.md`
  - `docs/ai_rules.md`
  - `docs/ai_docs/`
