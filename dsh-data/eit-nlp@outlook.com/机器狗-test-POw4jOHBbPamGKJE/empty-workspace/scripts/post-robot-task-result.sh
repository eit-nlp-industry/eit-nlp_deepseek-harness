#!/usr/bin/env bash
# 向 DSH robot-task-results 回调「任务完成」。
# 鉴权与 URL 优先读环境变量 / $DSH_HOME/.env（ROBOT_CALLBACK_TOKEN），
# 也可用命令行: ./post-robot-task-result.sh <task_id> [status] [message]
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# scripts/ -> empty-workspace/ -> $DSH_HOME
INSTANCE_HOME=$(cd "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="${DSH_HOME:-$INSTANCE_HOME}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# ========== 本地默认（可被 .env / 环境变量 / 参数覆盖）==========
DEFAULT_TASK_ID='sbi_058d3e1b33184126b49031a5a8cb38cd'
DEFAULT_MESSAGE='已完成'
DEFAULT_STATUS='succeeded'
# DSH 端口池现为 13180-13189；当前机器狗实例 directPort=13181。
DEFAULT_URL='http://10.37.0.21:13181/robot-task-results'
# ==============================================================

TASK_ID="${1:-$DEFAULT_TASK_ID}"
STATUS="${2:-$DEFAULT_STATUS}"
MESSAGE="${3:-$DEFAULT_MESSAGE}"
URL="${URL:-${ROBOT_CALLBACK_URL:-$DEFAULT_URL}}"
TOKEN="${TOKEN:-${ROBOT_CALLBACK_TOKEN:-}}"

if [[ -z "$TASK_ID" ]]; then
  echo "请传入 task_id: $0 <task_id> [status] [message]" >&2
  exit 1
fi
if [[ -z "$TOKEN" ]]; then
  echo "缺少 ROBOT_CALLBACK_TOKEN：请写入 ${ENV_FILE}，或 export TOKEN=..." >&2
  exit 1
fi

BODY=$(TASK_ID="$TASK_ID" STATUS="$STATUS" MESSAGE="$MESSAGE" python3 - <<'PY'
import json, os
print(json.dumps({
  "task_id": os.environ["TASK_ID"],
  "status": os.environ["STATUS"],
  "message": os.environ["MESSAGE"],
}, ensure_ascii=False))
PY
)

echo "POST $URL"
echo "body: $BODY"
echo "auth: Bearer (from ROBOT_CALLBACK_TOKEN / TOKEN, not printed)"
curl -i \
  -X POST \
  "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data "$BODY"
echo
