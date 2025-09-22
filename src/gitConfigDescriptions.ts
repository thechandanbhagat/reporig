export const gitConfigDescriptions: { [key: string]: string } = {
    // User identity
    'user.name': 'Your name for commit attribution',
    'user.email': 'Your email address for commit attribution',
    'user.signingkey': 'GPG key ID for signing commits',
    
    // Core settings
    'core.editor': 'Default text editor for git commands',
    'core.autocrlf': 'Automatic line ending conversion (true/false/input)',
    'core.safecrlf': 'Warn about mixed line endings (true/false/warn)',
    'core.filemode': 'Track executable bit changes in file permissions',
    'core.ignorecase': 'Ignore case in file names (true/false)',
    'core.precomposeunicode': 'Normalize unicode file names',
    'core.quotepath': 'Quote paths with non-ASCII characters',
    'core.bare': 'Repository is bare (no working directory)',
    'core.worktree': 'Path to the working tree',
    'core.logallrefupdates': 'Log all reference updates',
    'core.repositoryformatversion': 'Repository format version',
    'core.symlinks': 'Support symbolic links',
    'core.compression': 'Compression level for pack files (0-9)',
    'core.deltabasecachelimit': 'Memory limit for delta base cache',
    
    // Branch and merging
    'init.defaultbranch': 'Default branch name for new repositories',
    'branch.autosetupmerge': 'Automatically setup merge tracking',
    'branch.autosetuprebase': 'Automatically setup rebase tracking',
    'merge.tool': 'Default merge tool',
    'merge.conflictstyle': 'Conflict marker style (merge/diff3)',
    'merge.ff': 'Fast-forward merge behavior (true/false/only)',
    'merge.log': 'Include merge commit summaries in merge messages',
    
    // Pull and push
    'pull.rebase': 'Use rebase instead of merge for pulls (true/false/preserve)',
    'push.default': 'Default push behavior (simple/matching/upstream/current)',
    'push.followtags': 'Automatically push tags with commits',
    'push.autosetupremote': 'Automatically setup remote tracking',
    
    // Remote settings
    'remote.origin.url': 'URL of the origin remote repository',
    'remote.origin.fetch': 'Fetch refspec for origin remote',
    'remote.origin.push': 'Push refspec for origin remote',
    'remote.pushdefault': 'Default remote for pushing',
    
    // Diff and log
    'diff.tool': 'Default diff tool',
    'diff.algorithm': 'Diff algorithm (myers/minimal/patience/histogram)',
    'diff.renames': 'Detect renames in diffs (true/false/copies)',
    'log.date': 'Default date format for log (relative/local/iso/rfc/short/raw)',
    'log.decorate': 'Show branch and tag names in log',
    
    // Commit settings
    'commit.template': 'Path to commit message template file',
    'commit.cleanup': 'Cleanup mode for commit messages (strip/whitespace/verbatim/scissors/default)',
    'commit.gpgsign': 'Sign commits with GPG (true/false)',
    
    // Color settings
    'color.ui': 'Enable colored output (true/false/auto)',
    'color.branch': 'Color branch output',
    'color.diff': 'Color diff output',
    'color.status': 'Color status output',
    'color.interactive': 'Color interactive prompts',
    
    // Aliases (common ones)
    'alias.st': 'Alias for status command',
    'alias.co': 'Alias for checkout command',
    'alias.br': 'Alias for branch command',
    'alias.ci': 'Alias for commit command',
    'alias.unstage': 'Alias to unstage files',
    'alias.last': 'Alias to show last commit',
    'alias.visual': 'Alias for gitk',
    
    // Credential and security
    'credential.helper': 'Credential storage helper',
    'credential.username': 'Default username for authentication',
    'http.sslverify': 'Verify SSL certificates for HTTPS',
    'http.proxy': 'HTTP proxy server',
    'https.proxy': 'HTTPS proxy server',
    
    // Submodules
    'submodule.recurse': 'Recursively operate on submodules',
    'status.submodulesummary': 'Show submodule summary in status',
    
    // Rebase and cherry-pick
    'rebase.autostash': 'Automatically stash before rebase',
    'rebase.autosquash': 'Automatically squash commits during rebase',
    'rebase.stat': 'Show diffstat after rebase',
    
    // Stash
    'stash.usebuiltin': 'Use built-in stash implementation',
    'stash.showpatch': 'Show patch when listing stashes',
    
    // Git LFS
    'lfs.url': 'Git LFS server URL',
    'lfs.batch': 'Enable batch API for LFS',
    
    // Hooks
    'hooks.allowunannotated': 'Allow unannotated tags in hooks',
    'hooks.allowdeletetag': 'Allow tag deletion in hooks',
    'hooks.allowdeletebranch': 'Allow branch deletion in hooks',
    
    // Performance
    'gc.auto': 'Automatic garbage collection threshold',
    'gc.autopacklimit': 'Pack file limit for auto gc',
    'pack.threads': 'Number of threads for packing',
    'pack.deltacachesize': 'Delta cache size for packing',
    
    // Web interface
    'web.browser': 'Default web browser for git web',
    'instaweb.httpd': 'HTTP daemon for git instaweb',
    'instaweb.local': 'Bind instaweb to localhost only',
    'instaweb.modulepath': 'Module path for instaweb',
    'instaweb.port': 'Port for git instaweb'
};

export function getGitConfigDescription(key: string): string {
    return gitConfigDescriptions[key] || 'Git configuration option';
}