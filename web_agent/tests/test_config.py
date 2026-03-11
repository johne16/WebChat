"""Tests for config.py - Configuration management"""

import pytest
from unittest.mock import patch
from src.config import Config


class TestConfigValidate:
    """Tests for Config.validate()"""

    def test_validate_openai_missing_key(self):
        """Test validation raises when OpenAI key is missing"""
        with patch.object(Config, 'PROVIDER', 'openai'), \
             patch.object(Config, 'OPENAI_API_KEY', ''):
            with pytest.raises(ValueError, match="OPENAI_API_KEY"):
                Config.validate()

    def test_validate_anthropic_missing_key(self):
        """Test validation raises when Anthropic key is missing"""
        with patch.object(Config, 'PROVIDER', 'anthropic'), \
             patch.object(Config, 'ANTHROPIC_API_KEY', ''):
            with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
                Config.validate()

    def test_validate_openai_with_key(self, tmp_path):
        """Test validation passes when OpenAI key is set"""
        with patch.object(Config, 'PROVIDER', 'openai'), \
             patch.object(Config, 'OPENAI_API_KEY', 'sk-test'), \
             patch.object(Config, 'LOGS_DIR', tmp_path / 'logs'), \
             patch.object(Config, 'SAVE_GENERATED_CODE', False):
            Config.validate()
            assert (tmp_path / 'logs').exists()

    def test_validate_creates_generated_code_dir(self, tmp_path):
        """Test validation creates generated code dir when SAVE_GENERATED_CODE is True"""
        with patch.object(Config, 'PROVIDER', 'openai'), \
             patch.object(Config, 'OPENAI_API_KEY', 'sk-test'), \
             patch.object(Config, 'LOGS_DIR', tmp_path / 'logs'), \
             patch.object(Config, 'GENERATED_CODE_DIR', tmp_path / 'logs' / 'generated_code'), \
             patch.object(Config, 'SAVE_GENERATED_CODE', True):
            Config.validate()
            assert (tmp_path / 'logs' / 'generated_code').exists()


class TestGoalStatus:
    """Tests for GoalStatus enum"""

    def test_goal_status_values(self):
        """Test GoalStatus enum has expected values"""
        from src.config import GoalStatus

        assert GoalStatus.IN_PROGRESS == "in_progress"
        assert GoalStatus.ACHIEVED == "achieved"
        assert GoalStatus.BLOCKED == "blocked"
        assert GoalStatus.FAILED == "failed"
        assert GoalStatus.NEEDS_INPUT == "needs_input"
        assert GoalStatus.AWAITING_USER_ACTION == "awaiting_user_action"
        assert GoalStatus.STARTED == "started"
        assert GoalStatus.STEP_COMPLETED == "step_completed"
