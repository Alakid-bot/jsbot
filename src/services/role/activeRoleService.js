import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { logTime } from '../../utils/logger.js';
import { messageStatsService } from '../user/messageStatsService.js';
import { validateRoleTarget } from './selfServiceRoleService.js';

const ACTIVE_ROLE_PREFIX = 'active_role:';
const ACTIVE_ROLE_CLAIM_ID = `${ACTIVE_ROLE_PREFIX}claim`;
const DEFAULT_TIERS = [
    { id: 'huangtao', label: '黄桃', roleId: null, minMessages: 10, emoji: '🍑', description: '近 7 天发言达到 10 条' },
    { id: 'baitao', label: '白桃', roleId: null, minMessages: 30, emoji: '🍑', description: '近 7 天发言达到 30 条' },
    { id: 'shuimitao', label: '水蜜桃', roleId: null, minMessages: 60, emoji: '🍑', description: '近 7 天发言达到 60 条' },
    { id: 'pantao', label: '蟠桃', roleId: null, minMessages: 100, emoji: '🍑', description: '近 7 天发言达到 100 条' },
];

function getActiveRoleConfig(guildConfig) {
    const config = guildConfig?.activeRoles || {};
    return {
        enabled: config.enabled ?? false,
        panelTitle: config.panelTitle || '活跃身份组领取',
        panelDescription: config.panelDescription || '点击下方按钮，根据你近 7 天的发言数领取可获得的最高活跃身份组。',
        mutuallyExclusive: config.mutuallyExclusive ?? true,
        trackBots: config.trackBots ?? false,
        tiers: Array.isArray(config.tiers) ? config.tiers : DEFAULT_TIERS,
    };
}

function getConfiguredTiers(guildConfig) {
    return getActiveRoleConfig(guildConfig).tiers
        .filter(tier => tier?.id && tier?.label && tier?.roleId && Number.isFinite(Number(tier.minMessages)))
        .map(tier => ({
            ...tier,
            minMessages: Number(tier.minMessages),
        }))
        .sort((left, right) => left.minMessages - right.minMessages);
}

class ActiveRoleService {
    buildPanel(guildConfig) {
        const config = getActiveRoleConfig(guildConfig);
        const tiers = getConfiguredTiers(guildConfig);
        if (!config.enabled || tiers.length === 0) {
            throw new Error('未配置可用的活跃身份组。请先在配置中启用 activeRoles 并填写身份组。');
        }

        const tierLines = tiers.map(tier => {
            const label = tier.emoji ? `${tier.emoji} ${tier.label}` : tier.label;
            const description = tier.description || `近 7 天发言达到 ${tier.minMessages} 条`;
            return `**${label}**：${description}（门槛：${tier.minMessages} 条）`;
        });

        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(config.panelTitle)
            .setDescription([
                config.panelDescription,
                '',
                ...tierLines,
            ].join('\n'))
            .setFooter({ text: '按钮操作会扫描近 7 天消息，结果仅你自己可见' });

        const button = new ButtonBuilder()
            .setCustomId(ACTIVE_ROLE_CLAIM_ID)
            .setLabel('领取 / 更新活跃身份组')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🍑');

        return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
    }

    pickHighestEligibleTier(tiers, messageCount) {
        return tiers.reduce((selected, tier) => {
            if (messageCount < tier.minMessages) return selected;
            if (!selected || tier.minMessages > selected.minMessages) return tier;
            return selected;
        }, null);
    }

    async fetchAndValidateRoles(interaction, tiers, member, botMember) {
        const roleEntries = [];
        const errors = [];

        for (const tier of tiers) {
            let role = null;
            try {
                role = await interaction.guild.roles.fetch(tier.roleId);
            } catch (error) {
                logTime(`[活跃身份组] 获取身份组失败 ${tier.roleId}: ${error.message}`, true);
            }
            const validationError = validateRoleTarget(role, member, botMember);
            if (validationError) {
                errors.push(`「${tier.label}」：${validationError}`);
                continue;
            }
            roleEntries.push({ tier, role });
        }

        if (errors.length > 0) {
            return { roleEntries: [], error: errors.join('\n') };
        }

        return { roleEntries, error: null };
    }

