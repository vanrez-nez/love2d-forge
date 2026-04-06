export type ReloadEventType = 'change' | 'create' | 'delete';

export interface ReloadEvent {
    type: ReloadEventType;
    relativePath: string;
}

export type ReloadClassification = 'bootstrap-sensitive' | 'hot-reload-candidate' | 'unknown';

export interface ReloadDecision {
    classification: ReloadClassification;
    reason: string;
    action: 'restart' | 'bridge-reload';
    moduleName?: string;
}

export function classifyReloadEvent(event: ReloadEvent): ReloadDecision {
    const normalized = event.relativePath.replace(/\\/g, '/');

    if (normalized === 'main.lua' || normalized === 'conf.lua') {
        return {
            classification: 'bootstrap-sensitive',
            reason: `${normalized} affects bootstrap startup`,
            action: 'restart'
        };
    }

    if (normalized.endsWith('.lua')) {
        const moduleName = normalized
            .replace(/\.lua$/, '')
            .replace(/\/init$/, '')
            .replace(/\//g, '.');
        return {
            classification: 'hot-reload-candidate',
            reason: `${normalized} is a Lua module save and can be reloaded through the bridge`,
            action: 'bridge-reload',
            moduleName
        };
    }

    return {
        classification: 'unknown',
        reason: `${normalized} could not be classified; falling back to restart`,
        action: 'restart'
    };
}
