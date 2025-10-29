import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type MdEntry = {
	uri: vscode.Uri;
	filename: string;
	relativePath: string;  // relative to workspace folder
	absFsPath: string;     // absolute filesystem path
	workspaceFolder?: vscode.WorkspaceFolder;
};

let mdIndex: MdEntry[] = [];
let mdWatcher: vscode.FileSystemWatcher | undefined;
let codeIndex: MdEntry[] = [];
let codeWatcher: vscode.FileSystemWatcher | undefined;

function getCodeExtensions(): string[] {
	const config = vscode.workspace.getConfiguration('ctx-tool');
	const extensions = config.get<string[]>('codeExtensions', ['ts', 'tsx', 'js', 'jsx']);
	// Normalize: strip leading dots, lowercase, remove duplicates
	return [...new Set(extensions.map(ext => ext.replace(/^\./, '').toLowerCase()))].filter(ext => ext.length > 0);
}

function buildCodeGlob(): string {
	const exts = getCodeExtensions();
	if (exts.length === 0) {
		return ''; // No code files to watch
	}
	if (exts.length === 1) {
		return `**/*.${exts[0]}`;
	}
	return `**/*.{${exts.join(',')}}`;
}

// Toggle: keep true while debugging so you always see a "Test" suggestion.

export async function activate(context: vscode.ExtensionContext) {
	// 1) Build initial indexes
	await refreshIndex();
	await refreshCodeIndex();

	// 2) Watch for markdown file changes
	mdWatcher = vscode.workspace.createFileSystemWatcher('**/*.md');
	context.subscriptions.push(mdWatcher);

	mdWatcher.onDidCreate(async (uri) => addToIndex(uri));
	mdWatcher.onDidDelete((uri) => removeFromIndex(uri));
	mdWatcher.onDidChange(async (uri) => {
		// re-add on change to be robust to renames happening via save-as etc.
		await removeFromIndex(uri);
		await addToIndex(uri);
	});

	// 2b) Watch for code file changes
	setupCodeWatcher(context);

	// 2c) Listen for configuration changes
	const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
		if (e.affectsConfiguration('ctx-tool.codeExtensions')) {
			// Dispose old watcher
			codeWatcher?.dispose();
			// Rebuild index with new extensions
			await refreshCodeIndex();
			// Recreate watcher with new glob
			setupCodeWatcher(context);
		}
	});
	context.subscriptions.push(configListener);

	// 3) Completion provider for Markdown
	const selector: vscode.DocumentSelector = [
		{ language: 'markdown', scheme: 'file' },
		{ language: 'markdown', scheme: 'untitled' }
	];

	const provider = vscode.languages.registerCompletionItemProvider(
		selector,
		{
			provideCompletionItems(document, position) {
				const lineText = document.lineAt(position.line).text;
				const beforeCursor = lineText.slice(0, position.character);

				// Find the last '@' before the cursor (handle '!@' too)
				const atIdx = beforeCursor.lastIndexOf('@');
				if (atIdx === -1) { return; }

				// Include a preceding '!' if present
				const includeBang = atIdx > 0 && beforeCursor[atIdx - 1] === '!';
				const startCol = includeBang ? atIdx - 1 : atIdx;

				// Typed span (for filtering/replacement), allow word-ish chars, slashes, dots, spaces, # and {
				const span = beforeCursor.slice(startCol);
				if (!/^!?@[\w\-_. \/\\#\{\}]*$/.test(span)) {
					return;
				}

				// Replacement range = from start of '!@' or '@' to cursor
				const replaceRange = new vscode.Range(
					new vscode.Position(position.line, startCol),
					position
				);

				// Determine mode based on first char after '@'
				const afterAtIdx = atIdx + 1;
				const modeChar = beforeCursor[afterAtIdx] || '';
				// Modes: default = all; '#' -> md only; '{' -> code only
				let mode: 'all' | 'md' | 'code' = 'all';
				if (modeChar === '#') {
					mode = 'md';
				} else if (modeChar === '{') {
					mode = 'code';
				}

				// Prepare the filter: strip '!@' or '@'
				let typedFilter = span.replace(/^!@|^@/, '');
				// If we used a mode char, strip it from the filter
				if (modeChar === '#' || modeChar === '{') {
					typedFilter = typedFilter.slice(1);
				}
				const typedLower = typedFilter.toLowerCase().trim();

				const items: vscode.CompletionItem[] = [];

				// Choose pools based on mode
				const pools: MdEntry[][] = [];
				if (mode === 'all' || mode === 'md') {
					pools.push(mdIndex);
				}
				if (mode === 'all' || mode === 'code') {
					pools.push(codeIndex);
				}

				for (const pool of pools) {
					const candidates = pool.filter(e => {
						if (!typedLower) { return true; }
						return e.filename.toLowerCase().includes(typedLower)
							|| e.relativePath.toLowerCase().includes(typedLower);
					});

					for (const e of candidates) {
						const it = new vscode.CompletionItem(e.filename, vscode.CompletionItemKind.File);
						it.detail = e.relativePath;                                // show relative path
						it.filterText = `${span} ${e.filename} ${e.relativePath}`; // so it won't get filtered out
						it.sortText = `${mode === 'md' ? 'a' : mode === 'code' ? 'b' : 'c'}_${e.filename}`;
						// Insert a link RELATIVE TO THE CURRENT DOCUMENT
						it.textEdit = vscode.TextEdit.replace(
							replaceRange,
							buildMarkdownLinkRelativeToDoc(e.filename, e.uri, document.uri, includeBang)
						);
						items.push(it);
					}
				}

				return items;
			}
		},
		'@' // trigger character
	);
	context.subscriptions.push(provider);

	// 4) Commands: ctx prompt/save
	const cmdPrompt = vscode.commands.registerCommand('ctx-tool.ctxPrompt', () => {
		runCtxOnActiveMarkdown('prompt');
	});
	const cmdSave = vscode.commands.registerCommand('ctx-tool.ctxSave', () => {
		runCtxOnActiveMarkdown('save');
	});
	const cmdConfigure = vscode.commands.registerCommand('ctx-tool.configureMarkdownSettings', configureMarkdownSettings);
	context.subscriptions.push(cmdPrompt, cmdSave, cmdConfigure);
}

