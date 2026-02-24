"""JavaScript validation and execution engine"""

import re
import time
from typing import Tuple, Dict, Any, List, Optional
from src.browser import BrowserManager
from src.config import config

# JavaScript snippets for DOM operations
JS_FILL_FIELD = """
(args) => {
    const element = document.querySelector(args.selector);
    if (!element) {
        throw new Error(`Element not found: ${args.selector}`);
    }
    element.value = args.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}
"""

JS_CLICK_BUTTON = """
(selector) => {
    const element = document.querySelector(selector);
    if (!element) {
        throw new Error(`Button not found: ${selector}`);
    }
    element.click();
}
"""

JS_SELECT_OPTION = """
(args) => {
    const element = document.querySelector(args.selector);
    if (!element) {
        throw new Error(`Select element not found: ${args.selector}`);
    }
    element.value = args.value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
}
"""

JS_CHECK_CHECKBOX = """
(args) => {
    const element = document.querySelector(args.selector);
    if (!element) {
        throw new Error(`Checkbox not found: ${args.selector}`);
    }
    element.checked = args.checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
}
"""

JS_SELECT_RADIO = """
(args) => {
    const selector = `input[type="radio"][name="${args.name}"][value="${args.value}"]`;
    const element = document.querySelector(selector);
    if (!element) {
        throw new Error(`Radio button not found: name="${args.name}" value="${args.value}"`);
    }
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('click', { bubbles: true }));
}
"""

JS_WAIT_FOR_ELEMENT = """
async (args) => {
    const startTime = Date.now();
    while (Date.now() - startTime < args.timeout) {
        if (document.querySelector(args.selector)) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timeout waiting for element: ${args.selector}`);
}
"""


