"""Tests for agent_service.py - FastAPI server"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport
import tempfile
from pathlib import Path

from src.agent_service import app
from src.memory import SessionMemory


@pytest.fixture
def temp_db():
    """Use temporary database for tests"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_sessions.db"
        with patch.object(SessionMemory, 'DB_PATH', db_path):
            yield db_path


@pytest.fixture
def client():
    """Create test client"""
    return TestClient(app)


class TestHealthEndpoints:
    """Tests for health and info endpoints"""

    def test_health_check(self, client):
        """Test GET /health returns healthy status"""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["version"] == "2.0.0"

    def test_root_endpoint(self, client):
        """Test GET / returns API info"""
        response = client.get("/")

        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert data["endpoint"] == "POST /api/execute-goal"


class TestExecuteGoalEndpoint:
    """Tests for POST /api/execute-goal endpoint"""

    @pytest.mark.asyncio
    async def test_execute_goal_success(self, temp_db):
        """Test successful goal execution"""
        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": "test-session-123",
            "finalUrl": "http://example.com/success",
            "stepsTaken": 2,
            "executionTime": 5.5,
            "tokensUsed": 300,
            "actionHistory": [
                {
                    "step": 1,
                    "action": "fill_form",
                    "params": {},
                    "success": True,
                    "result": {},
                    "timestamp": "2024-01-01T00:00:00"
                }
            ],
            "memory": {
                "enteredData": {"email": "test@example.com"},
                "visitedUrls": ["http://example.com"],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Sign up",
                        "startUrl": "http://example.com/signup",
                        "userProfile": {
                            "email": "test@example.com",
                            "password": "TestPass123"
                        }
                    }
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["goalAchieved"] is True
            assert data["sessionId"] == "test-session-123"

    @pytest.mark.asyncio
    async def test_execute_goal_with_session_resume(self, temp_db):
        """Test goal execution with session resume"""
        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": "existing-session",
            "finalUrl": "http://example.com",
            "stepsTaken": 1,
            "executionTime": 2.0,
            "tokensUsed": 100,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Continue",
                        "startUrl": "http://example.com",
                        "userProfile": {},
                        "sessionId": "existing-session"
                    }
                )

            assert response.status_code == 200
            mock_agent_class.assert_called_with(session_id="existing-session")

    @pytest.mark.asyncio
    async def test_execute_goal_with_options(self, temp_db):
        """Test goal execution with custom options"""
        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": "test-session",
            "finalUrl": "http://example.com",
            "stepsTaken": 1,
            "executionTime": 1.0,
            "tokensUsed": 50,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Test",
                        "startUrl": "http://example.com",
                        "userProfile": {},
                        "options": {
                            "maxSteps": 10,
                            "headless": True,
                            "timeout": 30000
                        }
                    }
                )

            assert response.status_code == 200

            # Verify options were passed
            call_kwargs = mock_agent.execute_goal.call_args.kwargs
            assert call_kwargs["options"]["max_steps"] == 10

    @pytest.mark.asyncio
    async def test_execute_goal_failure(self, temp_db):
        """Test goal execution failure response"""
        mock_result = {
            "success": False,
            "goalAchieved": False,
            "sessionId": "test-session",
            "finalUrl": "http://example.com/error",
            "stepsTaken": 3,
            "executionTime": 10.0,
            "tokensUsed": 500,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": [
                {
                    "type": "action_error",
                    "message": "Element not found"
                }
            ]
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Fail",
                        "startUrl": "http://example.com",
                        "userProfile": {}
                    }
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert data["goalAchieved"] is False
            assert len(data["errors"]) > 0

    def test_execute_goal_validation_error(self, client):
        """Test validation error for missing required fields"""
        response = client.post(
            "/api/execute-goal",
            json={
                "goal": "Test"
                # Missing startUrl and userProfile
            }
        )

        assert response.status_code == 422  # Validation error

    def test_execute_goal_invalid_json(self, client):
        """Test error for invalid JSON"""
        response = client.post(
            "/api/execute-goal",
            content="not valid json",
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_execute_goal_user_profile_extra_fields(self, temp_db):
        """Test that extra user profile fields are allowed"""
        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": "test",
            "finalUrl": "http://example.com",
            "stepsTaken": 1,
            "executionTime": 1.0,
            "tokensUsed": 50,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Test",
                        "startUrl": "http://example.com",
                        "userProfile": {
                            "email": "test@example.com",
                            "customField": "custom value",
                            "anotherField": 123
                        }
                    }
                )

            assert response.status_code == 200

            # Verify extra fields were passed
            call_kwargs = mock_agent.execute_goal.call_args.kwargs
            assert "customField" in call_kwargs["user_profile"]


class TestRequestModels:
    """Tests for Pydantic request models"""

    def test_user_profile_optional_fields(self, client):
        """Test UserProfile allows all optional fields"""
        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value={
                "success": True,
                "goalAchieved": True,
                "sessionId": "test",
                "finalUrl": "",
                "stepsTaken": 0,
                "executionTime": 0,
                "tokensUsed": 0,
                "actionHistory": [],
                "memory": {"enteredData": {}, "visitedUrls": [], "extractedInfo": {}},
                "errors": []
            })
            mock_agent_class.return_value = mock_agent

            response = client.post(
                "/api/execute-goal",
                json={
                    "goal": "Test",
                    "startUrl": "http://example.com",
                    "userProfile": {}  # Empty profile should be valid
                }
            )

            assert response.status_code == 200

    def test_nested_address_in_profile(self, client):
        """Test nested address in user profile"""
        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value={
                "success": True,
                "goalAchieved": True,
                "sessionId": "test",
                "finalUrl": "",
                "stepsTaken": 0,
                "executionTime": 0,
                "tokensUsed": 0,
                "actionHistory": [],
                "memory": {"enteredData": {}, "visitedUrls": [], "extractedInfo": {}},
                "errors": []
            })
            mock_agent_class.return_value = mock_agent

            response = client.post(
                "/api/execute-goal",
                json={
                    "goal": "Test",
                    "startUrl": "http://example.com",
                    "userProfile": {
                        "address": {
                            "street": "123 Main St",
                            "city": "Austin",
                            "state": "TX",
                            "zip": "78701"
                        }
                    }
                }
            )

            assert response.status_code == 200


