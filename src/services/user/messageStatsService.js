import { ChannelType, EmbedBuilder } from 'discord.js';
import { logTime } from '../../utils/logger.js';

const discordIdPattern = /^\d{17,20}$/;
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const messageFetchLimit = 100;

const scannableChannelTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
]);

class MessageStatsService {
    canQuery(requesterId, targetId, statsConfig = {}) {
        const allowlist = Array.isArray(statsConfig.queryAllowUserIds) ? statsConfig.queryAllowUserIds : [];
        const allowSelfQuery = statsConfig.allowSelfQuery !== false;
        return allowlist.includes(requesterId) || (allowSelfQuery && requesterId === targetId);
    }

    normalizeTargetId(rawTargetId, requesterId) {
        const targetId = (rawTargetId || requesterId || '').trim();
        if (!discordIdPattern.test(targetId)) {
            throw new Error('请输入有效的 Discord 用户 ID（17-20 位数字）。');
        }
        return targetId;
    }

    async getRecentUserStats(interaction, userId, statsConfig) {
        const cutoffTimestamp = Date.now() - sevenDaysMs;
        const channels = await this.getScannableChannels(interaction.guild);
        const stats = {
            guildId: interaction.guildId,
            userId,
            messageCount: 0,
            firstMessageAt: null,
            lastMessageAt: null,
            scannedChannels: 0,
            skippedChannels: 0,
        };

        for (const channel of channels.values()) {
            const channelStats = await this.scanChannelMessages(channel, userId, cutoffTimestamp, statsConfig);
            if (!channelStats) {
                stats.skippedChannels += 1;
                continue;
            }

            stats.scannedChannels += 1;
            stats.messageCount += channelStats.messageCount;
            stats.firstMessageAt = this.pickEarlierTimestamp(stats.firstMessageAt, channelStats.firstMessageAt);
            stats.lastMessageAt = this.pickLaterTimestamp(stats.lastMessageAt, channelStats.lastMessageAt);
        }

        return stats;
    }

    async getScannableChannels(guild) {
        const channels = new Map();
        const guildChannels = await guild.channels.fetch();

        for (const channel of guildChannels.values()) {
            if (!channel) continue;

            if (this.canScanMessages(channel)) {
                channels.set(channel.id, channel);
            }

            if (channel.threads) {
                await this.addFetchableThreads(channels, channel);
            }
        }

        return channels;
    }

    canScanMessages(channel) {
        return scannableChannelTypes.has(channel.type) && channel.messages?.fetch;
    }

    async addFetchableThreads(channels, channel) {
        await this.addThreadCollection(channels, () => channel.threads.fetchActive());
        await this.addThreadCollection(channels, () => channel.threads.fetchArchived({ type: 'public', limit: messageFetchLimit }));

        if (channel.type !== ChannelType.GuildForum && channel.type !== ChannelType.GuildMedia) {
            await this.addThreadCollection(channels, () => channel.threads.fetchArchived({ type: 'private', limit: messageFetchLimit }));
        }
    }

    async addThreadCollection(channels, fetchThreads) {
        const fetched = await fetchThreads().catch(() => null);
        const threads = fetched?.threads;
        if (!threads) return;

        for (const thread of threads.values()) {
            if (thread && this.canScanMessages(thread)) {
                channels.set(thread.id, thread);
            }
        }
    }

    async scanChannelMessages(channel, userId, cutoffTimestamp, statsConfig) {
        let before;
        const stats = {
            messageCount: 0,
            firstMessageAt: null,
            lastMessageAt: null,
        };

        while (true) {
            const options = { limit: messageFetchLimit };
            if (before) options.before = before;

            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages) return null;
            if (messages.size === 0) break;

            let reachedCutoff = false;
            for (const message of messages.values()) {
                if (message.createdTimestamp < cutoffTimestamp) {
                    reachedCutoff = true;
                    continue;
                }
                if (message.author?.id !== userId) continue;
                if (message.author.bot && !statsConfig.trackBots) continue;

                stats.messageCount += 1;
                stats.firstMessageAt = this.pickEarlierTimestamp(stats.firstMessageAt, message.createdTimestamp);
                stats.lastMessageAt = this.pickLaterTimestamp(stats.lastMessageAt, message.createdTimestamp);
            }

            before = messages.last()?.id;
            if (!before || messages.size < messageFetchLimit || reachedCutoff) break;
        }

        return stats;
    }

    pickEarlierTimestamp(current, candidate) {
        if (!candidate) return current;
        if (!current) return candidate;
        return Math.min(current, candidate);
    }

    pickLaterTimestamp(current, candidate) {
        if (!candidate) return current;
        if (!current) return candidate;
        return Math.max(current, candidate);
    }

    buildStatsEmbed(stats, requesterId) {
        const firstMessage = stats.firstMessageAt
            ? `<t:${Math.floor(stats.firstMessageAt / 1000)}:F>`
            : '暂无记录';
        const lastMessage = stats.lastMessageAt
            ? `<t:${Math.floor(stats.lastMessageAt / 1000)}:F>`
            : '暂无记录';

        return new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('近 7 天发言统计')
            .setDescription(`用户：<@${stats.userId}>\nDCID：\`${stats.userId}\``)
            .addFields(
                { name: '总发言数', value: String(stats.messageCount || 0), inline: true },
                { name: '首次记录', value: firstMessage, inline: false },
                { name: '最近发言', value: lastMessage, inline: false },
                {
                    name: '扫描范围',
                    value: `最近 7 天，可访问频道 ${stats.scannedChannels ?? 0} 个${stats.skippedChannels ? `，跳过 ${stats.skippedChannels} 个` : ''}`,
                    inline: false,
                },
            )
            .setFooter({ text: requesterId === stats.userId ? '仅你可见' : '白名单查询，仅你可见' })
            .setTimestamp();
    }

    async handleStatsCommand(interaction, guildConfig) {
        const statsConfig = guildConfig?.messageStats || {};
        if (!statsConfig.enabled) {
            await interaction.editReply({ content: '此服务器未启用发言统计功能。' });
            return;
        }

        const requesterId = interaction.user.id;
        const rawTargetId = interaction.options.getString('dcid');
        let targetId;

        try {
            targetId = this.normalizeTargetId(rawTargetId, requesterId);
        } catch (error) {
            await interaction.editReply({ content: `❌ ${error.message}` });
            return;
        }

        if (!this.canQuery(requesterId, targetId, statsConfig)) {
            await interaction.editReply({
                content: '你只能查询自己的发言数。如需查询其他用户，请联系管理员加入查询白名单。',
            });
            return;
        }

        await interaction.editReply({ content: '正在扫描最近 7 天内的服务器消息，请稍候...' });
        const stats = await this.getRecentUserStats(interaction, targetId, statsConfig);
        const embed = this.buildStatsEmbed(stats, requesterId);
        await interaction.editReply({ content: '', embeds: [embed] });
        logTime(`[发言统计] ${interaction.user.tag} 查询了 ${targetId} 的发言统计`);
    }
}

export const messageStatsService = new MessageStatsService();
export default messageStatsService;
