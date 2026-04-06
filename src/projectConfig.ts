import * as fs from 'fs';
import * as path from 'path';

export interface ProjectFileLogConfig {
    enabled: boolean;
    outputFile: string;
    logLines: number;
}

export interface ProjectConfig {
    proxyErrorLogs: boolean;
    inferLogTypes: boolean;
    autoDiscovery: boolean;
    autoDiscoverySearchDepth: number;
    location?: string | string[];
    fileLogs: ProjectFileLogConfig;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
    proxyErrorLogs: true,
    inferLogTypes: true,
    autoDiscovery: true,
    autoDiscoverySearchDepth: 2,
    fileLogs: {
        enabled: false,
        outputFile: 'love2d.log',
        logLines: 1000
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
        const location = normalizeLocation(parsed.location);
        const config: ProjectConfig = {
            proxyErrorLogs: parsed.proxyErrorLogs ?? DEFAULT_PROJECT_CONFIG.proxyErrorLogs,
            inferLogTypes: parsed.inferLogTypes ?? DEFAULT_PROJECT_CONFIG.inferLogTypes,
            autoDiscovery: parsed.autoDiscovery ?? DEFAULT_PROJECT_CONFIG.autoDiscovery,
            autoDiscoverySearchDepth: normalizeSearchDepth(parsed.autoDiscoverySearchDepth),
            ...(location !== undefined ? { location } : {}),
            fileLogs: {
                enabled: parsed.fileLogs?.enabled ?? DEFAULT_PROJECT_CONFIG.fileLogs.enabled,
                outputFile: parsed.fileLogs?.outputFile ?? DEFAULT_PROJECT_CONFIG.fileLogs.outputFile,
                logLines: normalizeLogLines(parsed.fileLogs?.logLines)
            }
        };

        return {
            config,
            messages: [
                `Loaded project config from "${configPath}"`,
                `Project config launch settings: location=${formatLocationForLog(config.location)} autoDiscovery=${config.autoDiscovery} autoDiscoverySearchDepth=${config.autoDiscoverySearchDepth}`
            ]
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            config: DEFAULT_PROJECT_CONFIG,
            messages: [
                `Failed to read project config at "${configPath}": ${message}`,
                `Using default project config: location=unset autoDiscovery=${DEFAULT_PROJECT_CONFIG.autoDiscovery} autoDiscoverySearchDepth=${DEFAULT_PROJECT_CONFIG.autoDiscoverySearchDepth}`
            ]
        };
    }
}

export function normalizeLocation(value: unknown): string | string[] | undefined {
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

function formatLocationForLog(location: string | string[] | undefined): string {
    if (location === undefined) {
        return 'unset';
    }

    if (Array.isArray(location)) {
        return `[${location.map((item) => `"${item}"`).join(', ')}]`;
    }

    return `"${location}"`;
}
