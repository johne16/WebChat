"""Configuration management for Web Form-Filling Agent"""

import json
import os
from enum import Enum
from pathlib import Path
from typing import List
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def _load_app_config() -> dict:
    """Load shared config from project root webchat.config.json"""
    config_path = Path(__file__).parent.parent.parent / "webchat.config.json"
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


_app_config = _load_app_config()
_agent = _app_config.get("agent", {})
_browser = _agent.get("browser", {})
_llm = _agent.get("llm", {})
_execution = _agent.get("execution", {})
_providers = _app_config.get("providers", {})


class GoalStatus(str, Enum):
    """Status values for goal execution, used across agent modules"""
    IN_PROGRESS = "in_progress"
    ACHIEVED = "achieved"
    BLOCKED = "blocked"
    FAILED = "failed"
    NEEDS_INPUT = "needs_input"
    AWAITING_USER_ACTION = "awaiting_user_action"
    STARTED = "started"
    STEP_COMPLETED = "step_completed"


class Config:
    """Configuration class for agent settings"""

    # Provider Configuration
    PROVIDER: str = os.getenv("PROVIDER", _providers.get("default"))
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", _providers.get("defaultModel"))
    TEMPERATURE: float = float(os.getenv("TEMPERATURE", str(_llm.get("temperature", 0.1))))
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", str(_llm.get("maxTokens", 2000))))

    # Server Configuration
    PORT: int = int(os.getenv("PORT", str(_agent.get("defaultPort", 5001))))

    # Development Settings
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"
    SAVE_GENERATED_CODE: bool = (
        os.getenv("SAVE_GENERATED_CODE", "false").lower() == "true"
    )

    # Browser Settings
    HEADLESS: bool = os.getenv("HEADLESS", str(_browser.get("headless", False))).lower() == "true"
    BROWSER_TIMEOUT: int = int(os.getenv("BROWSER_TIMEOUT", str(_browser.get("timeoutMs", 30000))))
    NAVIGATION_TIMEOUT: int = int(os.getenv("NAVIGATION_TIMEOUT", str(_browser.get("navigationTimeoutMs", 5000))))
    WAIT_POLICY: str = os.getenv("WAIT_POLICY", _browser.get("waitPolicy", "networkidle"))
    SCROLL_PIXELS: int = int(os.getenv("SCROLL_PIXELS", str(_browser.get("scrollPixels", 500))))
    CONTENT_MAX_CHARS: int = int(os.getenv("CONTENT_MAX_CHARS", str(_browser.get("contentMaxChars", 3000))))
    LINK_TEXT_MAX_CHARS: int = int(os.getenv("LINK_TEXT_MAX_CHARS", str(_browser.get("linkTextMaxChars", 100))))
    BUTTON_TEXT_MAX_CHARS: int = int(os.getenv("BUTTON_TEXT_MAX_CHARS", str(_browser.get("buttonTextMaxChars", 100))))
    CHARS_PER_TOKEN: int = int(os.getenv("CHARS_PER_TOKEN", str(_browser.get("charsPerToken", 4))))

    # Allowed JavaScript APIs
    ALLOWED_APIS: List[str] = _agent.get("allowedAPIs", [
        "fillField",
        "clickButton",
        "selectOption",
        "selectRadio",
        "checkCheckbox",
        "waitForElement",
    ])

    # Error Handling
    MAX_RETRY_ATTEMPTS: int = int(os.getenv("MAX_RETRY_ATTEMPTS", str(_agent.get("maxRetryAttempts", 1))))

    # Autonomous Agent Settings
    MAX_AGENT_STEPS: int = int(os.getenv("MAX_AGENT_STEPS", str(_agent.get("maxSteps", 20))))
    CONSECUTIVE_FAILURE_THRESHOLD: int = int(
        os.getenv("CONSECUTIVE_FAILURE_THRESHOLD", str(_agent.get("consecutiveFailureThreshold", 3)))
    )
    RECENT_ACTION_LOOKBACK: int = int(
        os.getenv("RECENT_ACTION_LOOKBACK", str(_agent.get("recentActionLookback", 5)))
    )

    # Session cleanup
    SESSION_TTL_DAYS: int = int(os.getenv("SESSION_TTL_DAYS", str(_agent.get("sessionTtlDays", 7))))

    # Execution Engine
    MAX_CODE_LENGTH: int = int(os.getenv("MAX_CODE_LENGTH", str(_execution.get("maxCodeLength", 5000))))
    EXECUTION_WAIT_TIMEOUT: int = int(os.getenv("EXECUTION_WAIT_TIMEOUT", str(_execution.get("waitTimeoutMs", 5000))))

    # Paths
    BASE_DIR: Path = Path(__file__).parent.parent
    LOGS_DIR: Path = BASE_DIR / "logs"
    GENERATED_CODE_DIR: Path = LOGS_DIR / "generated_code"
    PROMPTS_DIR: Path = BASE_DIR / "prompts"

    @classmethod
    def validate(cls) -> None:
        """Validate configuration"""
        if cls.PROVIDER == "openai" and not cls.OPENAI_API_KEY:
            raise ValueError(
                "OPENAI_API_KEY not set. Please add it to your .env file."
            )
        if cls.PROVIDER == "anthropic" and not cls.ANTHROPIC_API_KEY:
            raise ValueError(
                "ANTHROPIC_API_KEY not set. Please add it to your .env file."
            )

        # Create necessary directories
        cls.LOGS_DIR.mkdir(exist_ok=True)
        if cls.SAVE_GENERATED_CODE:
            cls.GENERATED_CODE_DIR.mkdir(parents=True, exist_ok=True)


# Create global config instance
config = Config()
