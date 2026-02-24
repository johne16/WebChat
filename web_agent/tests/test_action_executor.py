"""Tests for action_executor.py - Action execution"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import tempfile
from pathlib import Path

from src.action_executor import ActionExecutor, ActionResult
from src.memory import SessionMemory


@pytest.fixture
def temp_db():
    """Use temporary database for tests"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_sessions.db"
        with patch.object(SessionMemory, 'DB_PATH', db_path):
            yield db_path


@pytest.fixture
def mock_browser():
    """Mock browser manager"""
    browser = MagicMock()
    browser.page = MagicMock()
    browser.page.url = "http://example.com/form"
    browser.page.click = AsyncMock()
    browser.page.wait_for_load_state = AsyncMock()
    browser.page.wait_for_selector = AsyncMock()
    browser.page.wait_for_url = AsyncMock()
    browser.page.evaluate = AsyncMock()
    browser.get_form_elements = AsyncMock(return_value="<form><input id='email'></form>")
    browser.get_readable_content = AsyncMock(return_value="Page content")
    browser.go_back = AsyncMock(return_value={"success": True, "error": None})
    browser.scroll = AsyncMock()
    return browser


@pytest.fixture
def mock_execution_engine():
    """Mock execution engine"""
    engine = MagicMock()
    engine.validate_code = MagicMock(return_value=(True, None))
    engine.extract_submit_click = MagicMock(return_value=("code", "button[type='submit']"))
    engine.execute = AsyncMock(return_value={
        "success": True,
        "steps": [{"action": "fillField", "selector": "#email"}],
        "error": None
    })
    return engine


@pytest.fixture
def mock_llm():
    """Mock LLM client"""
    llm = MagicMock()
    llm.generate_fill_code = AsyncMock(return_value={
        "code": "async function fillForm() { await fillField('#email', 'test@example.com'); await clickButton('button[type=\"submit\"]'); }",
        "tokens_used": 100
    })
    return llm


@pytest.fixture
def action_executor(temp_db, mock_browser, mock_execution_engine, mock_llm):
    """Create ActionExecutor with mocked dependencies"""
    memory = SessionMemory()
    return ActionExecutor(mock_browser, mock_execution_engine, memory, mock_llm)


class TestActionResult:
    """Tests for ActionResult dataclass"""

    def test_action_result_success(self):
        """Test successful ActionResult"""
        result = ActionResult(
            success=True,
            action_type="fill_form",
            details={"fields_filled": 3}
        )

        assert result.success is True
        assert result.action_type == "fill_form"
        assert result.error is None
        assert result.navigated is False

    def test_action_result_with_navigation(self):
        """Test ActionResult with navigation"""
        result = ActionResult(
            success=True,
            action_type="click_link",
            details={},
            navigated=True,
            new_url="http://example.com/next"
        )

        assert result.navigated is True
        assert result.new_url == "http://example.com/next"

    def test_action_result_failure(self):
        """Test failed ActionResult"""
        result = ActionResult(
            success=False,
            action_type="fill_form",
            details={},
            error={"type": "selector_error", "message": "Element not found", "details": {}}
        )

        assert result.success is False
        assert result.error["message"] == "Element not found"


