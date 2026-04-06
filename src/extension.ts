import * as vscode from 'vscode';
import { ProcessManager } from './processManager';
import { BootstrapManager } from './bootstrapManager';
import { FileWatcher } from './watcher';
import { StatusBarController, ExtensionState } from './statusBar';
import { Logger } from './logger';
import { classifyReloadEvent, ReloadEvent } from './reloadPolicy';
import { FileLogStore } from './fileLogStore';
import { initializeProjectConfig, readProjectConfig, resolveFileLogPath } from './projectConfig';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return;
    }

    const projectConfig = await readProjectConfig(workspaceRoot);
    const fileLogStore = projectConfig.fileLogs.enabled
        ? new FileLogStore(
            resolveFileLogPath(workspaceRoot, projectConfig.fileLogs.outputFile),
            projectConfig.fileLogs.logLines
        )
        : null;
    await fileLogStore?.initialize();
    const processManager = new ProcessManager(fileLogStore);
    const logger = new Logger(processManager.getOutputChannel(), '[love2d]', fileLogStore);
    const activationLogger = logger.child('extension');
    const reloadLogger = logger.child('reload');
    const bootstrapManager = new BootstrapManager(workspaceRoot, context.extensionPath, logger.child('bootstrap'));
    const statusBar = new StatusBarController();
    activationLogger.log(`activate: workspaceRoot="${workspaceRoot}" extensionPath="${context.extensionPath}"`);

    const launch = async (reason: string) => {
        const config = vscode.workspace.getConfiguration('love2d');
        const executablePath = config.get<string>('executablePath') || '';
        const hotPollInterval = config.get<number>('hotPollInterval') || 500;
        // Rebuild bootstrap on every launch so new/deleted project files are reflected
        activationLogger.log(`launch pipeline start: reason="${reason}" hotPollIntervalMs=${hotPollInterval} proxyErrorLogs=${projectConfig.proxyErrorLogs}`);
        const bootstrapDir = bootstrapManager.prepare(hotPollInterval, projectConfig.proxyErrorLogs);
        const success = await processManager.launch(bootstrapDir, workspaceRoot, executablePath, reason);
        if (success) {
            statusBar.update(ExtensionState.Running);
            activationLogger.log('status bar updated: running');
        }
    };

    const stop = async () => {
        activationLogger.log('manual stop requested');
        await processManager.stop();
        statusBar.update(ExtensionState.Stopped);
        activationLogger.log('status bar updated: stopped');
    };

    processManager.onCrash = () => {
        statusBar.update(ExtensionState.Stopped);
        activationLogger.log('process crash handler invoked; status bar updated to stopped');
        vscode.window.showWarningMessage('Love2D stopped unexpectedly.', 'Restart')
            .then(choice => {
                activationLogger.log(`crash dialog choice: ${choice ?? 'dismissed'}`);
                if (choice === 'Restart') {
                    void launch('crash recovery restart');
                }
            });
    };

    const handleReloadEvent = async (event: ReloadEvent) => {
        reloadLogger.log(`callback entered: type=${event.type} path="${event.relativePath}" running=${processManager.isRunning()}`);
        const decision = classifyReloadEvent(event);
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
