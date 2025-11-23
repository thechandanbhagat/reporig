# RepoRig

**Rig up your repository configurations with ease!**

RepoRig is a comprehensive VS Code extension that simplifies git configuration and hooks management directly within your workspace. Whether you're managing personal projects or enterprise repositories, RepoRig provides an intuitive interface to handle git settings, create powerful git hooks, and maintain consistent development workflows.

## Why RepoRig?

- **Centralized Management**: All git configurations and hooks in one place
- **Instant Access**: No more command line hunting for git settings
- **Configuration Profiles**: 🌟 **NEW!** Save and switch between different git configurations instantly
- **Change Tracking**: Keep track of configuration changes with timestamps
- **Hook Templates**: 20+ production-ready git hook examples
- **Visual Interface**: Beautiful, responsive UI that works with VS Code themes
- **Real-time Updates**: See changes immediately without reloading
- **Team Collaboration**: Share configuration profiles across teams

## Features

### 🎯 Configuration Profiles - NEW!
**The ultimate time-saver for developers working on multiple projects!**

- **Create Multiple Profiles**: Save different git configurations for Work, Personal, Open Source, Client projects
- **One-Click Switching**: Apply entire configuration sets instantly
- **Profile Templates**: Start with pre-configured profiles (Work, Personal, OSS, Client, Team Standard)
- **Smart Comparison**: Preview changes before applying a profile
- **Import/Export**: Share profiles with team members or across machines
- **Visual Management**: Dedicated sidebar view with profile status indicators
- **Current Config Capture**: Save your current settings as a new profile

**Use Cases:**
- 👔 **Work Profile**: Company email, GPG signing, specific line endings
- 🏠 **Personal Profile**: Private email, relaxed settings
- 🌐 **Open Source**: Public GitHub email, contribution settings
- 👥 **Client Profiles**: Different identities for different clients
- 🤝 **Team Standards**: Share standardized settings across your team

### Git Configuration Management
- **Smart Repository Detection**: Automatically detects git repositories in your workspace
- **Comprehensive Configuration View**: Display all local and global git configurations in an organized table
- **Intuitive Editing**: Edit configurations through a user-friendly interface with real-time validation
- **Change History Tracking**: Keep track of all configuration changes with timestamps in `.vscode/.reporig/`
- **Scope Management**: Easily distinguish between local (repository) and global (user) settings
- **Last Changed Accordion**: Quick access to your most recent configuration changes
- **Persistent Storage**: All configuration history stored locally for workspace-specific tracking

### Advanced Git Hooks Management
- **Complete Hook Overview**: View all standard git hooks with visual status indicators
- **Template-Based Creation**: Create hooks using 20+ production-ready templates
- **Inline Editing**: Edit hook scripts directly in the extension with syntax support
- **Full Lifecycle Management**: Create, edit, delete, and toggle hook execution
- **Extensive Template Library**: Pre-configured templates organized by hook type:
  - **Pre-commit**: ESLint checks, Prettier formatting, Unit tests, Security scans
  - **Commit-msg**: Conventional commits, Ticket validation, Message length checks
  - **Pre-push**: Branch protection, Integration tests, Security audits
  - **Post-commit**: Notifications, Auto documentation updates
  - **Server-side**: Pre-receive policies, Post-receive deployments
- **Hook-Type Filtering**: Templates automatically filtered by selected hook type
- **Inline Template Loading**: Load templates directly in the editor without scrolling
- **Dynamic Updates**: Templates update automatically when switching hook types

### Commands Available

#### Configuration Profile Commands 🌟
- `RepoRig: Create Configuration Profile` - Create a new profile from templates
- `RepoRig: Save Current Config as Profile` - Capture current settings as a profile
- `RepoRig: Apply Configuration Profile` - Switch to a different profile instantly
- `RepoRig: Compare Profile with Current` - Preview changes before applying
- `RepoRig: Export Profile` - Save profile as JSON file for sharing
- `RepoRig: Import Profile` - Load a profile from JSON file
- `RepoRig: Edit Profile` - Modify profile name and description
- `RepoRig: Delete Profile` - Remove a profile

