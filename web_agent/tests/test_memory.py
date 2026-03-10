"""Tests for memory.py - SQLite session memory"""

import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

from src.memory import SessionMemory, ActionRecord


@pytest.fixture
def temp_db():
    """Use temporary database for tests"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_sessions.db"
        with patch.object(SessionMemory, 'DEFAULT_DB_PATH', db_path):
            yield db_path


class TestSessionMemory:
    """Tests for SessionMemory class"""

    def test_create_new_session(self, temp_db):
        """Test creating a new session generates UUID"""
        memory = SessionMemory()

        assert memory.session_id is not None
        assert len(memory.session_id) == 36  # UUID format
        assert memory.status == "in_progress"  # GoalStatus.IN_PROGRESS == "in_progress"
        assert memory.current_step == 0

    @pytest.mark.asyncio
    async def test_create_session_with_id(self, temp_db):
        """Test creating session with existing ID"""
        # First create and save a session
        memory1 = await SessionMemory.create()
        memory1.goal = "Test goal"
        memory1.remember("email", "test@example.com")
        await memory1.save()

        # Load it with same ID
        memory2 = await SessionMemory.create(session_id=memory1.session_id)

        assert memory2.session_id == memory1.session_id
        assert memory2.goal == "Test goal"
        assert memory2.recall("email") == "test@example.com"

    def test_remember_and_recall(self, temp_db):
        """Test storing and retrieving entered data"""
        memory = SessionMemory()

        memory.remember("email", "john@example.com")
        memory.remember("password", "secret123")

        assert memory.recall("email") == "john@example.com"
        assert memory.recall("password") == "secret123"
        assert memory.recall("nonexistent") is None

    def test_store_and_get_info(self, temp_db):
        """Test storing and retrieving extracted info"""
        memory = SessionMemory()

        memory.store_info("account_number", "12345")
        memory.store_info("welcome_message", "Hello John!")

        assert memory.get_info("account_number") == "12345"
        assert memory.get_info("welcome_message") == "Hello John!"
        assert memory.get_info("nonexistent") is None

    def test_add_visited_url(self, temp_db):
        """Test tracking visited URLs"""
        memory = SessionMemory()

        memory.add_visited_url("http://example.com/page1")
        memory.add_visited_url("http://example.com/page2")
        memory.add_visited_url("http://example.com/page1")  # Duplicate

        urls = memory.visited_urls
        assert len(urls) == 2  # Duplicate not added
        assert "http://example.com/page1" in urls
        assert "http://example.com/page2" in urls

    def test_add_action(self, temp_db):
        """Test recording actions"""
        memory = SessionMemory()

        action = ActionRecord(
            step=1,
            action_type="fill_form",
            params={"submit": True},
            success=True,
            result={"fields_filled": 5}
        )
        memory.add_action(action)

        assert len(memory.action_history) == 1
        assert memory.action_history[0].action_type == "fill_form"
        assert memory.current_step == 1

    def test_get_last_action(self, temp_db):
        """Test getting most recent action"""
        memory = SessionMemory()

        assert memory.get_last_action() is None

        action1 = ActionRecord(step=1, action_type="fill_form", params={}, success=True)
        action2 = ActionRecord(step=2, action_type="click_link", params={}, success=True)

        memory.add_action(action1)
        memory.add_action(action2)

        last = memory.get_last_action()
        assert last.action_type == "click_link"
        assert last.step == 2

    @pytest.mark.asyncio
    async def test_save_and_load(self, temp_db):
        """Test persistence to SQLite"""
        memory = await SessionMemory.create()
        memory.goal = "Sign up and sign in"
        memory.status = "achieved"
        memory.current_url = "http://example.com/dashboard"
        memory.remember("email", "test@example.com")
        memory.add_visited_url("http://example.com/signup")

        action = ActionRecord(
            step=1,
            action_type="fill_form",
            params={"submit": True},
            success=True
        )
        memory.add_action(action)
        await memory.save()

        # Create new instance and load
        memory2 = await SessionMemory.create(session_id=memory.session_id)

        assert memory2.goal == "Sign up and sign in"
        assert memory2.status == "achieved"
        assert memory2.current_url == "http://example.com/dashboard"
        assert memory2.recall("email") == "test@example.com"
        assert "http://example.com/signup" in memory2.visited_urls
        assert len(memory2.action_history) == 1

    @pytest.mark.asyncio
    async def test_load_nonexistent_session(self, temp_db):
        """Test loading non-existent session returns False"""
        memory = await SessionMemory.create()
        result = await memory.load("nonexistent-session-id")

        assert result is False

    def test_get_context_for_llm(self, temp_db):
        """Test generating LLM context"""
        memory = SessionMemory()
        memory.goal = "Test goal"
        memory.remember("email", "test@example.com")
        memory.add_visited_url("http://example.com")

        action = ActionRecord(step=1, action_type="fill_form", params={}, success=True)
        memory.add_action(action)

        context = memory.get_context_for_llm()

        assert context["goal"] == "Test goal"
        assert context["entered_data"]["email"] == "test@example.com"
        assert "http://example.com" in context["visited_urls"]
        assert len(context["recent_actions"]) == 1
        assert context["recent_actions"][0]["action"] == "fill_form"

    def test_entered_data_property_returns_copy(self, temp_db):
        """Test entered_data property returns copy, not reference"""
        memory = SessionMemory()
        memory.remember("email", "test@example.com")

        data = memory.entered_data
        data["email"] = "modified@example.com"

        assert memory.recall("email") == "test@example.com"  # Original unchanged

    def test_set_user_profile(self, temp_db):
        """Test storing full user profile"""
        memory = SessionMemory()
        profile = {
            "firstName": "John",
            "lastName": "Doe",
            "email": "john@example.com",
            "address": {"city": "Austin", "state": "TX"}
        }

        memory.set_user_profile(profile)

        assert memory.user_profile["firstName"] == "John"
        assert memory.user_profile["email"] == "john@example.com"
        assert memory.user_profile["address"]["city"] == "Austin"

    def test_update_user_profile(self, temp_db):
        """Test merging additional data into user profile"""
        memory = SessionMemory()
        memory.set_user_profile({"firstName": "John", "email": "john@example.com"})

        memory.update_user_profile({"lastName": "Doe", "phone": "555-1234"})

        assert memory.user_profile["firstName"] == "John"  # Original preserved
        assert memory.user_profile["lastName"] == "Doe"  # New field added
        assert memory.user_profile["phone"] == "555-1234"  # New field added

    def test_update_user_profile_overwrites_existing(self, temp_db):
        """Test update_user_profile overwrites existing fields"""
        memory = SessionMemory()
        memory.set_user_profile({"email": "old@example.com"})

        memory.update_user_profile({"email": "new@example.com"})

        assert memory.user_profile["email"] == "new@example.com"

    def test_user_profile_property_returns_copy(self, temp_db):
        """Test user_profile property returns copy, not reference"""
        memory = SessionMemory()
        memory.set_user_profile({"email": "test@example.com"})

        profile = memory.user_profile
        profile["email"] = "modified@example.com"

        assert memory.user_profile["email"] == "test@example.com"  # Original unchanged

    def test_set_missing_fields(self, temp_db):
        """Test storing missing fields list"""
        memory = SessionMemory()

        memory.set_missing_fields(["birthCity", "securityQuestion"])

        assert memory.missing_fields == ["birthCity", "securityQuestion"]

    def test_missing_fields_property_returns_copy(self, temp_db):
        """Test missing_fields property returns copy, not reference"""
        memory = SessionMemory()
        memory.set_missing_fields(["birthCity"])

        fields = memory.missing_fields
        fields.append("anotherField")

        assert memory.missing_fields == ["birthCity"]  # Original unchanged

    def test_update_user_profile_clears_missing_fields(self, temp_db):
        """Test that updating profile clears missing fields"""
        memory = SessionMemory()
        memory.set_missing_fields(["birthCity"])

        memory.update_user_profile({"birthCity": "Austin"})

        assert memory.missing_fields == []

    @pytest.mark.asyncio
    async def test_user_profile_persists_to_db(self, temp_db):
        """Test user profile is saved and loaded from database"""
        memory = await SessionMemory.create()
        memory.set_user_profile({"firstName": "John", "email": "john@example.com"})
        await memory.save()

        # Load in new instance
        memory2 = await SessionMemory.create(session_id=memory.session_id)

        assert memory2.user_profile["firstName"] == "John"
        assert memory2.user_profile["email"] == "john@example.com"

    @pytest.mark.asyncio
    async def test_missing_fields_persists_to_db(self, temp_db):
        """Test missing fields is saved and loaded from database"""
        memory = await SessionMemory.create()
        memory.set_missing_fields(["birthCity", "securityAnswer"])
        await memory.save()

        # Load in new instance
        memory2 = await SessionMemory.create(session_id=memory.session_id)

        assert memory2.missing_fields == ["birthCity", "securityAnswer"]


    def test_format_context_for_llm(self, temp_db):
        """Test format_context_for_llm returns formatted string"""
        memory = SessionMemory()
        memory.remember("email", "test@example.com")
        memory.add_visited_url("http://example.com")

        action = ActionRecord(step=1, action_type="fill_form", params={}, success=True)
        memory.add_action(action)

        context = memory.format_context_for_llm()

        assert "## Session Memory" in context
        assert "test@example.com" in context
        assert "http://example.com" in context
        assert "Current Step: 1" in context
        assert "[OK] Step 1: fill_form" in context

    def test_format_context_for_llm_with_failed_action(self, temp_db):
        """Test format_context_for_llm shows FAIL for failed actions"""
        memory = SessionMemory()

        action = ActionRecord(step=1, action_type="click_link", params={}, success=False)
        memory.add_action(action)

        context = memory.format_context_for_llm()

        assert "[FAIL] Step 1: click_link" in context

    def test_format_action_history(self, temp_db):
        """Test format_action_history returns serializable list"""
        memory = SessionMemory()

        action1 = ActionRecord(step=1, action_type="fill_form", params={"submit": True}, success=True, result={"fields": 3})
        action2 = ActionRecord(step=2, action_type="click_link", params={"link_text": "Next"}, success=False)
        memory.add_action(action1)
        memory.add_action(action2)

        history = memory.format_action_history()

        assert len(history) == 2
        assert history[0]["step"] == 1
        assert history[0]["action"] == "fill_form"
        assert history[0]["params"] == {"submit": True}
        assert history[0]["success"] is True
        assert history[0]["result"] == {"fields": 3}
        assert "timestamp" in history[0]
        assert history[1]["step"] == 2
        assert history[1]["success"] is False

    def test_iter_action_history(self, temp_db):
        """Test iter_action_history returns iterator over actions"""
        memory = SessionMemory()

        action1 = ActionRecord(step=1, action_type="fill_form", params={}, success=True)
        action2 = ActionRecord(step=2, action_type="click_link", params={}, success=True)
        memory.add_action(action1)
        memory.add_action(action2)

        actions = list(memory.iter_action_history())

        assert len(actions) == 2
        assert actions[0].step == 1
        assert actions[1].step == 2


class TestActionRecord:
    """Tests for ActionRecord dataclass"""

    def test_action_record_creation(self):
        """Test creating ActionRecord with required fields"""
        action = ActionRecord(
            step=1,
            action_type="fill_form",
            params={"submit": True},
            success=True
        )

        assert action.step == 1
        assert action.action_type == "fill_form"
        assert action.params == {"submit": True}
        assert action.success is True
        assert isinstance(action.timestamp, datetime)

    def test_action_record_with_result(self):
        """Test ActionRecord with result dict"""
        action = ActionRecord(
            step=1,
            action_type="click_link",
            params={"link_text": "Sign In"},
            success=True,
            result={"navigated": True, "new_url": "http://example.com/signin"}
        )

        assert action.result["navigated"] is True
        assert action.result["new_url"] == "http://example.com/signin"
