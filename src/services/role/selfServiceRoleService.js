import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { logTime } from '../../utils/logger.js';

const SELF_ROLE_PREFIX = 'self_role:';
const MAX_BUTTONS_PER_ROW = 5;

function getEnabledGroups(guildConfig) {
    const config = guildConfig?.selfServiceRoles || {};
    if (!config.enabled || !Array.isArray(config.groups)) {
        return [];
    }
    return config.groups.filter(group => group?.id && group?.label && group?.roleId);
}

function getButtonStyle(mode) {
    if (mode === 'remove') return ButtonStyle.Danger;
    if (mode === 'grant') return ButtonStyle.Success;
    return ButtonStyle.Primary;
}

export function validateRoleTarget(role, member, botMember) {
    if (!role) {
        return '该身份组不存在，请联系管理员检查配置。';
    }
    if (role.managed) {
        return '该身份组由集成服务管理，Bot 无法分配。';
    }
    if (role.permissions.has(PermissionFlagsBits.Administrator)) {
        return '出于安全原因，不能通过自助按钮领取管理员身份组。';
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return 'Bot 缺少“管理身份组”权限，请联系管理员。';
    }
    if (role.position >= botMember.roles.highest.position) {
        return 'Bot 的最高身份组低于目标身份组，无法管理该身份组。';
    }
    if (role.position >= member.guild.members.me.roles.highest.position) {
        return 'Bot 的身份组层级不足，无法管理该身份组。';
    }
    return null;
}

class SelfServiceRoleService {
    getGroupById(guildConfig, groupId) {
        return getEnabledGroups(guildConfig).find(group => group.id === groupId) || null;
    }

    buildPanel(guildConfig) {
        const groups = getEnabledGroups(guildConfig);
        if (groups.length === 0) {
            throw new Error('未配置可用的自助身份组。请先在网页配置页添加身份组。');
        }

        const description = [
            '点击下方按钮领取或取消身份组。',
            '',
            ...groups.map(group => {
                const label = group.emoji ? `${group.emoji} ${group.label}` : group.label;
                return `**${label}**：${group.description || '点击按钮管理此身份组'}`;
            }),
        ].join('\n');

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('身份组自助中心')
            .setDescription(description)
            .setFooter({ text: '按钮操作结果仅你自己可见' });

        const rows = [];
        for (let index = 0; index < groups.length; index += MAX_BUTTONS_PER_ROW) {
            const buttons = groups.slice(index, index + MAX_BUTTONS_PER_ROW).map(group => {
                const button = new ButtonBuilder()
                    .setCustomId(`${SELF_ROLE_PREFIX}${group.id}`)
                    .setLabel(group.label.slice(0, 80))
                    .setStyle(getButtonStyle(group.mode));
                if (group.emoji) {
                    button.setEmoji(group.emoji);
                }
                return button;
            });
            rows.push(new ActionRowBuilder().addComponents(...buttons));
        }

        return { embeds: [embed], components: rows };
    }

    validateRoleTarget(role, member, botMember) {
        return validateRoleTarget(role, member, botMember);
    }

    async handleButton(interaction) {
        if (!interaction.guild) {
            await interaction.editReply({ content: '此按钮只能在服务器内使用。' });
            return;
        }

        const guildConfig = interaction.client.guildManager.getGuildConfig(interaction.guildId);
        const groupId = interaction.customId.slice(SELF_ROLE_PREFIX.length);
        const group = this.getGroupById(guildConfig, groupId);
        if (!group) {
            await interaction.editReply({ content: '该身份组按钮已失效或未正确配置。' });
            return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        let role = null;
        try {
            role = await interaction.guild.roles.fetch(group.roleId);
        } catch (error) {
            logTime(`[自助身份组] 获取身份组失败 ${group.roleId}: ${error.message}`, true);
        }
        const validationError = this.validateRoleTarget(role, member, botMember);
        if (validationError) {
            await interaction.editReply({ content: `❌ ${validationError}` });
            return;
        }

        const mode = group.mode || 'toggle';
        const hasRole = member.roles.cache.has(role.id);
        const roleName = group.label || role.name;

        if (mode === 'grant') {
            if (hasRole) {
                await interaction.editReply({ content: `你已经拥有「${roleName}」。` });
                return;
            }
            await member.roles.add(role, `自助身份组领取: ${interaction.user.tag}`);
            await interaction.editReply({ content: `✅ 你已领取「${roleName}」。` });
            return;
        }

        if (mode === 'remove') {
            if (!hasRole) {
                await interaction.editReply({ content: `你当前没有「${roleName}」。` });
                return;
            }
            await member.roles.remove(role, `自助身份组移除: ${interaction.user.tag}`);
            await interaction.editReply({ content: `✅ 你已移除「${roleName}」。` });
            return;
        }

        if (hasRole) {
            await member.roles.remove(role, `自助身份组取消: ${interaction.user.tag}`);
            await interaction.editReply({ content: `✅ 你已取消「${roleName}」。` });
        } else {
            await member.roles.add(role, `自助身份组领取: ${interaction.user.tag}`);
            await interaction.editReply({ content: `✅ 你已领取「${roleName}」。` });
        }
    }
}

export const selfServiceRoleService = new SelfServiceRoleService();
export { SELF_ROLE_PREFIX };
export default selfServiceRoleService;
