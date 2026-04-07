import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectConfig } from './projectConfig';

export interface EntryPointCandidate {
    mainFileRelativePath: string;
    appRootRelativePath: string;
    absoluteMainFilePath: string;
    absoluteAppRootPath: string;
    label: string;
    detail: string;
    source: 'config' | 'discovery';
}

export function describeEntryPointSelection(
    candidate: EntryPointCandidate,
    selectionMode: 'direct' | 'selected'
): string {
    if (candidate.source === 'config') {
        return selectionMode === 'selected'
            ? `Starting from selected configured location entry point "${candidate.mainFileRelativePath}"`
            : `Starting from location defined entry point "${candidate.mainFileRelativePath}"`;
    }

    return selectionMode === 'selected'
        ? `Starting from selected scanned entry point "${candidate.mainFileRelativePath}"`
        : `Starting from scanned entry point "${candidate.mainFileRelativePath}"`;
}

export interface ResolvedEntryPoint {
    candidate?: EntryPointCandidate;
    candidates?: EntryPointCandidate[];
    errorMessage?: string;
    configIssue?: boolean;
    messages?: string[];
}

export async function resolveEntryPoint(
    workspaceRoot: string,
    projectConfig: ProjectConfig
): Promise<ResolvedEntryPoint> {
    const messages: string[] = [];
    const configured = resolveConfiguredCandidates(workspaceRoot, projectConfig.locations);
    
    if (configured.candidates.length > 0) {
        if (configured.candidates.length === 1) {
            return { candidate: configured.candidates[0], messages };
        }

        return { candidates: configured.candidates, messages };
    }

    if (configured.hadConfiguredLocation) {
        const missingLocations = configured.invalidLocations.length > 0
            ? configured.invalidLocations
            : Array.isArray(projectConfig.locations)
                ? projectConfig.locations
                : [projectConfig.locations];
        for (const location of missingLocations) {
            if (location) {
                messages.push(`Defined location not found at "${location}"`);
            }
        }

        if (!projectConfig.autoDiscovery) {
            return {
                errorMessage: 'I could not find a valid main.lua from the configured manual locations in this workspace.',
                configIssue: true,
                messages
            };
        }

        messages.push('Switching to autoDiscovery mode');
    }

    if (!projectConfig.autoDiscovery) {
        return {
            errorMessage: 'I could not find a main.lua entry point. Turn on autoDiscovery or configure manual locations from config.',
            messages
        };
    }

    const discovered = await discoverCandidates(workspaceRoot, projectConfig.autoDiscoverySearchDepth);
    if (discovered.length === 0) {
        return {
            errorMessage: 'Auto Discovery: I searched but found no Love main.lua entry points anywhere.',
            messages
        };
    }

    if (discovered.length === 1) {
        return { candidate: discovered[0], messages };
    }

    return { candidates: discovered, messages };
}

export async function selectEntryPointCandidateWithLoading(
    candidatesPromise: Promise<EntryPointCandidate[]>
): Promise<EntryPointCandidate | undefined> {
    const quickPick = vscode.window.createQuickPick<{
        label: string;
        description: string;
        detail: string;
        candidate: EntryPointCandidate;
    }>();

    quickPick.title = 'Select Love2D App';
    quickPick.placeholder = 'Loading entry points...';
    quickPick.busy = true;

    return new Promise<EntryPointCandidate | undefined>((resolve) => {
        let settled = false;

        const finish = (candidate: EntryPointCandidate | undefined) => {
            if (settled) {
                return;
            }

            settled = true;
            quickPick.hide();
            quickPick.dispose();
            resolve(candidate);
        };

        quickPick.onDidAccept(() => {
            finish(quickPick.selectedItems[0]?.candidate);
        });
        quickPick.onDidHide(() => {
            finish(undefined);
        });

        quickPick.show();

        void candidatesPromise.then((candidates) => {
            if (settled) {
                return;
            }

            if (candidates.length === 1) {
                finish(candidates[0]);
                return;
            }

            quickPick.items = candidates.map((candidate) => ({
                label: candidate.label,
                description: candidate.source === 'config' ? 'Configured location' : 'Discovered location',
                detail: candidate.detail,
                candidate
            }));
            quickPick.placeholder = 'Choose which Love2D app to run';
            quickPick.busy = false;
        }).catch(() => {
            finish(undefined);
        });
    });
}

export async function selectDiscoveredEntryPointCandidate(
    candidatesPromise: Promise<EntryPointCandidate[]>
): Promise<EntryPointCandidate | undefined> {
    return selectEntryPointCandidateWithLoading(candidatesPromise);
}

