const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Path to the Playwright test file
const testFile = 'example.test.js';  // Update with your test file name if needed
const testCode = fs.readFileSync(testFile, 'utf-8');

// Parse the test file into AST
const ast = parser.parse(testCode, {
  sourceType: 'module',
  plugins: ['jsx'],
});

// Initialize a Mermaid diagram structure
let mermaidDiagram = `%%{init: {"themeVariables": {"fontSize": "16px", "nodeBorder": "1px solid #333", "nodeTextColor": "#333", "edgeColor": "#333", "nodeBackground": "#fff", "edgeLabelBackground": "#ffffff"} }}%%\n`;
mermaidDiagram += `flowchart TD\n`;

// Counter for nodes and steps
let stepCounter = 1;
let lastNode = '';  // Last node within a test case
let currentSubgraph = '';  // Track current subgraph for each test case

// Map to track existing nodes (to avoid duplicates)
let nodeMap = {};

// Function to generate unique node keys for tracking
function generateNodeKey(action, value, extra = '') {
  return `${action}:${value}:${extra}`;
}

// Helper function to clean URLs (remove 'https://')
function cleanUrl(text) {
  return text.replace('https://', '');
}

// Traverse AST to handle multiple test cases
traverse(ast, {
  CallExpression(path) {
    const { callee, arguments: args } = path.node;

    // Identify test cases by matching `test()` call
    if (callee.type === 'Identifier' && callee.name === 'test') {
      const testName = args[0].value;
      // Updated check for @manual tag
      const isManual = args[1] && args[1].type === 'ObjectExpression' && args[1].properties.some(prop => 
        prop.key.name === 'tag' && prop.value.value && prop.value.value.includes('@manual')
      );

      // Start a new subgraph for each test case
      const subgraphLabel = isManual ? `Manual test - ${testName}` : testName;
      mermaidDiagram += `    subgraph "${subgraphLabel}"\n`;
      currentSubgraph = subgraphLabel; // Track the current subgraph

      // Reset lastNode for each test
      lastNode = '';
    }

    // Handle Playwright actions within the test cases
    if (callee.type === 'MemberExpression') {
      const action = callee.property.name;
      let newNode = '';
      let nodeKey = '';

      // Handle 'goto' action (navigation)
      if (action === 'goto') {
        let url = path.node.arguments[0].value;

        // Remove 'https://' from the URL
        url = cleanUrl(url);

        nodeKey = generateNodeKey('goto', url);

        if (!nodeMap[nodeKey]) {
          newNode = `B${stepCounter}("fa:fa-globe Navigate to ${url}")`;
          mermaidDiagram += `        ${newNode}\n`;
          if (lastNode) {
            mermaidDiagram += `        ${lastNode} --> ${newNode}\n`;
          }
          nodeMap[nodeKey] = `B${stepCounter}`;  // Store the node in the map
          stepCounter++;
        }

        lastNode = nodeMap[nodeKey];  // Reuse the existing node
      }

      // Handle 'click' action (clicking a selector)
      if (action === 'click') {
        const selector = path.node.arguments[0].value;
        nodeKey = generateNodeKey('click', selector);

        if (!nodeMap[nodeKey]) {
          newNode = `C${stepCounter}("fa:fa-mouse-pointer Click ${selector}")`;
          mermaidDiagram += `        ${newNode}\n        ${lastNode} --> ${newNode}\n`;
          nodeMap[nodeKey] = `C${stepCounter}`;  // Store the node in the map
          stepCounter++;
        }

        lastNode = nodeMap[nodeKey];  // Reuse the existing node
      }

      // Handle 'fill' action (filling a form field)
      if (action === 'fill') {
        const selector = path.node.arguments[0].value;
        const value = path.node.arguments[1].value;
        nodeKey = generateNodeKey('fill', selector, value); // Include value to track different inputs

        if (!nodeMap[nodeKey]) {
          newNode = `D${stepCounter}("fa:fa-keyboard Fill ${selector} with '${value}'")`;
          mermaidDiagram += `        ${newNode}\n        ${lastNode} --> ${newNode}\n`;
          nodeMap[nodeKey] = `D${stepCounter}`;  // Store the node in the map with the value
          stepCounter++;
        }

        lastNode = nodeMap[nodeKey];  // Reuse the existing node
      }
    }

    // Handle 'expect' action (assertion)
    if (callee.type === 'Identifier' && callee.name === 'expect') {
      let assertionType = '';
      let assertionDetail = '';

      // Check if the first argument is a CallExpression (like page.getByText)
      if (args[0].type === 'CallExpression' && args[0].callee.type === 'MemberExpression') {
        // Get the assertion type (e.g., toBeVisible)
        assertionType = args[0].callee.property.name;  // Extract assertion type

        // Check if the CallExpression is using getByText
        if (args[0].callee.property.name === 'getByText' && args[0].arguments.length > 0) {
          const textContent = args[0].arguments[0].value || '';
          assertionDetail = `'${textContent}'`; // Ensure it's wrapped in quotes
        }
      } else if (args[0].type === 'MemberExpression') {
        // Handle cases where the first argument is something like page
        assertionDetail = 'page';
      }

      // Capture assertion details for regular StringLiteral arguments
      if (args[0].type === 'StringLiteral') {
        assertionDetail = cleanUrl(args[0].value);  // Remove 'https://' from URL
      } else if (args[0].type === 'RegExpLiteral') {
        assertionDetail = `/${args[0].pattern}/${args[0].flags}`;  // Extract the regex, e.g., '/dashboard/'
      }

      // Traverse up for chained assertions (toBeVisible, toHaveURL, etc.)
      let currentPath = path;
      let foundAssertion = false;

      while (currentPath && currentPath.parent) {
        if (currentPath.parent.type === 'CallExpression' && currentPath.parent.callee.type === 'MemberExpression') {
          assertionType = currentPath.parent.callee.property.name;  // Extract assertion type

          // Capture the argument for the assertion
          if (currentPath.parent.arguments && currentPath.parent.arguments.length > 0) {
            const firstArg = currentPath.parent.arguments[0];

            // Handle getByText
            if (firstArg.type === 'CallExpression' && firstArg.callee.property.name === 'getByText') {
              const textContent = firstArg.arguments[0].value || '';  // Extract text from getByText()
              assertionDetail = `'${textContent}'`; // Ensure it's wrapped in quotes
            } else if (firstArg.type === 'StringLiteral') {
              assertionDetail = cleanUrl(firstArg.value);  // Remove 'https://' from URL
            }

            // Handle regular expressions
            if (firstArg.type === 'RegExpLiteral') {
              assertionDetail = `/${firstArg.pattern}/${firstArg.flags}`;  // Extract the regex, e.g., '/dashboard/'
            }
          }

          foundAssertion = true;
          break;
        }

        currentPath = currentPath.parentPath;
      }

      // Once the assertion is found, log the details
      if (foundAssertion) {
        let newNode = `E${stepCounter}("fa:fa-check Assertion: ${assertionDetail} ${assertionType}")`;
        mermaidDiagram += `        ${newNode}\n        ${lastNode} --> ${newNode}\n`;
        lastNode = newNode;  // Update lastNode to the new assertion node
        stepCounter++;
      }
    }
  },

  // Close subgraphs when traversal ends
  exit(path) {
    const { callee } = path.node;
    if (callee && callee.type === 'Identifier' && callee.name === 'test') {
      mermaidDiagram += `    end\n`;
    }
  },
});

// Save the Mermaid diagram to a file
fs.writeFileSync('output.mermaid', mermaidDiagram);

console.log(mermaidDiagram);
