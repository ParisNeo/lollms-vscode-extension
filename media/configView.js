// media/configView.js

// Ensure VS Code API is available (it should be provided by the webview environment)
// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

// Store loaded settings to help pre-select models
let loadedSettings = {};

// DOM References
const elements = {
    serverUrl: document.getElementById('serverUrl'),
    apiKey: document.getElementById('apiKey'),
    overrideBinding: document.getElementById('overrideBindingInstance'), // Select
    overrideModel: document.getElementById('overrideModelName'),       // Select
    threshold: document.getElementById('contextCharWarningThreshold'),
    includePaths: document.getElementById('includeFilePathsInContext'),
    saveButton: document.getElementById('saveButton'),
    saveFeedback: document.getElementById('save-feedback'),
    loadingFeedback: document.getElementById('loading-feedback'),
    errorFeedback: document.getElementById('error-feedback')
};

function setLoadingState(isLoading, message = 'Loading...') {
    elements.loadingFeedback.textContent = isLoading ? message : '';
    elements.loadingFeedback.style.display = isLoading ? 'block' : 'none';
    // Disable form elements while loading might be good UX
    elements.saveButton.disabled = isLoading;
    elements.overrideBinding.disabled = isLoading;
    // Keep model disabled until its list is loaded/binding selected
    // elements.overrideModel.disabled = isLoading;
}

function setErrorState(message = '') {
    elements.errorFeedback.textContent = message;
    elements.errorFeedback.style.display = message ? 'block' : 'none';
    setLoadingState(false); // Stop loading indicator on error
}

// Load settings from extension into form
function loadSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        console.error("Webview: Invalid settings received", settings);
        setErrorState("Received invalid settings data from extension.");
        return;
    }
    console.log("Webview: Loading settings", settings);
    loadedSettings = settings; // Store for later use in populating selects
    elements.serverUrl.value = settings.serverUrl || '';
    elements.apiKey.value = settings.apiKey || '';
    // Don't set select values here yet, wait for lists to populate
    elements.threshold.value = settings.contextCharWarningThreshold || 100000;
    elements.includePaths.checked = settings.includeFilePathsInContext === true;
    setErrorState(); // Clear previous errors
}

// Populate Binding Dropdown
function populateBindings(bindings) {
    console.log("Webview: Populating bindings", bindings);
    elements.overrideBinding.innerHTML = '<option value="">-- Use Server Default --</option>'; // Reset
    let foundSavedBinding = false;
    if (Array.isArray(bindings)) {
        bindings.sort().forEach(bindingName => {
            const option = document.createElement('option');
            option.value = bindingName;
            option.textContent = bindingName;
            elements.overrideBinding.appendChild(option);
            if (loadedSettings.overrideBindingInstance === bindingName) {
                foundSavedBinding = true;
            }
        });
    }
    // Select the saved binding AFTER populating
    if (foundSavedBinding) {
        elements.overrideBinding.value = loadedSettings.overrideBindingInstance;
        // Trigger model fetch for the pre-selected binding
        requestModelsForBinding(loadedSettings.overrideBindingInstance);
    } else {
        elements.overrideBinding.value = ""; // Reset to default if saved binding not found
        requestModelsForBinding(""); // Ensure model list is cleared/disabled
    }
    setLoadingState(false); // Done loading bindings
}

