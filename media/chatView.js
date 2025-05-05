// media/chatView.js
// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

// --- DOM Elements ---
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const contextStatusSpan = document.getElementById('context-status');
const modelStatusSpan = document.getElementById('model-status');
const spinner = document.getElementById('spinner');
const discussionSelector = document.getElementById('discussion-selector');
const newDiscussionBtn = document.getElementById('new-discussion-btn');
const deleteDiscussionBtn = document.getElementById('delete-discussion-btn');


// --- State ---
let isGenerating = false;
let currentActiveDiscussionId = null; // Track the active discussion ID locally in the webview

// --- Functions ---

/** Scrolls the message container to the bottom */
function scrollToBottom() {
    // Add slight delay to ensure DOM is updated before scrolling
    setTimeout(() => {
        if (messagesContainer) { // Check if element exists
             messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }, 50);
}

/** Renders a single message object to the DOM */
function renderMessage(message) {
    if (!messagesContainer) return; // Exit if container not found

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${message.sender}`);
    if (message.sender === 'system') {
        messageDiv.classList.add(`message-${message.type}`); // Add error/info class for system messages
    }

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('sender');
    senderSpan.textContent = message.sender === 'user' ? 'You' : message.sender === 'assistant' ? 'LOLLMS' : 'System';
    if (message.sender === 'system') senderSpan.style.display = 'none'; // Hide sender for system messages

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('content');

    // Code block handling
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g;
    let lastIndex = 0;
    let hasCode = false;
    const messageContent = message.content || ""; // Ensure content is a string

    // Use replace to find all blocks and build the content piece by piece
    messageContent.replace(codeBlockRegex, (match, lang, code, offset) => {
        hasCode = true;
        // Add text before the code block
        if (offset > lastIndex) {
            const textPart = messageContent.substring(lastIndex, offset);
            contentDiv.appendChild(document.createTextNode(textPart));
        }

        // Create code block container
        const codeContainer = document.createElement('div');
        codeContainer.classList.add('code-block-container');

        // Add header with language label and copy button
        const header = document.createElement('div');
        header.classList.add('code-block-header');
        const langLabel = document.createElement('span');
        langLabel.classList.add('language-label');
        langLabel.textContent = lang || 'code';
        header.appendChild(langLabel);
        const copyButton = document.createElement('button');
        copyButton.classList.add('copy-button');
        copyButton.title = 'Copy Code';
        copyButton.innerHTML = `<span class="codicon codicon-copy"></span> Copy`;
        copyButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'copyCode', payload: { code: code.trim() } });
        });
        header.appendChild(copyButton);
        codeContainer.appendChild(header);

        // Add code itself
        const pre = document.createElement('pre');
        const codeElement = document.createElement('code');
        codeElement.textContent = code.trim(); // Use textContent for security
        if (lang) {
            codeElement.classList.add(`language-${lang}`);
        }
        pre.appendChild(codeElement);
        codeContainer.appendChild(pre);

        contentDiv.appendChild(codeContainer);

        lastIndex = offset + match.length; // Update last index
        return ''; // Necessary for the 'replace' logic
    });

    // Add any remaining text after the last code block
    if (lastIndex < messageContent.length) {
        contentDiv.appendChild(document.createTextNode(messageContent.substring(lastIndex)));
    }

    // If the message had no code block at all, just set the text content
    if (!hasCode) {
        contentDiv.textContent = messageContent;
    }

    messageDiv.appendChild(senderSpan);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
}

/** Clears all messages from the display */
function clearMessages() {
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }
}

/** Updates the UI state based on generation status */
function setGeneratingStatus(generating) {
    isGenerating = generating;
    if (messageInput) messageInput.disabled = generating;
    if (sendButton) sendButton.disabled = generating;
    if (discussionSelector) discussionSelector.disabled = generating;
    if (newDiscussionBtn) newDiscussionBtn.disabled = generating;
    // Only enable delete if not generating AND an active discussion exists
    if (deleteDiscussionBtn) deleteDiscussionBtn.disabled = generating || !currentActiveDiscussionId;

    if (spinner) spinner.style.display = generating ? 'inline-block' : 'none';

    // Update status text intelligently
    if (modelStatusSpan) {
         const currentStatus = modelStatusSpan.textContent.replace('Status: ', '').trim();
         if (generating) {
            modelStatusSpan.textContent = `Status: Generating...`;
            modelStatusSpan.style.color = 'var(--vscode-descriptionForeground)';
         } else if (currentStatus === 'Generating...') {
            modelStatusSpan.textContent = `Status: Ready`;
            modelStatusSpan.style.color = 'var(--vscode-descriptionForeground)';
         }
         // Keep error status if it was set
    }
}

/** Updates the context status display */
function updateContextStatus(fileCount) {
    if (contextStatusSpan) {
        contextStatusSpan.textContent = `Context: ${fileCount} file(s)`;
    }
}

/** Updates the model/connection status display */
function updateModelStatus(messageText, isError = false) {
    if (modelStatusSpan) {
        // Don't overwrite "Generating..." status unless it's an error
        const currentStatus = modelStatusSpan.textContent.replace('Status: ', '').trim();
        if (!isGenerating || isError || currentStatus !== 'Generating...') {
            modelStatusSpan.textContent = `Status: ${messageText}`;
            modelStatusSpan.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-descriptionForeground)';
        }
    }
}

/** Populates the discussion selector dropdown */
function populateDiscussionSelector(discussions = [], activeId = null) {
    if (!discussionSelector || !deleteDiscussionBtn) return;

    const previousValue = discussionSelector.value; // Store previous selection
    discussionSelector.innerHTML = ''; // Clear existing

    if (!discussions || discussions.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '-- No Discussions --';
        discussionSelector.appendChild(option);
        discussionSelector.disabled = true;
        deleteDiscussionBtn.disabled = true;
        currentActiveDiscussionId = null;
    } else {
        discussionSelector.disabled = false;

        // Sort discussions (assuming they might not be sorted)
        discussions.sort((a, b) => b.createdAt - a.createdAt); // Newest first

        discussions.forEach(d => {
            if (!d || !d.id) return; // Basic validation
            const option = document.createElement('option');
            option.value = d.id;
            const title = d.title || `Discussion ${d.id.substring(0, 8)}`; // Fallback title
            option.textContent = title.length > 60 ? title.substring(0, 57) + '...' : title;
            option.selected = d.id === activeId;
            discussionSelector.appendChild(option);
        });

        // Try to restore selection or select the activeId or default to newest
        if (activeId && discussions.some(d => d.id === activeId)) {
             discussionSelector.value = activeId;
             currentActiveDiscussionId = activeId;
        } else if (discussions.some(d => d.id === previousValue)) {
            // If activeId is gone, but previous selection still exists, keep it
             discussionSelector.value = previousValue;
             currentActiveDiscussionId = previousValue;
             // If the selection changed implicitly, notify the provider
             if (currentActiveDiscussionId !== activeId) {
                vscode.postMessage({ command: 'switchDiscussion', payload: { discussionId: currentActiveDiscussionId } });
             }
        } else if (discussions.length > 0) {
            // Fallback to selecting the newest (first in sorted list)
            discussionSelector.value = discussions[0].id;
            currentActiveDiscussionId = discussions[0].id;
            // If the selection changed implicitly, notify the provider
            if (currentActiveDiscussionId !== activeId) {
               vscode.postMessage({ command: 'switchDiscussion', payload: { discussionId: currentActiveDiscussionId } });
            }
        } else {
            currentActiveDiscussionId = null; // Should match the empty case above
        }
        // Enable delete button only if a discussion is actively selected
        deleteDiscussionBtn.disabled = !currentActiveDiscussionId || isGenerating;
    }

    // Final check for disabling based on generation status
    if (isGenerating) {
        discussionSelector.disabled = true;
        deleteDiscussionBtn.disabled = true;
        if (newDiscussionBtn) newDiscussionBtn.disabled = true;
    } else {
         if (newDiscussionBtn) newDiscussionBtn.disabled = false; // Re-enable New button if not generating
    }
}

/** Sends the message from the input field */
function sendMessage() {
    if (!messageInput || !sendButton) return; // Element checks

    const text = messageInput.value.trim();
    if (text && !isGenerating) {
        vscode.postMessage({ command: 'sendMessage', payload: { text: text } });
        messageInput.value = ''; // Clear input after sending
        messageInput.focus(); // Keep focus on input
    }
}

// --- Event Listeners ---

// Listen for messages from the extension host
window.addEventListener('message', event => {
    const message = event.data;
    console.log("ChatView received message:", message.type); // Log type for debugging

    switch (message.type) {
        case 'loadState':
             clearMessages();
             (message.payload?.history || []).forEach(renderMessage);
             populateDiscussionSelector(message.payload?.discussions, message.payload?.activeDiscussionId);
             setGeneratingStatus(message.payload?.isGenerating || false);
             updateContextStatus(message.payload?.contextFileCount || 0);
             updateModelStatus(message.payload?.statusMessage || 'Ready', message.payload?.statusIsError || false);
             scrollToBottom();
            break;
        case 'updateDiscussionList': // Only update the list and selector
            populateDiscussionSelector(message.payload?.discussions, currentActiveDiscussionId);
            break;
        case 'addMessage':
            renderMessage(message.payload);
            scrollToBottom();
            break;
        case 'generationStatus':
            setGeneratingStatus(message.payload?.isGenerating);
            break;
        case 'contextUpdated':
             updateContextStatus(message.payload?.fileCount || 0);
            break;
        case 'statusUpdate':
             updateModelStatus(message.payload?.message, message.payload?.isError);
            break;
    }
});

// Handle Send button click
if (sendButton) {
    sendButton.addEventListener('click', sendMessage);
}

// Handle Enter key press in textarea
if (messageInput) {
    messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
}

// Handle Discussion Selector change
if (discussionSelector) {
    discussionSelector.addEventListener('change', (event) => {
        const selectedId = event.target.value;
        // Check if selection is valid, different from current, and not generating
        if (selectedId && selectedId !== currentActiveDiscussionId && !isGenerating) {
            console.log("Requesting switch to discussion:", selectedId);
            vscode.postMessage({ command: 'switchDiscussion', payload: { discussionId: selectedId } });
            clearMessages(); // Clear view while switching
            updateModelStatus("Loading discussion...");
             // Optimistically update local tracker, provider confirms via loadState
            currentActiveDiscussionId = selectedId;
            if(deleteDiscussionBtn) deleteDiscussionBtn.disabled = false;
        } else if (!selectedId && deleteDiscussionBtn) {
             // Handle "-- No Discussions --" being selected (or empty value)
             deleteDiscussionBtn.disabled = true;
             currentActiveDiscussionId = null;
        }
    });
}

// Handle New Discussion button click
if (newDiscussionBtn) {
    newDiscussionBtn.addEventListener('click', () => {
        if (!isGenerating) {
            console.log("Requesting new discussion...");
            vscode.postMessage({ command: 'newDiscussion' });
            clearMessages();
            updateModelStatus("Starting new discussion...");
            if(deleteDiscussionBtn) deleteDiscussionBtn.disabled = false; // New discussion can be deleted
        }
    });
}

// Handle Delete Discussion button click
if (deleteDiscussionBtn) {
    deleteDiscussionBtn.addEventListener('click', () => {
        // Use the locally tracked active ID for deletion request
        if (currentActiveDiscussionId && !isGenerating) {
            console.log("Requesting delete discussion:", currentActiveDiscussionId);
            // Let the provider handle confirmation message
            vscode.postMessage({ command: 'deleteDiscussion', payload: { discussionId: currentActiveDiscussionId } });
            clearMessages();
            updateModelStatus("Deleting discussion...");
            if(discussionSelector) discussionSelector.disabled = true; // Temporarily disable selector
            deleteDiscussionBtn.disabled = true; // Disable self
        } else if (!currentActiveDiscussionId) {
            console.warn("Delete button clicked but no active discussion ID tracked.");
        }
    });
}


// --- Initialization ---
// Add checks for element existence before initial operations
if (messageInput) {
    messageInput.focus();
}
// Request initial state when the view loads
vscode.postMessage({ command: 'getViewState' });
console.log("ChatView initialized, requesting state.");