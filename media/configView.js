// media/configView.js

// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

let loadedSettings = {}; // Store loaded settings

// --- DOM References ---
const elements = {
    serverUrl: document.getElementById('serverUrl'),
    apiKey: document.getElementById('apiKey'),
    rescanButton: document.getElementById('rescanButton'), // ** NEW **
    overrideBinding: document.getElementById('overrideBindingInstance'),
    overrideModel: document.getElementById('overrideModelName'),
    threshold: document.getElementById('contextCharWarningThreshold'),
    includePaths: document.getElementById('includeFilePathsInContext'),
    saveButton: document.getElementById('saveButton'),
    saveFeedback: document.getElementById('save-feedback'),
    loadingFeedback: document.getElementById('loading-feedback'),
    errorFeedback: document.getElementById('error-feedback')
};

function setLoadingState(isLoading, message = 'Loading...') {
    if (!elements.loadingFeedback || !elements.saveButton || !elements.overrideBinding || !elements.overrideModel || !elements.rescanButton) return;

    elements.loadingFeedback.textContent = isLoading ? message : '';
    elements.loadingFeedback.style.display = isLoading ? 'block' : 'none';
    elements.saveButton.disabled = isLoading;
    elements.overrideBinding.disabled = isLoading;
    elements.overrideModel.disabled = isLoading || elements.overrideBinding.value === ""; // Keep model disabled if no binding selected OR loading
    elements.rescanButton.disabled = isLoading; // Disable rescan button while loading
}

function setErrorState(message = '') {
     if (!elements.errorFeedback) return;
    elements.errorFeedback.textContent = message;
    elements.errorFeedback.style.display = message ? 'block' : 'none';
    // Ensure loading stops on error
    setLoadingState(false);
}

// Load settings from extension into form
function loadSettings(settings) {
    // ... (implementation remains the same)
    if (!settings || typeof settings !== 'object' || !elements.serverUrl) { /*...*/ return; }
    loadedSettings = settings;
    elements.serverUrl.value = settings.serverUrl || '';
    elements.apiKey.value = settings.apiKey || '';
    elements.threshold.value = settings.contextCharWarningThreshold || 100000;
    elements.includePaths.checked = settings.includeFilePathsInContext === true;
    // Binding/Model selects are populated later by populateBindings/populateModels
    setErrorState();
}

// Populate Binding Dropdown
function populateBindings(bindings) {
     if (!elements.overrideBinding || !elements.overrideModel) return;
    console.log("Webview: Populating bindings", bindings);
    const previouslySelectedBinding = elements.overrideBinding.value; // Store current selection before clearing
    elements.overrideBinding.innerHTML = '<option value="">-- Use Server Default --</option>';
    let foundSavedBinding = false;
    let bindingToSelect = ""; // Determine which binding should be selected after populating

    if (Array.isArray(bindings)) {
        bindings.sort().forEach(bindingName => {
            const option = document.createElement('option');
            option.value = bindingName;
            option.textContent = bindingName;
            elements.overrideBinding.appendChild(option);
            if (loadedSettings.overrideBindingInstance === bindingName) {
                foundSavedBinding = true;
                bindingToSelect = bindingName; // Prefer the saved setting if it exists in the new list
            }
        });
    }

    // If saved binding wasn't found, but the previously selected one *is* in the new list, keep it selected.
    if (!foundSavedBinding && bindings.includes(previouslySelectedBinding)) {
         bindingToSelect = previouslySelectedBinding;
         console.log(`Saved binding '${loadedSettings.overrideBindingInstance}' not found, keeping previous selection '${previouslySelectedBinding}'.`);
    } else if (!foundSavedBinding) {
         bindingToSelect = ""; // Fallback to default if neither saved nor previous exists
         console.log(`Saved binding '${loadedSettings.overrideBindingInstance}' not found, resetting to default.`);
    } else {
        console.log(`Selecting saved binding '${bindingToSelect}'.`);
    }


    // Set the value and trigger model fetch
    elements.overrideBinding.value = bindingToSelect;
    requestModelsForBinding(bindingToSelect); // Fetch models for the finally selected binding

    // Re-enable the binding dropdown if it was disabled for loading
    elements.overrideBinding.disabled = false;
    // Model dropdown enabling/disabling is handled within populateModels/requestModelsForBinding
}


// Populate Model Dropdown
function populateModels(currentSelectedBinding, models) {
     if (!elements.overrideModel) return;
    console.log(`Webview: Populating models for ${currentSelectedBinding}`, models);
    elements.overrideModel.innerHTML = '<option value="">-- Use Binding Default --</option>';
    let foundSavedModel = false;

    if (currentSelectedBinding && Array.isArray(models) && models.length > 0) {
        models.sort().forEach(modelName => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            elements.overrideModel.appendChild(option);
            // Check if the CURRENTLY selected binding matches the saved binding AND the model matches
            if (currentSelectedBinding === loadedSettings.overrideBindingInstance && loadedSettings.overrideModelName === modelName) {
                foundSavedModel = true;
            }
        });
        elements.overrideModel.disabled = false; // Enable dropdown

        if (foundSavedModel) {
            elements.overrideModel.value = loadedSettings.overrideModelName;
        } else {
            // If saved model not found for this binding, reset to default
            // Also reset if the currently selected binding isn't the one saved in settings
            elements.overrideModel.value = "";
             if (currentSelectedBinding === loadedSettings.overrideBindingInstance) {
                  console.log(`Saved model '${loadedSettings.overrideModelName}' not found for binding '${currentSelectedBinding}'. Resetting.`);
             }
        }
    } else {
        // Disable and clear if no binding selected or no models returned
        elements.overrideModel.disabled = true;
        elements.overrideModel.value = "";
    }
    // Ensure loading state is cleared after populating or disabling
    setLoadingState(false);
}

