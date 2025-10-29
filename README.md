# ctx-tool

Lightweight VS Code extension to **link files (Markdown and code) by typing `@` / `!@`** and to **run a `ctx` CLI** on the active Markdown file.

---

## Inspiration
Born from MIT **6.1040 Software Design**, where students work extensively with Markdown files and a custom LLM coding tool called [`context`](https://github.com/61040-fa25/concept_backend) to manage coding workflows and knowledge.

6.1040 centers on **concept-based development** (see [Learning Concepts for Software Design](https://arxiv.org/pdf/2508.14511)), focusing on decomposing software into modular, reusable units—*concepts*—to improve LLM-based workflow. The course workflow requires constantly linking Markdown files and running the `ctx` CLI tool to feed in the context to the LLM, which involves tedious manual copying of relative paths and shelling out to commands—this extension minimizes that friction.

<img src="assets/inspiration.png" alt="A very relatable text: 'I hate markdown linking because I never remember the syntax lol — so I always have to ask chat'" width="600"/>

> No more asking chat—just @ and insert.

## Features

* **`@` & `!@` link completions (Markdown and Code files)**

  * Type `@` to see all workspace files (Markdown + code); use mode characters to narrow the search:
    * `@` → Shows all files (Markdown + code)
    * `@#` → Shows only Markdown files (think `#` for headings)
    * `@{` → Shows only code files (think `{` for code blocks)
  * Type `!@` for image-style links (works with all modes: `!@`, `!@#`, `!@{`)
  * Keep typing to filter by filename or path
  * Inserts a **relative** link from the current document:

    * `@` → `[@filename](path/to/file.md)`
    * `!@` → `![@filename](path/to/file.md)` (image-style)
  
  > **Auto-configured:** Optimal markdown editor settings are applied automatically. No configuration needed!
  
  > **Default code extensions:** By default, TypeScript and JavaScript files (`.ts`, `.tsx`, `.js`, `.jsx`) are indexed. You can customize this via `ctx-tool.codeExtensions` in your settings (see Configuration below).

<img src="assets/demo-autocomplete.gif" alt="Demo: autocomplete linking with `@`" width="600"/>


* **Commands**

  * **Ctx: Prompt current Markdown** → `./ctx prompt "<abs/path/to/current.md>"`
  * **Ctx: Save current Markdown** → `./ctx save "<abs/path/to/current.md>"`
  * Runs in the integrated terminal, with `cwd` set to the file’s workspace folder (multi-root friendly).

<img src="assets/demo-command.gif" alt="Demo: command running" width="600"/>

---

## Installation (dev)

1. Open the project in VS Code
2. `yarn` (or `npm install`)
3. `yarn watch` (or `npm run watch`)
4. Edit the second item in the `"args"` array of `.vscode/launch.json` to point to the folder you want to test.
5. Press **F5** to launch the Extension Development Host

> When publishing, add your `"publisher"` to `package.json`.

---

## Activation

* Opens on Markdown files (`onLanguage:markdown`), on **Ctx** commands, or when the workspace contains `**/*.md`.

---

## Usage

**Linking**

1. Open a `.md` file
2. Type `@` to see all files, `@#` for Markdown only, or `@{` for code only
3. (Optional) Type `!@` instead of `@` for image-style links
4. Keep typing to filter by filename or path
5. Pick a file → a relative link is inserted

**Running `ctx`**

* Command Palette (`cmd + shift + P`) → run **"Ctx: Prompt current Markdown"** or **"Ctx: Save current Markdown."**

---

## Configuration

### Code File Extensions

You can configure which file extensions are indexed as "code files" using the `ctx-tool.codeExtensions` setting.

**Default extensions:** `["ts", "tsx", "js", "jsx"]`

**Important:** The setting **completely overwrites** the default list (it does not add to it). If you want to include additional extensions while keeping the defaults, you must specify the full list.

**Example:** To add Python support while keeping TypeScript/JavaScript support:

```json
{
  "ctx-tool.codeExtensions": ["ts", "tsx", "js", "jsx", "py"]
}
```

**Workspace-specific:** Add this to `.vscode/settings.json` in your workspace for project-specific configuration.

**Note:** Changes to this setting take effect immediately—the extension will automatically rebuild the index and update the file watcher.

---

## Troubleshooting: Markdown suggestions not appearing?

The extension provides optimal Markdown editor settings automatically. If the `@` autocomplete isn't working, try the following:

### Quick Fix
Run **"Ctx: Configure Markdown Settings"** from the Command Palette to apply workspace tings.

### Manual Configuration
If the automatic defaults are overridden by your settings, add these to your workspace **Settings (JSON)**:

```json
"[markdown]": {
  "editor.quickSuggestions": true,
  "editor.suggestOnTriggerCharacters": true,
  "editor.quickSuggestionsDelay": 50,

  "editor.wordBasedSuggestions": false,
  "editor.inlineSuggest.enabled": false,
  "editor.snippetSuggestions": "none",

  "editor.suggest.showWords": false,
  "editor.suggest.showSnippets": false,
  "editor.suggest.showClasses": false,
  "editor.suggest.showColors": false,
  "editor.suggest.showConstructors": false,
  "editor.suggest.showConstants": false,
  "editor.suggest.showCustomcolors": false,
  "editor.suggest.showEnums": false,
  "editor.suggest.showEnumMembers": false,
  "editor.suggest.showEvents": false,
  "editor.suggest.showFields": false,
  "editor.suggest.showFiles": true,
  "editor.suggest.showFolders": false,
  "editor.suggest.showFunctions": false,
  "editor.suggest.showInterfaces": false,
  "editor.suggest.showIssues": false,
  "editor.suggest.showKeywords": false,
  "editor.suggest.showMethods": false,
  "editor.suggest.showModules": false,
  "editor.suggest.showOperators": false,
  "editor.suggest.showProperties": false,
  "editor.suggest.showReferences": false,
  "editor.suggest.showStructs": false,
  "editor.suggest.showTypeParameters": false,
  "editor.suggest.showUnits": false,
  "editor.suggest.showUsers": false,
  "editor.suggest.showValues": false
}
```

> **Important:** The minimum required setting is `"editor.quickSuggestions": true`. However, this alone will show many irrelevant suggestions. The settings above keep suggestions focused on file names only.


**macOS tip:** if Ctrl+Space triggers macOS input switching, use **Edit → Trigger Suggest** or rebind “Trigger Suggest” in VS Code.

---

## Commands (from `package.json`)

* `ctx-tool.ctxPrompt` — Ctx: Prompt current Markdown
* `ctx-tool.ctxSave` — Ctx: Save current Markdown
* `ctx-tool.configureMarkdownSettings` — Ctx: Configure Markdown Settings

---

## Notes

* Link paths are computed **relative to the current document** (portable if you move folders together).
* In unsaved Markdown buffers, the extension falls back to a workspace-relative path for suggestions.