class TestActionExecutor:
    """Tests for ActionExecutor class"""

    @pytest.mark.asyncio
    async def test_execute_unknown_action(self, action_executor):
        """Test executing unknown action type returns error"""
        result = await action_executor.execute_action(
            action_type="unknown_action",
            params={}
        )

        assert result.success is False
        assert "Unknown action type" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_fill_form_success(self, action_executor, mock_browser):
        """Test successful form filling"""
        result = await action_executor.execute_action(
            action_type="fill_form",
            params={"submit": True}
        )

        assert result.success is True
        assert result.action_type == "fill_form"

    @pytest.mark.asyncio
    async def test_execute_fill_form_no_forms(self, action_executor, mock_browser):
        """Test form filling when no forms found"""
        mock_browser.get_form_elements = AsyncMock(return_value=None)

        result = await action_executor.execute_action(
            action_type="fill_form",
            params={}
        )

        assert result.success is False
        assert "No forms found" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_fill_form_validation_fails(self, action_executor, mock_execution_engine):
        """Test form filling when code validation fails"""
        mock_execution_engine.validate_code = MagicMock(return_value=(False, "Dangerous code detected"))

        result = await action_executor.execute_action(
            action_type="fill_form",
            params={}
        )

        assert result.success is False
        assert "Validation failed" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_click_link_by_text(self, action_executor, mock_browser):
        """Test clicking link by text"""
        mock_browser.page.url = "http://example.com/new-page"

        result = await action_executor.execute_action(
            action_type="click_link",
            params={"link_text": "Sign In"}
        )

        assert result.success is True
        mock_browser.page.click.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_click_link_by_selector(self, action_executor, mock_browser):
        """Test clicking link by selector"""
        result = await action_executor.execute_action(
            action_type="click_link",
            params={"selector": "a#signin-link"}
        )

        assert result.success is True
        mock_browser.page.click.assert_called_with("a#signin-link")

    @pytest.mark.asyncio
    async def test_execute_click_link_missing_params(self, action_executor):
        """Test clicking link without required params"""
        result = await action_executor.execute_action(
            action_type="click_link",
            params={}
        )

        assert result.success is False
        assert "Missing" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_click_button_by_text(self, action_executor, mock_browser):
        """Test clicking button by text"""
        result = await action_executor.execute_action(
            action_type="click_button",
            params={"button_text": "Submit"}
        )

        assert result.success is True
        mock_browser.page.click.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_click_button_error(self, action_executor, mock_browser):
        """Test clicking button that doesn't exist"""
        mock_browser.page.click = AsyncMock(side_effect=Exception("Button not found"))

        result = await action_executor.execute_action(
            action_type="click_button",
            params={"button_text": "NonExistent"}
        )

        assert result.success is False
        assert "Button not found" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_go_back_success(self, action_executor, mock_browser):
        """Test going back in browser history"""
        mock_browser.page.url = "http://example.com/previous"

        result = await action_executor.execute_action(
            action_type="go_back",
            params={}
        )

        assert result.success is True
        assert result.navigated is True

    @pytest.mark.asyncio
    async def test_execute_go_back_failure(self, action_executor, mock_browser):
        """Test going back when it fails"""
        mock_browser.go_back = AsyncMock(return_value={"success": False, "error": {"type": "navigation_error", "message": "Failed to navigate back", "details": {}}})

        result = await action_executor.execute_action(
            action_type="go_back",
            params={}
        )

        assert result.success is False

    @pytest.mark.asyncio
    async def test_execute_scroll(self, action_executor, mock_browser):
        """Test scrolling the page"""
        result = await action_executor.execute_action(
            action_type="scroll",
            params={"direction": "down", "amount": 500}
        )

        assert result.success is True
        mock_browser.scroll.assert_called_with("down", 500)

    @pytest.mark.asyncio
    async def test_execute_scroll_defaults(self, action_executor, mock_browser):
        """Test scrolling with default params"""
        result = await action_executor.execute_action(
            action_type="scroll",
            params={}
        )

        assert result.success is True
        mock_browser.scroll.assert_called_with("down", 500)

    @pytest.mark.asyncio
    async def test_execute_wait_success(self, action_executor, mock_browser):
        """Test waiting for element"""
        result = await action_executor.execute_action(
            action_type="wait",
            params={"selector": "#loading", "timeout": 3000}
        )

        assert result.success is True
        mock_browser.page.wait_for_selector.assert_called_with("#loading", timeout=3000)

    @pytest.mark.asyncio
    async def test_execute_wait_missing_selector(self, action_executor):
        """Test waiting without selector"""
        result = await action_executor.execute_action(
            action_type="wait",
            params={}
        )

        assert result.success is False
        assert "Missing selector" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_wait_timeout(self, action_executor, mock_browser):
        """Test waiting for element that times out"""
        mock_browser.page.wait_for_selector = AsyncMock(
            side_effect=Exception("Timeout waiting for selector")
        )

        result = await action_executor.execute_action(
            action_type="wait",
            params={"selector": "#never-appears"}
        )

        assert result.success is False
        assert "Timeout" in result.error["message"]

    @pytest.mark.asyncio
    async def test_execute_read_content(self, action_executor, mock_browser):
        """Test reading page content"""
        result = await action_executor.execute_action(
            action_type="read_content",
            params={"purpose": "verification"}
        )

        assert result.success is True
        assert result.details["purpose"] == "verification"

    @pytest.mark.asyncio
    async def test_execute_read_content_with_selector(self, action_executor, mock_browser):
        """Test reading content from specific element"""
        mock_browser.page.evaluate = AsyncMock(return_value="Element text")

        result = await action_executor.execute_action(
            action_type="read_content",
            params={"purpose": "get_error", "selector": ".error-message"}
        )

        assert result.success is True

    @pytest.mark.asyncio
    async def test_execute_none_action(self, action_executor):
        """Test no-op action"""
        result = await action_executor.execute_action(
            action_type="none",
            params={}
        )

        assert result.success is True
        assert result.action_type == "none"

    @pytest.mark.asyncio
    async def test_store_entered_data(self, temp_db, mock_browser, mock_execution_engine, mock_llm):
        """Test that entered data is stored in memory"""
        memory = SessionMemory()
        memory.set_user_profile({
            "email": "test@example.com",
            "password": "secret123",
            "firstName": "John"
        })
        executor = ActionExecutor(mock_browser, mock_execution_engine, memory, mock_llm)

        await executor.execute_action(
            action_type="fill_form",
            params={}
        )

        assert memory.recall("email") == "test@example.com"
        assert memory.recall("password") == "secret123"
        assert memory.recall("firstName") == "John"

    @pytest.mark.asyncio
    async def test_memory_data_merged_with_profile(self, temp_db, mock_browser, mock_execution_engine, mock_llm):
        """Test that memory data is merged with user profile"""
        memory = SessionMemory()
        memory.set_user_profile({"password": "newpass"})
        memory.remember("email", "stored@example.com")

        executor = ActionExecutor(mock_browser, mock_execution_engine, memory, mock_llm)

        await executor.execute_action(
            action_type="fill_form",
            params={}
        )

        # LLM should receive merged profile
        call_args = mock_llm.generate_fill_code.call_args
        profile_sent = call_args[0][1]

        assert profile_sent["password"] == "newpass"
        assert profile_sent["email"] == "stored@example.com"
