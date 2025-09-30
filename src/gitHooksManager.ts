import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const statAsync = promisify(fs.stat);
const readdirAsync = promisify(fs.readdir);
const unlinkAsync = promisify(fs.unlink);

export interface GitHook {
	name: string;
	path: string;
	exists: boolean;
	executable: boolean;
	content?: string;
	description: string;
}

export interface HookTemplate {
	name: string;
	description: string;
	content: string;
	language: string;
	category: 'pre-commit' | 'post-commit' | 'pre-push' | 'post-receive' | 'update' | 'other';
}

export class GitHooksManager {
	private static readonly HOOK_NAMES = [
		'applypatch-msg',
		'pre-applypatch',
		'post-applypatch',
		'pre-commit',
		'pre-merge-commit',
		'prepare-commit-msg',
		'commit-msg',
		'post-commit',
		'pre-rebase',
		'post-checkout',
		'post-merge',
		'pre-push',
		'pre-receive',
		'update',
		'proc-receive',
		'post-receive',
		'post-update',
		'reference-transaction',
		'push-to-checkout',
		'pre-auto-gc',
		'post-rewrite',
		'sendemail-validate',
		'fsmonitor-watchman',
		'p4-changelist',
		'p4-prepare-changelist',
		'p4-post-changelist',
		'p4-pre-submit',
		'post-index-change'
	];

	private static readonly HOOK_DESCRIPTIONS: Record<string, string> = {
		'applypatch-msg': 'Invoked by git am and can edit the commit message',
		'pre-applypatch': 'Invoked by git am after the patch is applied but before a commit is made',
		'post-applypatch': 'Invoked by git am after the patch is applied and a commit is made',
		'pre-commit': 'Invoked before a commit is made, can prevent the commit',
		'pre-merge-commit': 'Invoked before a merge commit is created',
		'prepare-commit-msg': 'Invoked after the commit message is prepared but before the editor is started',
		'commit-msg': 'Invoked with the commit message, can edit or reject the commit',
		'post-commit': 'Invoked after a commit is made',
		'pre-rebase': 'Invoked before a rebase operation',
		'post-checkout': 'Invoked after a checkout or clone',
		'post-merge': 'Invoked after a merge is completed',
		'pre-push': 'Invoked before a push operation, can prevent the push',
		'pre-receive': 'Invoked on the remote repository before refs are updated',
		'update': 'Invoked on the remote repository for each ref being updated',
		'proc-receive': 'Invoked on the remote repository for processing push requests',
		'post-receive': 'Invoked on the remote repository after all refs have been updated',
		'post-update': 'Invoked on the remote repository after all refs have been updated (after post-receive)',
		'reference-transaction': 'Invoked during reference transactions',
		'push-to-checkout': 'Invoked when a push to a checked-out branch is attempted',
		'pre-auto-gc': 'Invoked before automatic garbage collection',
		'post-rewrite': 'Invoked after commands that rewrite commits',
		'sendemail-validate': 'Invoked before sending emails with git send-email',
		'fsmonitor-watchman': 'Used for file system monitoring with Watchman',
		'p4-changelist': 'Perforce integration hook for changelists',
		'p4-prepare-changelist': 'Perforce integration hook for preparing changelists',
		'p4-post-changelist': 'Perforce integration hook after changelist creation',
		'p4-pre-submit': 'Perforce integration hook before submit',
		'post-index-change': 'Invoked after the index is modified'
	};

	constructor(private workspaceRoot: string) {}

	async getHooksDirectory(): Promise<string> {
		return path.join(this.workspaceRoot, '.git', 'hooks');
	}

	async getAllHooks(): Promise<GitHook[]> {
		const hooksDir = await this.getHooksDirectory();
		const hooks: GitHook[] = [];

		for (const hookName of GitHooksManager.HOOK_NAMES) {
			const hookPath = path.join(hooksDir, hookName);
			let exists = false;
			let executable = false;
			let content: string | undefined;

			try {
				const stat = await statAsync(hookPath);
				exists = stat.isFile();
				executable = !!(stat.mode & parseInt('111', 8)); // Check if any execute bit is set

				if (exists) {
					content = await readFileAsync(hookPath, 'utf8');
				}
			} catch {
				// Hook doesn't exist, which is fine
			}

			hooks.push({
				name: hookName,
				path: hookPath,
				exists,
				executable,
				content,
				description: GitHooksManager.HOOK_DESCRIPTIONS[hookName] || 'Git hook'
			});
		}

		return hooks;
	}

	async getHook(hookName: string): Promise<GitHook | null> {
		const hooks = await this.getAllHooks();
		return hooks.find(hook => hook.name === hookName) || null;
	}

