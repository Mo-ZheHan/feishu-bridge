# FeishuBridge shell 侧集成 —— source 进 ~/.zshrc。依赖与细节见 setup/README.md。
# 与飞书启动卡同源（launcher.js / remote-launch.js 复刻这套逻辑）：
#   claude <host>   选远程项目 → rsync 同步到本地镜像 → tmux 里起 claude
#   claude [args]   本地 tmux 里起 claude
#   ccback          fzf 选一个正在跑的 claude 会话接回

export PATH="$HOME/.local/bin:$PATH"   # claude 官方安装器装在这里

# tmux 快捷别名
alias tn='tmux new -s'          # 新建会话
alias tl='tmux ls'              # 列出会话
alias tt='tmux attach -t'       # 恢复指定会话
alias ttt='tmux attach -t $(tmux ls | tail -n1 | cut -d: -f1)'  # 恢复最后一个会话
alias tk='tmux kill-session -t' # 结束指定会话

# ── Claude Code 远程开发 + tmux 持久化 ──────────────────────
# 每次新开一个 tmux 会话（可后台/并行），退出即关闭；CLAUDE_NO_TMUX=1 禁用。
CLAUDE_REMOTE_HOSTS=(devcloud cscg102 cscg103 cscg104 cscg106 fitten fitten2 hpc)
CLAUDE_REMOTE_BASE='~/Code'
typeset -gA CLAUDE_REMOTE_BASE_OVERRIDE=( [hpc]='~' )   # 个别主机的根目录(覆盖 CLAUDE_REMOTE_BASE)
CLAUDE_WORK_DIR="$HOME/ClaudeWork"                       # 本地镜像（自动托管）

# 在 <workdir> 运行命令：默认包进新 tmux 会话；已在 tmux 内/禁用/非终端则直接跑
_claude_launch() {
  local name=$1 wd=$2; shift 2
  if [[ -n $TMUX || -n $CLAUDE_NO_TMUX || ! -t 1 ]]; then
    ( cd "$wd" && "$@" )
  else
    tmux new-session -s "claude-${name//[^A-Za-z0-9_-]/-}-$(date +%H%M%S)" \
      -c "$wd" "exec ${(j: :)${(@q)@}}"
  fi
}

claude() {
  local bin="$HOME/.local/bin/claude"

  # 首参非已知主机 → 本地
  if (( ! $# )) || [[ -z ${CLAUDE_REMOTE_HOSTS[(re)$1]} ]]; then
    _claude_launch "${PWD:t}" "$PWD" "$bin" --dangerously-skip-permissions "$@"
    return
  fi

  local host="$1"; shift
  local base="${CLAUDE_REMOTE_BASE_OVERRIDE[$host]:-$CLAUDE_REMOTE_BASE}"

  echo "🔍 列出 $host:$base ..." >&2
  local proj=$(ssh "$host" "cd $base 2>/dev/null && ls -1d */ 2>/dev/null" \
                 | fzf -1 -0 --reverse --height=40% --prompt="$host ❯ ")
  proj=${proj%/}
  [[ -n $proj ]] || { echo "无项目或已取消" >&2; return 1; }

  local dest="$CLAUDE_WORK_DIR/$host/$proj"
  mkdir -p "$dest"

  # 派生 rsync exclude，跟 ~/.mutagen.yml 单一来源
  local rsync_excludes=()
  if [[ -f ~/.mutagen.yml ]]; then
    while IFS= read -r p; do
      [[ -n $p ]] && rsync_excludes+=(--exclude="$p")
    done < <(yq '.sync.defaults.ignore.paths[]' ~/.mutagen.yml 2>/dev/null)
  fi

  echo "⏬ 正在拉取项目 $proj"
  /opt/homebrew/bin/rsync -az --delete --delete-excluded --info=progress2 -h \
    "${rsync_excludes[@]}" -e ssh "$host:$base/$proj/" "$dest/" \
    || { echo "❌ 同步失败" >&2; return 1; }

  _claude_launch "$host-$proj" "$dest" \
    claude-remote-shell "$host:$base/$proj" "$bin" --dangerously-skip-permissions "$@"
}

# 接回一个正在运行的 claude 会话
ccback() {
  local pick=$(tmux ls -F '#{session_name}' 2>/dev/null | grep '^claude-' \
                 | fzf -1 -0 --reverse --height=40% --prompt='接回 ❯ ')
  [[ -n $pick ]] || { echo "没有正在运行的 claude 会话" >&2; return 1; }
  if [[ -n $TMUX ]]; then tmux switch-client -t "$pick"; else tmux attach -t "$pick"; fi
}

# ── Codex CLI PTY 中继（由 agent_notifier install.sh 注入） ──
codex() {
    local CODEX_BIN_CMD="${CODEX_BIN:-codex}"
    if [[ -z "$TMUX" && -z "$PTY_RELAY_ACTIVE" ]]; then
        PTY_RELAY_ACTIVE=1 python3 "$HOME/Code/agent_notifier/bin/pty-relay.py" "$CODEX_BIN_CMD" "$@"
    else
        command "$CODEX_BIN_CMD" "$@"
    fi
}
