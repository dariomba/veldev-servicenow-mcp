#!/usr/bin/env bash
# PostToolUse hook: auto-fix formatting and inject lint feedback after Write/Edit.
#
# Fires after every Write or Edit on a .ts file. Runs biome check --write
# (auto-fix) then injects any remaining violations as additionalContext so
# Claude self-corrects without interruption. Never exits 2 — lint issues are
# feedback, not blockers (tests gate completion via stop-verify.sh).

INPUT=$(cat)
FILE="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')"

# Only TypeScript source files; skip node_modules / build artifacts
[[ "$FILE" =~ \.ts$ ]] || exit 0
[[ "$FILE" =~ /(node_modules|build)/ ]] && exit 0

# Auto-fix formatting and safe lint rules in-place (silent — Claude wrote it)
npx biome check --write "$FILE" >/dev/null 2>&1 || true

# Collect remaining issues after auto-fix
BIOME_OUT=$(npx biome check "$FILE" 2>&1)
BIOME_EXIT=$?

# Exit cleanly if nothing to report
[[ $BIOME_EXIT -eq 0 ]] && exit 0

# Inject feedback into Claude's next turn as context (cap at 4000 chars)
FEEDBACK="biome check ${FILE##*/}:\n$(echo "$BIOME_OUT" | head -40)"
jq -n --arg ctx "$FEEDBACK" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
exit 0