#### Git Configuration Commands
- `RepoRig: Check Git Repository Status` - Verify if current workspace is a git repository
- `RepoRig: List Git Configurations` - Show all git configurations in a quick pick menu
- `RepoRig: Edit Git Configuration` - Modify git settings with guided input
- `RepoRig: Open Configuration Panel` - Show the git configuration tree view

#### Git Hooks Commands  
- `RepoRig: List Git Hooks` - View all git hooks in the hooks panel
- `RepoRig: Create Git Hook` - Create a new hook from templates or scratch

## Quick Start Guide

### 1. Installation
Install RepoRig from the VS Code Extensions Marketplace or run:
```bash
code --install-extension thechandanbhagat.reporig
```

### 2. Opening RepoRig
- **Command Palette**: Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
- **Type**: "RepoRig" to see all available commands
- **Main Panel**: Use `RepoRig: Open Configuration Panel` to access the main interface

### 3. Managing Git Configurations
1. Open the RepoRig main panel
2. Navigate to the "Git Configurations" tab
3. View all your local and global git settings
4. Click "Add New Configuration" to add settings
5. Use the "Edit" button to modify existing configurations
6. Check the "Last Configuration Change" accordion for recent modifications

### 4. Working with Configuration Profiles 🌟
**The fastest way to manage multiple identities!**

1. Open the Source Control view in VS Code
2. Find the "Configuration Profiles" panel
3. Click the **+** icon to create a new profile
4. Choose from templates: Work, Personal, Open Source, Client, or Team Standard
5. Customize the configurations if needed
6. Click on any profile to apply it instantly

**Or save your current setup:**
1. Configure your git settings as desired
2. Run command: `RepoRig: Save Current Config as Profile`
3. Give it a name (e.g., "Client A Settings")
4. Your current configuration is now saved!

### 5. Working with Git Hooks
1. Switch to the "Git Hooks" tab in RepoRig
2. Click "Create New Hook" to start
3. Select your hook type (pre-commit, commit-msg, etc.)
4. Click "Load Templates" for pre-built examples
5. Choose a template or write your own script
6. Save and test your hook

## Usage Examples

### 🔄 Switching Between Work and Personal Projects
```bash
# Working on company project - apply work profile:
1. Open Source Control view
2. Go to "Configuration Profiles" panel
3. Click on "Work Profile"
4. ✅ Automatically sets company email, GPG signing, and work settings

# Later, switching to personal project:
1. Click on "Personal Profile"
2. ✅ Your personal email and settings are applied instantly!

# No more manual git config commands! 🎉
```

### 💾 Saving and Sharing Team Standards
```bash
# Save your team's standard configuration:
1. Configure git settings as per team standards
2. Command Palette → "RepoRig: Save Current Config as Profile"
3. Name it "Team Standard"
4. Command Palette → "RepoRig: Export Profile"
5. Share the .reporig.json file with team members

# Team members import it:
1. Command Palette → "RepoRig: Import Profile"
2. Select the shared .reporig.json file
3. ✅ Everyone has identical settings!
```

### Setting Up a Pre-commit Hook
```bash
# 1. Open RepoRig panel
# 2. Go to Git Hooks tab
# 3. Click "Create New Hook"
# 4. Select "pre-commit"
# 5. Click "Load Templates"
# 6. Choose "ESLint Code Quality Check"
# 7. Customize if needed and save
```

### Managing User Configuration
```bash
# Set global username through RepoRig:
# 1. Open Git Configurations tab
# 2. Click "Add New Configuration"
# 3. Key: user.name
# 4. Value: Your Name
# 5. Scope: Global
# 6. Click Save
```

### Source Control Panels

When a git repository is detected, RepoRig adds two panels to the Source Control view:

#### Git Configuration Panel
- Local repository configurations
- Global git configurations  
- Easy-to-read key-value pairs with scope indicators

#### Git Hooks Panel
- All git hooks with visual status indicators:
  - **Active**: Hook exists and is executable
  - **Inactive**: Hook exists but is not executable
  - **Not configured**: Hook doesn't exist
- Right-click context menus for quick actions
- Inline buttons for edit, toggle, and delete operations

## Requirements

- Visual Studio Code 1.104.0 or higher
- Git installed and available in your system PATH
- A workspace with a git repository (for full functionality)

## Extension Settings

This extension doesn't add any VS Code settings currently. All configuration is handled through git's native configuration system.

