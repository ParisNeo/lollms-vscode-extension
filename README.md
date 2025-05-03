# LOLLMS Copilot (Alpha)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Visual Studio Marketplace Version (Pre-Release)](https://img.shields.io/badge/Marketplace-coming_soon-orange.svg)](https://marketplace.visualstudio.com/) <!-- Replace with actual link once published -->
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-^1.80.0-blue.svg)](https://code.visualstudio.com/updates)
[![Built with TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-blue.svg)](https://www.typescriptlang.org/)

**Publisher:** ParisNeo

**Warning:** This extension is currently in **Alpha**. Expect potential bugs, breaking changes, and evolving features.

**Integrates your self-hosted [lollms-server](https://github.com/ParisNeo/lollms_server) instance directly into VS Code for AI-powered code generation, code modification with context, and automated Git commit message suggestions.**

Bring the power of your personalized LOLLMS setup into your development environment. This extension acts as a bridge to your `lollms-server`, enabling features designed to enhance coding speed and consistency.

## Features

*   **🧠 AI-Powered Commit Messages:** Generate descriptive Git commit messages based on your staged changes with a single click in the Source Control view. Uses your configured `lollms-server`.
*   **✍️ Inline Code Generation:** Write a comment or docstring describing the code you need, then use a command or keybinding to have LOLLMS generate the implementation directly below it, respecting indentation.
*   **🔍 Context-Aware Generation/Modification:** Manage a set of context files using the dedicated LOLLMS view. Then, instruct LOLLMS to perform tasks like refactoring, adding features, explaining code, or generating new code based on that curated context. Results are shown in a new editor tab for review. Context files are formatted with path headers and code fences.
*   **🌳 Context View:** A dedicated sidebar view listing all files currently added to the LOLLMS context. Easily add/remove files, clear the context, and view the formatted prompt that will be sent.
*   **🚀 First Run Setup Wizard:** Guides you through configuring the essential server URL and API Key (if required by your server) upon first activation, including connection testing.
*   **⚙️ Configurable:** Easily configure the connection to your `lollms-server` (URL, API Key), specify a default binding instance for checks, fine-tune prompts, set default model parameters, configure context behavior (ignore patterns, path inclusion), and set warning thresholds via VS Code settings.
*   **🖱️ Accessible:** Access features through the Command Palette (`Ctrl+Shift+P`/`Cmd+Shift+P`), editor context menu, file explorer context menu, keyboard shortcuts, the Source Control view, and the dedicated LOLLMS Context view.

## Prerequisites

*   **Visual Studio Code:** Version 1.80.0 or higher.
*   **Git:** Must be installed and initialized in your workspace for commit message features. The built-in VS Code Git extension must be enabled.
*   **Running `lollms-server` Instance:** You need a running instance of the [lollms-server](https://github.com/ParisNeo/lollms_server). Ensure it's accessible from your machine and configured with the models/bindings you intend to use. **Ensure the `/health` and `/api/v1/get_model_info/{binding_name}` endpoints are available on your server version.**
*   **(Optional) `lollms-server` API Key:** If your server requires API key authentication (configured in its main config), you'll need a valid key.

## Installation

1.  **(Eventually)** Install from the Visual Studio Code Marketplace (Search for "LOLLMS Copilot").
2.  **(Manual/Development)**
    *   Clone the repository containing this extension.
    *   Install dependencies: `npm install`
    *   Compile the extension: `npm run compile` (or `npm run watch` for development)
    *   Open the extension folder in VS Code.
    *   Press `F5` to start a new Extension Development Host window with the extension loaded.

## Initial Setup & Configuration

### First Run Wizard

Upon the first activation (or if the essential `lollms.serverUrl` setting is missing), the extension will show an information message prompting you to configure the server URL:

1.  Click **"Configure Server URL Now"**.
2.  Enter the base URL of your running `lollms-server` (e.g., `http://localhost:9601`) in the input box and press Enter.
3.  The extension will attempt to contact the server's `/health` endpoint to verify the connection and check if an API key is required. The server version will also be shown if available.
4.  **If an API Key is required** by the server, you will be prompted to enter it. The input will be masked. Press Enter when done.
5.  The URL (and API Key, if entered) will be saved to your global VS Code settings. You'll also be prompted to set the `lollms.defaultBindingInstance` setting (required for context size checks).

If you choose **"Configure Later"** or cancel the input prompts, you can configure the extension manually via VS Code Settings at any time.

### Manual Configuration

You can always view and modify settings manually:

1.  Open VS Code Settings (`Ctrl+,` or `Cmd+,`).
2.  Search for "LOLLMS Copilot".
3.  Configure the following settings:

    *   **`lollms.serverUrl`**: (Required) Base URL of your `lollms-server`. Example: `http://localhost:9601`.
    *   **`lollms.apiKey`**: API Key for your server, if needed. Leave blank if your server doesn't require one.
    *   **`lollms.defaultBindingInstance`**: (Required) The name of the binding instance (e.g., `my_ollama_llama3`, `openai_gpt4o`) configured on your server to use for context size checks. This name must match an instance defined in your server's main config `bindings_map` and have a corresponding configuration file (e.g., `lollms_configs/bindings/my_ollama_llama3.yaml`).
    *   **`lollms.codeGenPromptPrefix` / `Suffix`**: Customize the text wrapped around the comment/docstring sent for inline code generation.
    *   **`lollms.contextPromptPrefix` / `Suffix`**: Customize the text wrapped around the *formatted* file context and the user's request for context-aware generation.
    *   **`lollms.commitMsgPromptPrefix` / `Suffix`**: Customize the text wrapped around the `git diff` sent for commit message generation.
    *   **`lollms.defaultModelParameters`**: A JSON object defining default generation parameters (`temperature`, `max_tokens`, etc.) sent with requests in the `/generate` payload.
    *   **`lollms.contextCharWarningThreshold`**: Character count threshold above which a warning is shown before sending large context requests. Default: `100000`.
    *   **`lollms.includeFilePathsInContext`**: Whether to include the relative file path as a header before file content in context prompts. Default: `true`.
    *   **`lollms.contextIgnorePatterns`**: Glob patterns for files/folders to exclude when using "Add All Project Files to Context".

## Usage

*(Ensure the extension is configured with your server URL, API Key if necessary, and `defaultBindingInstance`)*

### 1. Managing Context (LOLLMS View)

1.  Open the LOLLMS View in the Activity Bar (Lightbulb Sparkle icon).
2.  Use the icons in the view's title bar or context menus:
    *   **Add Current File (`+` icon):** Adds the currently active editor file to the context. Also available via editor/explorer context menus.
    *   **Add All Project Files (`folder-library` icon):** Scans the workspace (respecting `lollms.contextIgnorePatterns` and `.gitignore`) and adds found files. Will warn if the estimated size is large.
    *   **Remove File (Click 'x' on item):** Removes a specific file from the context.
    *   **Clear All (`clear-all` icon):** Removes all files from the context (asks for confirmation).
    *   **Refresh (`refresh` icon):** Reloads the view from the saved state.
    *   **View/Copy Prompt (`clippy` icon):** Shows the fully formatted context prompt (including prefixes, suffixes, file headers, and code fences) that would be sent to the model (with a placeholder for your specific request) in a new tab and copies it to the clipboard.

### 2. Generating Commit Messages

1.  Make changes to your project files.
2.  Stage the desired changes using the Source Control view (`git add ...`).
3.  Go to the Source Control view (Git icon).
4.  Click the **"Generate Commit Message (LOLLMS)"** button (⚡ icon) in the view's title bar or run the command from the palette.
5.  Wait for the progress notification.
6.  The generated commit message will appear in the commit message input box. Review and edit as needed.

### 3. Generating Code from Comments/Docstrings

1.  In your code editor, write a comment or docstring describing the code you want.
2.  Place your cursor on the line *immediately following* the comment/docstring.
3.  Trigger the command via:
    *   Right-click -> **"LOLLMS: Generate Code from Preceding Comment/Docstring"**.
    *   Keybinding: `Ctrl+Alt+L` then `Ctrl+G` (Windows/Linux) or `Cmd+Alt+L` then `Cmd+G` (Mac).
    *   Command Palette (`Ctrl+Shift+P`/`Cmd+Shift+P`) -> "LOLLMS: Generate Code...".
4.  Wait for the progress notification.
5.  The generated code (with surrounding fences removed) will be inserted below your cursor.

### 4. Generating/Modifying Code with Managed Context

1.  **Ensure files are added to the LOLLMS Context View.**
2.  Trigger the command via:
    *   Right-click in the editor -> **"LOLLMS: Generate/Modify Code using Managed Context"**.
    *   Command Palette -> "LOLLMS: Generate/Modify Code using Managed Context".
3.  Enter your detailed instruction in the input box (e.g., "Refactor the `DataLoader` class in `data.py` to handle CSV files", "Write a Python function using the context in `utils.py` to calculate the average").
4.  (If context is large) Confirm if prompted by the character count warning message.
5.  Wait for the progress notification.
6.  The result will open in a new editor tab side-by-side for review. Copy relevant parts into your codebase.

## Default Keybindings

*   **Generate Code from Comment:** `Ctrl+Alt+L` then `Ctrl+G` (Windows/Linux) or `Cmd+Alt+L` then `Cmd+G` (Mac).

*You can customize keybindings in VS Code's Keyboard Shortcuts editor.*

## Security Warning

*   **Code Generation Risk:** AI models can produce incorrect, inefficient, insecure, or malicious code. **Always carefully review and understand any AI-generated code before using or executing it.** You are responsible for the code you commit.
*   **Server-Side Execution Risk:** This extension *sends requests* (including code snippets or diffs) to your configured `lollms-server`. Ensure you trust your server environment. Be extremely cautious if your server runs personalities designed for code execution (`python_builder_executor`). Only use such personalities in secure, isolated environments.
*   **Data Transmission:** The commit message feature sends staged code diffs. Context generation sends the content of selected files. Ensure your server connection and environment are secure if handling sensitive data.

## Known Issues & Limitations

*   Currently in Alpha - expect bugs and changes.
*   Context size warning is based on character count, not precise tokens.
*   Large context requests may be slow or fail depending on server/model limits.
*   Error reporting from the server could be more detailed in the UI.
*   No streaming support for code generation results yet.
*   Relies on a correctly configured `lollms.defaultBindingInstance` for context size checks.

## Contributing

Contributions are welcome! Please check the [GitHub repository](https://github.com/ParisNeo/lollms-vscode-extension) (assuming this is the correct location) for guidelines.

## License

Apache License 2.0. See the LICENSE file (if included in the repo).