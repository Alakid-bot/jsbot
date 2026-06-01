import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export function getConfigPath() {
    if (process.env.JSBOT_CONFIG_PATH) {
        return resolve(process.env.JSBOT_CONFIG_PATH);
    }

    const persistentPath = join(process.cwd(), 'data', 'config.json');
    if (existsSync(persistentPath)) {
        return persistentPath;
    }

    return join(process.cwd(), 'config.json');
}

export function readBotConfig() {
    return JSON.parse(readFileSync(getConfigPath(), 'utf8'));
}
