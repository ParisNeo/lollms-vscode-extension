// src/config.ts
import * as vscode from 'vscode';

const CONFIG_SECTION = 'lollms';
const APPROX_CHARS_PER_TOKEN = 4; // Keep estimate factor consistent

function getConfig<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key) ?? defaultValue;
}

export function getServerUrl(): string | undefined {
    let url = getConfig<string | undefined>('serverUrl', "http://localhost:9601")?.trim(); // Updated default port
    if (url && url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    return url ? url : undefined;
}

export function getApiKey(): string | undefined {
    const key = getConfig<string | undefined>('apiKey', "")?.trim();
    return key ? key : undefined;
}

export function getOverrideBindingInstance(): string | undefined {
    const name = getConfig<string | undefined>('overrideBindingInstance', "")?.trim();
    return name ? name : undefined;
}

export function getOverrideModelName(): string | undefined {
    const name = getConfig<string | undefined>('overrideModelName', "")?.trim();
    return name ? name : undefined;
}

export function getCodeGenPromptPrefix(): string {
    return getConfig<string>('codeGenPromptPrefix', 'Implement the following functionality described in the comment/docstring:\n\n');
}

export function getCodeGenPromptSuffix(): string {
    return getConfig<string>('codeGenPromptSuffix', '\n\n```python\n');
}

export function getContextPromptPrefix(): string {
    return getConfig<string>('contextPromptPrefix', "Based on the provided file context and the user's request, generate or modify the code as described.\n\n--- CONTEXT FILES ---\n");
}

export function getContextPromptSuffix(): string {
    return getConfig<string>('contextPromptSuffix', "\n--- END CONTEXT FILES ---\n\nUser Request:\n");
}

export function getCommitMsgPromptPrefix(): string {
    return getConfig<string>('commitMsgPromptPrefix', "Generate a concise Git commit message in the conventional commit format (e.g., feat: ...) that summarizes the following staged changes:\n\n```diff\n");
}

export function getCommitMsgPromptSuffix(): string {
    return getConfig<string>('commitMsgPromptSuffix', "\n```\n\nCommit Message:");
}

export function getDefaultModelParameters(): Record<string, any> {
     return getConfig<Record<string, any>>('defaultModelParameters', { temperature: 0.3, max_tokens: 2048 });
}

export function getContextCharWarningThreshold(): number {
    return getConfig<number>('contextCharWarningThreshold', 100000);
}

export function shouldIncludeFilePathsInContext(): boolean {
    return getConfig<boolean>('includeFilePathsInContext', true);
}

export function getSvgAssetPromptPrefix(): string {
    return getConfig<string>('svgAssetPromptPrefix', 'Generate SVG code based on the following description. Only output the raw SVG code within ```svg ... ``` tags:\n\nDescription: ');
}

export function getSvgAssetPromptSuffix(): string {
    return getConfig<string>('svgAssetPromptSuffix', '\n\nSVG Code:\n');
}

export function getContextIgnorePatterns(): string[] {
    return getConfig<string[]>('contextIgnorePatterns', [
        "**/node_modules/**", "**/.git/**", "**/.vscode/**", "**/.svn/**", "**/.hg/**",
        "**/CVS/**", "**/.DS_Store/**", "**/Thumbs.db/**", "**/*.lock", "**/*.log",
        "**/*.exe", "**/*.dll", "**/*.so", "**/*.dylib", "**/*.obj", "**/*.o", "**/*.a",
        "**/*.lib", "**/*.pyc", "**/*.pyo", "**/*.class", "**/*.jar", "**/*.bin",
        "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.bmp", "**/*.tiff", "**/*.webp",
        "**/*.mp3", "**/*.wav", "**/*.ogg", "**/*.mp4", "**/*.avi", "**/*.mov", "**/*.wmv",
        "**/dist/**", "**/build/**", "**/out/**", "**/*.zip", "**/*.tar.gz", "**/*.rar"
    ]);
}

/**
 * Updates multiple LOLLMS configuration settings globally.
 * @param settingsToUpdate An object where keys are setting names (without 'lollms.')
 *                         and values are the new values to set.
 * @returns A promise that resolves when all updates are complete.
 */
export async function updateGlobalSettings(settingsToUpdate: { [key: string]: any }): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const promises: Thenable<void>[] = [];
    console.log("Updating LOLLMS global settings:", settingsToUpdate);

    for (const key in settingsToUpdate) {
        // Basic check to avoid prototype pollution, though unlikely here
        if (Object.prototype.hasOwnProperty.call(settingsToUpdate, key)) {
            const value = settingsToUpdate[key];
            console.debug(`Updating '${CONFIG_SECTION}.${key}' to:`, value);
            // Use ConfigurationTarget.Global to save in user settings
            promises.push(config.update(key, value, vscode.ConfigurationTarget.Global));
        }
    }

    try {
        await Promise.all(promises);
        console.log("LOLLMS global settings updated successfully.");
    } catch (error: any) { // Catch specifically as 'any'
        console.error("Error updating LOLLMS global settings:", error);
        vscode.window.showErrorMessage(`Failed to update LOLLMS settings: ${error.message || error}`);
        // Re-throw the error if the caller needs to know it failed
        throw error;
    }
}


export function isConfigValid(): boolean {
    const url = getServerUrl();
    return !!url;
}

export function showConfigurationError(): void {
    const url = getServerUrl();
    let message = 'LOLLMS Copilot configuration is incomplete:';
    if (!url) message += '\n- `lollms.serverUrl` is missing.';

     vscode.window.showErrorMessage(message, { modal: true }, 'Open Settings').then(selection => {
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'lollms.serverUrl');
        }
     });
}

export { APPROX_CHARS_PER_TOKEN };