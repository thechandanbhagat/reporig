import * as vscode from 'vscode';
import { RepoRigWebviewProvider } from './webviewProvider';
import { getGitConfigDescription } from './gitConfigDescriptions';
import { GitHooksManager, GitHook, HookTemplate } from './gitHooksManager';
import { ProfileManager, ConfigProfile, GitConfigItem } from './profileManager';

export class RepoRigMainWebviewProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private static profileManager: ProfileManager | undefined;

    public static createOrShow(extensionUri: vscode.Uri, context?: vscode.ExtensionContext) {
        // Initialize ProfileManager if not already done
        if (!this.profileManager && context) {
            this.profileManager = new ProfileManager(context);
        }

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
            case 'loadProfiles':
                await this.loadAndSendProfiles(webview);
                break;
            case 'createProfile':
                await this.createProfile(webview, message.name, message.description, message.configs, message.tags);
                break;
            case 'createProfileFromCurrent':
                await this.createProfileFromCurrent(webview, message.name, message.description, message.tags);
                break;
            case 'applyProfile':
                await this.applyProfile(webview, message.profileId);
                break;
            case 'deleteProfile':
                await this.deleteProfileItem(webview, message.profileId);
                break;
            case 'editProfile':
                await this.editProfile(webview, message.profileId, message.name, message.description, message.tags);
                break;
            case 'updateProfileConfigs':
                await this.updateProfileConfigs(webview, message.profileId, message.configs);
                break;
            case 'exportProfile':
                await this.exportProfile(webview, message.profileId);
                break;
            case 'importProfile':
                await this.importProfile(webview, message.jsonData);
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

            // Get the latest config change for the accordion
            const latestChange = await this.getLatestConfigChange(workspaceRoot);

            webview.postMessage({
                type: 'configs',
                data: {
                    configs,
                    isGitRepo,
                    workspaceRoot,
                    latestChange
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

            // Check if config already exists to determine if it's an update or create
            let existingValue = null;
            try {
                const scopeFlag = scope === 'local' ? '--local' : '--global';
                const checkCmd = `git config ${scopeFlag} "${key}"`;
                const { stdout } = await execAsync(checkCmd, scope === 'local' ? { cwd: workspaceRoot } : {});
                existingValue = stdout.trim();
            } catch {
                // Config doesn't exist, this is a new config
            }

            const scopeFlag = scope === 'local' ? '--local' : '--global';
            const cmd = `git config ${scopeFlag} "${key}" "${value}"`;

            await execAsync(cmd, scope === 'local' ? { cwd: workspaceRoot } : {});
            
            // Record the change in history
            const action = existingValue ? 'updated' : 'created';
            await this.addConfigChangeToHistory(workspaceRoot, key, value, scope, action);
            
			webview.postMessage({
				type: 'success',
				message: `Saved ${key} = ${value} (${scope})`
			});            
            // Reload configs
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

            // Get the current value before deleting for history
            let deletedValue = null;
            try {
                const scopeFlag = scope === 'local' ? '--local' : '--global';
                const getCmd = `git config ${scopeFlag} "${key}"`;
                const { stdout } = await execAsync(getCmd, scope === 'local' ? { cwd: workspaceRoot } : {});
                deletedValue = stdout.trim();
            } catch {
                // Config might not exist
            }

            const scopeFlag = scope === 'local' ? '--local' : '--global';
            const cmd = `git config ${scopeFlag} --unset "${key}"`;

            await execAsync(cmd, scope === 'local' ? { cwd: workspaceRoot } : {});
            
            // Record the deletion in history (value will be null to indicate deletion)
            if (workspaceRoot) {
                await this.addConfigChangeToHistory(workspaceRoot, key, deletedValue, scope, 'deleted');
            }
            
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

    // Profile Management Methods
    private static async loadAndSendProfiles(webview: vscode.Webview) {
        try {
            if (!this.profileManager) {
                webview.postMessage({
                    type: 'error',
                    message: 'Profile manager not initialized'
                });
                return;
            }

            const profiles = this.profileManager.getAllProfiles();
            const activeProfile = this.profileManager.getActiveProfile();

            webview.postMessage({
                type: 'profiles',
                data: {
                    profiles,
                    activeProfileId: activeProfile?.id
                }
            });
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to load profiles: ${error}`
            });
        }
    }

    private static async createProfile(webview: vscode.Webview, name: string, description: string, configs: GitConfigItem[], tags?: string[]) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            const profile = this.profileManager.createProfile(name, description, configs, tags);

            webview.postMessage({
                type: 'success',
                message: `Profile '${name}' created successfully`
            });

            await this.loadAndSendProfiles(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to create profile: ${error}`
            });
        }
    }

    private static async createProfileFromCurrent(webview: vscode.Webview, name: string, description: string, tags?: string[]) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            const workspaceRoot = await this.getWorkspaceRoot();
            const profile = await this.profileManager.createProfileFromCurrent(name, description, tags);

            webview.postMessage({
                type: 'success',
                message: `Profile '${name}' created from current configuration`
            });

            await this.loadAndSendProfiles(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to create profile from current config: ${error}`
            });
        }
    }

    private static async applyProfile(webview: vscode.Webview, profileId: string) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            const workspaceRoot = await this.getWorkspaceRoot();
            await this.profileManager.applyProfile(profileId, workspaceRoot);

            const profile = this.profileManager.getProfile(profileId);
            webview.postMessage({
                type: 'success',
                message: `Profile '${profile?.name}' applied successfully`
            });

            await this.loadAndSendProfiles(webview);
            await this.loadAndSendConfigs(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to apply profile: ${error}`
            });
        }
    }

    private static async deleteProfileItem(webview: vscode.Webview, profileId: string) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            const profile = this.profileManager.getProfile(profileId);
            const profileName = profile?.name || 'Unknown';

            this.profileManager.deleteProfile(profileId);

            webview.postMessage({
                type: 'success',
                message: `Profile '${profileName}' deleted successfully`
            });

            await this.loadAndSendProfiles(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to delete profile: ${error}`
            });
        }
    }

    private static async editProfile(webview: vscode.Webview, profileId: string, name: string, description: string, tags?: string[]) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            this.profileManager.updateProfile(profileId, { name, description, tags });

            webview.postMessage({
                type: 'success',
                message: `Profile '${name}' updated successfully`
            });

            await this.loadAndSendProfiles(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to update profile: ${error}`
            });
        }
    }

    private static async updateProfileConfigs(webview: vscode.Webview, profileId: string, configs: GitConfigItem[]) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            this.profileManager.updateProfile(profileId, { configs });

            webview.postMessage({
                type: 'success',
                message: 'Profile configurations updated successfully'
            });

            await this.loadAndSendProfiles(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to update profile configurations: ${error}`
            });
        }
    }

    private static async exportProfile(webview: vscode.Webview, profileId: string) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            const jsonData = this.profileManager.exportProfile(profileId);
            const profile = this.profileManager.getProfile(profileId);

            webview.postMessage({
                type: 'profileExported',
                data: {
                    jsonData,
                    filename: `${profile?.name.replace(/[^a-z0-9]/gi, '_')}_profile.json`
                }
            });
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to export profile: ${error}`
            });
        }
    }

    private static async importProfile(webview: vscode.Webview, jsonData: string) {
        try {
            if (!this.profileManager) {
                throw new Error('Profile manager not initialized');
            }

            const profile = this.profileManager.importProfile(jsonData);

            webview.postMessage({
                type: 'success',
                message: `Profile '${profile.name}' imported successfully`
            });

            await this.loadAndSendProfiles(webview);
        } catch (error) {
            webview.postMessage({
                type: 'error',
                message: `Failed to import profile: ${error}`
            });
        }
    }

    // Config History Management Methods
    private static async getConfigHistoryPath(workspaceRoot: string): Promise<string> {
        const path = require('path');
        const historyDir = path.join(workspaceRoot, '.vscode', '.reporig');
        return path.join(historyDir, 'config-history.json');
    }

    private static async ensureConfigHistoryDir(workspaceRoot: string): Promise<void> {
        const path = require('path');
        const fs = require('fs').promises;
        
        const historyDir = path.join(workspaceRoot, '.vscode', '.reporig');
        
        try {
            await fs.access(historyDir);
        } catch {
            await fs.mkdir(historyDir, { recursive: true });
        }
    }

    private static async loadConfigHistory(workspaceRoot: string): Promise<any[]> {
        try {
            const historyPath = await this.getConfigHistoryPath(workspaceRoot);
            const fs = require('fs').promises;
            
            const data = await fs.readFile(historyPath, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    private static async saveConfigHistory(workspaceRoot: string, history: any[]): Promise<void> {
        await this.ensureConfigHistoryDir(workspaceRoot);
        const historyPath = await this.getConfigHistoryPath(workspaceRoot);
        const fs = require('fs').promises;
        
        await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf8');
    }

    private static async addConfigChangeToHistory(
        workspaceRoot: string, 
        key: string, 
        value: string | null, 
        scope: string, 
        action: 'created' | 'updated' | 'deleted'
    ): Promise<void> {
        const history = await this.loadConfigHistory(workspaceRoot);
        
        const change = {
            key,
            value,
            scope,
            action,
            timestamp: new Date().toISOString(),
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString()
        };
        
        // Add to beginning of array (most recent first)
        history.unshift(change);
        
        // Keep only last 50 changes
        if (history.length > 50) {
            history.splice(50);
        }
        
        await this.saveConfigHistory(workspaceRoot, history);
    }

    private static async getLatestConfigChange(workspaceRoot: string): Promise<any | null> {
        const history = await this.loadConfigHistory(workspaceRoot);
        return history.length > 0 ? history[0] : null;
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
            padding: 12px;
            min-height: 100vh;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .status {
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
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
            margin-bottom: 12px;
        }

        .tab {
            padding: 10px 16px;
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 14px;
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
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 8px;
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

        /* Enhanced Template Styles */
        .template-category {
            margin-bottom: 24px;
        }

        .template-category-title {
            color: var(--vscode-foreground);
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .template-category-items {
            display: grid;
            gap: 12px;
        }

        .template-item {
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            margin-bottom: 0;
            cursor: pointer;
            transition: all 0.2s ease;
            background-color: var(--vscode-input-background);
        }

        .template-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-terminal-ansiBlue);
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }

        .template-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .template-name {
            font-weight: 600;
            color: var(--vscode-foreground);
            font-size: 14px;
        }

        .template-category-badge {
            background-color: var(--vscode-terminal-ansiBlue);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .template-description {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            margin: 8px 0;
            line-height: 1.4;
        }

        .template-preview {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 8px;
            margin-top: 8px;
        }

        .template-preview code {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            color: var(--vscode-editor-foreground);
            white-space: pre-wrap;
            word-break: break-all;
        }

        /* Hook-specific template styles */
        .templates-header {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .templates-header h4 {
            color: var(--vscode-foreground);
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .templates-header p {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
        }

        .template-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .template-select-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            transition: all 0.2s ease;
        }

        .template-item:hover .template-select-btn {
            background-color: var(--vscode-button-hoverBackground);
        }

        .no-templates-message {
            text-align: center;
            padding: 24px;
            color: var(--vscode-descriptionForeground);
            background-color: var(--vscode-input-background);
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 8px;
        }

        .no-templates-message p {
            margin-bottom: 8px;
        }

        .no-templates-message strong {
            color: var(--vscode-foreground);
        }

        /* Inline template styles */
        .hook-content-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .hook-content-header label {
            margin-bottom: 0;
        }

        .template-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .template-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .templates-header-inline {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .templates-header-inline h4 {
            margin: 0;
            color: var(--vscode-foreground);
            font-size: 14px;
            font-weight: 600;
        }

        .close-templates {
            background-color: transparent;
            color: var(--vscode-descriptionForeground);
            border: none;
            padding: 4px 8px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .close-templates:hover {
            background-color: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }

        .hook-templates {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
            animation: slideDown 0.2s ease;
        }

        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* Last Changed Accordion Styles */
        .last-changed-accordion {
            margin: 16px 0;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
            background-color: var(--vscode-input-background);
        }

        .last-changed-header {
            background-color: var(--vscode-list-headerBackground);
            padding: 12px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: background-color 0.2s ease;
        }

        .last-changed-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .last-changed-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .last-changed-chevron {
            transition: transform 0.2s ease;
            color: var(--vscode-descriptionForeground);
        }

        .last-changed-accordion.expanded .last-changed-chevron {
            transform: rotate(90deg);
        }

        .last-changed-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }

        .last-changed-accordion.expanded .last-changed-content {
            max-height: 200px;
        }

        .last-changed-details {
            padding: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .last-changed-item {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 12px;
            align-items: center;
        }

        .change-action-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .change-action-created {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
        }

        .change-action-updated {
            background-color: var(--vscode-terminal-ansiBlue);
            color: white;
        }

        .change-action-deleted {
            background-color: var(--vscode-terminal-ansiRed);
            color: white;
        }

        .change-info {
            display: flex;
            flex-direction: column;
        }

        .change-key {
            font-family: var(--vscode-editor-font-family);
            font-weight: 600;
            color: var(--vscode-terminal-ansiCyan);
            font-size: 14px;
        }

        .change-value {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-foreground);
            font-size: 12px;
            margin-top: 2px;
            opacity: 0.8;
        }

        .change-value.deleted {
            text-decoration: line-through;
            color: var(--vscode-descriptionForeground);
        }

        .change-timestamp {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-align: right;
        }

        /* Profile specific styles */
        .profiles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px;
            margin-top: 8px;
        }

        .profile-card {
            background-color: var(--vscode-editor-background);
            border: 2px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            cursor: default;
            transition: all 0.2s ease;
            position: relative;
            display: flex;
            flex-direction: column;
        }

        .profile-card:hover {
            border-color: var(--vscode-terminal-ansiBlue);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .profile-card.active {
            border-color: var(--vscode-terminal-ansiGreen);
            background-color: rgba(22, 163, 74, 0.05);
        }

        .profile-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .profile-title-section {
            flex: 1;
        }

        .profile-name {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .profile-active-badge {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
        }

        .profile-description {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-bottom: 8px;
        }

        .profile-meta {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .profile-meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .profile-meta-item svg {
            flex-shrink: 0;
            opacity: 0.8;
        }

        .profile-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-bottom: 8px;
        }

        .profile-tag {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
        }

        .profile-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .profile-action-btn {
            padding: 8px 12px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .profile-action-btn svg {
            flex-shrink: 0;
        }

        .profile-action-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .profile-action-btn.apply {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
        }

        .profile-action-btn.apply:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .profile-action-btn.danger {
            background-color: transparent;
            color: var(--vscode-errorForeground);
            border-color: var(--vscode-errorForeground);
        }

        .profile-action-btn.danger:hover {
            background-color: var(--vscode-errorForeground);
            color: white;
        }

        /* Modal styles */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .modal-header h3 {
            margin: 0;
            font-size: 18px;
        }

        .close-modal {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }

        .close-modal:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .modal-body {
            padding: 16px;
            overflow-y: auto;
            flex: 1;
        }

        .modal-description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 16px;
            font-size: 13px;
        }

        .modal-footer {
            padding: 16px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        .modal-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .editable-cell {
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            transition: background-color 0.2s ease;
        }

        .editable-cell:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .editable-cell.editing {
            background-color: var(--vscode-input-background);
            padding: 0;
        }

        .editable-cell input {
            width: 100%;
            background: transparent;
            border: none;
            color: var(--vscode-foreground);
            padding: 4px 8px;
            font-family: inherit;
            font-size: inherit;
        }

        .editable-cell input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .config-action-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .config-action-btn svg {
            flex-shrink: 0;
        }

        .config-action-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .config-action-btn.delete {
            color: var(--vscode-errorForeground);
        }

        .scope-select {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
        }

        .scope-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
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
            <button class="tab" data-tab="profiles">Profiles</button>
        </div>

        <div id="messages"></div>

        <!-- Git Config Tab Content -->
        <div id="config-tab" class="tab-content active">
            <div class="controls">
                <button id="refreshBtn" class="btn primary">Refresh Configurations</button>
                <button id="checkRepoBtn" class="btn">Check Repository Status</button>
                <button id="addConfigBtn" class="btn">Add New Configuration</button>
            </div>

            <!-- Last Changed Accordion -->
            <div id="lastChangedAccordion" class="last-changed-accordion" style="display: none;">
                <div class="last-changed-header" onclick="toggleLastChangedAccordion()">
                    <span class="last-changed-title">Last Configuration Change</span>
                    <span class="last-changed-chevron">▶</span>
                </div>
                <div class="last-changed-content">
                    <div class="last-changed-details">
                        <div id="lastChangedItem" class="last-changed-item">
                            <!-- Content will be populated by JavaScript -->
                        </div>
                    </div>
                </div>
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
                    <div class="hook-content-header">
                        <label for="hookContent">Hook Content</label>
                        <button id="loadTemplatesBtn" class="btn template-btn">📋 Load Templates</button>
                    </div>
                    <textarea id="hookContent" placeholder="Enter your hook script content here..."></textarea>
                </div>
                
                <!-- Hook Templates (inline) -->
                <div id="hookTemplates" class="hook-templates" style="display: none;">
                    <div class="templates-header-inline">
                        <h4>Select a Template</h4>
                        <button id="closeTemplatesBtn" class="btn close-templates">✕ Close</button>
                    </div>
                    <div id="templatesContainer">
                        <!-- Templates will be populated here -->
                    </div>
                </div>
                
                <div class="form-buttons">
                    <button id="saveHookBtn" class="btn primary">Save Hook</button>
                    <button id="cancelHookBtn" class="btn">Cancel</button>
                </div>

            </div>
        </div> <!-- End Hooks Tab -->

        <!-- Profiles Tab Content -->
        <div id="profiles-tab" class="tab-content">
            <div class="controls">
                <button id="refreshProfilesBtn" class="btn primary">Refresh Profiles</button>
                <button id="createProfileFromCurrentBtn" class="btn">Save Current as Profile</button>
                <button id="importProfileBtn" class="btn">Import Profile</button>
            </div>

            <div id="profilesLoadingState" class="loading" style="display: none;">
                <div>Loading profiles...</div>
            </div>

            <div id="profilesContainer" style="display: none;">
                <div id="profilesGrid" class="profiles-grid">
                    <!-- Profiles will be populated here -->
                </div>
            </div>

            <div id="profilesEmptyState" class="empty-state" style="display: none;">
                <h3>No Profiles Found</h3>
                <p>Create a profile to save and reuse git configurations across projects.</p>
                <button id="createFirstProfileBtn" class="btn primary" style="margin-top: 16px;">Create Your First Profile</button>
            </div>

            <!-- Profile Creation Form -->
            <div id="profileForm" class="form-container" style="display: none;">
                <h3 id="profileFormTitle">Create Profile from Current Configuration</h3>
                <div class="form-group">
                    <label for="profileName">Profile Name *</label>
                    <input type="text" id="profileName" placeholder="e.g., Work Profile, Personal, Client A" />
                </div>
                <div class="form-group">
                    <label for="profileDescription">Description</label>
                    <textarea id="profileDescription" placeholder="Optional description for this profile" rows="2"></textarea>
                </div>
                <div class="form-group">
                    <label for="profileTags">Tags (comma-separated)</label>
                    <input type="text" id="profileTags" placeholder="e.g., work, client, personal" />
                </div>
                <div class="form-buttons">
                    <button id="saveProfileBtn" class="btn primary">Create Profile</button>
                    <button id="cancelProfileBtn" class="btn">Cancel</button>
                </div>
            </div>

            <!-- Profile Configs Viewer/Editor -->
            <div id="profileConfigsModal" class="modal" style="display: none;" onclick="handleModalBackdropClick(event)">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h3 id="profileConfigsTitle">Profile Configurations</h3>
                        <button class="close-modal" onclick="closeProfileConfigsModal()" type="button">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p class="modal-description">These are the git configurations saved in this profile. Click on a value to edit it.</p>
                        <div class="modal-actions" style="margin-bottom: 12px;">
                            <button class="btn" onclick="addConfigToProfile()" type="button">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: middle; margin-right: 4px;"><path d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z"/></svg>
                                Add Configuration
                            </button>
                            <button class="btn primary" onclick="saveProfileConfigs()" id="saveProfileConfigsBtn" style="display: none;" type="button">Save Changes</button>
                        </div>
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
                                <tbody id="profileConfigsTableBody">
                                    <!-- Profile configs will be populated here -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn" onclick="closeProfileConfigsModal()" type="button">Close</button>
                    </div>
                </div>
            </div>
        </div> <!-- End Profiles Tab -->

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

        // DOM Elements - Profiles Tab
        const refreshProfilesBtn = document.getElementById('refreshProfilesBtn');
        const createProfileFromCurrentBtn = document.getElementById('createProfileFromCurrentBtn');
        const importProfileBtn = document.getElementById('importProfileBtn');
        const profilesLoadingState = document.getElementById('profilesLoadingState');
        const profilesContainer = document.getElementById('profilesContainer');
        const profilesEmptyState = document.getElementById('profilesEmptyState');
        const profilesGrid = document.getElementById('profilesGrid');
        const createFirstProfileBtn = document.getElementById('createFirstProfileBtn');
        const profileForm = document.getElementById('profileForm');
        const profileFormTitle = document.getElementById('profileFormTitle');
        const profileNameInput = document.getElementById('profileName');
        const profileDescriptionInput = document.getElementById('profileDescription');
        const profileTagsInput = document.getElementById('profileTags');
        const saveProfileBtn = document.getElementById('saveProfileBtn');
        const cancelProfileBtn = document.getElementById('cancelProfileBtn');

        // Tab navigation
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');

        // Hook management variables
        let hooks = [];
        let currentEditingHook = null;
        let availableTemplates = [];
        const cancelConfigBtn = document.getElementById('cancelConfigBtn');

        // Profile management variables
        let profiles = [];
        let activeProfileId = null;
        let editingProfileId = null;
        let currentEditingProfile = null;
        let profileConfigsModified = false;

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

        // Close templates button
        const closeTemplatesBtn = document.getElementById('closeTemplatesBtn');
        closeTemplatesBtn.addEventListener('click', () => {
            hookTemplates.style.display = 'none';
        });

        // Filter templates when hook type changes
        hookNameSelect.addEventListener('change', () => {
            if (hookTemplates.style.display === 'block' && availableTemplates.length > 0) {
                filterAndDisplayTemplates();
            }
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

        // Profile Event Listeners
        refreshProfilesBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'loadProfiles' });
            showProfilesLoading();
        });

        createProfileFromCurrentBtn.addEventListener('click', () => {
            showProfileForm();
        });

        createFirstProfileBtn.addEventListener('click', () => {
            showProfileForm();
        });

        saveProfileBtn.addEventListener('click', () => {
            const name = profileNameInput.value.trim();
            if (!name) {
                showMessage('Profile name is required', 'error');
                return;
            }

            const description = profileDescriptionInput.value.trim();
            const tags = profileTagsInput.value.trim();
            const tagsArray = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];

            if (editingProfileId) {
                // Edit existing profile
                vscode.postMessage({
                    type: 'editProfile',
                    profileId: editingProfileId,
                    name,
                    description,
                    tags: tagsArray
                });
            } else {
                // Create new profile
                vscode.postMessage({
                    type: 'createProfileFromCurrent',
                    name,
                    description,
                    tags: tagsArray
                });
            }

            hideProfileForm();
        });

        cancelProfileBtn.addEventListener('click', () => {
            hideProfileForm();
        });

        importProfileBtn.addEventListener('click', () => {
            const jsonData = window.prompt('Paste the profile JSON data:');
            if (!jsonData) return;

            vscode.postMessage({
                type: 'importProfile',
                jsonData
            });
        });

        // Tab switching
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                switchTab(targetTab);
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const modal = document.getElementById('profileConfigsModal');
                if (modal && modal.style.display === 'flex') {
                    closeProfileConfigsModal();
                }
            }
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
                case 'profiles':
                    handleProfilesData(message.data);
                    break;
                case 'profileExported':
                    downloadProfileJSON(message.data.jsonData, message.data.filename);
                    showMessage('Profile exported successfully', 'success');
                    break;
            }
        });

        function handleConfigsData(data) {
            configs = data.configs;
            isGitRepo = data.isGitRepo;
            
            updateStatus(data);
            renderConfigs();
            updateLastChangedAccordion(data.latestChange);
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
            if (confirm(\`Delete Git Configuration?\\n\\nThis will permanently remove:\\n• Key: \${key}\\n• Scope: \${scope}\\n\\nThis action cannot be undone. Are you sure?\`)) {
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

        // Last Changed Accordion Functions
        function toggleLastChangedAccordion() {
            const accordion = document.getElementById('lastChangedAccordion');
            accordion.classList.toggle('expanded');
        }

        function updateLastChangedAccordion(latestChange) {
            const accordion = document.getElementById('lastChangedAccordion');
            const itemContainer = document.getElementById('lastChangedItem');
            
            if (!latestChange) {
                accordion.style.display = 'none';
                return;
            }

            accordion.style.display = 'block';
            
            const actionClass = \`change-action-\${latestChange.action}\`;
            const valueDisplay = latestChange.action === 'deleted' 
                ? \`<span class="change-value deleted">Previously: \${escapeHtml(latestChange.value || 'N/A')}</span>\`
                : \`<span class="change-value">\${escapeHtml(latestChange.value || 'N/A')}</span>\`;

            itemContainer.innerHTML = \`
                <div class="change-action-badge \${actionClass}">\${latestChange.action}</div>
                <div class="change-info">
                    <div class="change-key">\${escapeHtml(latestChange.key)}</div>
                    \${valueDisplay}
                    <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px;">
                        \${latestChange.scope} scope
                    </div>
                </div>
                <div class="change-timestamp">
                    <div>\${latestChange.date}</div>
                    <div>\${latestChange.time}</div>
                </div>
            \`;
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
            } else if (tabName === 'profiles') {
                hideProfileForm();
                vscode.postMessage({ type: 'loadProfiles' });
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
            filterAndDisplayTemplates();
        }

        function filterAndDisplayTemplates() {
            const selectedHookType = hookNameSelect.value;
            
            // Filter templates based on selected hook type
            const filteredTemplates = availableTemplates.filter(template => 
                template.category === selectedHookType
            );

            if (filteredTemplates.length === 0) {
                templatesContainer.innerHTML = \`
                    <div class="no-templates-message">
                        <p>No templates available for <strong>\${selectedHookType}</strong> hook type.</p>
                        <p>You can still write your own hook script in the text area above.</p>
                    </div>
                \`;
                return;
            }

            // Render only templates for the selected hook type
            const templateHtml = filteredTemplates.map(template => {
                const templateName = template.name.split('-').slice(1).join(' ').replace(/\b\w/g, l => l.toUpperCase());
                
                return \`
                    <div class="template-item" onclick="useTemplate('\${escapeHtml(template.name)}')">
                        <div class="template-header">
                            <div class="template-name">\${escapeHtml(templateName)}</div>
                            <div class="template-select-btn">Select</div>
                        </div>
                        <div class="template-description">\${escapeHtml(template.description.split(': ').slice(1).join(': '))}</div>
                        <div class="template-preview">
                            <code>\${escapeHtml(template.content.split('\\n').slice(0, 4).join('\\n'))}\${template.content.split('\\n').length > 4 ? '\\n...' : ''}</code>
                        </div>
                    </div>
                \`;
            }).join('');

            const hookDisplayName = selectedHookType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            templatesContainer.innerHTML = \`
                <div class="templates-header">
                    <h4>\${hookDisplayName} Hook Templates</h4>
                    <p>Select a template to populate the hook content automatically:</p>
                </div>
                <div class="template-list">
                    \${templateHtml}
                </div>
            \`;
        }

        function useTemplate(templateName) {
            const template = availableTemplates.find(t => t.name === templateName);
            if (template) {
                hookContentTextarea.value = template.content;
                hookTemplates.style.display = 'none';
                const templateDisplayName = template.name.split('-').slice(1).join(' ');
                showMessage('Template "' + templateDisplayName + '" loaded successfully!', 'success');
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

        // Profile Functions
        function handleProfilesData(data) {
            profiles = data.profiles;
            activeProfileId = data.activeProfileId;
            renderProfiles();
            hideProfilesLoading();
        }

        function renderProfiles() {
            profileForm.style.display = 'none';
            
            if (profiles.length === 0) {
                profilesContainer.style.display = 'none';
                profilesEmptyState.style.display = 'block';
                return;
            }

            profilesContainer.style.display = 'block';
            profilesEmptyState.style.display = 'none';

            profilesGrid.innerHTML = profiles.map(profile => {
                const isActive = profile.id === activeProfileId;
                const tagsHtml = profile.tags && profile.tags.length > 0 
                    ? \`<div class="profile-tags">\${profile.tags.map(tag => 
                        \`<span class="profile-tag">\${escapeHtml(tag)}</span>\`
                    ).join('')}</div>\` 
                    : '';

                const createdDate = new Date(profile.created).toLocaleDateString();
                const configCount = profile.configs.length;

                return \`
                    <div class="profile-card \${isActive ? 'active' : ''}">
                        <div class="profile-card-header">
                            <div class="profile-title-section">
                                <div class="profile-name">
                                    \${escapeHtml(profile.name)}
                                    \${isActive ? '<span class="profile-active-badge">Active</span>' : ''}
                                </div>
                            </div>
                        </div>
                        <div class="profile-description">
                            \${escapeHtml(profile.description || 'No description provided')}
                        </div>
                        <div class="profile-meta">
                            <div class="profile-meta-item">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zM3.75 2a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z"/><path fill-rule="evenodd" d="M0 13.25a3.25 3.25 0 013.25-3.25h1a3.25 3.25 0 013.25 3.25v1.5a.5.5 0 01-1 0v-1.5A2.25 2.25 0 004.25 11h-1A2.25 2.25 0 001 13.25v1.5a.5.5 0 01-1 0v-1.5z"/><path fill-rule="evenodd" d="M12 5.5V3.5h-2V2h2V0h1.5v2H16v1.5h-2.5v2H12zM5 8.5h4.5v1.5H5V8.5z"/></svg>
                                <span>\${configCount} config\${configCount !== 1 ? 's' : ''}</span>
                            </div>
                            <div class="profile-meta-item">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 0a.5.5 0 01.5.5V1h6V.5a.5.5 0 011 0V1h1a2 2 0 012 2v11a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2h1V.5a.5.5 0 01.5-.5zM3 2a1 1 0 00-1 1v1h12V3a1 1 0 00-1-1H3zm11 3H2v9a1 1 0 001 1h10a1 1 0 001-1V5z"/></svg>
                                <span>\${createdDate}</span>
                            </div>
                        </div>
                        \${tagsHtml}
                        <div class="profile-actions">
                            <button class="profile-action-btn apply" onclick="applyProfile('\${profile.id}')" style="grid-column: span 2;">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
                                Apply Profile
                            </button>
                            <button class="profile-action-btn" onclick="viewProfileConfigs('\${profile.id}')">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path fill-rule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zM2 8a6 6 0 1112 0A6 6 0 012 8z"/></svg>
                                View
                            </button>
                            <button class="profile-action-btn" onclick="editProfile('\${profile.id}')">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z"/></svg>
                                Edit
                            </button>
                            <button class="profile-action-btn" onclick="exportProfile('\${profile.id}')">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.636 3.5a.5.5 0 00-.5-.5H1.5A1.5 1.5 0 000 4.5v10A1.5 1.5 0 001.5 16h10a1.5 1.5 0 001.5-1.5V7.864a.5.5 0 00-1 0V14.5a.5.5 0 01-.5.5h-10a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5h6.636a.5.5 0 00.5-.5z"/><path d="M16 .5a.5.5 0 00-.5-.5h-5a.5.5 0 000 1h3.793L6.146 9.146a.5.5 0 10.708.708L15 1.707V5.5a.5.5 0 001 0v-5z"/></svg>
                                Export
                            </button>
                            <button class="profile-action-btn danger" onclick="deleteProfile('\${profile.id}')">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                                Delete
                            </button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function applyProfile(profileId) {
            if (confirm('Apply this profile? This will update your git configurations.')) {
                vscode.postMessage({
                    type: 'applyProfile',
                    profileId
                });
            }
        }

        function editProfile(profileId) {
            const profile = profiles.find(p => p.id === profileId);
            if (!profile) return;

            editingProfileId = profileId;
            profileFormTitle.textContent = 'Edit Profile';
            profileNameInput.value = profile.name;
            profileDescriptionInput.value = profile.description || '';
            profileTagsInput.value = profile.tags ? profile.tags.join(', ') : '';
            saveProfileBtn.textContent = 'Update Profile';
            
            // Hide profile cards and empty state, show form
            profilesContainer.style.display = 'none';
            profilesEmptyState.style.display = 'none';
            profileForm.style.display = 'block';
            profileNameInput.focus();
        }

        function exportProfile(profileId) {
            vscode.postMessage({
                type: 'exportProfile',
                profileId
            });
        }

        function deleteProfile(profileId) {
            const profile = profiles.find(p => p.id === profileId);
            if (confirm(\`Are you sure you want to delete the profile "\${profile?.name}"?\`)) {
                vscode.postMessage({
                    type: 'deleteProfile',
                    profileId
                });
            }
        }

        function viewProfileConfigs(profileId) {
            const profile = profiles.find(p => p.id === profileId);
            if (!profile) return;

            currentEditingProfile = JSON.parse(JSON.stringify(profile)); // Deep copy
            profileConfigsModified = false;

            const modal = document.getElementById('profileConfigsModal');
            const title = document.getElementById('profileConfigsTitle');
            const tbody = document.getElementById('profileConfigsTableBody');
            const saveBtn = document.getElementById('saveProfileConfigsBtn');

            title.textContent = \`Configurations in "\${profile.name}"\`;
            saveBtn.style.display = 'none';

            renderProfileConfigsTable();
            modal.style.display = 'flex';
        }

        function renderProfileConfigsTable() {
            const tbody = document.getElementById('profileConfigsTableBody');
            
            tbody.innerHTML = currentEditingProfile.configs.map((config, index) => \`
                <tr>
                    <td class="config-key">\${escapeHtml(config.key)}</td>
                    <td class="editable-cell" onclick="editConfigValue(\${index})" id="value-\${index}">
                        \${escapeHtml(config.value)}
                    </td>
                    <td>
                        <select onchange="updateConfigScope(\${index}, this.value)" class="scope-select">
                            <option value="local" \${config.scope === 'local' ? 'selected' : ''}>local</option>
                            <option value="global" \${config.scope === 'global' ? 'selected' : ''}>global</option>
                        </select>
                    </td>
                    <td>
                        <button class="config-action-btn delete" onclick="removeConfigFromProfile(\${index})">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                            Remove
                        </button>
                    </td>
                </tr>
            \`).join('');
        }

        function editConfigValue(index) {
            const cell = document.getElementById(\`value-\${index}\`);
            const currentValue = currentEditingProfile.configs[index].value;
            
            cell.classList.add('editing');
            cell.innerHTML = \`<input type="text" value="\${escapeHtml(currentValue)}" 
                onblur="saveConfigValue(\${index}, this.value)" 
                onkeydown="if(event.key==='Enter') this.blur()" 
                autofocus />\`;
            
            const input = cell.querySelector('input');
            input.focus();
            input.select();
        }

        function saveConfigValue(index, newValue) {
            currentEditingProfile.configs[index].value = newValue;
            profileConfigsModified = true;
            document.getElementById('saveProfileConfigsBtn').style.display = 'inline-block';
            renderProfileConfigsTable();
        }

        function updateConfigScope(index, newScope) {
            currentEditingProfile.configs[index].scope = newScope;
            profileConfigsModified = true;
            document.getElementById('saveProfileConfigsBtn').style.display = 'inline-block';
        }

        function removeConfigFromProfile(index) {
            if (confirm('Remove this configuration from the profile?')) {
                currentEditingProfile.configs.splice(index, 1);
                profileConfigsModified = true;
                document.getElementById('saveProfileConfigsBtn').style.display = 'inline-block';
                renderProfileConfigsTable();
            }
        }

        function addConfigToProfile() {
            const key = window.prompt('Enter configuration key (e.g., user.name):');
            if (!key) return;

            const value = window.prompt('Enter configuration value:');
            if (value === null) return;

            const scope = confirm('Add as local config? (Cancel for global)') ? 'local' : 'global';

            currentEditingProfile.configs.push({ key, value, scope });
            profileConfigsModified = true;
            document.getElementById('saveProfileConfigsBtn').style.display = 'inline-block';
            renderProfileConfigsTable();
        }

        function saveProfileConfigs() {
            if (!profileConfigsModified) {
                showMessage('No changes to save', 'error');
                return;
            }

            vscode.postMessage({
                type: 'updateProfileConfigs',
                profileId: currentEditingProfile.id,
                configs: currentEditingProfile.configs
            });

            closeProfileConfigsModal();
        }

        function closeProfileConfigsModal() {
            if (profileConfigsModified && !confirm('You have unsaved changes. Close anyway?')) {
                return;
            }
            const modal = document.getElementById('profileConfigsModal');
            modal.style.display = 'none';
            currentEditingProfile = null;
            profileConfigsModified = false;
            document.getElementById('saveProfileConfigsBtn').style.display = 'none';
        }

        function handleModalBackdropClick(event) {
            // Close modal if clicking on the backdrop (not the content)
            if (event.target.id === 'profileConfigsModal') {
                closeProfileConfigsModal();
            }
        }

        function downloadProfileJSON(jsonData, filename) {
            // Display the JSON in a way that user can copy it
            const message = \`Profile exported successfully! Copy this JSON:\\n\\n\${jsonData}\`;
            alert(message);
        }

        function showProfilesLoading() {
            profileForm.style.display = 'none';
            profilesLoadingState.style.display = 'block';
            profilesContainer.style.display = 'none';
            profilesEmptyState.style.display = 'none';
        }

        function hideProfilesLoading() {
            profilesLoadingState.style.display = 'none';
        }

        function showProfileForm() {
            editingProfileId = null;
            profileFormTitle.textContent = 'Create Profile from Current Configuration';
            profileNameInput.value = '';
            profileDescriptionInput.value = '';
            profileTagsInput.value = '';
            saveProfileBtn.textContent = 'Create Profile';
            
            // Hide profile cards and empty state, show form
            profilesContainer.style.display = 'none';
            profilesEmptyState.style.display = 'none';
            profileForm.style.display = 'block';
            profileNameInput.focus();
        }

        function hideProfileForm() {
            editingProfileId = null;
            profileForm.style.display = 'none';
            profileNameInput.value = '';
            profileDescriptionInput.value = '';
            profileTagsInput.value = '';
            saveProfileBtn.textContent = 'Create Profile';
            
            // Re-render profiles to show cards again
            renderProfiles();
        }

        // Make functions globally available
        window.editConfig = editConfig;
        window.deleteConfig = deleteConfig;
        window.toggleAddConfigForm = toggleAddConfigForm;
        window.editHook = editHook;
        window.deleteHook = deleteHook;
        window.useTemplate = useTemplate;
        window.applyProfile = applyProfile;
        window.editProfile = editProfile;
        window.exportProfile = exportProfile;
        window.deleteProfile = deleteProfile;
        window.viewProfileConfigs = viewProfileConfigs;
        window.closeProfileConfigsModal = closeProfileConfigsModal;
        window.editConfigValue = editConfigValue;
        window.saveConfigValue = saveConfigValue;
        window.updateConfigScope = updateConfigScope;
        window.removeConfigFromProfile = removeConfigFromProfile;
        window.addConfigToProfile = addConfigToProfile;
        window.saveProfileConfigs = saveProfileConfigs;
        window.handleModalBackdropClick = handleModalBackdropClick;

        // Initial load
        vscode.postMessage({ type: 'loadConfigs' });
    </script>
</body>
</html>`;
    }
}