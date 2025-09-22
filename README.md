# RepoRig 🔧

**Rig up your repository configurations with ease!**

RepoRig is a VS Code extension that helps you manage git configurations directly within your workspace. Detect git repositories, list configurations, and edit settings without leaving your editor.

## Features

- **🔍 Git Repository Detection**: Automatically detects if your workspace contains a git repository
- **📋 Configuration Listing**: View all local and global git configurations in an organized tree view
- **✏️ Easy Editing**: Edit git configurations through intuitive UI with validation
- **🎯 Workspace-Focused**: Manage repository-specific settings efficiently
- **⚡ Command Palette Integration**: Quick access to all RepoRig commands

### Commands Available

- `RepoRig: Check Git Repository Status` - Verify if current workspace is a git repository
- `RepoRig: List Git Configurations` - Show all git configurations in a quick pick menu
- `RepoRig: Edit Git Configuration` - Modify git settings with guided input
- `RepoRig: Open Configuration Panel` - Show the git configuration tree view

## Usage

1. Open a workspace that contains a git repository
2. Use `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS) to open the command palette
3. Type "RepoRig" to see available commands
4. Or use the Git Configuration panel in the Source Control view

### Git Configuration Panel

The extension adds a "Git Configuration" panel to the Source Control view when a git repository is detected. This panel shows:
- Local repository configurations
- Global git configurations
- Easy-to-read key-value pairs with scope indicators

## Requirements

- Visual Studio Code 1.104.0 or higher
- Git installed and available in your system PATH
- A workspace with a git repository (for full functionality)

## Extension Settings

This extension doesn't add any VS Code settings currently. All configuration is handled through git's native configuration system.

## Known Issues

- System-level git configurations are not yet displayed (coming in future version)
- Large configuration lists might not be paginated

## Release Notes

### 0.0.1

Initial release of RepoRig with core functionality:
- Git repository detection
- Local and global configuration listing
- Configuration editing with validation
- Tree view integration

---

## Development

To set up the development environment:

1. Clone this repository
2. Run `npm install`
3. Press F5 to launch a new Extension Development Host window
4. Test the extension in the new window

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

**Enjoy rigging up your repositories! 🔧**EADME

This is the README for your extension "reporig". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