## Comprehensive Hook Templates Library

RepoRig includes 20+ production-ready git hook templates organized by hook type:

### Pre-commit Hooks
- **ESLint Code Quality Check**: Validates JavaScript/TypeScript code before commits
- **Prettier Code Formatting**: Automatically formats staged files with Prettier
- **Unit Tests Check**: Runs test suite before allowing commits
- **Security Scan**: Checks for hardcoded secrets and credentials

### Commit Message Hooks  
- **Conventional Commits**: Enforces conventional commit message format
- **Ticket Number Validation**: Ensures commit messages include ticket/issue numbers
- **Message Length Check**: Validates commit message length requirements

### Pre-push Hooks
- **Branch Protection**: Prevents direct pushes to protected branches (main/master)
- **Integration Tests**: Runs comprehensive test suite before pushing
- **Security Audit**: Performs security vulnerability scans before push

### Post-commit Hooks
- **Notification System**: Sends notifications after successful commits
- **Auto Documentation**: Updates documentation based on code changes

### Server-side Hooks
- **Branch Policy Enforcement**: Server-side branch naming and protection policies
- **Commit Size Limits**: Prevents oversized commits and files
- **Deployment Triggers**: Automatically triggers deployments after pushes
- **Backup Creation**: Creates automated backups after receiving commits

Each template includes:
- **Detailed Comments**: Explanation of what the hook does
- **Error Handling**: Proper exit codes and user feedback
- **Customization Points**: Clear areas for project-specific modifications
- **Best Practices**: Following git hooks conventions and security guidelines

## Technical Details

### Configuration History Tracking
RepoRig automatically tracks all configuration changes in `.vscode/.reporig/config-history.json`:
```json
{
  "key": "user.name",
  "value": "John Doe",
  "scope": "local", 
  "action": "updated",
  "timestamp": "2025-09-30T...",
  "date": "9/30/2025",
  "time": "2:45:30 PM"
}
```

### Hook Template System
- Templates stored in JSON format for easy extensibility
- Automatic filtering based on selected hook type
- Inline loading system for improved UX
- Support for multiple examples per hook type

## Configuration

### Extension Settings
This extension contributes the following settings:

- **Automatic Detection**: Git repositories are detected automatically on workspace load
- **History Limit**: Configuration history is limited to 50 entries per workspace
- **Template Updates**: Hook templates are loaded dynamically from the extension

## Known Issues & Limitations

- **System Configurations**: System-level git configurations not yet supported
- **Large Repositories**: Performance may be impacted in very large repositories
- **Hook Languages**: Templates currently limited to shell scripts (Python, Node.js support planned)
- **Network Hooks**: Remote git hooks not supported in current version

## Release Notes

### 1.0.0 (Current)
**Major Release - Full Git Management Suite**

#### New Features:
- Complete git configuration management with change tracking
- Comprehensive git hooks system with 20+ templates  
- Configuration history with timestamps and accordion view
- Hook-type specific template filtering
- Inline template loading for improved UX
- Professional dark theme UI matching VS Code
- Tabbed interface for configurations and hooks
- Real-time updates and change notifications

#### Technical Improvements:
- TypeScript-based architecture for reliability
- Webpack bundling for optimal performance
- Responsive webview design
- Persistent workspace-specific storage
- Input validation and error handling

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup
1. **Clone the repository**:
   ```bash
   git clone https://github.com/thechandanbhagat/reporig.git
   cd reporig
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Launch development environment**:
   ```bash
   # Open in VS Code
   code .
   
   # Press F5 to launch Extension Development Host
   # Test your changes in the new window
   ```

### Building the Extension
```bash
# Compile TypeScript
npm run compile

# Package for distribution
npm run package

# Create VSIX file
vsce package
```

### Contribution Guidelines
- **Testing**: Ensure all features work in both git and non-git workspaces
- **Documentation**: Update README.md for new features
- **UI/UX**: Maintain consistency with VS Code design principles
- **Security**: Validate all user inputs and git commands
- **Accessibility**: Ensure features work with screen readers and keyboard navigation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2025 Chandan Bhagat

## Support

If you encounter any issues or have suggestions, please visit our [GitHub repository](https://github.com/thechandanbhagat/reporig).

---

**Happy Git Configuration Management!**
