# Change Log

All notable changes to the "reporig" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- **Git Hooks Management**: Comprehensive git hooks management functionality
  - View all git hooks with status indicators (active/inactive/not configured)
  - Create new hooks using built-in templates or from scratch
  - Edit hooks with syntax highlighting and auto-save functionality
  - Delete, enable, or disable hooks with one-click actions
  - Built-in hook templates for common use cases:
    - Pre-commit linting and formatting
    - Commit message validation (conventional commits)
    - Pre-push testing
    - Security checks for hardcoded secrets
    - Post-commit notifications
- Git Hooks panel in Source Control view
- Hook management commands in command palette
- Right-click context menus for hook operations

## [0.0.1]

### Added
- Git repository detection
- Git configuration management (local and global)
- Configuration editing with validation
- Tree view for git configurations
- Command palette integration