#!/usr/bin/env bash
# Codex にタスクを投げる。セッション ID を保存し、resume で文脈を引き継げる。
#   新規:   scripts/codex-task.sh <name> <prompt-file>
#   続き:   scripts/codex-task.sh <name> <prompt-file> --resume
# ログ:     .codex-tasks/<name>.jsonl / 最終回答: .codex-tasks/<name>.last.md
set -euo pipefail
NAME=$1; PROMPT_FILE=$2; MODE=${3:-new}
ROOT=$(cd "$(dirname "$0")/.." && pwd); D="$ROOT/.codex-tasks"; mkdir -p "$D"
# デスクトップアプリ由来の環境変数（ANTHROPIC_BASE_URL 等）を持ち込まない
CLEAN_ENV=(env -i HOME="$HOME" USER="$USER" LANG=ja_JP.UTF-8 TERM=dumb
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
COMMON=(-m "${CODEX_MODEL:-gpt-5.6-terra}" -c "model_reasoning_effort=\"${CODEX_EFFORT:-high}\"" --json -o "$D/$NAME.last.md")
cd "$ROOT"
if [ "$MODE" = "--resume" ]; then
  SID=$(cat "$D/$NAME.session")
  "${CLEAN_ENV[@]}" codex exec resume "${COMMON[@]}" "$SID" - < "$PROMPT_FILE" >> "$D/$NAME.jsonl" 2>>"$D/$NAME.err"
else
  "${CLEAN_ENV[@]}" codex exec "${COMMON[@]}" -C "$ROOT" - < "$PROMPT_FILE" > "$D/$NAME.jsonl" 2>"$D/$NAME.err"
  python3 -c 'import sys,json
for l in open(sys.argv[1]):
    try: e=json.loads(l)
    except Exception: continue
    if e.get("type")=="thread.started": print(e["thread_id"]); break' "$D/$NAME.jsonl" > "$D/$NAME.session"
fi
echo "done: $NAME (session $(cat "$D/$NAME.session"))"
