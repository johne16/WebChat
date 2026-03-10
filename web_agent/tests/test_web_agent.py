"""Tests for web_agent.py - Autonomous web agent orchestrator"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import tempfile
from pathlib import Path

from src.web_agent import AutonomousWebAgent
from src.memory import SessionMemory
from src.action_executor import ActionResult


@pytest.fixture
def temp_db():
    """Use temporary database for tests"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_sessions.db"
        with patch.object(SessionMemory, 'DEFAULT_DB_PATH', db_path):
            yield db_path


@pytest.fixture
def mock_config():
    """Mock configuration"""
    with patch('src.web_agent.config') as mock:
        mock.HEADLESS = True
        mock.BROWSER_TIMEOUT = 30000
        mock.OPENAI_API_KEY = "test-key"
        mock.ANTHROPIC_API_KEY = ""
        mock.OPENAI_MODEL = "gpt-5.2"
        mock.PROVIDER = "openai"
        mock.TEMPERATURE = 0.1
        mock.MAX_AGENT_STEPS = 20
        mock.CONSECUTIVE_FAILURE_THRESHOLD = 3
        mock.RECENT_ACTION_LOOKBACK = 5
        mock.DEBUG = False
        yield mock


@pytest.fixture
def mock_browser():
    """Mock browser manager"""
    with patch('src.web_agent.BrowserManager') as mock_class:
        browser = MagicMock()
        browser.launch = AsyncMock()
        browser.close = AsyncMock()
        browser.navigate = AsyncMock(return_value={"success": True, "error": None})
        browser.page = MagicMock()
        browser.page.url = "about:blank"
        browser.get_page_title = AsyncMock(return_value="Test Page")
        browser.get_form_elements = AsyncMock(return_value="<form></form>")
        browser.get_page_links = AsyncMock(return_value=None)
        browser.get_page_buttons = AsyncMock(return_value=None)
        browser.get_readable_content = AsyncMock(return_value="Page content")
        browser.build_page_context = AsyncMock(return_value={
            "context": "## Current Page\nURL: http://example.com\nTitle: Test Page\n\n## Page Content\nPage content",
            "timings": {"pageExtraction": 0.01},
            "pageContextSize": 100
        })
        mock_class.return_value = browser
        yield browser


@pytest.fixture
def mock_llm():
    """Mock LLM client"""
    with patch('src.web_agent.LLMClient') as mock_class:
        llm = MagicMock()
        llm.provider = "openai"
        llm.generate_plan = AsyncMock(return_value={
            "action": "fill_form",
            "params": {"submit": True},
            "reasoning": "Need to fill the form",
            "goal_status": "in_progress",
            "tokens_used": 100
        })
        mock_class.return_value = llm
        yield llm


@pytest.fixture
def mock_action_executor():
    """Mock action executor"""
    with patch('src.web_agent.ActionExecutor') as mock_class:
        executor = MagicMock()
        executor.execute_action = AsyncMock(return_value=ActionResult(
            success=True,
            action_type="fill_form",
            details={"fields_filled": 3},
            navigated=True,
            new_url="http://example.com/success"
        ))
        mock_class.return_value = executor
        yield executor


