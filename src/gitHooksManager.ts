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
		return [
			{
				name: 'pre-commit-lint',
				description: 'Pre-commit hook that runs linting',
				language: 'shell',
				category: 'pre-commit',
				content: `#!/bin/sh
# Pre-commit hook to run linting

# Run ESLint if package.json exists and has eslint
if [ -f "package.json" ] && grep -q "eslint" package.json; then
    echo "Running ESLint..."
    npm run lint
    if [ $? -ne 0 ]; then
        echo "ESLint failed. Please fix the issues before committing."
        exit 1
    fi
fi

# Run other linters as needed
# Add your custom linting commands here

echo "Pre-commit checks passed!"
exit 0`
			},
			{
				name: 'pre-commit-format',
				description: 'Pre-commit hook that formats code',
				language: 'shell',
				category: 'pre-commit',
				content: `#!/bin/sh
# Pre-commit hook to format code

# Run Prettier if available
if [ -f "package.json" ] && grep -q "prettier" package.json; then
    echo "Running Prettier..."
    npm run format
    # Add formatted files back to staging
    git add -A
fi

# Run other formatters as needed
# Add your custom formatting commands here

exit 0`
			},
			{
				name: 'commit-msg-validate',
				description: 'Commit message validation hook',
				language: 'shell',
				category: 'pre-commit',
				content: `#!/bin/sh
# Commit message validation hook

commit_regex='^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?: .{1,50}'

error_msg="Aborting commit. Your commit message is malformed.
Commit message should follow the pattern: type(scope): description
Types: feat, fix, docs, style, refactor, test, chore
Example: feat(auth): add user login functionality"

if ! grep -qE "$commit_regex" "$1"; then
    echo "$error_msg" >&2
    exit 1
fi`
			},
			{
				name: 'pre-push-test',
				description: 'Pre-push hook that runs tests',
				language: 'shell',
				category: 'pre-push',
				content: `#!/bin/sh
# Pre-push hook to run tests

protected_branch='main'
current_branch=$(git symbolic-ref HEAD | sed -e 's,.*/\\(.*\\),\\1,')

# Check if we're pushing to protected branch
if [ $protected_branch = $current_branch ]; then
    echo "Running tests before push to $protected_branch..."
    
    # Run tests based on project type
    if [ -f "package.json" ]; then
        npm test
    elif [ -f "Cargo.toml" ]; then
        cargo test
    elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
        python -m pytest
    fi
    
    if [ $? -ne 0 ]; then
        echo "Tests failed. Push aborted."
        exit 1
    fi
    
    echo "Tests passed. Proceeding with push."
fi

exit 0`
			},
			{
				name: 'post-commit-notify',
				description: 'Post-commit hook for notifications',
				language: 'shell',
				category: 'post-commit',
				content: `#!/bin/sh
# Post-commit hook for notifications

commit_hash=$(git rev-parse HEAD)
commit_msg=$(git log -1 --pretty=%B)
author=$(git log -1 --pretty=%an)

echo "Commit completed:"
echo "Hash: $commit_hash"
echo "Author: $author"
echo "Message: $commit_msg"

# Add your notification logic here
# Examples:
# - Send to Slack webhook
# - Update project management tools
# - Trigger CI/CD pipelines`
			},
			{
				name: 'pre-commit-security',
				description: 'Pre-commit security checks',
				language: 'shell',
				category: 'pre-commit',
				content: `#!/bin/sh
# Pre-commit security checks

echo "Running security checks..."

# Check for secrets in staged files
if command -v git-secrets >/dev/null 2>&1; then
    git secrets --scan
    if [ $? -ne 0 ]; then
        echo "Security check failed: potential secrets detected!"
        exit 1
    fi
fi

# Check for common security patterns
staged_files=$(git diff --cached --name-only)
for file in $staged_files; do
    if [ -f "$file" ]; then
        # Check for hardcoded passwords, API keys, etc.
        if grep -i "password\|api_key\|secret\|token" "$file" | grep -v "placeholder\|example\|TODO"; then
            echo "Warning: Potential hardcoded credentials found in $file"
            echo "Please review and remove any sensitive information."
            exit 1
        fi
    fi
done

echo "Security checks passed!"
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