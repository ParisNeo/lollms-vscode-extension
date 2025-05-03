// src/contextTreeViewProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ContextManager } from './contextManager'; // Import the manager

/**
 * Represents an item in the LOLLMS Context Tree View.
 * Holds the URI of the file added to the context.
 */
export class ContextItem extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
        let label = path.basename(resourceUri.fsPath);
        let description = '';

        // Add relative path from workspace root if possible
        if (workspaceFolder) {
             const relDir = path.relative(workspaceFolder.uri.fsPath, path.dirname(resourceUri.fsPath));
             description = relDir || '.'; // Show '.' if in root, otherwise show relative dir
        } else {
            // If outside workspace, show parent directory
            description = path.basename(path.dirname(resourceUri.fsPath));
        }

        super(label, collapsibleState);
        this.tooltip = resourceUri.fsPath; // Show full path on hover
        this.description = description; // Show relative directory path or parent

        // Command to execute when the item is clicked (e.g., open the file)
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [resourceUri],
        };

        // Set context value for targeted menu contributions (e.g., the 'x' remove button)
        this.contextValue = 'lollmsContextFile';

        // Use built-in file icon
        this.iconPath = vscode.ThemeIcon.File;
    }
}

/**
 * Provides the data (TreeItems) for the LOLLMS Context sidebar view.
 */
export class ContextTreeDataProvider implements vscode.TreeDataProvider<ContextItem> {

    // Event emitter to signal VS Code that the tree data has changed
    private _onDidChangeTreeData: vscode.EventEmitter<ContextItem | undefined | null | void> = new vscode.EventEmitter<ContextItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ContextItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private contextManager: ContextManager, private context: vscode.ExtensionContext) {
         // Listen to changes in the context manager and refresh the view
         this.contextManager.onContextDidChange(() => {
             this.refresh();
             console.log("ContextTreeDataProvider: Context changed, refreshing view.");
         });
    }

    /**
     * Refreshes the entire tree view by firing the change event.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Gets the TreeItem representation for a given element (ContextItem).
     * @param element The ContextItem element.
     * @returns The corresponding vscode.TreeItem.
     */
    getTreeItem(element: ContextItem): vscode.TreeItem {
        return element; // The ContextItem is already a TreeItem
    }

    /**
     * Gets the children of a given element. For the root (element is undefined),
     * it returns all files currently in the context manager. ContextItems don't have children.
     * @param element The element to get children for (undefined for root).
     * @returns A promise resolving to an array of ContextItem children or null/undefined.
     */
    getChildren(element?: ContextItem): vscode.ProviderResult<ContextItem[]> {
        if (element) {
            // Our ContextItems represent files and have no children
            return Promise.resolve([]);
        } else {
            // Requesting root elements: return all URIs from the manager as ContextItems
            const uris = this.contextManager.getContextUris();
            // Sort URIs alphabetically by path for consistent display
            const sortedUris = [...uris].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
            const items = sortedUris.map(uri => new ContextItem(uri));
            console.log(`ContextTreeDataProvider: Providing ${items.length} root items.`);
            return Promise.resolve(items);
        }
    }
}
