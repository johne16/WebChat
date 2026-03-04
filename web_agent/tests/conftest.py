"""Pytest fixtures for Web Form-Filling Agent tests"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from src.browser import BrowserManager
from src.config import Config


@pytest.fixture
async def browser():
    """Provide browser instance for tests"""
    manager = BrowserManager(headless=True, timeout=30000)
    await manager.launch()
    yield manager
    await manager.close()


@pytest.fixture
def mock_llm_client():
    """Mock LLM client for testing without API calls"""
    mock = MagicMock()
    mock.provider = "openai"
    mock.generate_fill_code = AsyncMock(return_value={
        "code": "async function fillForm() { await fillField('#email', 'test@example.com'); await clickButton('button[type=\"submit\"]'); }",
        "tokens_used": 150,
        "model": "gpt-5.2",
        "reasoning": None
    })
    mock.generate_plan = AsyncMock(return_value={
        "action": "fill_form",
        "params": {"submit": True},
        "reasoning": "Need to fill the form",
        "goal_status": "in_progress",
        "tokens_used": 100
    })
    return mock


@pytest.fixture
def sample_user_profile():
    """Sample user profile for tests"""
    return {
        "firstName": "Test",
        "lastName": "User",
        "email": "test@example.com",
        "phone": "555-0123",
        "password": "TestPass123",
        "dateOfBirth": "1990-01-01",
        "address": {
            "street": "123 Test St",
            "city": "TestCity",
            "state": "TX",
            "zip": "12345"
        }
    }


@pytest.fixture
def simple_form_html():
    """Simple form HTML for testing"""
    return """
    <form action="/submit" method="post">
      <input id="email" name="email" type="email" required /> (Email)
      <input id="password" name="password" type="password" required /> (Password)
      <button type="submit">Submit</button>
    </form>
    """


@pytest.fixture
def complex_form_html():
    """Complex form HTML for testing"""
    return """
    <form action="/signup" method="post">
      <input id="firstName" name="first_name" type="text" required /> (First Name)
      <input id="lastName" name="last_name" type="text" required /> (Last Name)
      <input id="email" name="email" type="email" required /> (Email)
      <input id="phone" name="phone" type="tel" /> (Phone)
      <select id="state" name="state">
        <option value="TX">Texas</option>
        <option value="CA">California</option>
      </select>
      <button type="submit">Sign Up</button>
    </form>
    """


@pytest.fixture
def valid_js_code():
    """Valid JavaScript code for testing"""
    return """
    async function fillForm() {
      await fillField('#email', 'test@example.com');
      await fillField('#password', 'password123');
    }
    """


@pytest.fixture
def dangerous_js_code():
    """Dangerous JavaScript code for testing validation"""
    return """
    async function fillForm() {
      eval('alert("hacked")');
      await fillField('#email', 'test@example.com');
    }
    """