	async createOrUpdateHook(hookName: string, content: string): Promise<void> {
		const hooksDir = await this.getHooksDirectory();
		const hookPath = path.join(hooksDir, hookName);

		// Ensure hooks directory exists
		try {
			await fs.promises.mkdir(hooksDir, { recursive: true });
		} catch {
			// Directory might already exist
		}

		// Write the hook content
		await writeFileAsync(hookPath, content, 'utf8');

		// Make the hook executable
		await fs.promises.chmod(hookPath, 0o755);
	}

	async deleteHook(hookName: string): Promise<void> {
		const hook = await this.getHook(hookName);
		if (hook && hook.exists) {
			await unlinkAsync(hook.path);
		}
	}

	async toggleHookExecutable(hookName: string): Promise<void> {
		const hook = await this.getHook(hookName);
		if (hook && hook.exists) {
			const stat = await statAsync(hook.path);
			const isExecutable = !!(stat.mode & parseInt('111', 8));
			
			if (isExecutable) {
				// Remove execute permissions
				await fs.promises.chmod(hook.path, stat.mode & ~parseInt('111', 8));
			} else {
				// Add execute permissions
				await fs.promises.chmod(hook.path, stat.mode | parseInt('755', 8));
			}
		}
	}

	getHookTemplates(): HookTemplate[] {
		try {
			// Get the extension path
			const extensionPath = path.dirname(__dirname);
			const templatesPath = path.join(extensionPath, 'src', 'gitHookTemplates.json');
			
			// Read and parse the JSON file
			const templatesData = fs.readFileSync(templatesPath, 'utf8');
			const templatesJson = JSON.parse(templatesData);
			
			// Convert JSON structure to HookTemplate array
			const templates: HookTemplate[] = [];
			
			templatesJson.templates.forEach((hookType: any) => {
				hookType.examples.forEach((example: any) => {
					templates.push({
						name: `${hookType.name}-${example.name.toLowerCase().replace(/\s+/g, '-')}`,
						description: `${hookType.displayName}: ${example.description}`,
						content: example.content,
						language: 'shell',
						category: hookType.name as any
					});
				});
			});
			
			return templates;
		} catch (error) {
			console.error('Error loading hook templates:', error);
			// Return fallback templates if JSON loading fails
			return this.getFallbackTemplates();
		}
	}

	private getFallbackTemplates(): HookTemplate[] {
		return [
			{
				name: 'pre-commit-lint',
				description: 'Pre-commit hook that runs linting',
				language: 'shell',
				category: 'pre-commit',
				content: `#!/bin/sh
# Pre-commit hook to run linting

echo "Running linting checks..."
npm run lint
if [ $? -ne 0 ]; then
    echo "❌ Linting failed. Please fix issues before committing."
    exit 1
fi
echo "✅ Linting passed!"
exit 0`
			}
		];
	}
}

export class GitHooksProvider implements vscode.TreeDataProvider<GitHook> {
	private _onDidChangeTreeData: vscode.EventEmitter<GitHook | undefined | null | void> = new vscode.EventEmitter<GitHook | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<GitHook | undefined | null | void> = this._onDidChangeTreeData.event;

	private hooks: GitHook[] = [];
	private hooksManager: GitHooksManager | null = null;

	constructor(private workspaceRoot: string) {
		this.hooksManager = new GitHooksManager(workspaceRoot);
	}

	refresh(): void {
		this.loadHooks().then(() => {
			this._onDidChangeTreeData.fire();
		});
	}

	getTreeItem(element: GitHook): vscode.TreeItem {
		const item = new vscode.TreeItem(
			element.name,
			vscode.TreeItemCollapsibleState.None
		);

		// Set description and icon based on hook status
		if (element.exists) {
			item.description = element.executable ? '✅ Active' : '⚠️ Inactive';
			item.tooltip = `${element.description}\nStatus: ${element.executable ? 'Executable' : 'Not executable'}`;
			item.iconPath = new vscode.ThemeIcon(
				element.executable ? 'check' : 'warning'
			);
		} else {
			item.description = '➖ Not configured';
			item.tooltip = `${element.description}\nStatus: Not configured`;
			item.iconPath = new vscode.ThemeIcon('circle-outline');
		}

		item.contextValue = element.exists ? 'existingHook' : 'missingHook';
		item.command = {
			command: 'reporig.viewHook',
			title: 'View Hook',
			arguments: [element]
		};

		return item;
	}

	getChildren(element?: GitHook): Thenable<GitHook[]> {
		if (!element) {
			return Promise.resolve(this.hooks);
		}
		return Promise.resolve([]);
	}

	private async loadHooks(): Promise<void> {
		if (this.hooksManager) {
			try {
				this.hooks = await this.hooksManager.getAllHooks();
			} catch (error) {
				console.error('Error loading git hooks:', error);
				this.hooks = [];
			}
		}
	}

	getHooksManager(): GitHooksManager | null {
		return this.hooksManager;
	}
}