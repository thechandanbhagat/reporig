import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RepoRigWebviewProvider } from './webviewProvider';
import { RepoRigMainWebviewProvider } from './mainWebviewProvider';

const execAsync = promisify(exec);

interface GitConfig {
	key: string;
	value: string;
	scope: 'local' | 'global' | 'system';
}

class GitConfigProvider implements vscode.TreeDataProvider<GitConfig> {
	private _onDidChangeTreeData: vscode.EventEmitter<GitConfig | undefined | null | void> = new vscode.EventEmitter<GitConfig | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<GitConfig | undefined | null | void> = this._onDidChangeTreeData.event;

	private configs: GitConfig[] = [];

	refresh(): void {
		this.loadConfigs().then(() => {
			this._onDidChangeTreeData.fire();
		});
	}

	getTreeItem(element: GitConfig): vscode.TreeItem {
		const item = new vscode.TreeItem(`${element.key}: ${element.value}`, vscode.TreeItemCollapsibleState.None);
		item.tooltip = `${element.scope} configuration: ${element.key} = ${element.value}`;
		item.description = element.scope;
		item.contextValue = 'gitConfig';
		return item;
	}

	getChildren(element?: GitConfig): Thenable<GitConfig[]> {
		if (!element) {
			return Promise.resolve(this.configs);
		}
		return Promise.resolve([]);
	}

	private async loadConfigs(): Promise<void> {
		try {
			const workspaceRoot = await getWorkspaceRoot();
			if (!workspaceRoot) {
				this.configs = [];
				return;
			}

			const configs: GitConfig[] = [];
			
			// Load local configs
			try {
				const { stdout: localConfigs } = await execAsync('git config --local --list', { cwd: workspaceRoot });
				localConfigs.split('\n').forEach(line => {
					if (line.trim() && line.includes('=')) {
						const [key, ...valueParts] = line.split('=');
						const value = valueParts.join('=');
						configs.push({ key: key.trim(), value: value.trim(), scope: 'local' });
					}
				});
			} catch (error) {
				// Local config might not exist, that's OK
			}

			// Load global configs
			try {
				const { stdout: globalConfigs } = await execAsync('git config --global --list');
				globalConfigs.split('\n').forEach(line => {
					if (line.trim() && line.includes('=')) {
						const [key, ...valueParts] = line.split('=');
						const value = valueParts.join('=');
						configs.push({ key: key.trim(), value: value.trim(), scope: 'global' });
					}
				});
			} catch (error) {
				console.error('Error loading global git configs:', error);
			}

			this.configs = configs;
		} catch (error) {
			console.error('Error loading git configs:', error);
			this.configs = [];
		}
	}
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('RepoRig extension is now active!');

