import { QueryTypes } from 'sequelize';
import { pgManager } from '../pg/pgManager.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logTime } from '../utils/logger.js';

const fieldMap = {
    userid: 'userId',
    warningduration: 'warningDuration',
    executorid: 'executorId',
    syncedservers: 'syncedServers',
    keepmessages: 'keepMessages',
    channelid: 'channelId',
    createdat: 'createdAt',
    updatedat: 'updatedAt',
    notificationmessageid: 'notificationMessageId',
    notificationguildid: 'notificationGuildId',
    statusreason: 'statusReason',
    targetid: 'targetId',
    messageid: 'messageId',
    statusmessageid: 'statusMessageId',
    debatethreadid: 'debateThreadId',
    expireat: 'expireAt',
    processid: 'processId',
    redside: 'redSide',
    blueside: 'blueSide',
    redvoters: 'redVoters',
    bluevoters: 'blueVoters',
    totalvoters: 'totalVoters',
    starttime: 'startTime',
    endtime: 'endTime',
    publictime: 'publicTime',
    threadid: 'threadId',
    guildid: 'guildId',
    messagecount: 'messageCount',
    firstmessageat: 'firstMessageAt',
    lastmessageat: 'lastMessageAt',
};

function normalizeValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object' && !(value instanceof Date))) {
        return JSON.stringify(value);
    }
    return value;
}

function normalizeRow(row) {
    if (!row || typeof row !== 'object') {
        return row;
    }
    return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [fieldMap[key] || key, value]),
    );
}

function normalizeRows(rows) {
    return Array.isArray(rows) ? rows.map(normalizeRow) : normalizeRow(rows);
}

function convertPlaceholders(query) {
    let index = 0;
    return query.replace(/\?/g, () => `$${++index}`);
}

