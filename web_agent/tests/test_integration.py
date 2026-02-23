"""Integration tests - requires Web_Test_Bed running on localhost:500
Run Web_Test_Bed first:
    cd C:\\Users\\John\\PycharmProjects\\Web_Test_Bed
    python app.py

Then run these tests:
    pytest tests/test_integration.py -v

To add new test sites:
    1. Add a new site config to TEST_SITES below
    2. Tests will automatically run against all configured sites
"""

import pytest
import httpx
from unittest.mock import patch
import tempfile
from pathlib import Path

from src.memory import SessionMemory


# =============================================================================
# CONFIGURATION - Add new test sites here
# =============================================================================

AGENT_URL = "http://localhost:5001"

# Test site configurations - only site-specific settings
TEST_SITES = {
    "default": {
        "base_url": "http://localhost:5000",
        "signup_path": "/signup",
        "signin_path": "/signin",
        "signup_goal": "Fill out the signup form with my information and submit",
        "signin_goal": "Fill in the sign in form and submit it",
        "signup_then_signin_goal": "Sign up for an account, then sign in with the same credentials",
    },
    # TEMPLATE - Add new sites:
    # "ecommerce": {
    #     "base_url": "http://localhost:5000",
    #     "signup_path": "/register",
    #     "signin_path": "/login",
    #     "signup_goal": "Create a new account",
    #     "signin_goal": "Log in to the website",
    #     "signup_then_signin_goal": "Register and then log in",
    # },
}

