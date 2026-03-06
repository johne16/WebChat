"""Tests for browser.py - Playwright wrapper and HTML preprocessing"""

import pytest
from src.browser import BrowserManager


@pytest.mark.asyncio
async def test_browser_launch_and_close():
    """Test browser launches and closes cleanly"""
    browser = BrowserManager(headless=True)
    await browser.launch()

    assert browser.browser is not None
    assert browser.page is not None

    await browser.close()


@pytest.mark.asyncio
async def test_navigate_to_valid_url():
    """Test navigation to a valid URL"""
    browser = BrowserManager(headless=True)
    await browser.launch()

    result = await browser.navigate("https://example.com")
    assert result["success"] is True

    await browser.close()


@pytest.mark.asyncio
async def test_navigate_to_invalid_url():
    """Test navigation to invalid URL fails gracefully"""
    browser = BrowserManager(headless=True, timeout=5000)
    await browser.launch()

    result = await browser.navigate("http://invalid-url-that-does-not-exist-12345.com")
    assert result["success"] is False

    await browser.close()


@pytest.mark.asyncio
async def test_get_raw_html():
    """Test raw HTML extraction"""
    browser = BrowserManager(headless=True)
    await browser.launch()
    await browser.navigate("https://example.com")

    html = await browser.get_raw_html()

    assert len(html) > 0
    assert "<!DOCTYPE" in html or "<html" in html

    await browser.close()


@pytest.mark.asyncio
async def test_execute_js():
    """Test JavaScript execution in page context"""
    browser = BrowserManager(headless=True)
    await browser.launch()
    await browser.navigate("https://example.com")

    result = await browser.execute_js("1 + 1")

    assert result["success"] is True
    assert result["result"] == 2
    assert result["error"] is None

    await browser.close()


@pytest.mark.asyncio
async def test_execute_js_with_error():
    """Test JavaScript execution with error"""
    browser = BrowserManager(headless=True)
    await browser.launch()
    await browser.navigate("https://example.com")

    result = await browser.execute_js("throw new Error('test error')")

    assert result["success"] is False
    assert result["error"] is not None

    await browser.close()


@pytest.mark.asyncio
async def test_format_for_llm_empty():
    """Test formatting empty form data"""
    browser = BrowserManager(headless=True)

    result = browser._format_for_llm([])

    assert result is None


@pytest.mark.asyncio
async def test_format_for_llm_simple_form():
    """Test formatting simple form data"""
    browser = BrowserManager(headless=True)

    form_data = [{
        "id": "login",
        "action": "/login",
        "method": "post",
        "fields": [
            {
                "tag": "input",
                "type": "email",
                "id": "email",
                "name": "email",
                "label": "Email",
                "placeholder": "",
                "required": True
            }
        ],
        "buttons": [
            {
                "type": "submit",
                "text": "Login",
                "id": "submit-btn",
                "name": ""
            }
        ]
    }]

    result = browser._format_for_llm(form_data)

    assert "<form" in result
    assert 'id="email"' in result
    assert "Email" in result
    assert "<button" in result
    assert "Login" in result


def test_format_for_llm_radio_fields():
    """Test formatting radio button fields"""
    browser = BrowserManager(headless=True)

    form_data = [{
        "id": "plan-form",
        "action": "/select",
        "method": "post",
        "fields": [
            {
                "tag": "input",
                "type": "radio",
                "id": "plan-basic",
                "name": "plan",
                "label": "Basic Plan",
                "placeholder": "",
                "required": False,
                "value": "basic",
                "checked": True
            },
            {
                "tag": "input",
                "type": "radio",
                "id": "plan-premium",
                "name": "plan",
                "label": "Premium Plan",
                "placeholder": "",
                "required": False,
                "value": "premium",
                "checked": False
            }
        ],
        "buttons": []
    }]

    result = browser._format_for_llm(form_data)

    assert 'type="radio"' in result
    assert 'value="basic"' in result
    assert 'value="premium"' in result
    assert " checked" in result
    assert "Basic Plan" in result


def test_format_for_llm_checkbox_field():
    """Test formatting checkbox field"""
    browser = BrowserManager(headless=True)

    form_data = [{
        "id": "",
        "action": "/submit",
        "method": "post",
        "fields": [
            {
                "tag": "input",
                "type": "checkbox",
                "id": "terms",
                "name": "terms",
                "label": "I agree to terms",
                "placeholder": "",
                "required": True,
                "value": "yes",
                "checked": False
            }
        ],
        "buttons": []
    }]

    result = browser._format_for_llm(form_data)

    assert 'type="checkbox"' in result
    assert 'id="terms"' in result
    assert "required" in result
    assert "I agree to terms" in result
    assert " checked" not in result  # not checked


def test_format_for_llm_select_field():
    """Test formatting select dropdown field"""
    browser = BrowserManager(headless=True)

    form_data = [{
        "id": "",
        "action": "/submit",
        "method": "post",
        "fields": [
            {
                "tag": "select",
                "type": "",
                "id": "state",
                "name": "state",
                "label": "State",
                "placeholder": "",
                "required": True,
                "options": [
                    {"value": "", "text": "Select...", "selected": True},
                    {"value": "TX", "text": "Texas", "selected": False},
                    {"value": "CA", "text": "California", "selected": False}
                ]
            }
        ],
        "buttons": []
    }]

    result = browser._format_for_llm(form_data)

    assert "<select" in result
    assert 'id="state"' in result
    assert "required" in result
    assert '<option value="TX"' in result
    assert "Texas</option>" in result
    assert "selected" in result  # first option is selected
    assert "State" in result


@pytest.mark.asyncio
async def test_build_page_context_structure():
    """Test build_page_context returns correct structure"""
    from unittest.mock import AsyncMock, MagicMock, PropertyMock

    browser = BrowserManager(headless=True)
    browser.page = MagicMock()
    browser.page.url = "http://example.com/test"
    browser.get_page_title = AsyncMock(return_value="Test Page")
    browser.get_form_elements = AsyncMock(return_value="<form>...</form>")
    browser.get_page_links = AsyncMock(return_value='Links on page:\n  - "Home" -> /')
    browser.get_page_buttons = AsyncMock(return_value=None)
    browser.get_readable_content = AsyncMock(return_value="Some page text")

    result = await browser.build_page_context()

    assert "context" in result
    assert "timings" in result
    assert "pageContextSize" in result
    assert result["timings"]["pageExtraction"] >= 0

    ctx = result["context"]
    assert "## Current Page" in ctx
    assert "http://example.com/test" in ctx
    assert "Test Page" in ctx
    assert "## Forms on Page" in ctx
    assert "## Available Links" in ctx
    assert "Available Buttons" not in ctx  # None was returned
    assert "Some page text" in ctx