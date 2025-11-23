import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitConfigItem {
	key: string;
	value: string;
	scope: 'local' | 'global';
}

export interface ConfigProfile {
	id: string;
	name: string;
	description: string;
	configs: GitConfigItem[];
	created: string;
	modified: string;
	tags?: string[];
	icon?: string;
}

export interface ProfileStorage {
	profiles: ConfigProfile[];
	activeProfile?: string;
	lastModified: string;
}

export class ProfileManager {
	private storageFile: string;
	private storage: ProfileStorage;
	private context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		const workspaceRoot = this.getWorkspaceRoot();
		
		// Store profiles in workspace .vscode folder
		if (workspaceRoot) {
			const vscodePath = path.join(workspaceRoot, '.vscode', '.reporig');
			if (!fs.existsSync(vscodePath)) {
				fs.mkdirSync(vscodePath, { recursive: true });
			}
			this.storageFile = path.join(vscodePath, 'profiles.json');
		} else {
			// Fallback to global storage
			this.storageFile = path.join(context.globalStorageUri.fsPath, 'profiles.json');
		}

		this.storage = this.loadStorage();
	}

	private getWorkspaceRoot(): string | undefined {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return undefined;
		}
		return vscode.workspace.workspaceFolders[0].uri.fsPath;
	}

	private loadStorage(): ProfileStorage {
		try {
			if (fs.existsSync(this.storageFile)) {
				const data = fs.readFileSync(this.storageFile, 'utf8');
				return JSON.parse(data);
			}
		} catch (error) {
			console.error('Error loading profiles:', error);
		}

		return {
			profiles: [],
			lastModified: new Date().toISOString()
		};
	}

	private saveStorage(): void {
		try {
			this.storage.lastModified = new Date().toISOString();
			const dir = path.dirname(this.storageFile);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(this.storageFile, JSON.stringify(this.storage, null, 2));
		} catch (error) {
			throw new Error(`Failed to save profiles: ${error}`);
		}
	}

	public getAllProfiles(): ConfigProfile[] {
		return this.storage.profiles;
	}

	public getProfile(id: string): ConfigProfile | undefined {
		return this.storage.profiles.find(p => p.id === id);
	}

	public createProfile(name: string, description: string, configs: GitConfigItem[], tags?: string[]): ConfigProfile {
		const profile: ConfigProfile = {
			id: this.generateId(),
			name,
			description,
			configs,
			created: new Date().toISOString(),
			modified: new Date().toISOString(),
			tags,
			icon: this.getIconForProfile(tags)
		};

		this.storage.profiles.push(profile);
		this.saveStorage();
		return profile;
	}

	public updateProfile(id: string, updates: Partial<Omit<ConfigProfile, 'id' | 'created'>>): ConfigProfile {
		const profile = this.getProfile(id);
		if (!profile) {
			throw new Error(`Profile not found: ${id}`);
		}

		Object.assign(profile, updates, {
			modified: new Date().toISOString()
		});

		this.saveStorage();
		return profile;
	}

	public deleteProfile(id: string): void {
		const index = this.storage.profiles.findIndex(p => p.id === id);
		if (index === -1) {
			throw new Error(`Profile not found: ${id}`);
		}

		this.storage.profiles.splice(index, 1);
		
		// Clear active profile if it was deleted
		if (this.storage.activeProfile === id) {
			this.storage.activeProfile = undefined;
		}

		this.saveStorage();
	}

	public async applyProfile(id: string, workspaceRoot?: string): Promise<void> {
		const profile = this.getProfile(id);
		if (!profile) {
			throw new Error(`Profile not found: ${id}`);
		}

		const root = workspaceRoot || this.getWorkspaceRoot();
		if (!root) {
			throw new Error('No workspace folder found');
		}

		const errors: string[] = [];

		for (const config of profile.configs) {
			try {
				const scopeFlag = config.scope === 'local' ? '--local' : '--global';
				const cwd = config.scope === 'local' ? root : undefined;
				await execAsync(`git config ${scopeFlag} "${config.key}" "${config.value}"`, { cwd });
			} catch (error) {
				errors.push(`Failed to set ${config.key}: ${error}`);
			}
		}

		if (errors.length > 0) {
			throw new Error(`Some configurations failed:\n${errors.join('\n')}`);
		}

		this.storage.activeProfile = id;
		this.saveStorage();
	}

	public async getCurrentConfigs(workspaceRoot?: string): Promise<GitConfigItem[]> {
		const root = workspaceRoot || this.getWorkspaceRoot();
		if (!root) {
			return [];
		}

		const configs: GitConfigItem[] = [];

		// Get local configs
		try {
			const { stdout: localConfigs } = await execAsync('git config --local --list', { cwd: root });
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

		// Get global configs
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

		return configs;
	}

	public async createProfileFromCurrent(name: string, description: string, tags?: string[]): Promise<ConfigProfile> {
		const currentConfigs = await this.getCurrentConfigs();
		return this.createProfile(name, description, currentConfigs, tags);
	}

	public compareProfiles(profileId: string, workspaceRoot?: string): Promise<ProfileComparison> {
		return this.compareProfileWithCurrent(profileId, workspaceRoot);
	}

	private async compareProfileWithCurrent(profileId: string, workspaceRoot?: string): Promise<ProfileComparison> {
		const profile = this.getProfile(profileId);
		if (!profile) {
			throw new Error(`Profile not found: ${profileId}`);
		}

		const currentConfigs = await this.getCurrentConfigs(workspaceRoot);
		const currentMap = new Map(currentConfigs.map(c => [`${c.key}:${c.scope}`, c.value]));
		const profileMap = new Map(profile.configs.map(c => [`${c.key}:${c.scope}`, c.value]));

		const toAdd: GitConfigItem[] = [];
		const toUpdate: Array<{ key: string; scope: 'local' | 'global'; oldValue: string; newValue: string }> = [];
		const toRemove: GitConfigItem[] = [];

		// Find configs to add or update
		for (const config of profile.configs) {
			const key = `${config.key}:${config.scope}`;
			const currentValue = currentMap.get(key);

			if (currentValue === undefined) {
				toAdd.push(config);
			} else if (currentValue !== config.value) {
				toUpdate.push({
					key: config.key,
					scope: config.scope,
					oldValue: currentValue,
					newValue: config.value
				});
			}
		}

		// Find configs to remove (exist in current but not in profile)
		for (const config of currentConfigs) {
			const key = `${config.key}:${config.scope}`;
			if (!profileMap.has(key)) {
				toRemove.push(config);
			}
		}

		return { toAdd, toUpdate, toRemove };
	}

	public exportProfile(id: string): string {
		const profile = this.getProfile(id);
		if (!profile) {
			throw new Error(`Profile not found: ${id}`);
		}

		return JSON.stringify(profile, null, 2);
	}

	public importProfile(jsonData: string): ConfigProfile {
		try {
			const profile = JSON.parse(jsonData) as ConfigProfile;
			
			// Validate profile structure
			if (!profile.name || !profile.configs || !Array.isArray(profile.configs)) {
				throw new Error('Invalid profile format');
			}

			// Generate new ID to avoid conflicts
			const newProfile: ConfigProfile = {
				...profile,
				id: this.generateId(),
				created: new Date().toISOString(),
				modified: new Date().toISOString()
			};

			this.storage.profiles.push(newProfile);
			this.saveStorage();
			return newProfile;
		} catch (error) {
			throw new Error(`Failed to import profile: ${error}`);
		}
	}

	public getActiveProfile(): ConfigProfile | undefined {
		if (!this.storage.activeProfile) {
			return undefined;
		}
		return this.getProfile(this.storage.activeProfile);
	}

	private generateId(): string {
		return `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	private getIconForProfile(tags?: string[]): string {
		if (!tags || tags.length === 0) {
			return 'symbol-misc';
		}

		const tagLower = tags[0].toLowerCase();
		if (tagLower.includes('work') || tagLower.includes('office')) {
			return 'briefcase';
		}
		if (tagLower.includes('personal') || tagLower.includes('home')) {
			return 'home';
		}
		if (tagLower.includes('opensource') || tagLower.includes('oss')) {
			return 'github';
		}
		if (tagLower.includes('client')) {
			return 'organization';
		}

		return 'symbol-misc';
	}
}

export interface ProfileComparison {
	toAdd: GitConfigItem[];
	toUpdate: Array<{
		key: string;
		scope: 'local' | 'global';
		oldValue: string;
		newValue: string;
	}>;
	toRemove: GitConfigItem[];
}

export class ProfileTreeProvider implements vscode.TreeDataProvider<ProfileTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ProfileTreeItem | undefined | null | void> = 
		new vscode.EventEmitter<ProfileTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<ProfileTreeItem | undefined | null | void> = 
		this._onDidChangeTreeData.event;

	constructor(private profileManager: ProfileManager) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ProfileTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: ProfileTreeItem): Thenable<ProfileTreeItem[]> {
		if (!element) {
			const profiles = this.profileManager.getAllProfiles();
			const activeProfile = this.profileManager.getActiveProfile();
			
			return Promise.resolve(
				profiles.map(profile => {
					const isActive = activeProfile?.id === profile.id;
					return new ProfileTreeItem(
						profile,
						isActive,
						vscode.TreeItemCollapsibleState.None
					);
				})
			);
		}
		return Promise.resolve([]);
	}
}

class ProfileTreeItem extends vscode.TreeItem {
	constructor(
		public readonly profile: ConfigProfile,
		public readonly isActive: boolean,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(profile.name, collapsibleState);

		this.tooltip = `${profile.description}\n${profile.configs.length} configurations`;
		this.description = isActive ? '● Active' : `${profile.configs.length} configs`;
		this.iconPath = new vscode.ThemeIcon(profile.icon || 'symbol-misc');
		this.contextValue = 'profile';
		
		// Add command to apply profile on click
		this.command = {
			command: 'reporig.applyProfile',
			title: 'Apply Profile',
			arguments: [profile.id]
		};
	}
}
