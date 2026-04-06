import * as fs from 'fs';
import * as path from 'path';

export interface ProjectFileLogConfig {
    enabled: boolean;
    outputFile: string;
    logLines: number;
}

export interface ProjectConfig {
    proxyErrorLogs: boolean;
    fileLogs: ProjectFileLogConfig;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
    proxyErrorLogs: true,
    fileLogs: {
        enabled: false,
        outputFile: 'love2d.log',
        logLines: 1000
    }
};

export function getProjectConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.love2d-hotreload', 'config.json');
}

export async function readProjectConfig(workspaceRoot: string): Promise<ProjectConfig> {
    const configPath = getProjectConfigPath(workspaceRoot);

    try {
        const raw = await fs.promises.readFile(configPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
        return {
            proxyErrorLogs: parsed.proxyErrorLogs ?? DEFAULT_PROJECT_CONFIG.proxyErrorLogs,
            fileLogs: {
                enabled: parsed.fileLogs?.enabled ?? DEFAULT_PROJECT_CONFIG.fileLogs.enabled,
                outputFile: parsed.fileLogs?.outputFile ?? DEFAULT_PROJECT_CONFIG.fileLogs.outputFile,
                logLines: normalizeLogLines(parsed.fileLogs?.logLines)
            }
        };
    } catch {
        return DEFAULT_PROJECT_CONFIG;
    }
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