	// Register webview provider
	const webviewProvider = new RepoRigWebviewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RepoRigWebviewProvider.viewType, webviewProvider)
	);

	const gitConfigProvider = new GitConfigProvider();
	vscode.window.createTreeView('reporig.gitConfig', {
		treeDataProvider: gitConfigProvider,
		showCollapseAll: true
	});

	// Check if workspace has git repository on startup
	await checkAndSetGitContext();

	// Register commands
	const checkGitRepoCommand = vscode.commands.registerCommand('reporig.checkGitRepo', async () => {
		const isGitRepo = await isGitRepository();
		const workspaceRoot = await getWorkspaceRoot();
		
		if (isGitRepo && workspaceRoot) {
			vscode.window.showInformationMessage(`✅ Git repository detected in: ${workspaceRoot}`);
		} else if (workspaceRoot) {
			vscode.window.showWarningMessage(`⚠️ No git repository found in: ${workspaceRoot}`);
		} else {
			vscode.window.showErrorMessage('❌ No workspace folder is open');
		}

		await checkAndSetGitContext();
		gitConfigProvider.refresh();
	});

	const listConfigsCommand = vscode.commands.registerCommand('reporig.listConfigs', async () => {
		const workspaceRoot = await getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		const isGitRepo = await isGitRepository(workspaceRoot);
		if (!isGitRepo) {
			vscode.window.showErrorMessage('Current workspace is not a git repository');
			return;
		}

		try {
			const configs = await getGitConfigurations(workspaceRoot);
			if (configs.length === 0) {
				vscode.window.showInformationMessage('No git configurations found');
				return;
			}

			const configItems = configs.map(config => 
				`${config.scope.toUpperCase()}: ${config.key} = ${config.value}`
			);

			const selected = await vscode.window.showQuickPick(configItems, {
				placeHolder: 'Select a configuration to view details',
				canPickMany: false
			});

			if (selected) {
				vscode.window.showInformationMessage(`Selected: ${selected}`);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error listing configurations: ${error}`);
		}
	});

	const editConfigCommand = vscode.commands.registerCommand('reporig.editConfig', async () => {
		const workspaceRoot = await getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		const isGitRepo = await isGitRepository(workspaceRoot);
		if (!isGitRepo) {
			vscode.window.showErrorMessage('Current workspace is not a git repository');
			return;
		}

		// Show quick pick for common git config keys
		const commonConfigs = [
			'user.name',
			'user.email',
			'core.editor',
			'core.autocrlf',
			'init.defaultBranch',
			'pull.rebase',
			'push.default',
			'Custom key...'
		];

		const selectedConfig = await vscode.window.showQuickPick(commonConfigs, {
			placeHolder: 'Select a configuration key to edit'
		});

		if (!selectedConfig) {
			return;
		}

		let configKey = selectedConfig;
		if (selectedConfig === 'Custom key...') {
			const customKey = await vscode.window.showInputBox({
				prompt: 'Enter the git configuration key (e.g., user.name)',
				validateInput: (value) => {
					if (!value || !value.includes('.')) {
						return 'Please enter a valid git configuration key (e.g., user.name)';
					}
					return null;
				}
			});

			if (!customKey) {
				return;
			}
			configKey = customKey;
		}

		// Get current value
		let currentValue = '';
		try {
			const { stdout } = await execAsync(`git config --local ${configKey}`, { cwd: workspaceRoot });
			currentValue = stdout.trim();
		} catch {
			// Key might not exist, that's OK
		}

		const newValue = await vscode.window.showInputBox({
			prompt: `Enter new value for ${configKey}`,
			value: currentValue,
			validateInput: (value) => {
				if (!value) {
					return 'Value cannot be empty';
				}
				return null;
			}
		});

		if (newValue !== undefined) {
			try {
				await execAsync(`git config --local ${configKey} "${newValue}"`, { cwd: workspaceRoot });
				vscode.window.showInformationMessage(`✅ Set ${configKey} = ${newValue}`);
				gitConfigProvider.refresh();
			} catch (error) {
				vscode.window.showErrorMessage(`❌ Error setting configuration: ${error}`);
			}
		}
	});

	const showConfigPanelCommand = vscode.commands.registerCommand('reporig.showConfigPanel', () => {
		gitConfigProvider.refresh();
		vscode.commands.executeCommand('reporig.gitConfig.focus');
	});

	const openWebviewCommand = vscode.commands.registerCommand('reporig.openWebview', () => {
		vscode.commands.executeCommand('reporig.webview.focus');
	});

	const focusWebviewCommand = vscode.commands.registerCommand('reporig.focusWebview', () => {
		vscode.commands.executeCommand('workbench.view.extension.reporig');
	});

	const openMainViewCommand = vscode.commands.registerCommand('reporig.openMainView', () => {
		RepoRigMainWebviewProvider.createOrShow(context.extensionUri);
	});

	// Register workspace folder change listener
	const workspaceFoldersChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
		await checkAndSetGitContext();
		gitConfigProvider.refresh();
	});

	context.subscriptions.push(
		checkGitRepoCommand,
		listConfigsCommand,
		editConfigCommand,
		showConfigPanelCommand,
		openWebviewCommand,
		focusWebviewCommand,
		openMainViewCommand,
		workspaceFoldersChangeListener
	);

	// Initial load of configurations
	gitConfigProvider.refresh();
}

async function getWorkspaceRoot(): Promise<string | undefined> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return undefined;
	}
	return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

async function isGitRepository(workspacePath?: string): Promise<boolean> {
	const workspaceRoot = workspacePath || await getWorkspaceRoot();
	if (!workspaceRoot) {
		return false;
	}

	try {
		const gitPath = path.join(workspaceRoot, '.git');
		const stat = await fs.promises.stat(gitPath);
		return stat.isDirectory() || stat.isFile(); // .git can be a file in case of git worktrees
	} catch {
		return false;
	}
}

async function checkAndSetGitContext(): Promise<void> {
	const isGitRepo = await isGitRepository();
	await vscode.commands.executeCommand('setContext', 'reporig.isGitRepository', isGitRepo);
}

async function getGitConfigurations(workspaceRoot: string): Promise<GitConfig[]> {
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

export function deactivate() {}
