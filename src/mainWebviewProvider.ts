import * as vscode from 'vscode';
import { RepoRigWebviewProvider } from './webviewProvider';
import { getGitConfigDescription } from './gitConfigDescriptions';

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
    </style>
</head>
<body>
        <div class="header">
            <div class="header-left">
                <h1>RepoRig</h1>
                <div id="status" class="status"></div>
            </div>
        </div>

        <div class="controls">
            <button id="refreshBtn" class="btn primary">Refresh Configurations</button>
            <button id="checkRepoBtn" class="btn">Check Repository Status</button>
            <button id="addConfigBtn" class="btn">Add New Configuration</button>
        </div>    <div id="messages"></div>

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

    <script>
        const vscode = acquireVsCodeApi();
        let configs = [];
        let isGitRepo = false;

        // DOM Elements
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

        // Initial load
        vscode.postMessage({ type: 'loadConfigs' });
    </script>
</body>
</html>`;
    }
}