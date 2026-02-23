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
        with patch.object(SessionMemory, 'DB_PATH', db_path):
            yield db_path


@pytest.fixture
def mock_config():
    """Mock configuration"""
    with patch('src.web_agent.config') as mock:
        mock.HEADLESS = True
        mock.BROWSER_TIMEOUT = 30000
        mock.OPENAI_API_KEY = "test-key"
        mock.OPENAI_MODEL = "gpt-5"
        mock.TEMPERATURE = 0.1
        mock.MAX_AGENT_STEPS = 20
        mock.DEBUG = False
        yield mock


@pytest.fixture
def mock_browser():
    """Mock browser manager"""
    with patch('src.web_agent.BrowserManager') as mock_class:
        browser = MagicMock()
        browser.launch = AsyncMock()
        browser.close = AsyncMock()
        browser.navigate = AsyncMock(return_value=True)
        browser.page = MagicMock()
        browser.page.url = "http://example.com"
        browser.get_page_title = AsyncMock(return_value="Test Page")
        browser.get_form_elements = AsyncMock(return_value="<form></form>")
        browser.get_page_links = AsyncMock(return_value="No links found")
        browser.get_page_buttons = AsyncMock(return_value="No standalone buttons")
        browser.get_readable_content = AsyncMock(return_value="Page content")
        mock_class.return_value = browser
        yield browser


@pytest.fixture
def mock_llm():
    """Mock LLM client"""
    with patch('src.web_agent.LLMClient') as mock_class:
        llm = MagicMock()
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
        mock_browser.navigate = AsyncMock(return_value=False)

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
            error="Element not found"
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
        # Create initial session
        agent1 = AutonomousWebAgent()
        agent1.memory.goal = "Sign up"
        agent1.memory.remember("email", "saved@example.com")
        agent1.memory.save()
        session_id = agent1.memory.session_id

        # Resume session
        agent2 = AutonomousWebAgent(session_id=session_id)

        assert agent2.memory.session_id == session_id
        assert agent2.memory.recall("email") == "saved@example.com"

    @pytest.mark.asyncio
    async def test_build_page_context(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test page context building"""
        agent = AutonomousWebAgent()
        agent.browser = mock_browser

        context = await agent._build_page_context()

        assert "Current Page" in context
        assert "http://example.com" in context
        assert "Test Page" in context

    @pytest.mark.asyncio
    async def test_build_page_context_excludes_empty_sections(
        self, temp_db, mock_config, mock_browser, mock_llm
    ):
        """Test that empty sections are excluded from context"""
        mock_browser.get_form_elements = AsyncMock(return_value="No forms found")
        mock_browser.get_page_links = AsyncMock(return_value="No links found")
        mock_browser.get_page_buttons = AsyncMock(return_value="No standalone buttons")

        agent = AutonomousWebAgent()
        agent.browser = mock_browser

        context = await agent._build_page_context()

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
        mock_browser.navigate = AsyncMock(return_value=False)

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
