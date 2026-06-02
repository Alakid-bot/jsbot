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

    mkdir -p "$(dirname "$target_file")"

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

setup_web_password() {
    : "${JSBOT_WEB_PASSWORD_FILE:=data/web-password.txt}"
    export JSBOT_WEB_PASSWORD_FILE

    if [ -n "$(printenv JSBOT_WEB_PASSWORD || true)" ]; then
        export JSBOT_WEB_PASSWORD
        echo "[entrypoint] JSBot web configuration password is set from environment. The password will not be printed."
        return 0
    fi

    if [ -n "$(printenv PASSWORD || true)" ]; then
        JSBOT_WEB_PASSWORD="$(printenv PASSWORD)"
        export JSBOT_WEB_PASSWORD
        echo "[entrypoint] JSBot web configuration password is synchronized from PASSWORD. The password will not be printed."
        return 0
    fi

    JSBOT_WEB_PASSWORD="$(node <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const passwordFile = process.env.JSBOT_WEB_PASSWORD_FILE || 'data/web-password.txt';
fs.mkdirSync(path.dirname(passwordFile), { recursive: true });

let password = '';
let created = false;

if (fs.existsSync(passwordFile)) {
    password = fs.readFileSync(passwordFile, 'utf8').trim();
}

if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
    created = true;
}

try {
    fs.chmodSync(passwordFile, 0o600);
} catch (_error) {
    // Some mounted volumes may not support chmod; the file still remains inside the app volume.
}

console.error(
    created
        ? `[entrypoint] Generated JSBot web configuration password at ${passwordFile}`
        : `[entrypoint] Reusing JSBot web configuration password from ${passwordFile}`
);

process.stdout.write(password);
NODE
)"
    export JSBOT_WEB_PASSWORD

    echo "============================================================"
    echo "JSBot web configuration password"
    echo "Password: ${JSBOT_WEB_PASSWORD}"
    echo "Password file: ${JSBOT_WEB_PASSWORD_FILE}"
    echo "Only the password is checked. If your browser shows a username field, leave it blank or enter anything."
    echo "Set JSBOT_WEB_PASSWORD in Zeabur if you want to override it."
    echo "============================================================"
}

mkdir -p data logs data/backups data/qalog

: "${JSBOT_CONFIG_PATH:=data/config.json}"
export JSBOT_CONFIG_PATH

setup_web_password

# Optional application configuration. Prefer JSBOT_CONFIG_JSON_BASE64 when the
# Zeabur dashboard has trouble preserving quotes/newlines in large JSON values.
# When omitted, the web configuration page can create data/config.json after the
# service starts.
write_json_from_env "$JSBOT_CONFIG_PATH" "JSBOT_CONFIG_JSON" "JSBOT_CONFIG_JSON_BASE64" "false"

# PostgreSQL configuration is required because runtime data is stored in PostgreSQL.
write_json_from_env "pg.config.json" "JSBOT_PG_CONFIG_JSON" "JSBOT_PG_CONFIG_JSON_BASE64" "false"

# If this service is deployed together with a Zeabur PostgreSQL service, Zeabur
# can provide POSTGRES_* variables. Generate pg.config.json from them when no
# explicit JSBOT_PG_CONFIG_JSON/BASE64 value was provided.
write_pg_json_from_postgres_env

if [ -f "pg.config.json" ]; then
    node -e "JSON.parse(require('fs').readFileSync('pg.config.json', 'utf8'))"
else
    echo "Missing PostgreSQL configuration. Set JSBOT_PG_CONFIG_JSON/BASE64 or deploy with the Zeabur PostgreSQL template." >&2
    exit 1
fi

exec "$@"