class TestAutonomousWebAgent:
    """Tests for AutonomousWebAgent class"""

    @pytest.mark.asyncio
    async def test_execute_goal_success(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test successful goal execution"""
        # Set up LLM to return goal achieved after one action
        mock_llm.generate_plan = AsyncMock(side_effect=[
            {
                "action": "fill_form",
                "params": {},
                "reasoning": "Fill the form",
                "goal_status": "in_progress",
                "tokens_used": 100
            },
            {
                "action": "none",
                "params": {},
                "reasoning": "Goal achieved",
                "goal_status": "achieved",
                "tokens_used": 50
            }
        ])

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={"email": "test@example.com"}
        )

        assert result["success"] is True
        assert result["goalAchieved"] is True
        assert result["sessionId"] is not None
        assert result["tokensUsed"] > 0

    @pytest.mark.asyncio
    async def test_execute_goal_navigation_failure(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test goal execution fails on navigation error"""
        mock_browser.navigate = AsyncMock(return_value={"success": False, "error": {"type": "navigation_error", "message": "Failed to navigate", "details": {"url": "http://invalid.example.com"}}})

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Sign up",
            start_url="http://invalid.example.com",
            user_profile={}
        )

        assert result["success"] is False
        assert result["goalAchieved"] is False
        assert any("navigation" in e["type"] for e in result["errors"])

    @pytest.mark.asyncio
    async def test_execute_goal_blocked(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test goal execution when goal becomes blocked"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "Cannot proceed - CAPTCHA required",
            "goal_status": "blocked",
            "tokens_used": 100
        })

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={}
        )

        assert result["success"] is False
        assert result["goalAchieved"] is False
        assert any("blocked" in e["type"] for e in result["errors"])

    @pytest.mark.asyncio
    async def test_execute_goal_max_steps_exceeded(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test goal execution stops at max steps"""
        # LLM always returns in_progress
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "scroll",
            "params": {},
            "reasoning": "Keep scrolling",
            "goal_status": "in_progress",
            "tokens_used": 10
        })

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Find something",
            start_url="http://example.com",
            user_profile={},
            options={"max_steps": 3}
        )

        assert result["success"] is False
        assert result["goalAchieved"] is False
        assert result["stepsTaken"] == 3
        assert any("max_steps" in e["type"] for e in result["errors"])

    @pytest.mark.asyncio
    async def test_execute_goal_consecutive_failures(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test goal execution gives up after 3 consecutive failures"""
        mock_action_executor.execute_action = AsyncMock(return_value=ActionResult(
            success=False,
            action_type="fill_form",
            details={},
            error={"type": "selector_error", "message": "Element not found", "details": {}}
        ))

        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "fill_form",
            "params": {},
            "reasoning": "Try to fill form",
            "goal_status": "in_progress",
            "tokens_used": 50
        })

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={}
        )

        assert result["success"] is False
        assert len(result["errors"]) >= 3

    @pytest.mark.asyncio
    async def test_execute_goal_tracks_urls(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test that visited URLs are tracked"""
        mock_llm.generate_plan = AsyncMock(side_effect=[
            {
                "action": "click_link",
                "params": {"link_text": "Next"},
                "reasoning": "Go to next page",
                "goal_status": "in_progress",
                "tokens_used": 50
            },
            {
                "action": "none",
                "params": {},
                "reasoning": "Done",
                "goal_status": "achieved",
                "tokens_used": 50
            }
        ])

        mock_action_executor.execute_action = AsyncMock(return_value=ActionResult(
            success=True,
            action_type="click_link",
            details={},
            navigated=True,
            new_url="http://example.com/page2"
        ))

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Navigate",
            start_url="http://example.com",
            user_profile={}
        )

        assert "http://example.com" in result["memory"]["visitedUrls"]

    @pytest.mark.asyncio
    async def test_execute_goal_passwords_masked(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test that passwords are masked in response"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "Done",
            "goal_status": "achieved",
            "tokens_used": 50
        })

        agent = AutonomousWebAgent()
        agent.memory.remember("password", "secret123")
        agent.memory.remember("email", "test@example.com")

        result = await agent.execute_goal(
            goal="Test",
            start_url="http://example.com",
            user_profile={}
        )

        assert result["memory"]["enteredData"]["password"] == "***"
        assert result["memory"]["enteredData"]["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_execute_goal_session_resume(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test resuming existing session"""
        # Create initial session with async memory
        memory1 = await SessionMemory.create()
        memory1.goal = "Sign up"
        memory1.remember("email", "saved@example.com")
        await memory1.save()
        session_id = memory1.session_id

        # Resume session - memory is initialized lazily in execute_goal,
        # so manually create and assign it for this test
        agent2 = AutonomousWebAgent(session_id=session_id)
        agent2.memory = await SessionMemory.create(session_id=session_id)

        assert agent2.memory.session_id == session_id
        assert agent2.memory.recall("email") == "saved@example.com"

    @pytest.mark.asyncio
    async def test_build_page_context(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test page context building via browser"""
        from src.browser import BrowserManager
        mock_browser.page.url = "http://example.com"
        # Call the real build_page_context using unbound method on the mock
        mock_browser.build_page_context = lambda: BrowserManager.build_page_context(mock_browser)

        result = await mock_browser.build_page_context()
        context = result["context"]

        assert "Current Page" in context
        assert "http://example.com" in context
        assert "Test Page" in context

    @pytest.mark.asyncio
    async def test_build_page_context_excludes_empty_sections(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test that empty sections are excluded from context"""
        from src.browser import BrowserManager
        mock_browser.get_form_elements = AsyncMock(return_value=None)
        mock_browser.get_page_links = AsyncMock(return_value=None)
        mock_browser.get_page_buttons = AsyncMock(return_value=None)
        mock_browser.build_page_context = lambda: BrowserManager.build_page_context(mock_browser)

        result = await mock_browser.build_page_context()
        context = result["context"]

        assert "Forms on Page" not in context
        assert "Available Links" not in context
        assert "Available Buttons" not in context

    @pytest.mark.asyncio
    async def test_execute_goal_exception_handling(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test that unexpected exceptions are caught"""
        mock_browser.navigate = AsyncMock(side_effect=Exception("Unexpected error"))

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Test",
            start_url="http://example.com",
            user_profile={}
        )

        assert result["success"] is False
        assert any("unexpected" in e["type"] for e in result["errors"])

    @pytest.mark.asyncio
    async def test_browser_closed_on_success(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test browser is closed after successful execution"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "Done",
            "goal_status": "achieved",
            "tokens_used": 50
        })

        agent = AutonomousWebAgent()
        await agent.execute_goal(
            goal="Test",
            start_url="http://example.com",
            user_profile={}
        )

        mock_browser.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_browser_closed_on_failure(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test browser is closed after failed execution"""
        mock_browser.navigate = AsyncMock(return_value={"success": False, "error": {"type": "navigation_error", "message": "Failed", "details": {}}})

        agent = AutonomousWebAgent()
        await agent.execute_goal(
            goal="Test",
            start_url="http://example.com",
            user_profile={}
        )

        mock_browser.close.assert_called_once()

    def test_build_response_format(self, temp_db, mock_config):
        """Test response dictionary structure"""
        agent = AutonomousWebAgent()
        agent.start_time = 0
        agent.total_tokens = 500

        response = agent._build_response(
            success=True,
            goal_achieved=True,
            errors=[]
        )

        assert "success" in response
        assert "goalAchieved" in response
        assert "sessionId" in response
        assert "finalUrl" in response
        assert "stepsTaken" in response
        assert "executionTime" in response
        assert "tokensUsed" in response
        assert "actionHistory" in response
        assert "memory" in response
        assert "errors" in response

    @pytest.mark.asyncio
    async def test_send_webhook_no_callback(self, temp_db, mock_config):
        """Test _send_webhook is a no-op when callback_url is None"""
        agent = AutonomousWebAgent()
        agent.callback_url = None

        # Should not raise
        await agent._send_webhook("started", "test message")

    @pytest.mark.asyncio
    async def test_send_webhook_sends_payload(self, temp_db, mock_config):
        """Test _send_webhook sends correct payload"""
        agent = AutonomousWebAgent()
        agent.callback_url = "http://localhost:8787/api/agent/webhook"
        agent.port = 5001
        agent.task_id = "task-123"

        mock_client = MagicMock()
        mock_client.post = AsyncMock()
        agent._http_client = mock_client

        await agent._send_webhook("step_completed", "Step 1 done", data={"step": 1})

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        payload = call_args.kwargs["json"]
        assert payload["status"] == "step_completed"
        assert payload["port"] == 5001
        assert payload["taskId"] == "task-123"
        assert payload["message"] == "Step 1 done"
        assert payload["data"]["step"] == 1

    @pytest.mark.asyncio
    async def test_send_webhook_handles_error(self, temp_db, mock_config):
        """Test _send_webhook does not raise on HTTP failure"""
        agent = AutonomousWebAgent()
        agent.callback_url = "http://localhost:8787/api/agent/webhook"

        mock_client = MagicMock()
        mock_client.post = AsyncMock(side_effect=Exception("Connection refused"))
        agent._http_client = mock_client

        # Should not raise
        await agent._send_webhook("started", "test")

    @pytest.mark.asyncio
    async def test_execute_goal_needs_input(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test goal execution returns needs_input when LLM reports missing fields"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "Missing birth city",
            "goal_status": "needs_input",
            "missing_fields": ["birthCity"],
            "tokens_used": 100
        })

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={"email": "test@example.com"}
        )

        assert result["success"] is True
        assert result["goalAchieved"] is False
        assert result["needsInput"] is True
        assert "birthCity" in result["missingFields"]
        assert result["message"] == "Missing birth city"

    @pytest.mark.asyncio
    async def test_execute_goal_needs_input_keeps_browser_open(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test browser stays open for needs_input so agent can resume"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "Missing data",
            "goal_status": "needs_input",
            "missing_fields": ["securityAnswer"],
            "tokens_used": 50
        })

        agent = AutonomousWebAgent()
        await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={}
        )

        mock_browser.close.assert_not_called()

    @pytest.mark.asyncio
    async def test_execute_goal_awaiting_user_action(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test goal execution returns awaiting_user_action for manual steps"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "CAPTCHA detected, user must solve it",
            "goal_status": "awaiting_user_action",
            "tokens_used": 100
        })

        agent = AutonomousWebAgent()
        result = await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={}
        )

        assert result["success"] is True
        assert result["goalAchieved"] is False
        assert result["awaitingUserAction"] is True
        assert "CAPTCHA" in result["message"]

    @pytest.mark.asyncio
    async def test_execute_goal_awaiting_user_action_keeps_browser_open(
        self, temp_db, mock_config, mock_browser, mock_llm, mock_action_executor
    ):
        """Test browser stays open for awaiting_user_action"""
        mock_llm.generate_plan = AsyncMock(return_value={
            "action": "none",
            "params": {},
            "reasoning": "Manual action needed",
            "goal_status": "awaiting_user_action",
            "tokens_used": 50
        })

        agent = AutonomousWebAgent()
        await agent.execute_goal(
            goal="Sign up",
            start_url="http://example.com/signup",
            user_profile={}
        )

        mock_browser.close.assert_not_called()
