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
    const processManager = new ProcessManager(fileLogStore, projectConfig.inferLogTypes);
    const logger = new Logger(processManager.getOutputChannel(), 'love2d', fileLogStore);
    const activationLogger = logger.child('extension');
    const reloadLogger = logger.child('reload');
    const bootstrapManager = new BootstrapManager(workspaceRoot, context.extensionPath, logger.child('bootstrap'));
    const statusBar = new StatusBarController();
    let activeEntryPoint: Awaited<ReturnType<typeof selectEntryPointCandidate>> | undefined;
    activationLogger.log(`activate: workspaceRoot="${workspaceRoot}" extensionPath="${context.extensionPath}"`);

    const launch = async (reason: string) => {
        const configReadResult = await readProjectConfigWithDiagnostics(workspaceRoot);
        projectConfig = configReadResult.config;
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
            activationLogger.log('launch cancelled: no entry point selected');
            return;
        }

        activeEntryPoint = candidate;
        activationLogger.info(describeEntryPointSelection(candidate, selectionMode));

        // Rebuild bootstrap on every launch so new/deleted project files are reflected
        activationLogger.log(`launch pipeline start: reason="${reason}" hotPollIntervalMs=${hotPollInterval} proxyErrorLogs=${projectConfig.proxyErrorLogs} inferLogTypes=${projectConfig.inferLogTypes} entryPoint="${candidate.mainFileRelativePath}"`);
        const bootstrapDir = bootstrapManager.prepare(candidate.absoluteAppRootPath, hotPollInterval, projectConfig.proxyErrorLogs);
        const success = await processManager.launch(
            bootstrapDir,
            workspaceRoot,
            candidate.absoluteAppRootPath,
            executablePath,
            reason
        );
        if (success) {
            statusBar.update(ExtensionState.Running);
            activationLogger.log('status bar updated: running');
        }
    };

    const stop = async () => {
        activationLogger.log('manual stop requested');
        await processManager.stop();
        activeEntryPoint = undefined;
        statusBar.update(ExtensionState.Stopped);
        activationLogger.log('status bar updated: stopped');
    };

    processManager.onCrash = () => {
        activeEntryPoint = undefined;
        statusBar.update(ExtensionState.Stopped);
        activationLogger.log('process crash handler invoked; status bar updated to stopped');
        vscode.window.showWarningMessage('Love2D stopped unexpectedly. I can try to restart it.', 'Restart')
            .then(choice => {
                activationLogger.log(`crash dialog choice: ${choice ?? 'dismissed'}`);
                if (choice === 'Restart') {
                    void launch('crash recovery restart');
                }
            });
    };

    const handleReloadEvent = async (event: ReloadEvent) => {
        reloadLogger.log(`callback entered: type=${event.type} path="${event.relativePath}" running=${processManager.isRunning()}`);
        const scopedEvent = toActiveEntryPointReloadEvent(event, activeEntryPoint, reloadLogger);
        if (!scopedEvent) {
            reloadLogger.log('callback ignored because file is outside the active app root');
            return;
        }

        const decision = classifyReloadEvent(scopedEvent);
        reloadLogger.log(`decision: classification=${decision.classification} action=${decision.action} reason="${decision.reason}"`);
        if (!processManager.isRunning()) {
            reloadLogger.log('callback ignored because process is not running');
            return;
        }

        if (decision.action === 'bridge-reload' && decision.moduleName) {
            if (processManager.isBridgeConnected()) {
                try {
                    await processManager.reloadModule(decision.moduleName);
                    return;
                } catch (error) {
                    reloadLogger.log(`bridge reload failed for ${decision.moduleName}; falling back to restart: ${String(error)}`);
                }
            } else {
                reloadLogger.log(`bridge reload unavailable for ${decision.moduleName}; bridge not connected, falling back to restart`);
            }
        }

        await launch(`watcher ${event.type} ${event.relativePath} -> ${decision.classification}: ${decision.reason}`);
    };

    const watcher = new FileWatcher(workspaceRoot, logger.child('watcher'), (event) => {
        void handleReloadEvent(event);
    });

    const initConfig = async () => {
        const configPath = await initializeProjectConfig(workspaceRoot);
        const document = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(document);
        activationLogger.log(`initialized project config at "${configPath}"`);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('love2d.launch', () => launch('manual command: love2d.launch')),
        vscode.commands.registerCommand('love2d.stop', stop),
        vscode.commands.registerCommand('love2d.reload', () => launch('manual command: love2d.reload')),
        vscode.commands.registerCommand('love2d.initConfig', initConfig),
        { dispose: () => { void fileLogStore?.flush(); } },
        processManager,
        statusBar,
        watcher
    );
}

export function deactivate() {}

function toActiveEntryPointReloadEvent(
    event: ReloadEvent,
    activeEntryPoint: EntryPointCandidate | undefined,
    logger: Logger
): ReloadEvent | undefined {
    if (!activeEntryPoint) {
        return event;
    }

    const appRoot = activeEntryPoint.appRootRelativePath;
    if (!appRoot) {
        return event;
    }

    const normalizedPath = event.relativePath.replace(/\\/g, '/');
    if (normalizedPath === appRoot || normalizedPath.startsWith(`${appRoot}/`)) {
        const scopedPath = normalizedPath.slice(appRoot.length).replace(/^\/+/, '');
        logger.log(`reload path rebased from "${normalizedPath}" to "${scopedPath}" for active app root "${appRoot}"`);
        return {
            ...event,
            relativePath: scopedPath
        };
    }

    logger.log(`reload path "${normalizedPath}" is outside active app root "${appRoot}"`);
    return undefined;
}