// Request Models for a specific binding
function requestModelsForBinding(bindingName) {
     if (!elements.overrideModel) return;
    if (bindingName) {
        setErrorState(); // Clear errors
        elements.overrideModel.disabled = true; // Disable while loading
        elements.overrideModel.innerHTML = '<option value="">Loading...</option>';
        // Show loading indicator specifically for models
        setLoadingState(true, `Loading models for ${bindingName}...`);
        vscode.postMessage({ command: 'getModelsList', payload: { bindingName: bindingName } });
    } else {
        // No binding selected, disable model selection
        elements.overrideModel.disabled = true;
        elements.overrideModel.innerHTML = '<option value="">-- Use Binding Default --</option>';
        elements.overrideModel.value = "";
        setLoadingState(false); // No loading needed if no binding selected
    }
}


// --- Message Listener ---
window.addEventListener('message', event => {
    const message = event.data;
    console.log("ConfigView received message: ", message.command);
    switch (message.command) {
        case 'loadSettings': loadSettings(message.payload); break;
        case 'bindingsList':
            setLoadingState(false); // Stop loading after bindings arrive
            populateBindings(message.payload);
            break;
        case 'modelsList':
             // Loading state is handled within populateModels based on result
            populateModels(message.payload.bindingName, message.payload.models);
            break;
        case 'settingsSaved':
            setLoadingState(false);
            elements.saveFeedback.className = 'success';
            elements.saveFeedback.textContent = 'Saved!';
            setTimeout(() => { if(elements.saveFeedback) elements.saveFeedback.textContent = ''; }, 3000);
            break;
        case 'saveError':
            setLoadingState(false);
            elements.saveFeedback.className = 'error';
            elements.saveFeedback.textContent = 'Error saving: ' + message.error;
            break;
        case 'showError': // Generic error display
            setErrorState(message.payload);
            // Ensure loading indicator stops on any error
             setLoadingState(false);
            break;
         // Handle explicit request for bindings initiated by extension (e.g., on initial load or rescan)
         case 'requestBindingsList':
             setErrorState(); // Clear previous errors
             setLoadingState(true, 'Loading available bindings...');
             vscode.postMessage({ command: 'getBindingsList' });
             break;
        // ** NEW ** Handle scan completion signals
        case 'scanComplete':
            setLoadingState(false); // Turn off general loading indicator
            // Optionally show a temporary success message for the scan itself
            elements.errorFeedback.textContent = 'Server scan complete.';
            elements.errorFeedback.className = 'success'; // Use success class
             setTimeout(() => { if(elements.errorFeedback && elements.errorFeedback.classList.contains('success')) { elements.errorFeedback.textContent = ''; elements.errorFeedback.className = 'error';} }, 3000);
            break;
        case 'scanError':
             setErrorState(`Server scan failed: ${message.payload || 'Unknown error'}`);
             // setLoadingState(false) is called within setErrorState
             break;
    }
});

// --- Event Handlers ---

// Add event listener for Binding selection change
if (elements.overrideBinding) {
    elements.overrideBinding.addEventListener('change', (event) => {
        const selectedBinding = event.target.value;
        console.log("Binding selection changed to:", selectedBinding);
        requestModelsForBinding(selectedBinding);
    });
}

// Save button action
if (elements.saveButton) {
    elements.saveButton.addEventListener('click', () => {
        if (!elements.serverUrl || !elements.serverUrl.value.trim()) { setErrorState('Server URL cannot be empty.'); return; }
        setErrorState(); // Clear errors before saving
        const settings = {
            serverUrl: elements.serverUrl.value.trim(),
            apiKey: elements.apiKey.value.trim(),
            overrideBindingInstance: elements.overrideBinding.value,
            overrideModelName: elements.overrideModel.value,
            contextCharWarningThreshold: parseInt(elements.threshold.value, 10) || 100000,
            includeFilePathsInContext: elements.includePaths.checked
        };
        if(elements.saveFeedback) {
            elements.saveFeedback.textContent = 'Saving...';
            elements.saveFeedback.className = 'info';
        }
        setLoadingState(true, 'Saving...');
        vscode.postMessage({ command: 'saveSettings', payload: settings });
    });
}

// ** NEW ** Rescan button action
if (elements.rescanButton) {
    elements.rescanButton.addEventListener('click', () => {
        console.log("Rescan Server button clicked.");
        setErrorState(); // Clear previous errors
        setLoadingState(true, 'Scanning server...'); // Show loading state
        // Clear current dropdowns slightly differently to indicate refresh
         if(elements.overrideBinding) elements.overrideBinding.innerHTML = '<option value="">Scanning...</option>';
         if(elements.overrideModel) {
             elements.overrideModel.innerHTML = '<option value="">Scanning...</option>';
             elements.overrideModel.disabled = true;
         }
        vscode.postMessage({ command: 'rescanServer' });
    });
}

// --- Initial Request ---
// Request settings when the script loads (this will indirectly trigger binding/model load)
console.log("ConfigView requesting initial settings...");
vscode.postMessage({ command: 'getCurrentSettings' });