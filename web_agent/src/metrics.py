"""Metrics Logger - JSONL file writer for per-session performance instrumentation"""

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)


class MetricsLogger:
    """Appends JSON lines to a per-session JSONL file for performance analysis"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.file_path = Path(__file__).parent.parent / "logs" / f"{session_id}.jsonl"
        self.file_path.parent.mkdir(parents=True, exist_ok=True)

    def log_step(self, step_data: Dict[str, Any]) -> None:
        """Append step metrics as a single JSON line"""
        self._append(step_data)

    def log_summary(self, summary_data: Dict[str, Any]) -> None:
        """Append session summary as a single JSON line"""
        self._append(summary_data)

    def _append(self, data: Dict[str, Any]) -> None:
        """Write a single JSON line to the metrics file"""
        try:
            with open(self.file_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(data) + "\n")
        except Exception as e:
            logger.warning("Failed to write metrics: %s", e)