function normalizeQuery(query, operation) {
    let normalized = query
        .replace(/INSERT\s+OR\s+IGNORE/gi, 'INSERT')
        .replace(/strftime\('%s',\s*'now'\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT')
        .replace(/"in_progress"/g, "'in_progress'");

    normalized = convertPlaceholders(normalized);

    if (/INSERT\s+INTO\s+pg_sync_state/i.test(normalized) && !/\bON\s+CONFLICT\b/i.test(normalized)) {
        normalized += ' ON CONFLICT(thread_id) DO NOTHING';
    }

    if (operation === 'run' && /^\s*INSERT\s+INTO\s+/i.test(normalized) && !/\bRETURNING\b/i.test(normalized) && !/\bON\s+CONFLICT\b/i.test(normalized)) {
        normalized += ' RETURNING id';
    }

    return normalized;
}

class PostgresRuntimeManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000;
        this.connected = false;
    }

    async connect() {
        if (this.connected) {
            return;
        }
        if (!pgManager.getConnectionStatus()) {
            await pgManager.connect();
        }
        await this._createTables();
        this.connected = true;
        logTime('[数据库] PostgreSQL运行时存储初始化完成');
    }

    async _createTables() {
        const sequelize = pgManager.getSequelize();
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS punishments (
                id BIGSERIAL PRIMARY KEY,
                userId TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('ban', 'mute', 'softban', 'warning')),
                reason TEXT NOT NULL,
                duration BIGINT NOT NULL DEFAULT -1,
                warningDuration BIGINT DEFAULT NULL,
                executorId TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'appealed', 'revoked')),
                syncedServers TEXT NOT NULL DEFAULT '[]',
                keepMessages INTEGER DEFAULT 0,
                channelId TEXT,
                createdAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
                updatedAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
                notificationMessageId TEXT DEFAULT NULL,
                notificationGuildId TEXT DEFAULT NULL,
                statusReason TEXT DEFAULT NULL
            )
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS processes (
                id BIGSERIAL PRIMARY KEY,
                type TEXT NOT NULL CHECK(type IN ('appeal', 'vote', 'debate', 'court_mute', 'court_ban', 'court_impeach')),
                targetId TEXT NOT NULL,
                executorId TEXT NOT NULL,
                messageId TEXT UNIQUE NOT NULL,
                statusMessageId TEXT,
                debateThreadId TEXT,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'rejected', 'cancelled')),
                expireAt BIGINT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                supporters TEXT NOT NULL DEFAULT '[]',
                result TEXT CHECK(result IN ('approved', 'rejected', 'cancelled', NULL)),
                reason TEXT DEFAULT '',
                createdAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
                updatedAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            )
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS votes (
                id BIGSERIAL PRIMARY KEY,
                processId BIGINT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK(type IN ('appeal', 'court_mute', 'court_ban', 'court_impeach')),
                redSide TEXT NOT NULL,
                blueSide TEXT NOT NULL,
                redVoters TEXT NOT NULL DEFAULT '[]',
                blueVoters TEXT NOT NULL DEFAULT '[]',
                totalVoters INTEGER NOT NULL,
                startTime BIGINT NOT NULL,
                endTime BIGINT NOT NULL,
                publicTime BIGINT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed')),
                result TEXT CHECK(result IN ('red_win', 'blue_win', 'cancelled', NULL)),
                messageId TEXT NOT NULL,
                threadId TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                createdAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
                updatedAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            )
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS pg_sync_state (
                id BIGSERIAL PRIMARY KEY,
                thread_id TEXT UNIQUE NOT NULL,
                last_sync_at BIGINT,
                last_success_at BIGINT,
                member_count INTEGER DEFAULT 0,
                sync_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                last_error TEXT,
                priority TEXT DEFAULT 'low' CHECK(priority IN ('high', 'medium', 'low')),
                is_active INTEGER DEFAULT 0,
                created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
                updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
            )
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS message_stats (
                id BIGSERIAL PRIMARY KEY,
                guildId TEXT NOT NULL,
                userId TEXT NOT NULL,
                messageCount BIGINT NOT NULL DEFAULT 0,
                firstMessageAt BIGINT,
                lastMessageAt BIGINT,
                createdAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
                updatedAt BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
                UNIQUE(guildId, userId)
            )
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS user_blacklists (
                ownerId TEXT NOT NULL,
                targetUserId TEXT NOT NULL,
                addedAt BIGINT NOT NULL,
                addedBy TEXT NOT NULL,
                totalViolations INTEGER NOT NULL DEFAULT 0,
                threads TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY (ownerId, targetUserId)
            )
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS runtime_state (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_punishments_user ON punishments(userId);
            CREATE INDEX IF NOT EXISTS idx_punishments_status ON punishments(status, createdAt, duration);
            CREATE INDEX IF NOT EXISTS idx_processes_target ON processes(targetId);
            CREATE INDEX IF NOT EXISTS idx_processes_message ON processes(messageId);
            CREATE INDEX IF NOT EXISTS idx_processes_status ON processes(status, expireAt);
            CREATE INDEX IF NOT EXISTS idx_votes_process ON votes(processId);
            CREATE INDEX IF NOT EXISTS idx_votes_status ON votes(status, endTime);
            CREATE INDEX IF NOT EXISTS idx_pg_sync_priority ON pg_sync_state(priority, last_sync_at);
            CREATE INDEX IF NOT EXISTS idx_pg_sync_thread ON pg_sync_state(thread_id);
            CREATE INDEX IF NOT EXISTS idx_message_stats_guild_user ON message_stats(guildId, userId);
            CREATE INDEX IF NOT EXISTS idx_message_stats_count ON message_stats(guildId, messageCount DESC);
            CREATE INDEX IF NOT EXISTS idx_user_blacklists_owner ON user_blacklists(ownerId);
            CREATE INDEX IF NOT EXISTS idx_runtime_state_key ON runtime_state(key);
        `);
    }

    async safeExecute(operation, query, params = []) {
        if (!this.connected) {
            throw new Error('[数据库] PostgreSQL运行时存储未连接');
        }

        return ErrorHandler.handleService(
            async () => {
                const sequelize = pgManager.getSequelize();
                const sql = normalizeQuery(query, operation);
                const bind = params.map(normalizeValue);

                if (operation === 'get') {
                    const rows = await sequelize.query(sql, { bind, type: QueryTypes.SELECT });
                    return normalizeRow(rows[0] || null);
                }

                if (operation === 'all') {
                    const rows = await sequelize.query(sql, { bind, type: QueryTypes.SELECT });
                    return normalizeRows(rows);
                }

                if (operation === 'run') {
                    const [rows, metadata] = await sequelize.query(sql, { bind });
                    const firstRow = Array.isArray(rows) ? rows[0] : null;
                    return {
                        lastID: firstRow?.id ? Number(firstRow.id) : undefined,
                        changes: metadata?.rowCount || 0,
                    };
                }

                if (operation === 'exec') {
                    return await sequelize.query(sql, { bind });
                }

                throw new Error(`不支持的PostgreSQL操作: ${operation}`);
            },
            `PostgreSQL运行时操作-${operation}`,
            { throwOnError: true, userFriendly: false },
        );
    }

    async transaction(callback) {
        return pgManager.transaction(async () => callback());
    }

    getDb() {
        return {
            prepare: async query => ({
                run: async (...params) => this.safeExecute('run', query, params),
                finalize: async () => undefined,
            }),
        };
    }

    setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    getCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }

    clearCache(key) {
        if (key) {
            this.cache.delete(key);
        } else {
            logTime('[数据库] 清除所有PostgreSQL运行时缓存');
            this.cache.clear();
        }
    }

    async disconnect() {
        this.connected = false;
        this.cache.clear();
    }

    getConnectionStatus() {
        return this.connected;
    }

    async updateArrayField(table, field, value, where) {
        const whereClause = Object.entries(where).map(([key]) => `${key} = ?`).join(' AND ');
        const whereValues = Object.values(where);

        return ErrorHandler.handleService(
            async () => {
                const record = await this.safeExecute('get', `SELECT * FROM ${table} WHERE ${whereClause}`, whereValues);
                if (!record) {
                    throw new Error('记录不存在');
                }

                const currentArray = Array.isArray(record[field]) ? [...record[field]] : [];
                const index = currentArray.indexOf(value);
                if (index !== -1) {
                    currentArray.splice(index, 1);
                } else {
                    currentArray.push(value);
                }

                await this.safeExecute('run', `UPDATE ${table} SET ${field} = ?, updatedAt = ? WHERE ${whereClause}`, [currentArray, Date.now(), ...whereValues]);
                return this.safeExecute('get', `SELECT * FROM ${table} WHERE ${whereClause}`, whereValues);
            },
            `更新数组字段-${table}.${field}`,
            { throwOnError: true, userFriendly: false },
        );
    }
}

export const dbManager = new PostgresRuntimeManager();
export default dbManager;
