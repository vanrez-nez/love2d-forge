export type ReloadEventType = 'change' | 'create' | 'delete';

export interface ReloadEvent {
    type: ReloadEventType;
    relativePath: string;
    appRoot?: string;
}

export type ReloadClassification = 'bootstrap-sensitive' | 'hot-reload-candidate' | 'app-logic' | 'unknown';

export interface ReloadDecision {
    classification: ReloadClassification;
    reason: string;
    action: 'restart' | 'bridge-reload' | 'none';
    moduleName?: string;
}

export function classifyReloadEvent(event: ReloadEvent): ReloadDecision {
    const normalized = event.relativePath.replace(/\\/g, '/');
    const appRoot = event.appRoot ? event.appRoot.replace(/\\/g, '/').replace(/\/$/, '') : '';

    // 1. Detect if the file is an entry point (always restart)
    if (normalized === 'main.lua' || normalized === 'conf.lua' ||
        (appRoot && (normalized === `${appRoot}/main.lua` || normalized === `${appRoot}/conf.lua`))) {
        return {
            classification: 'bootstrap-sensitive',
            reason: `${normalized} affects bootstrap startup; restarting`,
            action: 'restart'
        };
    }

    // 2. Identify Lua modules (all other Lua files hotswap by default)
    if (normalized.endsWith('.lua')) {
        const moduleName = normalized
            .replace(/\.lua$/, '')
            .replace(/\/init$/, '')
            .replace(/\//g, '.');

        return {
            classification: 'hot-reload-candidate',
            reason: `${normalized} is a Lua module; hotswapping via bridge`,
            action: 'bridge-reload',
            moduleName
        };
    }

    return {
        classification: 'unknown',
        reason: `${normalized} could not be classified; ignoring change`,
        action: 'none'
    };
}