export function deactivate() {
	mdWatcher?.dispose();
	codeWatcher?.dispose();
}

/* ------------------ Helpers ------------------ */

async function refreshIndex() {
	const uris = await vscode.workspace.findFiles('**/*.md');
	mdIndex = [];
	for (const uri of uris) {
		await addToIndex(uri);
	}
}

async function addToIndex(uri: vscode.Uri) {
	// Avoid dupes
	removeFromIndex(uri);

	const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
	const filename = basename(uri.fsPath);
	const absFsPath = uri.fsPath;

	let relativePath = filename;
	if (wsFolder) {
		const base = wsFolder.uri.fsPath.replace(/[/\\]+$/, '');
		const full = uri.fsPath;
		const rel = full.startsWith(base) ? full.slice(base.length + 1) : filename;
		relativePath = toPosix(rel);
	}

	mdIndex.push({
		uri,
		filename,
		relativePath,
		absFsPath,
		workspaceFolder: wsFolder
	});
}

function removeFromIndex(uri: vscode.Uri) {
	mdIndex = mdIndex.filter(e => e.uri.toString() !== uri.toString());
}

function setupCodeWatcher(context: vscode.ExtensionContext) {
	const glob = buildCodeGlob();
	if (!glob) {
		// No code extensions configured, skip watcher
		codeWatcher = undefined;
		return;
	}

	codeWatcher = vscode.workspace.createFileSystemWatcher(glob);
	context.subscriptions.push(codeWatcher);

	codeWatcher.onDidCreate(async (uri) => addCodeToIndex(uri));
	codeWatcher.onDidDelete((uri) => removeCodeFromIndex(uri));
	codeWatcher.onDidChange(async (uri) => {
		await removeCodeFromIndex(uri);
		await addCodeToIndex(uri);
	});
}

async function refreshCodeIndex() {
	const glob = buildCodeGlob();
	if (!glob) {
		codeIndex = [];
		return;
	}

	const uris = await vscode.workspace.findFiles(glob);
	codeIndex = [];
	for (const uri of uris) {
		await addCodeToIndex(uri);
	}
}

async function addCodeToIndex(uri: vscode.Uri) {
	// Avoid dupes
	removeCodeFromIndex(uri);

	const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
	const filename = basename(uri.fsPath);
	const absFsPath = uri.fsPath;

	let relativePath = filename;
	if (wsFolder) {
		const base = wsFolder.uri.fsPath.replace(/[/\\]+$/, '');
		const full = uri.fsPath;
		const rel = full.startsWith(base) ? full.slice(base.length + 1) : filename;
		relativePath = toPosix(rel);
	}

	codeIndex.push({
		uri,
		filename,
		relativePath,
		absFsPath,
		workspaceFolder: wsFolder
	});
}

function removeCodeFromIndex(uri: vscode.Uri) {
	codeIndex = codeIndex.filter(e => e.uri.toString() !== uri.toString());
}

function basename(p: string): string {
	return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p;
}

function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}

