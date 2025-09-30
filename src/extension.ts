import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RepoRigWebviewProvider } from './webviewProvider';
import { RepoRigMainWebviewProvider } from './mainWebviewProvider';
import { GitHooksProvider, GitHooksManager, GitHook, HookTemplate } from './gitHooksManager';

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

	// Initialize git hooks provider
	let gitHooksProvider: GitHooksProvider | null = null;
	const workspaceRoot = await getWorkspaceRoot();
	if (workspaceRoot) {
		gitHooksProvider = new GitHooksProvider(workspaceRoot);
		vscode.window.createTreeView('reporig.gitHooks', {
			treeDataProvider: gitHooksProvider,
			showCollapseAll: true
		});
	}

	// Check if workspace has git repository on startup
	await checkAndSetGitContext();

	// Git Hooks Commands
	const listHooksCommand = vscode.commands.registerCommand('reporig.listHooks', async () => {
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

		if (gitHooksProvider) {
			gitHooksProvider.refresh();
			vscode.commands.executeCommand('reporig.gitHooks.focus');
		}
	});

	const viewHookCommand = vscode.commands.registerCommand('reporig.viewHook', async (hook: GitHook) => {
		if (!hook.exists) {
			const action = await vscode.window.showInformationMessage(
				`Hook '${hook.name}' is not configured. Would you like to create it?`,
				'Create Hook', 'Cancel'
			);
			if (action === 'Create Hook') {
				vscode.commands.executeCommand('reporig.createHook', hook.name);
			}
			return;
		}

		// Open hook content in a new editor
		const doc = await vscode.workspace.openTextDocument({
			content: hook.content || '',
			language: 'shellscript'
		});
		await vscode.window.showTextDocument(doc);
	});

	const createHookCommand = vscode.commands.registerCommand('reporig.createHook', async (hookName?: string) => {
		const workspaceRoot = await getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		if (!gitHooksProvider) {
			vscode.window.showErrorMessage('Git hooks provider not initialized');
			return;
		}

		const hooksManager = gitHooksProvider.getHooksManager();
		if (!hooksManager) {
			vscode.window.showErrorMessage('Git hooks manager not available');
			return;
		}

		// If hook name not provided, ask user to select
		if (!hookName) {
			const hooks = await hooksManager.getAllHooks();
			const availableHooks = hooks.filter(h => !h.exists).map(h => h.name);
			
			if (availableHooks.length === 0) {
				vscode.window.showInformationMessage('All hooks are already configured');
				return;
			}

			hookName = await vscode.window.showQuickPick(availableHooks, {
				placeHolder: 'Select a hook to create'
			});

			if (!hookName) {
				return;
			}
		}

		// Show template options
		const templates = hooksManager.getHookTemplates();
		const templateOptions = [
			'Empty Hook',
			...templates.map(t => `${t.name} - ${t.description}`)
		];

		const selectedTemplate = await vscode.window.showQuickPick(templateOptions, {
			placeHolder: 'Choose a template for the hook'
		});

		if (!selectedTemplate) {
			return;
		}

		let content = '#!/bin/sh\n\n# Add your hook logic here\nexit 0\n';
		
		if (selectedTemplate !== 'Empty Hook') {
			const templateName = selectedTemplate.split(' - ')[0];
			const template = templates.find(t => t.name === templateName);
			if (template) {
				content = template.content;
			}
		}

		try {
			await hooksManager.createOrUpdateHook(hookName, content);
			vscode.window.showInformationMessage(`✅ Created hook: ${hookName}`);
			gitHooksProvider.refresh();

			// Open the created hook for editing
			const hook = await hooksManager.getHook(hookName);
			if (hook && hook.exists) {
				vscode.commands.executeCommand('reporig.editHook', hook);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`❌ Failed to create hook: ${error}`);
		}
	});

	const editHookCommand = vscode.commands.registerCommand('reporig.editHook', async (hook: GitHook) => {
		if (!hook.exists) {
			vscode.window.showErrorMessage('Hook does not exist');
			return;
		}

		// Create a temporary document with the hook content
		const doc = await vscode.workspace.openTextDocument({
			content: hook.content || '',
			language: 'shellscript'
		});

		const editor = await vscode.window.showTextDocument(doc);
		
		// Save the hook when the document is saved
		const disposable = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
			if (savedDoc === doc) {
				const workspaceRoot = await getWorkspaceRoot();
				if (workspaceRoot && gitHooksProvider) {
					const hooksManager = gitHooksProvider.getHooksManager();
					if (hooksManager) {
						try {
							await hooksManager.createOrUpdateHook(hook.name, savedDoc.getText());
							vscode.window.showInformationMessage(`✅ Updated hook: ${hook.name}`);
							gitHooksProvider.refresh();
						} catch (error) {
							vscode.window.showErrorMessage(`❌ Failed to save hook: ${error}`);
						}
					}
				}
				disposable.dispose();
			}
		});
	});

	const deleteHookCommand = vscode.commands.registerCommand('reporig.deleteHook', async (hook: GitHook) => {
		if (!hook.exists) {
			vscode.window.showWarningMessage('Hook does not exist');
			return;
		}

		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to delete the '${hook.name}' hook?`,
			{ modal: true },
			'Delete Hook'
		);

		if (confirmation === 'Delete Hook') {
			const workspaceRoot = await getWorkspaceRoot();
			if (workspaceRoot && gitHooksProvider) {
				const hooksManager = gitHooksProvider.getHooksManager();
				if (hooksManager) {
					try {
						await hooksManager.deleteHook(hook.name);
						vscode.window.showInformationMessage(`✅ Deleted hook: ${hook.name}`);
						gitHooksProvider.refresh();
					} catch (error) {
						vscode.window.showErrorMessage(`❌ Failed to delete hook: ${error}`);
					}
				}
			}
		}
	});

	const toggleHookCommand = vscode.commands.registerCommand('reporig.toggleHook', async (hook: GitHook) => {
		if (!hook.exists) {
			vscode.window.showWarningMessage('Hook does not exist');
			return;
		}

		const workspaceRoot = await getWorkspaceRoot();
		if (workspaceRoot && gitHooksProvider) {
			const hooksManager = gitHooksProvider.getHooksManager();
			if (hooksManager) {
				try {
					await hooksManager.toggleHookExecutable(hook.name);
					const newStatus = hook.executable ? 'disabled' : 'enabled';
					vscode.window.showInformationMessage(`✅ Hook '${hook.name}' ${newStatus}`);
					gitHooksProvider.refresh();
				} catch (error) {
					vscode.window.showErrorMessage(`❌ Failed to toggle hook: ${error}`);
				}
			}
		}
	});

	const refreshHooksCommand = vscode.commands.registerCommand('reporig.refreshHooks', () => {
		if (gitHooksProvider) {
			gitHooksProvider.refresh();
		}
	});

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
		if (gitHooksProvider) {
			gitHooksProvider.refresh();
		}
	});

	context.subscriptions.push(
		// Git Config Commands
		checkGitRepoCommand,
		listConfigsCommand,
		editConfigCommand,
		showConfigPanelCommand,
		openWebviewCommand,
		focusWebviewCommand,
		openMainViewCommand,
		// Git Hooks Commands
		listHooksCommand,
		viewHookCommand,
		createHookCommand,
		editHookCommand,
		deleteHookCommand,
		toggleHookCommand,
		refreshHooksCommand,
		// Event Listeners
		workspaceFoldersChangeListener
	);

	// Initial load of configurations
	gitConfigProvider.refresh();
	if (gitHooksProvider) {
		gitHooksProvider.refresh();
	}
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
