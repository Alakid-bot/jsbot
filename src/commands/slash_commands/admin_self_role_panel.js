import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { selfServiceRoleService } from '../../services/role/selfServiceRoleService.js';
import { checkAndHandlePermission, handleCommandError } from '../../utils/helper.js';
import { logTime } from '../../utils/logger.js';

export default {
    cooldown: 5,
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('admin_self_role_panel')
        .setDescription('发送身份组自助领取面板')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('发送面板的频道，默认当前频道')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread),
        ),

    async execute(interaction, guildConfig) {
        if (!(await checkAndHandlePermission(interaction, guildConfig.AdministratorRoleIds))) {
            return;
        }

        try {
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            const panel = selfServiceRoleService.buildPanel(guildConfig);
            await targetChannel.send(panel);
            await interaction.editReply({ content: `✅ 已在 <#${targetChannel.id}> 发送身份组自助面板。` });
            logTime(`管理员 ${interaction.user.tag} 在频道 ${targetChannel.name} 创建了身份组自助面板`);
        } catch (error) {
            await handleCommandError(interaction, error, '发送身份组自助面板');
        }
    },
};