    async handleButton(interaction) {
        if (!interaction.guild) {
            await interaction.editReply({ content: '此按钮只能在服务器内使用。' });
            return;
        }

        const guildConfig = interaction.client.guildManager.getGuildConfig(interaction.guildId);
        const config = getActiveRoleConfig(guildConfig);
        const tiers = getConfiguredTiers(guildConfig);
        if (!config.enabled || tiers.length === 0) {
            await interaction.editReply({ content: '该活跃身份组面板已失效或未正确配置。' });
            return;
        }

        await interaction.editReply({ content: '正在扫描你近 7 天的服务器发言，请稍候...' });

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        const { roleEntries, error } = await this.fetchAndValidateRoles(interaction, tiers, member, botMember);
        if (error) {
            await interaction.editReply({ content: `❌ 活跃身份组配置存在问题，未进行任何身份组变更。\n${error}` });
            return;
        }

        const stats = await messageStatsService.getRecentUserStats(interaction, interaction.user.id, {
            trackBots: config.trackBots,
        });
        const selectedTier = this.pickHighestEligibleTier(tiers, stats.messageCount);
        const selectedEntry = selectedTier
            ? roleEntries.find(entry => entry.tier.id === selectedTier.id)
            : null;
        const activeRoleIds = new Set(roleEntries.map(entry => entry.role.id));
        const rolesToRemove = config.mutuallyExclusive
            ? roleEntries
                .filter(entry => entry.role.id !== selectedEntry?.role.id && member.roles.cache.has(entry.role.id))
                .map(entry => entry.role)
            : [];

        if (!selectedEntry) {
            if (rolesToRemove.length > 0) {
                await member.roles.remove(rolesToRemove, `活跃身份组未达标移除: ${interaction.user.tag}`);
            }
            const firstThreshold = tiers[0]?.minMessages ?? 0;
            await interaction.editReply({
                content: [
                    `你近 7 天发言数为 ${stats.messageCount} 条，尚未达到最低门槛 ${firstThreshold} 条。`,
                    rolesToRemove.length > 0 ? '已移除你当前的活跃身份组。' : '你当前没有可更新的活跃身份组。',
                ].join('\n'),
            });
            logTime(`[活跃身份组] ${interaction.user.tag} 未达标（${stats.messageCount} 条），移除 ${rolesToRemove.length} 个活跃身份组`);
            return;
        }

        if (!activeRoleIds.has(selectedEntry.role.id)) {
            await interaction.editReply({ content: '❌ 活跃身份组配置存在问题，未进行任何身份组变更。' });
            return;
        }

        const alreadyHasSelected = member.roles.cache.has(selectedEntry.role.id);
        if (!alreadyHasSelected) {
            await member.roles.add(selectedEntry.role, `活跃身份组领取: ${interaction.user.tag} (${stats.messageCount} 条)`);
        }
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove, `活跃身份组互斥更新: ${interaction.user.tag}`);
        }

        const action = alreadyHasSelected && rolesToRemove.length === 0 ? '保留' : '更新为';
        await interaction.editReply({
            content: `✅ 你近 7 天发言数为 ${stats.messageCount} 条，已${action}「${selectedTier.label}」。`,
        });
        logTime(`[活跃身份组] ${interaction.user.tag} ${action} ${selectedTier.label}（${stats.messageCount} 条），移除 ${rolesToRemove.length} 个互斥身份组`);
    }
}

export const activeRoleService = new ActiveRoleService();
export { ACTIVE_ROLE_PREFIX, DEFAULT_TIERS };
export default activeRoleService;
