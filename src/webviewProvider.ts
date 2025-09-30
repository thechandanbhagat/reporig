import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getGitConfigDescription } from './gitConfigDescriptions';

const execAsync = promisify(exec);

export interface GitConfig {
	key: string;
	value: string;
	scope: 'local' | 'global' | 'system';
}

export class RepoRigWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'reporig.webview';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			message => {
				switch (message.type) {
					case 'loadConfigs':
						this.loadAndSendConfigs();
						break;
					case 'saveConfig':
						this.saveConfig(message.key, message.value, message.scope);
						break;
					case 'deleteConfig':
						this.deleteConfig(message.key, message.scope);
						break;
					case 'addConfig':
						this.addConfig(message.key, message.value, message.scope);
						break;
					case 'checkGitRepo':
						this.checkGitRepository();
						break;
					case 'openMainView':
						vscode.commands.executeCommand('reporig.openMainView');
						break;
				}
			},
			undefined,
		);

		// Load initial data
		this.loadAndSendConfigs();
	}

	private async loadAndSendConfigs() {
		try {
			const workspaceRoot = await this.getWorkspaceRoot();
			if (!workspaceRoot) {
				this._view?.webview.postMessage({
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

			this._view?.webview.postMessage({
				type: 'configs',
				data: {
					configs,
					isGitRepo,
					workspaceRoot
				}
			});
		} catch (error) {
			this._view?.webview.postMessage({
				type: 'error',
				message: `Error loading configurations: ${error}`
			});
		}
	}

	private async saveConfig(key: string, value: string, scope: 'local' | 'global') {
		try {
			const workspaceRoot = await this.getWorkspaceRoot();
			if (!workspaceRoot) {
				throw new Error('No workspace folder is open');
			}

			const scopeFlag = scope === 'local' ? '--local' : '--global';
			const cmd = scope === 'local' 
				? `git config ${scopeFlag} "${key}" "${value}"`
				: `git config ${scopeFlag} "${key}" "${value}"`;

			await execAsync(cmd, scope === 'local' ? { cwd: workspaceRoot } : {});
			
			this._view?.webview.postMessage({
				type: 'success',
				message: `Saved ${key} = ${value} (${scope})`
			});

			// Reload configs
			this.loadAndSendConfigs();
		} catch (error) {
			this._view?.webview.postMessage({
				type: 'error',
				message: `❌ Error saving config: ${error}`
			});
		}
	}

	private async deleteConfig(key: string, scope: 'local' | 'global') {
		try {
			const workspaceRoot = await this.getWorkspaceRoot();
			if (!workspaceRoot && scope === 'local') {
				throw new Error('No workspace folder is open');
			}

			const scopeFlag = scope === 'local' ? '--local' : '--global';
			const cmd = `git config ${scopeFlag} --unset "${key}"`;

			await execAsync(cmd, scope === 'local' ? { cwd: workspaceRoot } : {});
			
			this._view?.webview.postMessage({
				type: 'success',
				message: `Deleted ${key} (${scope})`
			});

			// Reload configs
			this.loadAndSendConfigs();
		} catch (error) {
			this._view?.webview.postMessage({
				type: 'error',
				message: `❌ Error deleting config: ${error}`
			});
		}
	}

	private async addConfig(key: string, value: string, scope: 'local' | 'global') {
		await this.saveConfig(key, value, scope);
	}

	private async checkGitRepository() {
		const workspaceRoot = await this.getWorkspaceRoot();
		const isGitRepo = workspaceRoot ? await this.isGitRepository(workspaceRoot) : false;
		
		this._view?.webview.postMessage({
			type: 'gitRepoStatus',
			data: {
				isGitRepo,
				workspaceRoot,
				message: isGitRepo 
					? `✅ Git repository detected in: ${workspaceRoot}`
					: workspaceRoot 
						? `⚠️ No git repository found in: ${workspaceRoot}`
						: '❌ No workspace folder is open'
			}
		});
	}

	private async getWorkspaceRoot(): Promise<string | undefined> {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return undefined;
		}
		return vscode.workspace.workspaceFolders[0].uri.fsPath;
	}

	private async isGitRepository(workspacePath: string): Promise<boolean> {
		try {
			const gitPath = path.join(workspacePath, '.git');
			const fs = require('fs').promises;
			const stat = await fs.stat(gitPath);
			return stat.isDirectory() || stat.isFile();
		} catch {
			return false;
		}
	}

	private async getGitConfigurations(workspaceRoot: string): Promise<GitConfig[]> {
		const configs: GitConfig[] = [];

		try {
			// Get local configurations
			try {
				const { stdout: localConfigs } = await execAsync('git config --local --list', { cwd: workspaceRoot });
				localConfigs.split('\n').forEach(line => {
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
				globalConfigs.split('\n').forEach(line => {
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

	private _getHtmlForWebview(webview: vscode.Webview) {
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
            padding: 16px;
        }

        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 18px;
            font-weight: 600;
        }

        .status {
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
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
            gap: 8px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-weight: 600;
        }

        #openMainBtn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border);
        }

        #openMainBtn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .config-table {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
            background-color: var(--vscode-editor-background);
        }

        .config-table table {
            width: 100%;
            border-collapse: collapse;
        }

        .config-table th {
            background-color: var(--vscode-list-headerBackground);
            color: var(--vscode-list-headerForeground);
            padding: 8px 12px;
            text-align: left;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .config-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: top;
        }

        .config-table tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .scope-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 2px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
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
            font-weight: 500;
        }

        .config-value {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-terminal-ansiCyan);
        }

        .actions {
            display: flex;
            gap: 4px;
        }

        .btn-small {
            padding: 2px 6px;
            font-size: 10px;
            border-radius: 2px;
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
            margin-top: 16px;
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
        }

        .add-config h3 {
            margin-bottom: 12px;
            font-size: 14px;
        }

        .form-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }

        .form-group {
            flex: 1;
            min-width: 150px;
        }

        .form-group label {
            display: block;
            margin-bottom: 4px;
            font-size: 11px;
            font-weight: 500;
            color: var(--vscode-input-foreground);
        }

        .form-group input, .form-group select {
            width: 100%;
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            font-size: 12px;
        }

        .message {
            padding: 8px 12px;
            margin: 8px 0;
            border-radius: 3px;
            font-size: 12px;
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
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state h3 {
            margin-bottom: 8px;
        }

        @media (max-width: 600px) {
            .form-row {
                flex-direction: column;
            }
            
            .controls {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>RepoRig</h1>
        <div id="status" class="status"></div>
    </div>

    <div class="controls">
        <button id="openMainBtn" class="btn primary">Open Full Interface</button>
        <button id="refreshBtn" class="btn">Refresh</button>
        <button id="checkRepoBtn" class="btn">Check Repository</button>
        <button id="addConfigBtn" class="btn">Add Configuration</button>
    </div>

    <div id="messages"></div>

    <div id="emptyState" class="empty-state" style="display: none;">
        <h3>No Git Configurations Found</h3>
        <p>Add some configurations to get started!</p>
    </div>

    <div id="addConfigForm" class="add-config" style="display: none;">
        <h3>Add New Configuration</h3>
        <div class="form-row">
            <div class="form-group">
                <label for="configKey">Key</label>
                <input type="text" id="configKey" placeholder="e.g., user.name">
            </div>
            <div class="form-group">
                <label for="configValue">Value</label>
                <input type="text" id="configValue" placeholder="e.g., John Doe">
            </div>
            <div class="form-group">
                <label for="configScope">Scope</label>
                <select id="configScope">
                    <option value="local">Local</option>
                    <option value="global">Global</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <button id="saveConfigBtn" class="btn primary">Save</button>
            <button id="cancelConfigBtn" class="btn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let configs = [];
        let isGitRepo = false;

        // DOM Elements
        const openMainBtn = document.getElementById('openMainBtn');
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
        openMainBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openMainView' });
        });

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
                statusEl.textContent = 'Not a Git Repo';
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
                \`<tr title="\${escapeHtml(config.description || 'Git configuration option')}">
                    <td class="config-key">\${escapeHtml(config.key)}</td>
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