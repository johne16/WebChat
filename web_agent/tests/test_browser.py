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