class TestNeedsInputResponse:
    """Tests for needs_input response fields"""

    @pytest.mark.asyncio
    async def test_execute_goal_needs_input(self, temp_db):
        """Test response includes needsInput and missingFields"""
        mock_result = {
            "success": True,
            "goalAchieved": False,
            "sessionId": "test-session",
            "status": "needs_input",
            "finalUrl": "http://example.com/signup",
            "stepsTaken": 1,
            "executionTime": 2.0,
            "tokensUsed": 150,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": ["http://example.com/signup"],
                "extractedInfo": {}
            },
            "errors": [],
            "needsInput": True,
            "missingFields": ["birthCity", "securityAnswer"],
            "message": "Form requires additional fields"
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Sign up",
                        "startUrl": "http://example.com/signup",
                        "userProfile": {"email": "test@example.com"}
                    }
                )

            assert response.status_code == 200
            data = response.json()
            assert data["needsInput"] is True
            assert data["missingFields"] == ["birthCity", "securityAnswer"]
            assert data["message"] == "Form requires additional fields"

    @pytest.mark.asyncio
    async def test_execute_goal_awaiting_user_action(self, temp_db):
        """Test response includes awaitingUserAction"""
        mock_result = {
            "success": True,
            "goalAchieved": False,
            "sessionId": "test-session",
            "status": "awaiting_user_action",
            "finalUrl": "http://example.com/captcha",
            "stepsTaken": 2,
            "executionTime": 3.0,
            "tokensUsed": 200,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": [],
            "awaitingUserAction": True,
            "message": "CAPTCHA requires human interaction"
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    "/api/execute-goal",
                    json={
                        "goal": "Sign up",
                        "startUrl": "http://example.com/signup",
                        "userProfile": {}
                    }
                )

            assert response.status_code == 200
            data = response.json()
            assert data["awaitingUserAction"] is True
            assert data["message"] == "CAPTCHA requires human interaction"


class TestContinueSessionEndpoint:
    """Tests for POST /api/session/{session_id}/continue endpoint"""

    @pytest.mark.asyncio
    async def test_continue_session_success(self, temp_db):
        """Test continuing a paused session with additional data"""
        # Create a session first
        memory = SessionMemory()
        memory.goal = "Sign up"
        memory.current_url = "http://example.com/signup"
        memory.status = "needs_input"
        memory.set_missing_fields(["birthCity"])
        memory.save()
        session_id = memory.session_id

        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": session_id,
            "status": "achieved",
            "finalUrl": "http://example.com/success",
            "stepsTaken": 2,
            "executionTime": 3.0,
            "tokensUsed": 250,
            "actionHistory": [],
            "memory": {
                "enteredData": {"birthCity": "Austin"},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    f"/api/session/{session_id}/continue",
                    json={"additionalData": {"birthCity": "Austin"}}
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["goalAchieved"] is True

    @pytest.mark.asyncio
    async def test_continue_session_not_found(self, temp_db):
        """Test continuing a non-existent session returns error"""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(
                "/api/session/nonexistent-session-id/continue",
                json={"additionalData": {}}
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert len(data["errors"]) > 0
        assert data["errors"][0]["type"] == "session_not_found"

    @pytest.mark.asyncio
    async def test_continue_session_empty_additional_data(self, temp_db):
        """Test continuing session with empty additionalData (for awaiting_user_action)"""
        memory = SessionMemory()
        memory.goal = "Sign up"
        memory.current_url = "http://example.com/signup"
        memory.status = "awaiting_user_action"
        memory.save()
        session_id = memory.session_id

        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": session_id,
            "status": "achieved",
            "finalUrl": "http://example.com/success",
            "stepsTaken": 1,
            "executionTime": 2.0,
            "tokensUsed": 100,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    f"/api/session/{session_id}/continue",
                    json={}  # Empty body
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    @pytest.mark.asyncio
    async def test_continue_session_merges_profile_data(self, temp_db):
        """Test that continue endpoint merges additionalData with stored profile"""
        memory = SessionMemory()
        memory.goal = "Sign up"
        memory.current_url = "http://example.com/signup"
        memory.status = "needs_input"
        memory.set_user_profile({"email": "test@example.com", "firstName": "John"})
        memory.set_missing_fields(["birthCity"])
        memory.save()
        session_id = memory.session_id

        mock_result = {
            "success": True,
            "goalAchieved": True,
            "sessionId": session_id,
            "status": "achieved",
            "finalUrl": "http://example.com/success",
            "stepsTaken": 1,
            "executionTime": 1.0,
            "tokensUsed": 100,
            "actionHistory": [],
            "memory": {
                "enteredData": {},
                "visitedUrls": [],
                "extractedInfo": {}
            },
            "errors": []
        }

        with patch('src.agent_service.AutonomousWebAgent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.execute_goal = AsyncMock(return_value=mock_result)
            mock_agent_class.return_value = mock_agent

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post(
                    f"/api/session/{session_id}/continue",
                    json={"additionalData": {"birthCity": "Austin"}}
                )

            assert response.status_code == 200

            # Verify agent was created with correct session_id
            mock_agent_class.assert_called_with(session_id=session_id)