function stripMdExt(name: string): string {
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

function buildMarkdownLinkRelativeToDoc(
	filename: string,
	targetUri: vscode.Uri,
	fromDocUri: vscode.Uri,
	prefixBang = false
): string {
	// Visible text, with optional leading '!' for image-style markdown
	const display = `${prefixBang ? '!' : ''}[@${stripMdExt(filename)}]`;

	// If current doc isn't saved to disk yet, fall back to workspace-relative
	let rel: string;
	if (fromDocUri.scheme === 'file') {
		const fromDir = path.dirname(fromDocUri.fsPath);
		rel = path.relative(fromDir, targetUri.fsPath);
	} else {
		// Unsaved/untitled buffer → best effort: workspace-relative
		rel = vscode.workspace.asRelativePath(targetUri);
	}

	// Normalize to POSIX separators for Markdown and wrap in <> for spaces/specials
	rel = rel.replace(/\\/g, '/');
	const url = `${rel}`;

	return `${display}(${url})\n\n`;
}

function runCtxOnActiveMarkdown(subcommand: 'prompt' | 'save') {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('No active editor.');
		return;
	}
	const doc = editor.document;
	if (doc.languageId !== 'markdown') {
		vscode.window.showWarningMessage('Active file is not Markdown.');
		return;
	}

	// Workspace folder (useful for cwd and resolving ./ctx)
	const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
	const cwd = wsFolder?.uri.fsPath;

	// Prefer reusing the active terminal so we don't spawn a new one each time.
	let term = vscode.window.activeTerminal;
	if (!term) {
		term = vscode.window.createTerminal({ name: 'ctx', cwd });
	} else if (cwd) {
		// If we reuse an existing terminal, change to the workspace folder so relative ./ctx works.
		// This is conservative: we only send a cd if we know the intended cwd.
		term.sendText(`cd "${cwd}"`, true);
	}

	// Use a path relative to the workspace/cwd so the extension keeps using relative paths.
	const absPath = doc.uri.fsPath;
	const relPath = cwd ? path.relative(cwd, absPath) : vscode.workspace.asRelativePath(doc.uri);
	const cmd = `./ctx ${subcommand} ${relPath}`;

	term.sendText(cmd, true);
	term.show(true);
}

async function configureMarkdownSettings() {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}

	const settingsPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'settings.json');

	// Define the markdown settings
	const markdownSettings = {
		'editor.quickSuggestions': {
			"comments": "on",
			"strings": "on",
			"other": "on"
		},
		'editor.suggestOnTriggerCharacters': true,
		'editor.quickSuggestionsDelay': 50,
		'editor.wordBasedSuggestions': "off",
		'editor.inlineSuggest.enabled': false,
		'editor.snippetSuggestions': 'none',
		'editor.suggest.showWords': false,
		'editor.suggest.showSnippets': false,
		'editor.suggest.showClasses': false,
		'editor.suggest.showColors': false,
		'editor.suggest.showConstructors': false,
		'editor.suggest.showConstants': false,
		'editor.suggest.showCustomcolors': false,
		'editor.suggest.showEnums': false,
		'editor.suggest.showEnumMembers': false,
		'editor.suggest.showEvents': false,
		'editor.suggest.showFields': false,
		'editor.suggest.showFiles': true,
		'editor.suggest.showFolders': false,
		'editor.suggest.showFunctions': false,
		'editor.suggest.showInterfaces': false,
		'editor.suggest.showIssues': false,
		'editor.suggest.showKeywords': false,
		'editor.suggest.showMethods': false,
		'editor.suggest.showModules': false,
		'editor.suggest.showOperators': false,
		'editor.suggest.showProperties': false,
		'editor.suggest.showReferences': false,
		'editor.suggest.showStructs': false,
		'editor.suggest.showTypeParameters': false,
		'editor.suggest.showUnits': false,
		'editor.suggest.showUsers': false,
		'editor.suggest.showValues': false
	};

	try {
		// Read existing settings
		let settingsJson: any = {};
		try {
			const settingsContent = await vscode.workspace.fs.readFile(vscode.Uri.file(settingsPath));
			settingsJson = JSON.parse(settingsContent.toString());
		} catch {
			// File doesn't exist or is invalid, start with empty object
		}

		// Ensure .vscode directory exists
		const vscodeDir = path.dirname(settingsPath);
		try {
			await vscode.workspace.fs.readDirectory(vscode.Uri.file(vscodeDir));
		} catch {
			// Directory doesn't exist, create it
			fs.mkdirSync(vscodeDir, { recursive: true });
		}

		// Merge markdown settings into existing settings
		if (!settingsJson['[markdown]']) {
			settingsJson['[markdown]'] = {};
		}
		Object.assign(settingsJson['[markdown]'], markdownSettings);

		// Write settings back
		fs.writeFileSync(settingsPath, JSON.stringify(settingsJson, null, '\t'), 'utf8');

		vscode.window.showInformationMessage('Markdown settings configured for ctx-tool!');
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to configure settings: ${error}`);
	}
}
