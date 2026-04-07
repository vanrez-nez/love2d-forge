import * as vscode from 'vscode';
import { ProcessManager } from './processManager';
import { BootstrapManager } from './bootstrapManager';
import { FileWatcher } from './watcher';
import { StatusBarController, ExtensionState } from './statusBar';
import { Logger } from './logger';
import { classifyReloadEvent, ReloadEvent } from './reloadPolicy';
import { FileLogStore } from './fileLogStore';
import { initializeProjectConfig, readProjectConfig, readProjectConfigWithDiagnostics, resolveFileLogPath } from './projectConfig';
import { describeEntryPointSelection, EntryPointCandidate, resolveEntryPoint, selectEntryPointCandidate } from './locationResolver';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return;
    }

    let projectConfig = await readProjectConfig(workspaceRoot);
    const fileLogStore = projectConfig.fileLogs.enabled
        ? new FileLogStore(
            resolveFileLogPath(workspaceRoot, projectConfig.fileLogs.outputFile),
            projectConfig.fileLogs.logLines
        )
        : null;
    await fileLogStore?.initialize();
    const outputChannel = vscode.window.createOutputChannel('Love2D');
    const logger = new Logger(outputChannel, 'love2d', fileLogStore);
    logger.updateFilter(projectConfig.logFilter);
    const processManager = new ProcessManager(logger, projectConfig.inferLogTypes);
    const activationLogger = logger.child('extension');
    const reloadLogger = logger.child('reload');
    const bootstrapManager = new BootstrapManager(workspaceRoot, context.extensionPath, logger.child('bootstrap'));
    const statusBar = new StatusBarController();
    let activeEntryPoint: EntryPointCandidate | undefined;
    let watcher: FileWatcher | undefined;
    let isLaunching = false;
    let lastLaunchTime = 0;
    const LAUNCH_COOLDOWN_MS = 1000;
    activationLogger.debug(`activate: workspaceRoot="${workspaceRoot}" extensionPath="${context.extensionPath}"`);

    const launch = async (reason: string) => {
        if (isLaunching) {
            activationLogger.debug(`launch skipped: already launching (reason="${reason}")`);
            return;
        }

        isLaunching = true;
        try {
            const configReadResult = await readProjectConfigWithDiagnostics(workspaceRoot);
            projectConfig = configReadResult.config;
            logger.updateFilter(projectConfig.logFilter);
            for (const message of configReadResult.messages) {
                activationLogger.info(message);
            }
        const config = vscode.workspace.getConfiguration('love2d');
        const executablePath = config.get<string>('executablePath') || '';
        const hotPollInterval = config.get<number>('hotPollInterval') || 500;
        const resolvedEntryPoint = await resolveEntryPoint(workspaceRoot, projectConfig);
        for (const message of resolvedEntryPoint.messages ?? []) {
            activationLogger.info(message);
        }
        if (resolvedEntryPoint.errorMessage) {
            activeEntryPoint = undefined;
            const action = await vscode.window.showErrorMessage(
                resolvedEntryPoint.errorMessage,
                'Init Config'
            );
            if (action === 'Init Config') {
                await initConfig();
            }
            return;
        }

        let candidate = resolvedEntryPoint.candidate;
        let selectionMode: 'direct' | 'selected' = 'direct';
        if (!candidate && resolvedEntryPoint.candidates) {
            const activeCandidate = activeEntryPoint
                ? resolvedEntryPoint.candidates.find((item) => item.mainFileRelativePath === activeEntryPoint?.mainFileRelativePath)
                : undefined;
            candidate = activeCandidate;
            if (!candidate) {
                candidate = await selectEntryPointCandidate(resolvedEntryPoint.candidates);
                if (candidate) {
                    selectionMode = 'selected';
                }
            }
        }

        if (!candidate) {
            activationLogger.debug('launch cancelled: no entry point selected');
            return;
        }

        activeEntryPoint = candidate;
        activationLogger.info(describeEntryPointSelection(candidate, selectionMode));

        const isReload = reason.startsWith('watcher');
        const shouldClear = isReload ? projectConfig.fileLogs.reloadClear : projectConfig.fileLogs.sessionClear;
        if (shouldClear) {
            const clearMessage = isReload ? '--- Logs Cleared for Reload ---' : '--- Logs Cleared for New Session ---';
            await fileLogStore?.clear(clearMessage);
        }
        fileLogStore?.setActive(true);
        // Update watcher for the new app/config
        if (watcher) {
            watcher.dispose();
        }
        watcher = new FileWatcher({
            workspaceRoot,
            appRoot: candidate.appRootRelativePath,
            watchScope: projectConfig.watchScope,
            watchExclude: [
                ...(projectConfig.watchExclude ?? []),
                projectConfig.fileLogs.outputFile
            ],
            logger: logger.child('watcher'),
            onReload: (event) => void handleReloadEvent(event)
        });

        // Rebuild bootstrap on every launch so new/deleted project files are reflected
        activationLogger.debug(`launch pipeline start: reason="${reason}" hotPollIntervalMs=${hotPollInterval} proxyErrorLogs=${projectConfig.proxyErrorLogs} inferLogTypes=${projectConfig.inferLogTypes} entryPoint="${candidate.mainFileRelativePath}"`);
        const bootstrapDir = bootstrapManager.prepare(workspaceRoot, candidate.absoluteAppRootPath, hotPollInterval, projectConfig.proxyErrorLogs);
        const success = await processManager.launch(
            bootstrapDir,
            workspaceRoot,
            candidate.absoluteAppRootPath,
            executablePath,
            reason
        );
        if (success) {
            statusBar.update(ExtensionState.Running);
            activationLogger.debug('status bar updated: running');
        }
        lastLaunchTime = Date.now();
    } catch (error) {
        activationLogger.error(`launch failed: ${String(error)}`);
    } finally {
        isLaunching = false;
    }
};

    const stop = async () => {
        activationLogger.debug('manual stop requested');
        fileLogStore?.setActive(false);
        await processManager.stop();
        activeEntryPoint = undefined;
        statusBar.update(ExtensionState.Stopped);
        activationLogger.debug('status bar updated: stopped');
    };

    processManager.onCrash = () => {
        activeEntryPoint = undefined;
        fileLogStore?.setActive(false);
        statusBar.update(ExtensionState.Stopped);
        activationLogger.debug('process crash handler invoked; status bar updated to stopped');
        vscode.window.showWarningMessage('Love2D stopped unexpectedly. I can try to restart it.', 'Restart')
            .then(choice => {
                activationLogger.debug(`crash dialog choice: ${choice ?? 'dismissed'}`);
                if (choice === 'Restart') {
                    void launch('crash recovery restart');
                }
            });
    };

    const handleReloadEvent = async (event: ReloadEvent) => {
        reloadLogger.debug(`callback entered: type=${event.type} path=${event.relativePath} running=${processManager.isRunning()}`);
        const scopedEvent = toActiveEntryPointReloadEvent(event, activeEntryPoint, projectConfig.watchScope);
        if (!scopedEvent) {
            reloadLogger.debug('callback ignored because file is outside the active app root/project scope');
            return;
        }

        const decision = classifyReloadEvent({
            ...scopedEvent,
            appRoot: activeEntryPoint?.appRootRelativePath
        });
        reloadLogger.debug(`decision: classification=${decision.classification} action=${decision.action} reason="${decision.reason}"`);

        if (decision.action === 'none') {
            return;
        }

        // Apply safety checks only for 'restart' actions. Hot-swaps bypass these.
        if (decision.action === 'restart') {
            const now = Date.now();
            if (isLaunching) {
                reloadLogger.debug(`restart skipped: currently launching (path="${event.relativePath}")`);
                return;
            }
            if (now - lastLaunchTime < LAUNCH_COOLDOWN_MS) {
                reloadLogger.debug(`restart skipped: launch cooldown active (path="${event.relativePath}" elapsed=${now - lastLaunchTime}ms)`);
                return;
            }
        }

        if (!processManager.isRunning()) {
            reloadLogger.debug('callback ignored because process is not running');
            return;
        }

        if (decision.action === 'bridge-reload' && decision.moduleName) {
            if (processManager.isBridgeConnected()) {
                try {
                    await processManager.reloadModule(decision.moduleName);
                    return;
                } catch (error) {
                    reloadLogger.debug(`bridge reload failed for ${decision.moduleName}; falling back to restart: ${String(error)}`);
                }
            } else {
                reloadLogger.debug(`bridge reload unavailable for ${decision.moduleName}; bridge not connected, falling back to restart`);
            }
        }

        await launch(`watcher ${event.type} ${event.relativePath} -> ${decision.classification}: ${decision.reason}`);
    };

    // Watcher is initialized in 'launch'

    const initConfig = async () => {
        const configPath = await initializeProjectConfig(workspaceRoot);
        const document = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(document);
        activationLogger.debug(`initialized project config at "${configPath}"`);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('love2d.launch', () => launch('manual command: love2d.launch')),
        vscode.commands.registerCommand('love2d.stop', stop),
        vscode.commands.registerCommand('love2d.reload', () => launch('manual command: love2d.reload')),
        vscode.commands.registerCommand('love2d.initConfig', initConfig),
        { dispose: () => { void fileLogStore?.flush(); } },
        processManager,
        statusBar,
        { dispose: () => watcher?.dispose() }
    );
}

export function deactivate() {}

function toActiveEntryPointReloadEvent(
    event: ReloadEvent,
    activeEntryPoint: EntryPointCandidate | undefined,
    watchScope: 'location' | 'project' = 'location'
): ReloadEvent | undefined {
    if (!activeEntryPoint) {
        return event;
    }

    const normalizedPath = event.relativePath.replace(/\\/g, '/');

    // 1. If project scope is enabled, allow files and SKIP rebasing.
    // This supports project-level require paths (e.g., require('demos.app.main')).
    if (watchScope === 'project') {
        return event;
    }

    // 2. Check main app root (for "location" scope)
    const appRoot = activeEntryPoint.appRootRelativePath;
    if (appRoot === '' || normalizedPath === appRoot || normalizedPath.startsWith(`${appRoot}/`)) {
        const scopedPath = appRoot === '' ? normalizedPath : normalizedPath.slice(appRoot.length).replace(/^\/+/, '');
        return {
            ...event,
            relativePath: scopedPath
        };
    }

    return undefined;
}
