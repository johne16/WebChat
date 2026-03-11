"""Pytest fixtures for Web Form-Filling Agent tests"""

import pytest


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
