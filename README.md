# LOLLMS Copilot (Alpha)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Visual Studio Marketplace Version (Pre-Release)](https://img.shields.io/badge/Marketplace-coming_soon-orange.svg)](https://marketplace.visualstudio.com/) <!-- Replace with actual link once published -->
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-^1.80.0-blue.svg)](https://code.visualstudio.com/updates)
[![Built with TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-blue.svg)](https://www.typescriptlang.org/)

**Publisher:** YourPublisherName (Replace this!)

**Warning:** This extension is currently in **Alpha**. Expect potential bugs, breaking changes, and evolving features.

**Integrates your self-hosted [lollms-server](https://github.com/ParisNeo/lollms_server) instance directly into VS Code for AI-powered code generation, code modification with context, and automated Git commit message suggestions.**

Bring the power of your personalized LOLLMS setup into your development environment. This extension acts as a bridge to your `lollms-server`, enabling features designed to enhance coding speed and consistency.

## Features

*   **🧠 AI-Powered Commit Messages:** Generate descriptive Git commit messages based on your staged changes with a single click in the Source Control view. Uses your configured `lollms-server`.
*   **✍️ Inline Code Generation:** Write a comment or docstring describing the code you need, then use a command or keybinding to have LOLLMS generate the implementation directly below it, respecting indentation.
*   **🔍 Context-Aware Generation/Modification:** Select files or text snippets to provide context, then instruct LOLLMS to perform tasks like refactoring, adding features, explaining code, or generating new code based on that context. Results are shown in a new editor tab for review.
*   **🚀 First Run Setup Wizard:** Guides you through configuring the essential server URL and API Key (if required by your server) upon first activation.
*   **⚙️ Configurable:** Easily configure the connection to your `lollms-server` (URL, API Key), fine-tune prompts used for different tasks, and set default model parameters via VS Code settings.
*   **🖱️ Accessible:** Access features through the Command Palette (`Ctrl+Shift+P`/`Cmd+Shift+P`), editor context (right-click) menu, keyboard shortcuts, and a dedicated button in the Source Control view.

## Prerequisites

*   **Visual Studio Code:** Version 1.80.0 or higher.
*   **Git:** Must be installed and initialized in your workspace for commit message features. The built-in VS Code Git extension must be enabled.
*   **Running `lollms-server` Instance:** You need a running instance of the [lollms-server](https://github.com/ParisNeo/lollms_server). Ensure it's accessible from your machine and configured with the models/bindings you intend to use. **Ensure the `/health` endpoint is available on your server version.**
*   **(Optional) `lollms-server` API Key:** If your server requires API key authentication (configured in its `config.toml`), you'll need a valid key.

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
2.  Enter the base URL of your running `lollms-server` (e.g., `http://localhost:9600`) in the input box and press Enter.
3.  The extension will attempt to contact the server's `/health` endpoint to verify the connection and check if an API key is required.
4.  **If an API Key is required** by the server, you will be prompted to enter it. The input will be masked. Press Enter when done.
5.  The URL (and API Key, if entered) will be saved to your global VS Code settings.

If you choose **"Configure Later"** or cancel the input prompts, you can configure the extension manually via VS Code Settings at any time.

### Manual Configuration

You can always view and modify settings manually:

1.  Open VS Code Settings (`Ctrl+,` or `Cmd+,`).
2.  Search for "LOLLMS Copilot".
3.  Configure the following settings:

    *   **`lollms.serverUrl`**: (Required) Base URL of your `lollms-server`. Example: `http://localhost:9600`.
    *   **`lollms.apiKey`**: API Key for your server, if needed. Leave blank if your server doesn't require one.
    *   **`lollms.codeGenPromptPrefix` / `Suffix`**: Customize the text wrapped around the comment/docstring sent for inline code generation.
    *   **`lollms.contextPromptPrefix` / `Suffix`**: Customize the text wrapped around file context and the user's request for context-aware generation.
    *   **`lollms.commitMsgPromptPrefix` / `Suffix`**: Customize the text wrapped around the `git diff` sent for commit message generation.
    *   **`lollms.defaultModelParameters`**: A JSON object defining default generation parameters (`temperature`, `max_tokens`, etc.) sent with requests.
    *   **`lollms.contextTokenWarningThreshold`**: Character count threshold above which a warning is shown before sending large context requests. Default: `100000`.
    *   **`lollms.includeFilePathsInContext`**: Whether to include the relative file path as a header before file content in context prompts. Default: `true`.

## Usage

*(Ensure the extension is configured with your server URL and API Key if necessary)*

### 1. Generating Commit Messages

1.  Make changes to your project files.
2.  Stage the desired changes using the Source Control view (`git add ...`).
3.  Go to the Source Control view (Git icon in the activity bar).
4.  Click the **"Generate Commit Message (LOLLMS)"** button (⚡ icon) in the view's title bar.
5.  Wait for the progress notification to complete.
6.  The generated commit message will appear in the commit message input box. Review and edit as needed before committing.

### 2. Generating Code from Comments/Docstrings

1.  In your code editor, write a comment (`# ...` or `// ...`) or a docstring (`"""..."""`, `'''...'''`, `/* ... */`) describing the code you want generated.
2.  Place your cursor on the line *immediately following* the comment/docstring.
3.  Trigger the command via **one** of these methods:
    *   Right-click -> **"LOLLMS: Generate Code from Preceding Comment/Docstring"**.
    *   Keybinding: `Ctrl+Alt+L` then `Ctrl+G` (Windows/Linux) or `Cmd+Alt+L` then `Cmd+G` (Mac).
    *   Command Palette (`Ctrl+Shift+P`/`Cmd+Shift+P`) -> "LOLLMS: Generate Code from Preceding Comment/Docstring".
4.  Wait for the progress notification.
5.  The generated code will be inserted below your cursor.

### 3. Generating/Modifying Code with Context

1.  (Optional) Select a specific block of text in your active editor if you want to include it in the context.
2.  Trigger the command via **one** of these methods:
    *   Right-click -> **"LOLLMS: Generate/Modify Code with Context"**.
    *   Command Palette (`Ctrl+Shift+P`/`Cmd+Shift+P`) -> "LOLLMS: Generate/Modify Code with Context".
3.  Choose the context source from the Quick Pick menu:
    *   `Current File`: Uses the active file.
    *   `Selected Files...`: Opens a dialog to select workspace files.
    *   `Selected Text (+ Files...)`: Uses the text you selected *before* running the command, plus opens a dialog for more files.
4.  (If applicable) Select file(s) from the dialog.
5.  Enter your detailed instruction in the input box that appears (e.g., "Refactor the selected function to use async/await", "Add a unit test for the `process_data` function in `parser.py`").
6.  (If context is large) Confirm if prompted by the token warning message.
7.  Wait for the progress notification.
8.  The result will open in a new editor tab side-by-side for your review. Copy and paste the relevant parts into your codebase.

## Default Keybindings

*   **Generate Code from Comment:** `Ctrl+Alt+L` then `Ctrl+G` (Windows/Linux) or `Cmd+Alt+L` then `Cmd+G` (Mac).

*You can customize keybindings in VS Code's Keyboard Shortcuts editor (File > Preferences > Keyboard Shortcuts).*

## Security Warning

*   **Code Generation Risk:** This extension **generates** code. Language models can produce incorrect, inefficient, insecure, or even malicious code. **Always carefully review and understand any AI-generated code before using or executing it.** You are responsible for the code you commit.
*   **Server-Side Execution:** This extension *sends requests* to your `lollms-server`. It does **not** execute code locally within VS Code itself. However, be extremely cautious about the personalities and models configured on your `lollms-server`. Some personalities (like the example `python_builder_executor`) *are designed to execute code on the server*. Only run such personalities in secure, isolated environments if you fully understand the risks.
*   **Commit Message Data:** The commit message feature reads your *staged code changes* (the diff) and sends it to your `lollms-server` to generate a summary. Ensure you trust your server environment if your staged changes contain sensitive information.

## Known Issues & Limitations

*   Currently in Alpha - expect bugs and changes.
*   Context generation token estimation is approximate (character-based).
*   Large context requests may be slow or fail depending on server/model limits.
*   Error reporting from the server could be more detailed in the UI.
*   No streaming support for code generation results yet.

## Contributing

Contributions are welcome! Please check the [GitHub repository](https://github.com/YourGitHub/lollms-copilot) for guidelines. (Replace with actual link)

## License

Apache License 2.0. See the [LICENSE](LICENSE) file.