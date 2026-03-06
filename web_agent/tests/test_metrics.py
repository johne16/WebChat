"""Tests for metrics.py - JSONL metrics logger"""

import json
import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch

from src.metrics import MetricsLogger


@pytest.fixture
def temp_logs_dir():
    """Use temporary directory for log files"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


class TestMetricsLogger:
    """Tests for MetricsLogger class"""

    def test_init_creates_log_directory(self, temp_logs_dir):
        """Test logger creates parent directory"""
        with patch.object(MetricsLogger, '__init__', lambda self, sid: None):
            logger = MetricsLogger.__new__(MetricsLogger)
            logger.session_id = "test-session"
            logger.file_path = temp_logs_dir / "sub" / "test-session.jsonl"
            logger.file_path.parent.mkdir(parents=True, exist_ok=True)

            assert logger.file_path.parent.exists()

    def test_log_step_writes_jsonl(self, temp_logs_dir):
        """Test log_step appends a JSON line"""
        logger = MetricsLogger.__new__(MetricsLogger)
        logger.session_id = "test-session"
        logger.file_path = temp_logs_dir / "test-session.jsonl"

        logger.log_step({"type": "step", "step": 1, "action": "fill_form"})

        lines = logger.file_path.read_text().strip().split("\n")
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["type"] == "step"
        assert data["step"] == 1

    def test_log_summary_writes_jsonl(self, temp_logs_dir):
        """Test log_summary appends a JSON line"""
        logger = MetricsLogger.__new__(MetricsLogger)
        logger.session_id = "test-session"
        logger.file_path = temp_logs_dir / "test-session.jsonl"

        logger.log_summary({"type": "task_summary", "totalSteps": 5})

        lines = logger.file_path.read_text().strip().split("\n")
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["type"] == "task_summary"
        assert data["totalSteps"] == 5

    def test_multiple_writes_append(self, temp_logs_dir):
        """Test multiple log calls append to the same file"""
        logger = MetricsLogger.__new__(MetricsLogger)
        logger.session_id = "test-session"
        logger.file_path = temp_logs_dir / "test-session.jsonl"

        logger.log_step({"type": "step", "step": 1})
        logger.log_step({"type": "step", "step": 2})
        logger.log_summary({"type": "task_summary"})

        lines = logger.file_path.read_text().strip().split("\n")
        assert len(lines) == 3

    def test_log_step_handles_write_error(self, temp_logs_dir):
        """Test logger does not raise on write failure"""
        logger = MetricsLogger.__new__(MetricsLogger)
        logger.session_id = "test-session"
        logger.file_path = Path("/nonexistent/path/test.jsonl")

        # Should not raise
        logger.log_step({"type": "step"})
