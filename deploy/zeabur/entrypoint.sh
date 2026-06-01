#!/bin/sh
set -eu

cd "${APP_DIR:-/app}"

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

write_pg_json_from_postgres_env() {
    if [ -f "pg.config.json" ]; then
        return 0
    fi

    postgres_host_value="$(printenv POSTGRES_HOST || true)$(printenv ZEABUR_POSTGRES_HOST || true)"
    if [ -z "$postgres_host_value" ]; then
        return 0
    fi

    node <<'NODE'
const fs = require('fs');

const aliases = {
    host: ['POSTGRES_HOST', 'ZEABUR_POSTGRES_HOST'],
    port: ['POSTGRES_PORT', 'ZEABUR_POSTGRES_PORT'],
    database: ['POSTGRES_DATABASE', 'ZEABUR_POSTGRES_DATABASE'],
    user: ['POSTGRES_USERNAME', 'ZEABUR_POSTGRES_USERNAME'],
    password: ['POSTGRES_PASSWORD', 'ZEABUR_POSTGRES_PASSWORD'],
};

function readFirst(keys) {
    const key = keys.find((name) => process.env[name]);
    return key ? process.env[key] : undefined;
}

const values = Object.fromEntries(
    Object.entries(aliases).map(([name, keys]) => [name, readFirst(keys)])
);

const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => aliases[name].join(' or '));

if (missing.length > 0) {
    console.error(`Missing PostgreSQL environment variables: ${missing.join(', ')}`);
    process.exit(1);
}

const config = {
    host: values.host,
    port: Number(values.port),
    database: values.database,
    user: values.user,
    password: values.password,
    max: Number(process.env.JSBOT_PG_POOL_MAX || 20),
    logging: process.env.JSBOT_PG_LOGGING === 'true',
    idleTimeoutMillis: Number(process.env.JSBOT_PG_IDLE_TIMEOUT_MILLIS || 30000),
    connectionTimeoutMillis: Number(process.env.JSBOT_PG_CONNECTION_TIMEOUT_MILLIS || 5000),
};

if (!Number.isFinite(config.port) || config.port <= 0) {
    console.error(`Invalid PostgreSQL port: ${values.port}`);
    process.exit(1);
}

fs.writeFileSync('pg.config.json', `${JSON.stringify(config, null, 4)}\n`);
NODE
}

mkdir -p data logs data/backups data/qalog

# Required application configuration. Prefer JSBOT_CONFIG_JSON_BASE64 when the
# Zeabur dashboard has trouble preserving quotes/newlines in large JSON values.
write_json_from_env "config.json" "JSBOT_CONFIG_JSON" "JSBOT_CONFIG_JSON_BASE64" "true"

# Optional PostgreSQL configuration. The bot treats PostgreSQL startup failure
# as non-fatal, but providing this enables PG-backed features.
write_json_from_env "pg.config.json" "JSBOT_PG_CONFIG_JSON" "JSBOT_PG_CONFIG_JSON_BASE64" "false"

# If this service is deployed together with a Zeabur PostgreSQL service, Zeabur
# can provide POSTGRES_* variables. Generate pg.config.json from them when no
# explicit JSBOT_PG_CONFIG_JSON/BASE64 value was provided.
write_pg_json_from_postgres_env

if [ -f "pg.config.json" ]; then
    node -e "JSON.parse(require('fs').readFileSync('pg.config.json', 'utf8'))"
fi

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
