
var toolRouteMap = {
  get_file_tree: 'project-tree',
  execute_shell_command: 'terminal',
  write_file: 'file-write'
};

// 2. Extract tool calls from XML
function extractToolCalls(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "application/xml");
  const toolCalls = Array.from(xmlDoc.getElementsByTagName("tool_call"));
  return toolCalls.map(toolCall => {
    const toolName = toolCall.getElementsByTagName("tool_name")[0]?.textContent.trim();

    // Extract <tool_call_arguments>
    const argsElement = toolCall.getElementsByTagName("tool_call_arguments")[0];
    let toolCallArguments = "";
    if (argsElement) {
      // Check if the first child is a CDATA section
      if (argsElement.firstChild && argsElement.firstChild.nodeType === Node.CDATA_SECTION_NODE) {
        toolCallArguments = argsElement.firstChild.data;
      } else {
        // Fallback: get all text (may include extra whitespace)
        toolCallArguments = argsElement.textContent.trim();
      }
    }
    toolCallArguments = toolCallArguments.startsWith('"') ? toolCallArguments.slice(1) : toolCallArguments;
    toolCallArguments = toolCallArguments.endsWith('"') ? toolCallArguments.slice(0, -1) : toolCallArguments;

    return { toolName, toolCallArguments };
  });
}


function parseToolParameter(toolName, toolCallArguments) {
    if(toolName === 'get_file_tree') {
        const {dir: rootDir, ...rest} = toolCallArguments;
        return {
          rootDir,
          options: {
            ...rest
        }
        };
    } 

    return toolCallArguments;
}

// 3. POST each tool call to its mapped route
async function postToolCalls(toolCalls, baseUrl = "") {
  const retval = [];
  for (const { toolName, toolCallArguments } of toolCalls) {
    // Map tool name to route
    const route = toolRouteMap[toolName];
    if (!route) {
      console.error(`No route mapping for toolName: ${toolName}`);
      continue;
    }

    let body;
    try {
      const payload = JSON.parse(toolCallArguments);
      body = parseToolParameter(toolName, payload)
    } catch (e) {
      console.error(`Failed to parse arguments for ${toolName}:`, toolCallArguments);
      continue;
    }
    body = JSON.stringify(body);

    try {
      const response = await fetch(`${baseUrl}/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "081388040"
        },
        body: body
      });
      const result = await response.json();
      console.log(`Response from ${route} (${toolName}):`, result);
      retval.push(result);
    } catch (err) {
      console.error(`Error calling ${route} (${toolName}):`, err);
      retval.push({ error: `Failed to call ${route}: ${err.message}` });
    }
  }
  return retval;
}

function getSourceValue() {
    const el = document.querySelector(SOURCE_SELECTOR);
    if (!el) return null;
    return el.value || el.textContent;
}

// 4. Find and duplicate Copy buttons as Send buttons
function addSendButtons() {
    const copyElements = document.querySelectorAll('[aria-label="Copy"]');
    
    copyElements.forEach(copyElement => {
        // Check if Send button already exists next to this Copy button
        const nextSibling = copyElement.nextElementSibling;
        if (nextSibling && nextSibling.getAttribute('aria-label') === 'Send') {
            return; // Skip if Send button already exists
        }
        
        // Clone the copy element
        const sendElement = copyElement.cloneNode(true);
        
        // Update the aria-label to "Send"
        sendElement.setAttribute('aria-label', 'Send');
        
        // Update any text content that might say "Copy" to "Send"
        const textNodes = getAllTextNodes(sendElement);
        textNodes.forEach(textNode => {
            if (textNode.textContent.trim().toLowerCase() === 'copy') {
                textNode.textContent = 'Send';
            }
        });
        
        // Update any title attributes
        if (sendElement.title && sendElement.title.toLowerCase().includes('copy')) {
            sendElement.title = sendElement.title.replace(/copy/gi, 'Send');
        }
        
        // Add click event listener for Send functionality
        sendElement.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            // Find the <code> element under this Send button
            const codeElement = findCodeElement(sendElement);
            if (codeElement) {
                const codeContent = codeElement.textContent || codeElement.innerText;
                const response = await callLocalhostApi(codeContent);
                console.log('Send button response: \n', response);
                if (response && !response.error) {
                    setDestinationValue(JSON.stringify(response, null, 2));
                }
            } else {
                console.warn('No <code> element found for this Send button');
            }
        });
        
        // Insert the Send button right after the Copy button
        copyElement.parentNode.insertBefore(sendElement, copyElement.nextSibling);
    });
}

// Helper function to get all text nodes in an element
function getAllTextNodes(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    return textNodes;
}

// Helper function to find the <code> element associated with a Send button
function findCodeElement(sendButton) {
    // Strategy 1: Look for <code> element in the same parent container
    let parent = sendButton.parentElement;
    while (parent && parent !== document.body) {
        const codeElement = parent.querySelector('code');
        if (codeElement) {
            return codeElement;
        }
        parent = parent.parentElement;
    }
    
    // Strategy 2: Look for <code> element in previous siblings
    let sibling = sendButton.previousElementSibling;
    while (sibling) {
        if (sibling.tagName === 'CODE') {
            return sibling;
        }
        const codeInSibling = sibling.querySelector('code');
        if (codeInSibling) {
            return codeInSibling;
        }
        sibling = sibling.previousElementSibling;
    }
    
    // Strategy 3: Look for <code> element in the closest common ancestor with the Copy button
    const copyButton = sendButton.previousElementSibling;
    if (copyButton && copyButton.getAttribute('aria-label') === 'Copy') {
        let commonParent = copyButton.parentElement;
        while (commonParent && commonParent !== document.body) {
            const codeElement = commonParent.querySelector('code');
            if (codeElement) {
                return codeElement;
            }
            commonParent = commonParent.parentElement;
        }
    }
    
    return null;
}

// 5. Initialize the script when DOM is ready
function initializeScript() {
    addSendButtons();
    
    // Set up a MutationObserver to watch for new Copy buttons being added dynamically
    const observer = new MutationObserver((mutations) => {
        let shouldAddSendButtons = false;
        
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the added node or any of its descendants has aria-label="Copy"
                    if (node.getAttribute && node.getAttribute('aria-label') === 'Copy') {
                        shouldAddSendButtons = true;
                    } else if (node.querySelectorAll) {
                        const copyElements = node.querySelectorAll('[aria-label="Copy"]');
                        if (copyElements.length > 0) {
                            shouldAddSendButtons = true;
                        }
                    }
                }
            });
        });
        
        if (shouldAddSendButtons) {
            // Delay slightly to ensure DOM is fully updated
            setTimeout(addSendButtons, 100);
        }
    });
    
    // Start observing the document for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeScript);
} else {
    initializeScript();
}

// 2. Make a POST request to localhost with the value
async function callLocalhostApi(inputValue) {
    try {
        const toolCalls = extractToolCalls(inputValue);
        return await postToolCalls(toolCalls, "http://localhost:3000/api/v1");
    } catch (err) {
        return { error: err.message };
    }
}

// 3. Set the DOM input with the network response
function setDestinationValue(value) {
    const el = document.querySelector('#prompt-textarea > p');
    if (!el) return;
    if ("value" in el) el.value = value;
    else el.textContent = value;
}