// Populate Model Dropdown
function populateModels(currentSelectedBinding, models) {
    console.log(`Webview: Populating models for ${currentSelectedBinding}`, models);
    elements.overrideModel.innerHTML = '<option value="">-- Use Binding Default --</option>'; // Reset
    let foundSavedModel = false;

    // Only populate if a binding is actually selected and models exist
    if (currentSelectedBinding && Array.isArray(models) && models.length > 0) {
        models.sort().forEach(modelName => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            elements.overrideModel.appendChild(option);
            // Check if the SAVED binding matches the CURRENTLY selected binding
            // AND if the SAVED model matches the CURRENT model in the loop
            if (loadedSettings.overrideBindingInstance === currentSelectedBinding && loadedSettings.overrideModelName === modelName) {
                foundSavedModel = true;
            }
        });
        elements.overrideModel.disabled = false; // Enable dropdown

        // Select saved model only if it was found for the current binding
        if (foundSavedModel) {
            elements.overrideModel.value = loadedSettings.overrideModelName;
        } else {
            elements.overrideModel.value = ""; // Reset if saved model not valid for this binding
        }
    } else {
        // Disable and clear if no binding selected or no models returned
        elements.overrideModel.disabled = true;
        elements.overrideModel.value = ""; // Clear selection when disabled
    }
    setLoadingState(false); // Done loading models or disabling
}

// Request Models for a specific binding
function requestModelsForBinding(bindingName) {
    if (bindingName) {
        setLoadingState(true, `Loading models for ${bindingName}...`);
        setErrorState(); // Clear errors
        elements.overrideModel.disabled = true; // Disable while loading
        elements.overrideModel.innerHTML = '<option value="">Loading...</option>';
        vscode.postMessage({ command: 'getModelsList', payload: { bindingName: bindingName } });
    } else {
        // No binding selected (use server default), disable model selection
        elements.overrideModel.disabled = true;
        elements.overrideModel.innerHTML = '<option value="">-- Use Binding Default --</option>';
        elements.overrideModel.value = ""; // Ensure value is cleared
        setLoadingState(false); // No loading needed if no binding selected
    }
}


// Listen for messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    console.log("Webview received message: ", message.command); // Log incoming commands
    switch (message.command) {
        case 'loadSettings': loadSettings(message.payload); break;
        case 'bindingsList': populateBindings(message.payload); break;
        case 'modelsList': populateModels(message.payload.bindingName, message.payload.models); break;
        case 'settingsSaved':
            setLoadingState(false);
            elements.saveFeedback.className = 'success';
            elements.saveFeedback.textContent = 'Saved!';
            setTimeout(() => { elements.saveFeedback.textContent = ''; }, 3000);
            break;
        case 'saveError':
            setLoadingState(false);
            elements.saveFeedback.className = 'error';
            elements.saveFeedback.textContent = 'Error: ' + message.error;
            break;
        case 'showError': // Generic error display
            setErrorState(message.payload);
            break;
        // Handle request for bindings initiated by extension
        case 'requestBindingsList':
            setErrorState();
            setLoadingState(true, 'Loading bindings...');
            vscode.postMessage({ command: 'getBindingsList' });
            break;
    }
});

// Add event listener for Binding selection change
elements.overrideBinding.addEventListener('change', (event) => {
    // Use currentTarget for potentially delegated events, target is fine here
    const selectedBinding = event.target.value;
    console.log("Binding selection changed to:", selectedBinding);
    requestModelsForBinding(selectedBinding); // Fetch models for the new selection
});

// Save button action - Reads selected values from dropdowns
elements.saveButton.addEventListener('click', () => {
    if (!elements.serverUrl.value.trim()) { setErrorState('Server URL cannot be empty.'); return; }
    setErrorState(); // Clear errors
    const settings = {
        serverUrl: elements.serverUrl.value.trim(),
        apiKey: elements.apiKey.value.trim(),
        overrideBindingInstance: elements.overrideBinding.value, // Get selected value
        overrideModelName: elements.overrideModel.value,       // Get selected value
        contextCharWarningThreshold: parseInt(elements.threshold.value, 10) || 100000,
        includeFilePathsInContext: elements.includePaths.checked
    };
    elements.saveFeedback.textContent = 'Saving...';
    elements.saveFeedback.className = 'info'; // Use info class for saving message
    setLoadingState(true, 'Saving...'); // Show loading indicator during save
    vscode.postMessage({ command: 'saveSettings', payload: settings });
});

// Initial request for settings (which will trigger binding load via message handler)
console.log("Webview requesting initial settings...");
vscode.postMessage({ command: 'getCurrentSettings' });