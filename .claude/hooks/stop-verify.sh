#!/usr/bin/env bash
# Stop hook: block completion until tsc type-check and test suite both pass.
#
# Fires when Claude declares a turn complete. Runs the full quality gate:
#   1. npx tsc --noEmit  (type correctness)
#   2. npm test          (vitest suite, ~800 ms)
#
# Exit 2 + stderr feeds the failure output back to Claude as a new task,
# forcing it to fix the issue before it can stop again.
#
# stop_hook_active guard: when Claude is already in forced-continuation mode
# (hook fired → fix attempt → stop again), allow the stop to prevent an
# infinite loop if fixes are not possible.

INPUT=$(cat)

# Prevent infinite loops
if [[ "$(echo "$INPUT" | jq -r '.stop_hook_active // false')" == "true" ]]; then
  exit 0
fi

# 1. Type check
TSC_OUT=$(npx tsc --noEmit 2>&1)
if [[ $? -ne 0 ]]; then
  printf "tsc --noEmit failed — fix type errors before finishing:\n\n%s" "$TSC_OUT" >&2
  exit 2
fi

# 2. Test suite
TEST_OUT=$(npm test 2>&1)
if [[ $? -ne 0 ]]; then
  printf "npm test failed — fix failing tests before finishing:\n\n%s" \
    "$(echo "$TEST_OUT" | tail -50)" >&2
  exit 2
fi

exit 0
