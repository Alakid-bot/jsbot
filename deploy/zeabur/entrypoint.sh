#!/bin/sh
set -eu

cd /app

write_json_from_env() {
    target_file="$1"
    raw_var_name="$2"
    b64_var_name="$3"
    required="$4"

    raw_value="$(printenv "$raw_var_name" || true)"
    b64_value="$(printenv "$b64_var_name" || true)"

    if [ -n "$b64_value" ]; then
        printf '%s' "$b64_value" | base64 -d > "$target_file"
    elif [ -n "$raw_value" ]; then
        printf '%s' "$raw_value" > "$target_file"
    elif [ "$required" = "true" ]; then
        echo "Missing required environment variable: $raw_var_name or $b64_var_name" >&2
        exit 1
    else
        return 0
    fi

    node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$target_file"
}

mkdir -p data logs data/backups data/qalog

# Required application configuration. Prefer JSBOT_CONFIG_JSON_BASE64 when the
# Zeabur dashboard has trouble preserving quotes/newlines in large JSON values.
write_json_from_env "config.json" "JSBOT_CONFIG_JSON" "JSBOT_CONFIG_JSON_BASE64" "true"

# Optional PostgreSQL configuration. The bot treats PostgreSQL startup failure
# as non-fatal, but providing this enables PG-backed features.
write_json_from_env "pg.config.json" "JSBOT_PG_CONFIG_JSON" "JSBOT_PG_CONFIG_JSON_BASE64" "false"

# Optional persistent message IDs. If omitted, create an empty file so runtime
# modules that read data/messageIds.json have a sane starting point.
if [ -n "$(printenv JSBOT_MESSAGE_IDS_JSON_BASE64 || true)" ]; then
    printf '%s' "$(printenv JSBOT_MESSAGE_IDS_JSON_BASE64)" | base64 -d > data/messageIds.json
elif [ -n "$(printenv JSBOT_MESSAGE_IDS_JSON || true)" ]; then
    printf '%s' "$(printenv JSBOT_MESSAGE_IDS_JSON)" > data/messageIds.json
elif [ ! -f data/messageIds.json ]; then
    printf '{}\n' > data/messageIds.json
fi

node -e "JSON.parse(require('fs').readFileSync('data/messageIds.json', 'utf8'))"

exec "$@"
