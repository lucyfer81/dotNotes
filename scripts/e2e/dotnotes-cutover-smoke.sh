#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$ROOT_DIR/output/playwright/dotnotes-cutover-smoke"
BASE_URL="${DOTNOTES_BASE_URL:-https://dotnotes.lucyfer81.workers.dev}"
OPS_URL="${DOTNOTES_OPS_URL:-${BASE_URL%/}/ops}"
SESSION_NAME="${PLAYWRIGHT_CLI_SESSION:-dotnotes-cutover-smoke}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"

mkdir -p "$ARTIFACT_DIR"
cd "$ARTIFACT_DIR"

run_pw() {
	PLAYWRIGHT_CLI_SESSION="$SESSION_NAME" bash "$PWCLI" "$@"
}

cleanup() {
	run_pw close >/dev/null 2>&1 || true
}

assert_last_line() {
	local expected="$1"
	local label="$2"
	local output
	shift 2
	output="$(run_pw "$@")"
	local actual
	actual="$(printf '%s\n' "$output" | grep -E '^(true|false)$' | tail -n 1 || true)"
	if [[ "$actual" != "$expected" ]]; then
		printf '断言失败: %s\n期望: %s\n实际: %s\n完整输出:\n%s\n' "$label" "$expected" "$actual" "$output" >&2
		exit 1
	fi
}

trap cleanup EXIT

run_pw open "$BASE_URL"
sleep 2
assert_last_line "true" "首页基础工作台按钮存在" \
	eval "document.body.innerText.includes('Capture') && document.body.innerText.includes('Organize') && document.body.innerText.includes('Focus')"
assert_last_line "false" "首页不应再出现 Blog 入口" \
	eval "document.evaluate(\"//button[normalize-space()='Blog'] | //a[normalize-space()='Blog']\", document, null, XPathResult.BOOLEAN_TYPE, null).booleanValue"
run_pw screenshot
run_pw close

run_pw open "$OPS_URL"
sleep 2
assert_last_line "true" "运维控制台标题存在" \
	eval "document.body.innerText.includes('运维控制台')"
assert_last_line "false" "运维控制台不应再出现 RSS 阅读队列" \
	eval "document.evaluate(\"//h1[normalize-space()='RSS 阅读队列'] | //h2[normalize-space()='RSS 阅读队列'] | //h3[normalize-space()='RSS 阅读队列']\", document, null, XPathResult.BOOLEAN_TYPE, null).booleanValue"
run_pw screenshot

printf 'dotnotes cutover smoke passed: %s and %s\n' "$BASE_URL" "$OPS_URL"
