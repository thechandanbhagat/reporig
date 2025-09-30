import * as vscode from 'vscode';
import { RepoRigWebviewProvider } from './webviewProvider';
import { getGitConfigDescription } from './gitConfigDescriptions';
import { GitHooksManager, GitHook, HookTemplate } from './gitHooksManager';

export class RepoRigMainWebviewProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (RepoRigMainWebviewProvider.currentPanel) {
            RepoRigMainWebviewProvider.currentPanel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'reporig-main',
            'RepoRig - Git Configuration Manager',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        RepoRigMainWebviewProvider.currentPanel = panel;

        // Set the webview's initial html content
        panel.webview.html = this.getWebviewContent(panel.webview);

        // Listen for when the panel is disposed
        panel.onDidDispose(() => {
            RepoRigMainWebviewProvider.currentPanel = undefined;
        }, null);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            message => {
                this.handleMessage(message);
            },
            undefined
        );

        // Load initial data
        this.loadAndSendConfigs(panel.webview);
    }

    private static async handleMessage(message: any) {
        const webview = RepoRigMainWebviewProvider.currentPanel?.webview;
        if (!webview) return;

        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const path = require('path');

        switch (message.type) {
            case 'loadConfigs':
                await this.loadAndSendConfigs(webview);
                break;
            case 'saveConfig':
                await this.saveConfig(webview, message.key, message.value, message.scope);
                break;
            case 'deleteConfig':
                await this.deleteConfig(webview, message.key, message.scope);
                break;
            case 'addConfig':
                await this.addConfig(webview, message.key, message.value, message.scope);
                break;
            case 'checkGitRepo':
                await this.checkGitRepository(webview);
                break;
            case 'loadHooks':
                await this.loadAndSendHooks(webview);
                break;
            case 'createHook':
                await this.createHook(webview, message.hookName, message.content);
                break;
            case 'editHook':
                await this.editHook(webview, message.hookName, message.content);
                break;
            case 'deleteHook':
                await this.deleteHook(webview, message.hookName);
                break;
            case 'getHookTemplates':
                await this.getHookTemplates(webview);
                break;
        }
    }

    private static async loadAndSendConfigs(webview: vscode.Webview) {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                webview.postMessage({
                    type: 'error',
                    message: 'No workspace folder is open'
                });
                return;
            }

            const isGitRepo = await this.isGitRepository(workspaceRoot);
            const rawConfigs = isGitRepo ? await this.getGitConfigurations(workspaceRoot) : [];
            
            // Add descriptions to configs
            const configs = rawConfigs.map(config => ({
                ...config,
                description: getGitConfigDescription(config.key)
            }));

            webview.postMessage({
                type: 'configs',
                data: {
                    configs,
                    isGitRepo,
                    workspaceRoot
                }
            });
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Error loading configurations: ${error}`
            });
        }
    }

    private static async saveConfig(webview: vscode.Webview, key: string, value: string, scope: 'local' | 'global') {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                throw new Error('No workspace folder is open');
            }

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            const scopeFlag = scope === 'local' ? '--local' : '--global';
            const cmd = `git config ${scopeFlag} "${key}" "${value}"`;

            await execAsync(cmd, scope === 'local' ? { cwd: workspaceRoot } : {});
            
			webview.postMessage({
				type: 'success',
				message: `Saved ${key} = ${value} (${scope})`
			});            // Reload configs
            await this.loadAndSendConfigs(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Error saving config: ${error}`
            });
        }
    }

    private static async deleteConfig(webview: vscode.Webview, key: string, scope: 'local' | 'global') {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot && scope === 'local') {
                throw new Error('No workspace folder is open');
            }

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            const scopeFlag = scope === 'local' ? '--local' : '--global';
            const cmd = `git config ${scopeFlag} --unset "${key}"`;

            await execAsync(cmd, scope === 'local' ? { cwd: workspaceRoot } : {});
            
            webview.postMessage({
                type: 'success',
                message: `Deleted ${key} (${scope})`
            });

            // Reload configs
            await this.loadAndSendConfigs(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `❌ Error deleting config: ${error}`
            });
        }
    }

    private static async addConfig(webview: vscode.Webview, key: string, value: string, scope: 'local' | 'global') {
        await this.saveConfig(webview, key, value, scope);
    }

    private static async checkGitRepository(webview: vscode.Webview) {
        const workspaceRoot = await this.getWorkspaceRoot();
        const isGitRepo = workspaceRoot ? await this.isGitRepository(workspaceRoot) : false;
        
        webview.postMessage({
            type: 'gitRepoStatus',
            data: {
                isGitRepo,
                workspaceRoot,
                message: isGitRepo 
                    ? `Git repository detected in: ${workspaceRoot}`
                    : workspaceRoot 
                        ? `No git repository found in: ${workspaceRoot}`
                        : 'No workspace folder is open'
            }
        });
    }

    private static async getWorkspaceRoot(): Promise<string | undefined> {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return undefined;
        }
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    private static async isGitRepository(workspacePath: string): Promise<boolean> {
        try {
            const path = require('path');
            const fs = require('fs').promises;
            const gitPath = path.join(workspacePath, '.git');
            const stat = await fs.stat(gitPath);
            return stat.isDirectory() || stat.isFile();
        } catch {
            return false;
        }
    }

    private static async getGitConfigurations(workspaceRoot: string): Promise<any[]> {
        const configs: any[] = [];
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
            // Get local configurations
            try {
                const { stdout: localConfigs } = await execAsync('git config --local --list', { cwd: workspaceRoot });
                localConfigs.split('\n').forEach((line: string) => {
                    if (line.trim() && line.includes('=')) {
                        const [key, ...valueParts] = line.split('=');
                        const value = valueParts.join('=');
                        configs.push({ key: key.trim(), value: value.trim(), scope: 'local' });
                    }
                });
            } catch {
                // Local config might not exist
            }

            // Get global configurations
            try {
                const { stdout: globalConfigs } = await execAsync('git config --global --list');
                globalConfigs.split('\n').forEach((line: string) => {
                    if (line.trim() && line.includes('=')) {
                        const [key, ...valueParts] = line.split('=');
                        const value = valueParts.join('=');
                        configs.push({ key: key.trim(), value: value.trim(), scope: 'global' });
                    }
                });
            } catch {
                // Global config might not exist
            }
        } catch (error) {
            throw new Error(`Failed to get git configurations: ${error}`);
        }

        return configs;
    }

    private static async loadAndSendHooks(webview: vscode.Webview) {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                webview.postMessage({
                    type: 'error',
                    message: 'No workspace folder is open'
                });
                return;
            }

            const isGitRepo = await this.isGitRepository(workspaceRoot);
            if (!isGitRepo) {
                webview.postMessage({
                    type: 'hooks',
                    data: {
                        hooks: [],
                        isGitRepo: false,
                        workspaceRoot
                    }
                });
                return;
            }

            const hooksManager = new GitHooksManager(workspaceRoot);
            const hooks = await hooksManager.getAllHooks();

            webview.postMessage({
                type: 'hooks',
                data: {
                    hooks,
                    isGitRepo,
                    workspaceRoot
                }
            });
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to load git hooks: ${error}`
            });
        }
    }

    private static async createHook(webview: vscode.Webview, hookName: string, content: string) {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                webview.postMessage({
                    type: 'error',
                    message: 'No workspace folder is open'
                });
                return;
            }

            const hooksManager = new GitHooksManager(workspaceRoot);
            await hooksManager.createOrUpdateHook(hookName, content);

            webview.postMessage({
                type: 'success',
                message: `Git hook '${hookName}' created successfully`
            });

            // Reload hooks
            await this.loadAndSendHooks(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to create hook: ${error}`
            });
        }
    }

    private static async editHook(webview: vscode.Webview, hookName: string, content: string) {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                webview.postMessage({
                    type: 'error',
                    message: 'No workspace folder is open'
                });
                return;
            }

            const hooksManager = new GitHooksManager(workspaceRoot);
            await hooksManager.createOrUpdateHook(hookName, content);

            webview.postMessage({
                type: 'success',
                message: `Git hook '${hookName}' updated successfully`
            });

            // Reload hooks
            await this.loadAndSendHooks(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to update hook: ${error}`
            });
        }
    }

    private static async deleteHook(webview: vscode.Webview, hookName: string) {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                webview.postMessage({
                    type: 'error',
                    message: 'No workspace folder is open'
                });
                return;
            }

            const hooksManager = new GitHooksManager(workspaceRoot);
            await hooksManager.deleteHook(hookName);

            webview.postMessage({
                type: 'success',
                message: `Git hook '${hookName}' deleted successfully`
            });

            // Reload hooks
            await this.loadAndSendHooks(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to delete hook: ${error}`
            });
        }
    }

    private static async getHookTemplates(webview: vscode.Webview) {
        try {
            const workspaceRoot = await this.getWorkspaceRoot();
            if (!workspaceRoot) {
                webview.postMessage({
                    type: 'error',
                    message: 'No workspace folder is open'
                });
                return;
            }

            const hooksManager = new GitHooksManager(workspaceRoot);
            const templates = hooksManager.getHookTemplates();

            webview.postMessage({
                type: 'hookTemplates',
                data: templates
            });
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to load hook templates: ${error}`
            });
        }
    }

    private static getWebviewContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RepoRig - Git Configuration Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 24px;
            min-height: 100vh;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 32px;
            padding-bottom: 16px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .header h1 {
            font-size: 32px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .status {
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status.git-repo {
            background-color: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-terminal-background);
        }

        .status.no-git {
            background-color: var(--vscode-terminal-ansiYellow);
            color: var(--vscode-terminal-background);
        }

        .status.no-workspace {
            background-color: var(--vscode-terminal-ansiRed);
            color: var(--vscode-terminal-background);
        }

        .controls {
            display: flex;
            gap: 16px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }

        .btn {
            padding: 12px 24px;
            border: 2px solid var(--vscode-button-border);
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }

        .btn.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .config-table-container {
            border: 2px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
            background-color: var(--vscode-editor-background);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .config-table {
            width: 100%;
            border-collapse: collapse;
        }

        .config-table th {
            background-color: var(--vscode-list-headerBackground);
            color: var(--vscode-list-headerForeground);
            padding: 16px;
            text-align: left;
            font-weight: 600;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .config-table td {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: middle;
        }

        .config-table tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .config-table tr:last-child td {
            border-bottom: none;
        }

        .scope-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .scope-local {
            background-color: var(--vscode-terminal-ansiBlue);
            color: white;
        }

        .scope-global {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
        }

        .config-key {
            font-family: var(--vscode-editor-font-family);
            font-weight: 600;
            font-size: 14px;
            color: var(--vscode-terminal-ansiCyan);
        }

        .config-value {
            font-family: var(--vscode-editor-font-family);
            font-size: 14px;
            color: var(--vscode-foreground);
            word-break: break-all;
        }

        .key-with-info {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .info-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: help;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
            transition: opacity 0.2s ease;
        }

        .info-icon:hover {
            opacity: 1;
            color: var(--vscode-foreground);
        }

        .info-icon svg {
            width: 14px;
            height: 14px;
        }

        .actions {
            display: flex;
            gap: 8px;
        }

        .btn-small {
            padding: 8px 16px;
            font-size: 12px;
            border-radius: 4px;
            font-weight: 500;
        }

        .btn-edit {
            background-color: var(--vscode-terminal-ansiBlue);
            color: white;
            border: none;
        }

        .btn-delete {
            background-color: var(--vscode-terminal-ansiRed);
            color: white;
            border: none;
        }

        .add-config {
            margin-top: 32px;
            padding: 24px;
            border: 2px solid var(--vscode-panel-border);
            border-radius: 8px;
            background-color: var(--vscode-input-background);
        }

        .add-config h3 {
            margin-bottom: 20px;
            font-size: 18px;
            font-weight: 600;
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr 200px;
            gap: 16px;
            margin-bottom: 16px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-input-foreground);
        }

        .form-group input, .form-group select {
            width: 100%;
            padding: 12px;
            border: 2px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 14px;
            transition: border-color 0.2s ease;
        }

        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .form-buttons {
            display: flex;
            gap: 12px;
            margin-top: 20px;
        }

        .message {
            padding: 16px 20px;
            margin: 16px 0;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
        }

        .message.success {
            background-color: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-terminal-background);
        }

        .message.error {
            background-color: var(--vscode-terminal-ansiRed);
            color: var(--vscode-terminal-background);
        }

        .loading {
            text-align: center;
            padding: 60px;
            color: var(--vscode-descriptionForeground);
            font-size: 18px;
        }

        .empty-state {
            text-align: center;
            padding: 60px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state h3 {
            margin-bottom: 12px;
            font-size: 20px;
        }

        .empty-state p {
            font-size: 16px;
        }

        @media (max-width: 800px) {
            .form-row {
                grid-template-columns: 1fr;
            }
            
            .controls {
                flex-direction: column;
            }

            .header {
                flex-direction: column;
                align-items: flex-start;
                gap: 16px;
            }
        }

        /* Tab styles */
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-panel-border);
            margin-bottom: 24px;
        }

        .tab {
            padding: 16px 24px;
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            border-bottom: 3px solid transparent;
            transition: all 0.2s ease;
        }

        .tab:hover {
            color: var(--vscode-foreground);
            background-color: var(--vscode-list-hoverBackground);
        }

        .tab.active {
            color: var(--vscode-foreground);
            border-bottom-color: var(--vscode-terminal-ansiBlue);
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        /* Hook specific styles */
        .hook-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px;
            border: 2px solid var(--vscode-panel-border);
            border-radius: 8px;
            margin-bottom: 12px;
            background-color: var(--vscode-editor-background);
        }

        .hook-info {
            flex: 1;
        }

        .hook-name {
            font-family: var(--vscode-editor-font-family);
            font-weight: 600;
            font-size: 16px;
            color: var(--vscode-terminal-ansiCyan);
        }

        .hook-description {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            margin-top: 4px;
        }

        .hook-status {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            margin-top: 8px;
        }

        .hook-status.exists {
            background-color: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-terminal-background);
        }

        .hook-status.missing {
            background-color: var(--vscode-terminal-ansiYellow);
            color: var(--vscode-terminal-background);
        }

        .hook-actions {
            display: flex;
            gap: 8px;
            flex-direction: column;
        }

        .hook-editor {
            margin-top: 24px;
            padding: 24px;
            border: 2px solid var(--vscode-panel-border);
            border-radius: 8px;
            background-color: var(--vscode-input-background);
            display: none;
        }

        .hook-editor.active {
            display: block;
        }

        .hook-editor textarea {
            width: 100%;
            min-height: 300px;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: 14px;
            border-radius: 4px;
        }

        .hook-templates {
            margin-top: 16px;
        }

        .template-item {
            padding: 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }

        .template-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .template-name {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .template-description {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-top: 4px;
        }
    </style>
</head>
<body>
        <div class="header">
            <div class="header-left">
                <h1>RepoRig</h1>
                <div id="status" class="status"></div>
            </div>
        </div>

        <div class="tabs">
            <button class="tab active" data-tab="config">Git Configurations</button>
            <button class="tab" data-tab="hooks">Git Hooks</button>
        </div>

        <div id="messages"></div>

        <!-- Git Config Tab Content -->
        <div id="config-tab" class="tab-content active">
            <div class="controls">
                <button id="refreshBtn" class="btn primary">Refresh Configurations</button>
                <button id="checkRepoBtn" class="btn">Check Repository Status</button>
                <button id="addConfigBtn" class="btn">Add New Configuration</button>
            </div>

    <div id="loadingState" class="loading">
        <div>Loading git configurations...</div>
    </div>

    <div id="configContainer" style="display: none;">
        <div class="config-table-container">
            <table class="config-table">
                <thead>
                    <tr>
                        <th>Configuration Key</th>
                        <th>Value</th>
                        <th>Scope</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="configTableBody">
                </tbody>
            </table>
        </div>
    </div>

    <div id="emptyState" class="empty-state" style="display: none;">
        <h3>No Git Configurations Found</h3>
        <p>Add some configurations to get started with your repository!</p>
    </div>

    <div id="addConfigForm" class="add-config" style="display: none;">
        <h3>Add New Git Configuration</h3>
        <div class="form-row">
            <div class="form-group">
                <label for="configKey">Configuration Key</label>
                <input type="text" id="configKey" placeholder="e.g., user.name">
            </div>
            <div class="form-group">
                <label for="configValue">Value</label>
                <input type="text" id="configValue" placeholder="e.g., John Doe">
            </div>
            <div class="form-group">
                <label for="configScope">Scope</label>
                <select id="configScope">
                    <option value="local">Local (Repository)</option>
                    <option value="global">Global (User)</option>
                </select>
            </div>
        </div>
        <div class="form-buttons">
            <button id="saveConfigBtn" class="btn primary">Save Configuration</button>
            <button id="cancelConfigBtn" class="btn">Cancel</button>
        </div>
    </div>
        </div> <!-- End Config Tab -->

        <!-- Git Hooks Tab Content -->
        <div id="hooks-tab" class="tab-content">
            <div class="controls">
                <button id="refreshHooksBtn" class="btn primary">Refresh Hooks</button>
                <button id="addHookBtn" class="btn">Create New Hook</button>
                <button id="loadTemplatesBtn" class="btn">Load Templates</button>
            </div>

            <div id="hooksLoadingState" class="loading" style="display: none;">
                <div>Loading git hooks...</div>
            </div>

            <div id="hooksContainer" style="display: none;">
                <div id="hooksListContainer">
                    <!-- Hooks will be populated here -->
                </div>
            </div>

            <div id="hooksEmptyState" class="empty-state" style="display: none;">
                <h3>No Git Repository Found</h3>
                <p>Git hooks are only available in git repositories.</p>
            </div>

            <!-- Hook Editor -->
            <div id="hookEditor" class="hook-editor">
                <h3 id="hookEditorTitle">Edit Hook</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label for="hookName">Hook Name</label>
                        <select id="hookName">
                            <option value="pre-commit">pre-commit</option>
                            <option value="post-commit">post-commit</option>
                            <option value="pre-push">pre-push</option>
                            <option value="commit-msg">commit-msg</option>
                            <option value="pre-receive">pre-receive</option>
                            <option value="post-receive">post-receive</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="hookContent">Hook Content</label>
                    <textarea id="hookContent" placeholder="Enter your hook script content here..."></textarea>
                </div>
                <div class="form-buttons">
                    <button id="saveHookBtn" class="btn primary">Save Hook</button>
                    <button id="cancelHookBtn" class="btn">Cancel</button>
                </div>
                
                <!-- Hook Templates -->
                <div id="hookTemplates" class="hook-templates" style="display: none;">
                    <h4>Available Templates</h4>
                    <div id="templatesContainer">
                        <!-- Templates will be populated here -->
                    </div>
                </div>
            </div>
        </div> <!-- End Hooks Tab -->

    <script>
        const vscode = acquireVsCodeApi();
        let configs = [];
        let isGitRepo = false;

        // DOM Elements - Config Tab
        const refreshBtn = document.getElementById('refreshBtn');
        const checkRepoBtn = document.getElementById('checkRepoBtn');
        const addConfigBtn = document.getElementById('addConfigBtn');
        const statusEl = document.getElementById('status');
        const messagesEl = document.getElementById('messages');
        const loadingState = document.getElementById('loadingState');
        const configContainer = document.getElementById('configContainer');
        const emptyState = document.getElementById('emptyState');
        const configTableBody = document.getElementById('configTableBody');
        const addConfigForm = document.getElementById('addConfigForm');
        const saveConfigBtn = document.getElementById('saveConfigBtn');

        // DOM Elements - Hooks Tab
        const refreshHooksBtn = document.getElementById('refreshHooksBtn');
        const addHookBtn = document.getElementById('addHookBtn');
        const loadTemplatesBtn = document.getElementById('loadTemplatesBtn');
        const hooksLoadingState = document.getElementById('hooksLoadingState');
        const hooksContainer = document.getElementById('hooksContainer');
        const hooksEmptyState = document.getElementById('hooksEmptyState');
        const hooksListContainer = document.getElementById('hooksListContainer');
        const hookEditor = document.getElementById('hookEditor');
        const hookEditorTitle = document.getElementById('hookEditorTitle');
        const hookNameSelect = document.getElementById('hookName');
        const hookContentTextarea = document.getElementById('hookContent');
        const saveHookBtn = document.getElementById('saveHookBtn');
        const cancelHookBtn = document.getElementById('cancelHookBtn');
        const hookTemplates = document.getElementById('hookTemplates');
        const templatesContainer = document.getElementById('templatesContainer');

        // Tab navigation
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');

        // Hook management variables
        let hooks = [];
        let currentEditingHook = null;
        let availableTemplates = [];
        const cancelConfigBtn = document.getElementById('cancelConfigBtn');

        // Event Listeners
        refreshBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'loadConfigs' });
            showLoading();
        });

        checkRepoBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'checkGitRepo' });
        });

        addConfigBtn.addEventListener('click', () => {
            toggleAddConfigForm();
        });

        saveConfigBtn.addEventListener('click', () => {
            const key = document.getElementById('configKey').value.trim();
            const value = document.getElementById('configValue').value.trim();
            const scope = document.getElementById('configScope').value;

            if (!key || !value) {
                showMessage('Please fill in both key and value', 'error');
                return;
            }

            vscode.postMessage({
                type: 'addConfig',
                key,
                value,
                scope
            });

            hideAddConfigForm();
        });

        cancelConfigBtn.addEventListener('click', () => {
            hideAddConfigForm();
        });

        // Hook Event Listeners
        refreshHooksBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'loadHooks' });
            showHooksLoading();
        });

        addHookBtn.addEventListener('click', () => {
            showHookEditor();
        });

        loadTemplatesBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'getHookTemplates' });
            hookTemplates.style.display = 'block';
        });

        saveHookBtn.addEventListener('click', () => {
            const hookName = hookNameSelect.value;
            const content = hookContentTextarea.value.trim();

            if (!content) {
                showMessage('Please enter hook content', 'error');
                return;
            }

            const messageType = currentEditingHook ? 'editHook' : 'createHook';
            vscode.postMessage({
                type: messageType,
                hookName,
                content
            });

            hideHookEditor();
        });

        cancelHookBtn.addEventListener('click', () => {
            hideHookEditor();
        });

        // Tab switching
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                switchTab(targetTab);
            });
        });

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configs':
                    handleConfigsData(message.data);
                    break;
                case 'success':
                    showMessage(message.message, 'success');
                    break;
                case 'error':
                    showMessage(message.message, 'error');
                    hideLoading();
                    break;
                case 'gitRepoStatus':
                    updateStatus(message.data);
                    showMessage(message.data.message, message.data.isGitRepo ? 'success' : 'error');
                    break;
                case 'hooks':
                    handleHooksData(message.data);
                    break;
                case 'hookTemplates':
                    handleHookTemplates(message.data);
                    break;
            }
        });

        function handleConfigsData(data) {
            configs = data.configs;
            isGitRepo = data.isGitRepo;
            
            updateStatus(data);
            renderConfigs();
            hideLoading();
        }

        function updateStatus(data) {
            if (!data.workspaceRoot) {
                statusEl.textContent = 'No Workspace';
                statusEl.className = 'status no-workspace';
            } else if (data.isGitRepo) {
                statusEl.textContent = 'Git Repository';
                statusEl.className = 'status git-repo';
            } else {
                statusEl.textContent = 'Not a Git Repository';
                statusEl.className = 'status no-git';
            }

            addConfigBtn.disabled = !data.isGitRepo;
        }

        function renderConfigs() {
            if (configs.length === 0) {
                configContainer.style.display = 'none';
                emptyState.style.display = 'block';
                return;
            }

            configContainer.style.display = 'block';
            emptyState.style.display = 'none';

            configTableBody.innerHTML = configs.map(config => 
                \`<tr>
                    <td class="config-key">
                        <div class="key-with-info">
                            \${escapeHtml(config.key)}
                            <span class="info-icon" title="\${escapeHtml(config.description || 'Git configuration option')}">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" fill="none"/>
                                    <path d="M8 7v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                                    <circle cx="8" cy="5" r="0.8" fill="currentColor"/>
                                </svg>
                            </span>
                        </div>
                    </td>
                    <td class="config-value">\${escapeHtml(config.value)}</td>
                    <td><span class="scope-badge scope-\${config.scope}">\${config.scope}</span></td>
                    <td>
                        <div class="actions">
                            <button class="btn btn-small btn-edit" onclick="editConfig('\${escapeHtml(config.key)}', '\${escapeHtml(config.value)}', '\${config.scope}')">
                                Edit
                            </button>
                            <button class="btn btn-small btn-delete" onclick="deleteConfig('\${escapeHtml(config.key)}', '\${config.scope}')">
                                Delete
                            </button>
                        </div>
                    </td>
                </tr>\`
            ).join('');
        }

        function editConfig(key, value, scope) {
            document.getElementById('configKey').value = key;
            document.getElementById('configValue').value = value;
            document.getElementById('configScope').value = scope;
            showAddConfigForm();
        }

        function deleteConfig(key, scope) {
            if (confirm(\`Are you sure you want to delete \${key} (\${scope})?\`)) {
                vscode.postMessage({
                    type: 'deleteConfig',
                    key,
                    scope
                });
            }
        }

        function toggleAddConfigForm() {
            if (addConfigForm.style.display === 'none') {
                showAddConfigForm();
            } else {
                hideAddConfigForm();
            }
        }

        function showAddConfigForm() {
            addConfigForm.style.display = 'block';
            document.getElementById('configKey').focus();
            addConfigForm.scrollIntoView({ behavior: 'smooth' });
        }

        function hideAddConfigForm() {
            addConfigForm.style.display = 'none';
            document.getElementById('configKey').value = '';
            document.getElementById('configValue').value = '';
            document.getElementById('configScope').value = 'local';
        }

        function showMessage(message, type) {
            const messageEl = document.createElement('div');
            messageEl.className = \`message \${type}\`;
            messageEl.textContent = message;
            messagesEl.appendChild(messageEl);
            
            setTimeout(() => {
                messageEl.remove();
            }, 5000);
        }

        function showLoading() {
            loadingState.style.display = 'block';
            configContainer.style.display = 'none';
            emptyState.style.display = 'none';
        }

        function hideLoading() {
            loadingState.style.display = 'none';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Hook management functions
        function switchTab(tabName) {
            // Remove active class from all tabs and contents
            tabs.forEach(tab => tab.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to clicked tab and corresponding content
            document.querySelector(\`[data-tab="\${tabName}"]\`).classList.add('active');
            document.getElementById(\`\${tabName}-tab\`).classList.add('active');

            // Load data for the active tab
            if (tabName === 'hooks') {
                vscode.postMessage({ type: 'loadHooks' });
            }
        }

        function handleHooksData(data) {
            hooks = data.hooks;
            isGitRepo = data.isGitRepo;

            hideHooksLoading();

            if (!isGitRepo) {
                hooksContainer.style.display = 'none';
                hooksEmptyState.style.display = 'block';
                return;
            }

            if (hooks.length === 0) {
                hooksContainer.style.display = 'none';
                hooksEmptyState.style.display = 'block';
            } else {
                hooksEmptyState.style.display = 'none';
                hooksContainer.style.display = 'block';
                renderHooks();
            }
        }

        function renderHooks() {
            hooksListContainer.innerHTML = hooks.map(hook => 
                \`<div class="hook-item">
                    <div class="hook-info">
                        <div class="hook-name">\${escapeHtml(hook.name)}</div>
                        <div class="hook-description">\${escapeHtml(hook.description)}</div>
                        <div class="hook-status \${hook.exists ? 'exists' : 'missing'}">
                            \${hook.exists ? 'EXISTS' : 'MISSING'}
                        </div>
                    </div>
                    <div class="hook-actions">
                        <button class="btn btn-small btn-edit" onclick="editHook('\${escapeHtml(hook.name)}')">
                            \${hook.exists ? 'Edit' : 'Create'}
                        </button>
                        \${hook.exists ? \`<button class="btn btn-small btn-delete" onclick="deleteHook('\${escapeHtml(hook.name)}')">Delete</button>\` : ''}
                    </div>
                </div>\`
            ).join('');
        }

        function showHookEditor(hookName = null) {
            currentEditingHook = hookName;
            
            if (hookName) {
                const hook = hooks.find(h => h.name === hookName);
                hookEditorTitle.textContent = \`Edit Hook: \${hookName}\`;
                hookNameSelect.value = hookName;
                hookNameSelect.disabled = true;
                hookContentTextarea.value = hook ? hook.content || '' : '';
            } else {
                hookEditorTitle.textContent = 'Create New Hook';
                hookNameSelect.disabled = false;
                hookContentTextarea.value = '';
            }

            hookEditor.classList.add('active');
            hookContentTextarea.focus();
        }

        function hideHookEditor() {
            hookEditor.classList.remove('active');
            hookTemplates.style.display = 'none';
            currentEditingHook = null;
            hookNameSelect.disabled = false;
            hookContentTextarea.value = '';
        }

        function editHook(hookName) {
            showHookEditor(hookName);
        }

        function deleteHook(hookName) {
            if (confirm(\`Are you sure you want to delete the '\${hookName}' hook?\`)) {
                vscode.postMessage({
                    type: 'deleteHook',
                    hookName
                });
            }
        }

        function handleHookTemplates(templates) {
            availableTemplates = templates;
            templatesContainer.innerHTML = templates.map(template => 
                \`<div class="template-item" onclick="useTemplate('\${escapeHtml(template.name)}')">
                    <div class="template-name">\${escapeHtml(template.name)}</div>
                    <div class="template-description">\${escapeHtml(template.description)}</div>
                </div>\`
            ).join('');
        }

        function useTemplate(templateName) {
            const template = availableTemplates.find(t => t.name === templateName);
            if (template) {
                hookContentTextarea.value = template.content;
                hookTemplates.style.display = 'none';
            }
        }

        function showHooksLoading() {
            hooksLoadingState.style.display = 'block';
            hooksContainer.style.display = 'none';
            hooksEmptyState.style.display = 'none';
        }

        function hideHooksLoading() {
            hooksLoadingState.style.display = 'none';
        }

        // Make functions globally available
        window.editHook = editHook;
        window.deleteHook = deleteHook;
        window.useTemplate = useTemplate;

        // Initial load
        vscode.postMessage({ type: 'loadConfigs' });
    </script>
</body>
</html>`;
    }
}