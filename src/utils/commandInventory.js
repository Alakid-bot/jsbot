function getCommandName(command) {
    return command?.data?.name || command?.name || null;
}

function getCommandJson(command) {
    if (command?.data?.toJSON) {
        return command.data.toJSON();
    }

    return command?.data || command;
}

function getEnabledCommandSet(guildConfig) {
    if (!Array.isArray(guildConfig?.enabledCommands)) {
        return null;
    }

    return new Set(guildConfig.enabledCommands.filter(name => typeof name === 'string'));
}

export function isCommandEnabled(guildConfig, commandName) {
    const enabledCommands = getEnabledCommandSet(guildConfig);
    return enabledCommands === null || enabledCommands.has(commandName);
}

export function filterCommandsForGuild(commands, guildConfig) {
    const enabledCommands = getEnabledCommandSet(guildConfig);
    if (enabledCommands === null) {
        return new Map(commands);
    }

    return new Map([...commands].filter(([name]) => enabledCommands.has(name)));
}

export function serializeCommandData(commands) {
    return [...commands.values()].map(command => getCommandJson(command));
}

export function getCommandInventory(commands) {
    return serializeCommandData(commands).map(command => ({
        name: command.name,
        description: command.description || '',
        type: command.type || 1,
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export function getEnabledCommandData(commands, guildConfig) {
    return serializeCommandData(filterCommandsForGuild(commands, guildConfig));
}

export function getUnknownEnabledCommands(commands, guildConfig) {
    const enabledCommands = getEnabledCommandSet(guildConfig);
    if (enabledCommands === null) {
        return [];
    }

    const loadedNames = new Set([...commands.keys()]);
    return [...enabledCommands].filter(name => !loadedNames.has(name)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function summarizeCommandSelection(commands, guildConfig) {
    const enabledCommands = getEnabledCommandSet(guildConfig);
    const filteredCommands = filterCommandsForGuild(commands, guildConfig);

    return {
        mode: enabledCommands === null ? 'all' : 'selected',
        totalCommandCount: commands.size,
        enabledCommandCount: filteredCommands.size,
        unknownEnabledCommands: getUnknownEnabledCommands(commands, guildConfig),
    };
}

export function getCommandNameFromInteraction(interaction) {
    return getCommandName(interaction) || interaction?.commandName || null;
}
