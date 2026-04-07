import * as fs from 'fs';
import * as path from 'path';

export interface ProjectFileLogConfig {
    enabled: boolean;
    outputFile: string;
    logLines: number;
    sessionClear: boolean;
    reloadClear: boolean;
}

export interface ProjectConfig {
    proxyErrorLogs: boolean;
    inferLogTypes: boolean;
    autoDiscovery: boolean;
    autoDiscoverySearchDepth: number;
    locations?: string | string[];
    watchScope: 'location' | 'project';
    watchExclude?: string[];
    logFilter?: string | string[];
    fileLogs: ProjectFileLogConfig;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
    proxyErrorLogs: true,
    inferLogTypes: true,
    autoDiscovery: true,
    autoDiscoverySearchDepth: 2,
    watchScope: 'location',
    logFilter: ['info', 'warn', 'error'],
    fileLogs: {
        enabled: false,
        outputFile: 'love2d.log',
        logLines: 1000,
        sessionClear: false,
        reloadClear: false
    }
};

export function getProjectConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.love2d-forge', 'config.json');
}

export interface ProjectConfigReadResult {
    config: ProjectConfig;
    messages: string[];
}

export async function readProjectConfig(workspaceRoot: string): Promise<ProjectConfig> {
    return (await readProjectConfigWithDiagnostics(workspaceRoot)).config;
}

export async function readProjectConfigWithDiagnostics(workspaceRoot: string): Promise<ProjectConfigReadResult> {
    const configPath = getProjectConfigPath(workspaceRoot);

    try {
        const raw = await fs.promises.readFile(configPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
        const locations = normalizeLocations(parsed.locations);
        const config: ProjectConfig = {
            proxyErrorLogs: parsed.proxyErrorLogs ?? DEFAULT_PROJECT_CONFIG.proxyErrorLogs,
            inferLogTypes: parsed.inferLogTypes ?? DEFAULT_PROJECT_CONFIG.inferLogTypes,
            autoDiscovery: parsed.autoDiscovery ?? DEFAULT_PROJECT_CONFIG.autoDiscovery,
            autoDiscoverySearchDepth: normalizeSearchDepth(parsed.autoDiscoverySearchDepth),
            ...(locations !== undefined ? { locations } : {}),
            watchScope: normalizeWatchScope(parsed.watchScope),
            watchExclude: normalizeStringArray(parsed.watchExclude),
            logFilter: normalizeStringOrStringArray(parsed.logFilter),
            fileLogs: {
                enabled: parsed.fileLogs?.enabled ?? DEFAULT_PROJECT_CONFIG.fileLogs.enabled,
                outputFile: parsed.fileLogs?.outputFile ?? DEFAULT_PROJECT_CONFIG.fileLogs.outputFile,
                logLines: normalizeLogLines(parsed.fileLogs?.logLines),
                sessionClear: parsed.fileLogs?.sessionClear ?? DEFAULT_PROJECT_CONFIG.fileLogs.sessionClear,
                reloadClear: parsed.fileLogs?.reloadClear ?? DEFAULT_PROJECT_CONFIG.fileLogs.reloadClear
            }
        };

        return {
            config,
            messages: [
                `Loaded project config from "${configPath}"`,
                `Project config launch settings: locations=${formatLocationsForLog(config.locations)} watchScope=${config.watchScope} autoDiscovery=${config.autoDiscovery}`
            ]
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            config: DEFAULT_PROJECT_CONFIG,
            messages: [
                `Failed to read project config at "${configPath}": ${message}`,
                `Using default project config: locations=unset autoDiscovery=${DEFAULT_PROJECT_CONFIG.autoDiscovery} autoDiscoverySearchDepth=${DEFAULT_PROJECT_CONFIG.autoDiscoverySearchDepth}`
            ]
        };
    }
}

export function normalizeLocations(value: unknown): string | string[] | undefined {
    if (typeof value === 'string') {
        return normalizeLocationString(value);
    }

    if (!Array.isArray(value)) {
        return undefined;
    }

    const locations = value
        .map((item) => normalizeLocationString(item))
        .filter((item): item is string => item !== undefined);

    if (locations.length === 0) {
        return undefined;
    }

    return locations;
}

function normalizeWatchScope(value: unknown): 'location' | 'project' {
    if (value === 'project') {
        return 'project';
    }
    return 'location';
}

function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const paths = value
        .map((item) => (typeof item === 'string' ? item.trim() : undefined))
        .filter((item): item is string => !!item);

    return paths.length > 0 ? paths : undefined;
}

function normalizeLocationString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimmed.replace(/\\/g, '/');
}

function normalizeStringOrStringArray(value: unknown): string | string[] | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        return trimmed ? trimmed : undefined;
    }

    if (!Array.isArray(value)) {
        return undefined;
    }

    const arr = value
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : undefined))
        .filter((item): item is string => !!item);

    return arr.length > 0 ? arr : undefined;
}

export async function initializeProjectConfig(workspaceRoot: string): Promise<string> {
    const configPath = getProjectConfigPath(workspaceRoot);
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });

    try {
        await fs.promises.access(configPath, fs.constants.F_OK);
    } catch {
        await fs.promises.writeFile(
            configPath,
            `${JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2)}\n`,
            'utf8'
        );
    }

    return configPath;
}

export function resolveFileLogPath(workspaceRoot: string, outputFile: string): string {
    if (path.isAbsolute(outputFile)) {
        return outputFile;
    }

    return path.join(workspaceRoot, outputFile);
}

function normalizeLogLines(value: number | undefined): number {
    if (!Number.isFinite(value) || value === undefined) {
        return DEFAULT_PROJECT_CONFIG.fileLogs.logLines;
    }

    return Math.max(1, Math.floor(value));
}

function normalizeSearchDepth(value: number | undefined): number {
    if (!Number.isFinite(value) || value === undefined) {
        return DEFAULT_PROJECT_CONFIG.autoDiscoverySearchDepth;
    }

    return Math.max(0, Math.floor(value));
}

function formatLocationsForLog(locations: string | string[] | undefined): string {
    if (locations === undefined) {
        return 'unset';
    }

    if (Array.isArray(locations)) {
        return `[${locations.map((item) => `"${item}"`).join(', ')}]`;
    }

    return `"${locations}"`;
}