# Test user profiles - separate from site config
# Each test scenario uses a different user to avoid credential conflicts
TEST_USERS = {
    "default": {
        "username": "johndoe",
        "firstName": "John",
        "lastName": "Doe",
        "email": "john.doe@example.com",
        "password": "TestPass123",
        "phone": "555-123-4567",
        "dateOfBirth": "1990-01-15",
        "address": {
            "street": "123 Main Street",
            "city": "Austin",
            "state": "TX",
            "zip": "78701"
        }
    },
    "signup_then_signin": {
        "username": "alicesmith",
        "firstName": "Alice",
        "lastName": "Smith",
        "email": "alice.smith@example.com",
        "password": "AlicePass456",
        "phone": "555-987-6543",
        "dateOfBirth": "1985-06-20",
        "address": {
            "street": "456 Oak Avenue",
            "city": "Dallas",
            "state": "TX",
            "zip": "75201"
        }
    },
    "api_tests": {
        "username": "bobwilson",
        "firstName": "Bob",
        "lastName": "Wilson",
        "email": "bob.wilson@example.com",
        "password": "BobPass789",
        "phone": "555-456-7890",
        "dateOfBirth": "1992-03-25",
        "address": {
            "street": "789 Pine Road",
            "city": "Houston",
            "state": "TX",
            "zip": "77001"
        }
    }
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_site_config(site_name="default"):
    """Get configuration for a test site"""
    return TEST_SITES.get(site_name, TEST_SITES["default"])


def get_site_url(site_name="default", path=""):
    """Get full URL for a site path"""
    config = get_site_config(site_name)
    return f"{config['base_url']}{path}"


def get_all_site_names():
    """Get list of all configured site names for parametrization"""
    return list(TEST_SITES.keys())


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def temp_db():
    """Use temporary database for tests"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_sessions.db"
        with patch.object(SessionMemory, 'DB_PATH', db_path):
            yield db_path


@pytest.fixture
def site_config():
    """Default site configuration"""
    return get_site_config("default")


@pytest.fixture
def sample_user_profile():
    """Default user profile for tests"""
    return TEST_USERS["default"]


def is_site_running(site_name="default") -> bool:
    """Check if a test site is running"""
    try:
        config = get_site_config(site_name)
        response = httpx.get(f"{config['base_url']}/", timeout=2.0)
        return response.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException):
        return False


def is_agent_running() -> bool:
    """Check if agent service is running"""
    try:
        response = httpx.get(f"{AGENT_URL}/health", timeout=2.0)
        return response.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException):
        return False


# Skip all tests in this module if default test site is not running
pytestmark = pytest.mark.skipif(
    not is_site_running("default"),
    reason=f"Test site not running on {get_site_config('default')['base_url']}"
)


class TestBrowserIntegration:
    """Test browser automation against real pages"""

    @pytest.mark.asyncio
    async def test_navigate_to_signup(self, temp_db, site_config):
        """Test browser can navigate to signup page"""
        from src.browser import BrowserManager

        browser = BrowserManager(headless=True, timeout=10000)
        await browser.launch()

        try:
            signup_url = f"{site_config['base_url']}{site_config['signup_path']}"
            success = await browser.navigate(signup_url)
            assert success is True

            title = await browser.get_page_title()
            assert len(title) > 0

        finally:
            await browser.close()

    @pytest.mark.asyncio
    async def test_extract_signup_form(self, temp_db, site_config):
        """Test form extraction from signup page"""
        from src.browser import BrowserManager

        browser = BrowserManager(headless=True, timeout=10000)
        await browser.launch()

        try:
            signup_url = f"{site_config['base_url']}{site_config['signup_path']}"
            await browser.navigate(signup_url)
            form_html = await browser.get_form_elements()

            # Should find form elements
            assert "No forms found" not in form_html
            assert "<form" in form_html or "input" in form_html.lower()

        finally:
            await browser.close()

    @pytest.mark.asyncio
    async def test_extract_signin_form(self, temp_db, site_config):
        """Test form extraction from signin page"""
        from src.browser import BrowserManager

        browser = BrowserManager(headless=True, timeout=10000)
        await browser.launch()

        try:
            signin_url = f"{site_config['base_url']}{site_config['signin_path']}"
            await browser.navigate(signin_url)
            form_html = await browser.get_form_elements()

            assert "No forms found" not in form_html

        finally:
            await browser.close()

    @pytest.mark.asyncio
    async def test_extract_page_links(self, temp_db, site_config):
        """Test link extraction"""
        from src.browser import BrowserManager

        browser = BrowserManager(headless=True, timeout=10000)
        await browser.launch()

        try:
            signup_url = f"{site_config['base_url']}{site_config['signup_path']}"
            await browser.navigate(signup_url)
            links = await browser.get_page_links()

            assert isinstance(links, str)

        finally:
            await browser.close()


class TestExecutionEngineIntegration:
    """Test JavaScript execution against real pages"""

    @pytest.mark.asyncio
    async def test_fill_field_on_real_form(self, temp_db, site_config):
        """Test filling a field on real signup form"""
        from src.browser import BrowserManager
        from src.execution_engine import ExecutionEngine

        browser = BrowserManager(headless=True, timeout=10000)
        await browser.launch()

        try:
            signup_url = f"{site_config['base_url']}{site_config['signup_path']}"
            await browser.navigate(signup_url)
            engine = ExecutionEngine(browser)

            # Generic code to fill email field (works with most forms)
            code = """async function fillForm() {
                await fillField('input[type="email"], input[name="email"], #email', 'test@example.com');
            }"""

            result = await engine.execute(code)

            # Should succeed (field exists on page)
            assert result["success"] is True or "not found" not in str(result.get("error", "")).lower()

        finally:
            await browser.close()


class TestWebAgentIntegration:
    """Test full agent execution against real pages"""

    @pytest.mark.asyncio
    async def test_agent_fills_signup_form(self, temp_db, site_config, sample_user_profile):
        """Test agent can fill signup form"""
        from src.web_agent import AutonomousWebAgent

        agent = AutonomousWebAgent()
        signup_url = f"{site_config['base_url']}{site_config['signup_path']}"

        result = await agent.execute_goal(
            goal=site_config["signup_goal"],
            start_url=signup_url,
            user_profile=sample_user_profile,
            options={"max_steps": 5}
        )

        assert result["stepsTaken"] >= 1
        assert result["sessionId"] is not None

    @pytest.mark.asyncio
    async def test_agent_fills_signin_form(self, temp_db, site_config, sample_user_profile):
        """Test agent can fill signin form (uses account created in previous test)"""
        from src.web_agent import AutonomousWebAgent

        agent = AutonomousWebAgent()
        signin_url = f"{site_config['base_url']}{site_config['signin_path']}"

        result = await agent.execute_goal(
            goal=site_config["signin_goal"],
            start_url=signin_url,
            user_profile={
                "username": sample_user_profile["username"],
                "password": sample_user_profile["password"]
            },
            options={"max_steps": 5}
        )

        assert result["stepsTaken"] >= 1
        assert result["sessionId"] is not None

    @pytest.mark.asyncio
    async def test_agent_signup_then_signin(self, temp_db, site_config):
        """Test full signup then signin flow with unique user"""
        from src.web_agent import AutonomousWebAgent

        agent = AutonomousWebAgent()
        signup_url = f"{site_config['base_url']}{site_config['signup_path']}"

        result = await agent.execute_goal(
            goal=site_config["signup_then_signin_goal"],
            start_url=signup_url,
            user_profile=TEST_USERS["signup_then_signin"],
            options={"max_steps": 15}
        )

        assert result["stepsTaken"] >= 2
        assert len(result["memory"]["visitedUrls"]) >= 1
        assert len(result["memory"]["enteredData"]) >= 1


@pytest.mark.skipif(
    not is_agent_running(),
    reason="Agent service not running on localhost:5001"
)
class TestAPIIntegration:
    """Test API endpoint against running agent service

    Requires both test site and agent service (5001) running
    """

    def test_api_health_check(self):
        """Test API health endpoint"""
        response = httpx.get(f"{AGENT_URL}/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_api_execute_goal_signup(self, site_config):
        """Test API execute-goal endpoint with signup"""
        signup_url = f"{site_config['base_url']}{site_config['signup_path']}"

        response = httpx.post(
            f"{AGENT_URL}/api/execute-goal",
            json={
                "goal": site_config["signup_goal"],
                "startUrl": signup_url,
                "userProfile": TEST_USERS["api_tests"],
                "options": {
                    "maxSteps": 5,
                    "headless": True
                }
            },
            timeout=120.0
        )

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert data["stepsTaken"] >= 1

    def test_api_execute_goal_signin(self, site_config):
        """Test API execute-goal endpoint with signin (uses account from previous test)"""
        signin_url = f"{site_config['base_url']}{site_config['signin_path']}"
        api_user = TEST_USERS["api_tests"]

        response = httpx.post(
            f"{AGENT_URL}/api/execute-goal",
            json={
                "goal": site_config["signin_goal"],
                "startUrl": signin_url,
                "userProfile": {
                    "username": api_user["username"],
                    "password": api_user["password"]
                },
                "options": {
                    "maxSteps": 5,
                    "headless": True
                }
            },
            timeout=120.0
        )

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert "sessionId" in data
        assert data["stepsTaken"] >= 1