class ExecutionEngine:
    """Validates and executes generated JavaScript code"""

    # Compiled regex patterns for operation parsing
    _OP_PATTERNS = [
        (re.compile(r"await\s+fillField\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]*?)['\"]\s*\)"), "fillField"),
        (re.compile(r"await\s+clickButton\s*\(\s*(?:'([^']*)'|\"([^\"]*)\")\s*\)"), "clickButton"),
        (re.compile(r"await\s+selectOption\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]*?)['\"]\s*\)"), "selectOption"),
        (re.compile(r"await\s+selectRadio\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]*?)['\"]\s*\)"), "selectRadio"),
        (re.compile(r"await\s+checkCheckbox\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*(true|false)\s*\)"), "checkCheckbox"),
        (re.compile(r"await\s+waitForElement\s*\(\s*['\"]([^'\"]+)['\"]\s*(?:,\s*(\d+))?\s*\)"), "waitForElement"),
    ]

    # Compiled regex patterns for code validation
    _DANGEROUS_PATTERNS = [
        (re.compile(r'\beval\s*\('), "eval() not allowed"),
        (re.compile(r'\bFunction\s*\('), "Function constructor not allowed"),
        (re.compile(r'\bfetch\s*\('), "fetch() not allowed"),
        (re.compile(r'\bXMLHttpRequest\b'), "XMLHttpRequest not allowed"),
        (re.compile(r'window\.open\s*\('), "window.open() not allowed"),
        (re.compile(r'location\.href\s*='), "location.href assignment not allowed"),
        (re.compile(r'document\.write\s*\('), "document.write() not allowed"),
        (re.compile(r'\.innerHTML\s*='), "innerHTML assignment not allowed"),
    ]

    _FUNCTION_CALL_PATTERN = re.compile(r'\b(\w+)\s*\(')

    _SUBMIT_CLICK_PATTERN = re.compile(r"await\s+clickButton\s*\(\s*(?:'([^']*)'|\"([^\"]*)\")\s*\)\s*;?")

    def __init__(self, browser: BrowserManager):
        """Initialize execution engine

        Args:
            browser: BrowserManager instance
        """
        self.browser = browser
        self._functions_exposed = False

    # ========== Direct DOM Operation Methods ==========
    # These execute single operations without nested evaluate contexts

    async def _fill_field(self, selector: str, value: str) -> None:
        """Fill a form field with a value"""
        await self.browser.page.evaluate(JS_FILL_FIELD, {"selector": selector, "value": value})

    async def _click_button(self, selector: str) -> None:
        """Click a button"""
        await self.browser.page.evaluate(JS_CLICK_BUTTON, selector)

    async def _select_option(self, selector: str, value: str) -> None:
        """Select a dropdown option"""
        await self.browser.page.evaluate(JS_SELECT_OPTION, {"selector": selector, "value": value})

    async def _check_checkbox(self, selector: str, checked: bool) -> None:
        """Toggle a checkbox"""
        await self.browser.page.evaluate(JS_CHECK_CHECKBOX, {"selector": selector, "checked": checked})

    async def _select_radio(self, name: str, value: str) -> None:
        """Select a radio button by name and value"""
        await self.browser.page.evaluate(JS_SELECT_RADIO, {"name": name, "value": value})

    async def _wait_for_element(self, selector: str, timeout: int = 5000) -> None:
        """Wait for an element to appear"""
        await self.browser.page.evaluate(JS_WAIT_FOR_ELEMENT, {"selector": selector, "timeout": timeout})

    # ========== Code Parsing ==========

    def _parse_operations(self, code: str) -> List[Dict[str, Any]]:
        """Parse generated code to extract operations in execution order

        Args:
            code: Generated JavaScript code

        Returns:
            List of operation dicts with type and arguments
        """
        # Find all matches with positions
        all_matches = []
        for pattern, op_type in self._OP_PATTERNS:
            for match in pattern.finditer(code):
                all_matches.append((match.start(), op_type, match))

        # Sort by position to preserve execution order
        all_matches.sort(key=lambda x: x[0])

        # Extract operations
        operations = []
        for pos, op_type, match in all_matches:
            if op_type == "fillField":
                operations.append({
                    "type": "fillField",
                    "selector": match.group(1),
                    "value": match.group(2)
                })
            elif op_type == "clickButton":
                # Selector is in group 1 (single-quoted) or group 2 (double-quoted)
                operations.append({
                    "type": "clickButton",
                    "selector": match.group(1) or match.group(2)
                })
            elif op_type == "selectOption":
                operations.append({
                    "type": "selectOption",
                    "selector": match.group(1),
                    "value": match.group(2)
                })
            elif op_type == "selectRadio":
                operations.append({
                    "type": "selectRadio",
                    "name": match.group(1),
                    "value": match.group(2)
                })
            elif op_type == "checkCheckbox":
                operations.append({
                    "type": "checkCheckbox",
                    "selector": match.group(1),
                    "checked": match.group(2) == "true"
                })
            elif op_type == "waitForElement":
                operations.append({
                    "type": "waitForElement",
                    "selector": match.group(1),
                    "timeout": int(match.group(2)) if match.group(2) else 5000
                })

        return operations

    def validate_code(self, code: str) -> Tuple[bool, Optional[str]]:
        """Validate JavaScript code for safety

        Checks:
        1. Syntax validity (basic structure check)
        2. Only allowed API functions are called
        3. No dangerous operations (eval, fetch, etc.)
        4. Async function structure
        5. Reasonable code length

        Args:
            code: JavaScript code to validate

        Returns:
            (is_valid, error_message)
        """
        # Check for dangerous patterns
        for pattern, error_msg in self._DANGEROUS_PATTERNS:
            if pattern.search(code):
                return False, f"Dangerous operation detected: {error_msg}"

        # Check for async function structure
        if 'async function fillForm()' not in code:
            return False, "Code must define 'async function fillForm()'"

        # Check length
        if len(code) > 5000:
            return False, "Generated code exceeds maximum length (5000 chars)"

        # Extract function calls and verify they're allowed
        function_calls = self._FUNCTION_CALL_PATTERN.findall(code)

        # Allowed functions (API + standard JS)
        allowed = set(config.ALLOWED_APIS + [
            'fillForm', 'console', 'log', 'warn', 'error', 'await'
        ])

        for func in function_calls:
            if func not in allowed and not func.startswith('_'):
                return False, f"Unauthorized function call: {func}()"

        # If all checks pass
        return True, None

    def extract_submit_click(self, code: str) -> Tuple[str, Optional[str]]:
        """Extract last clickButton call (likely submit) from generated code

        Args:
            code: Generated JavaScript code

        Returns:
            (modified_code, submit_selector) - code without submit click, and the selector
        """
        # Find all clickButton calls
        # Handle both 'selector' and "selector" (selector may contain opposite quote type)
        matches = list(self._SUBMIT_CLICK_PATTERN.finditer(code))

        if not matches:
            return code, None

        # Get the last match (most likely the submit button)
        last_match = matches[-1]
        # Selector is in group 1 (single-quoted) or group 2 (double-quoted)
        selector = last_match.group(1) or last_match.group(2)

        # Remove the last clickButton call from code
        modified_code = code[:last_match.start()] + code[last_match.end():]

        return modified_code, selector

    async def execute(self, code: str) -> Dict[str, Any]:
        """Execute generated JavaScript code by parsing and running operations directly

        This approach avoids nested page.evaluate() calls which can cause
        "Execution context was destroyed" errors when events trigger navigation.

        Args:
            code: Generated JavaScript code (parsed, not evaluated)

        Returns:
            {
                "success": bool,
                "steps": list[dict],  # Actions taken
                "error": dict | None, # Error details if failed
                "execution_time": float  # Seconds
            }
        """
        start_time = time.time()
        steps = []

        try:
            # Parse code to extract operations
            operations = self._parse_operations(code)

            if not operations:
                return {
                    "success": False,
                    "steps": [],
                    "error": {
                        "type": "parse_error",
                        "message": "No valid operations found in generated code",
                        "details": {}
                    },
                    "execution_time": time.time() - start_time
                }

            # Execute each operation directly from Python
            for op in operations:
                op_type = op["type"]

                if op_type == "fillField":
                    await self._fill_field(op["selector"], op["value"])
                    steps.append({"action": "fillField", "selector": op["selector"], "value": op["value"]})

                elif op_type == "clickButton":
                    await self._click_button(op["selector"])
                    steps.append({"action": "clickButton", "selector": op["selector"]})

                elif op_type == "selectOption":
                    await self._select_option(op["selector"], op["value"])
                    steps.append({"action": "selectOption", "selector": op["selector"], "value": op["value"]})

                elif op_type == "selectRadio":
                    await self._select_radio(op["name"], op["value"])
                    steps.append({"action": "selectRadio", "name": op["name"], "value": op["value"]})

                elif op_type == "checkCheckbox":
                    await self._check_checkbox(op["selector"], op["checked"])
                    steps.append({"action": "checkCheckbox", "selector": op["selector"], "checked": op["checked"]})

                elif op_type == "waitForElement":
                    await self._wait_for_element(op["selector"], op["timeout"])
                    steps.append({"action": "waitForElement", "selector": op["selector"]})

            return {
                "success": True,
                "steps": steps,
                "error": None,
                "execution_time": time.time() - start_time
            }

        except Exception as e:
            execution_time = time.time() - start_time

            # Parse error message for better context
            error_type = "execution_error"
            error_msg = str(e)

            if "not found" in error_msg.lower():
                error_type = "selector_error"

            return {
                "success": False,
                "steps": steps,
                "error": {
                    "type": error_type,
                    "message": error_msg,
                    "details": {}
                },
                "execution_time": execution_time
            }