export async function discoverEntryPointCandidates(
    workspaceRoot: string,
    searchDepth: number
): Promise<EntryPointCandidate[]> {
    return discoverCandidates(workspaceRoot, searchDepth);
}

export function resolveConfiguredEntryPointCandidates(
    workspaceRoot: string,
    locations: ProjectConfig['locations']
): EntryPointCandidate[] {
    return resolveConfiguredCandidates(workspaceRoot, locations).candidates;
}

export async function selectEntryPointCandidate(candidates: EntryPointCandidate[]): Promise<EntryPointCandidate | undefined> {
    return selectEntryPointCandidateWithLoading(Promise.resolve(candidates));
}

function resolveConfiguredCandidates(workspaceRoot: string, locations: ProjectConfig['locations']): {
    candidates: EntryPointCandidate[];
    hadConfiguredLocation: boolean;
    invalidLocations: string[];
} {
    if (locations === undefined) {
        return { candidates: [], hadConfiguredLocation: false, invalidLocations: [] };
    }

    const values = Array.isArray(locations) ? locations : [locations];
    const candidates: EntryPointCandidate[] = [];
    const invalidLocations: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const pathValue = value;
        
        const candidate = createCandidate(workspaceRoot, pathValue, 'config');
        if (!candidate) {
            invalidLocations.push(pathValue);
            continue;
        }

        if (seen.has(candidate.mainFileRelativePath)) {
            continue;
        }

        seen.add(candidate.mainFileRelativePath);
        candidates.push(candidate);
    }

    return {
        candidates,
        hadConfiguredLocation: true,
        invalidLocations
    };
}

async function discoverCandidates(workspaceRoot: string, searchDepth: number): Promise<EntryPointCandidate[]> {
    const patterns = buildSearchPatterns(searchDepth);
    const excludes = new vscode.RelativePattern(
        workspaceRoot,
        '{.love2d-forge/**,node_modules/**,vendor/**,vendors/**,third_party/**,third-party/**,deps/**,dist/**,build/**,out/**}'
    );
    const fileSets = await Promise.all(
        patterns.map((pattern) => vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceRoot, pattern),
            excludes
        ))
    );

    const files = fileSets.flat();

    const candidates = files
        .map((file) => path.relative(workspaceRoot, file.fsPath).replace(/\\/g, '/'))
        .map((relativePath) => createCandidate(workspaceRoot, relativePath, 'discovery'))
        .filter((candidate): candidate is EntryPointCandidate => candidate !== undefined)
        .sort((a, b) => a.mainFileRelativePath.localeCompare(b.mainFileRelativePath));

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        if (seen.has(candidate.mainFileRelativePath)) {
            return false;
        }

        seen.add(candidate.mainFileRelativePath);
        return true;
    });
}

function buildSearchPatterns(searchDepth: number): string[] {
    const patterns: string[] = [];
    for (let depth = 0; depth <= searchDepth; depth += 1) {
        patterns.push(`${'*/'.repeat(depth)}main.lua`);
    }

    return patterns;
}

function createCandidate(
    workspaceRoot: string,
    configuredLocation: string,
    source: 'config' | 'discovery'
): EntryPointCandidate | undefined {
    const normalizedLocation = normalizeConfiguredLocation(configuredLocation);
    if (!normalizedLocation) {
        return undefined;
    }

    const absoluteMainFilePath = path.resolve(workspaceRoot, normalizedLocation);
    const relativeMainFilePath = path.relative(workspaceRoot, absoluteMainFilePath).replace(/\\/g, '/');
    if (
        relativeMainFilePath.startsWith('..') ||
        path.isAbsolute(relativeMainFilePath) ||
        path.basename(absoluteMainFilePath) !== 'main.lua'
    ) {
        return undefined;
    }

    try {
        const stat = fs.statSync(absoluteMainFilePath);
        if (!stat.isFile()) {
            return undefined;
        }
    } catch {
        return undefined;
    }

    const absoluteAppRootPath = path.dirname(absoluteMainFilePath);
    const appRootRelativePath = path.relative(workspaceRoot, absoluteAppRootPath).replace(/\\/g, '/');
    return {
        mainFileRelativePath: relativeMainFilePath,
        appRootRelativePath,
        absoluteMainFilePath,
        absoluteAppRootPath,
        label: appRootRelativePath || '.',
        detail: relativeMainFilePath,
        source
    };
}

export function normalizeConfiguredLocation(value: string): string | undefined {
    const trimmed = value.trim().replace(/\\/g, '/');
    if (!trimmed) {
        return undefined;
    }

    if (trimmed === 'main.lua' || trimmed.endsWith('/main.lua')) {
        return trimmed;
    }

    return path.posix.join(trimmed, 'main.lua');
}
