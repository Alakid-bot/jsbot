import { EmbedBuilder } from 'discord.js';
import { MessageStatsModel } from '../../sqlite/models/messageStatsModel.js';
import { ErrorHandler } from '../../utils/errorHandler.js';
import { logTime } from '../../utils/logger.js';

const discordIdPattern = /^\d{17,20}$/;

class MessageStatsService {
    shouldTrackMessage(message, guildConfig) {
        if (!message.guild || !guildConfig?.messageStats?.enabled) {
            return false;
        }
        if (message.author.bot && !guildConfig.messageStats.trackBots) {
            return false;
        }
        return true;
    }

    async incrementFromMessage(message, guildConfig) {
        if (!this.shouldTrackMessage(message, guildConfig)) {
            return;
        }

        await ErrorHandler.handleSilent(
            () => MessageStatsModel.increment(message.guild.id, message.author.id, message.createdTimestamp || Date.now()),
            '记录用户发言统计',
        );
    }

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

    async getUserStats(guildId, userId) {
        const record = await MessageStatsModel.getByUser(guildId, userId);
        return record || {
            guildId,
            userId,
            messageCount: 0,
            firstMessageAt: null,
            lastMessageAt: null,
        };
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
            .setTitle('发言统计')
            .setDescription(`用户：<@${stats.userId}>\nDCID：\`${stats.userId}\``)
            .addFields(
                { name: '总发言数', value: String(stats.messageCount || 0), inline: true },
                { name: '首次记录', value: firstMessage, inline: false },
                { name: '最近发言', value: lastMessage, inline: false },
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

        const stats = await this.getUserStats(interaction.guildId, targetId);
        const embed = this.buildStatsEmbed(stats, requesterId);
        await interaction.editReply({ embeds: [embed] });
        logTime(`[发言统计] ${interaction.user.tag} 查询了 ${targetId} 的发言统计`);
    }
}

export const messageStatsService = new MessageStatsService();
export default messageStatsService;
