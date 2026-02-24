"""Configuration management for Web Form-Filling Agent"""

import os
from enum import Enum
from pathlib import Path
from typing import List
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


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

    # OpenAI Configuration
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-5")
    TEMPERATURE: float = float(os.getenv("TEMPERATURE", "0.1"))
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", "2000"))

    # Server Configuration
    PORT: int = int(os.getenv("PORT", "5001"))

    # Development Settings
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"
    SAVE_GENERATED_CODE: bool = (
        os.getenv("SAVE_GENERATED_CODE", "false").lower() == "true"
    )

    # Browser Settings
    HEADLESS: bool = os.getenv("HEADLESS", "false").lower() == "true"
    BROWSER_TIMEOUT: int = int(os.getenv("BROWSER_TIMEOUT", "30000"))

    # Allowed JavaScript APIs
    ALLOWED_APIS: List[str] = [
        "fillField",
        "clickButton",
        "selectOption",
        "selectRadio",
        "checkCheckbox",
        "waitForElement",
    ]

    # Error Handling
    MAX_RETRY_ATTEMPTS: int = int(os.getenv("MAX_RETRY_ATTEMPTS", "1"))

    # Autonomous Agent Settings
    MAX_AGENT_STEPS: int = int(os.getenv("MAX_AGENT_STEPS", "20"))

    # Paths
    BASE_DIR: Path = Path(__file__).parent.parent
    LOGS_DIR: Path = BASE_DIR / "logs"
    GENERATED_CODE_DIR: Path = LOGS_DIR / "generated_code"
    PROMPTS_DIR: Path = BASE_DIR / "prompts"

    @classmethod
    def validate(cls) -> None:
        """Validate configuration"""
        if not cls.OPENAI_API_KEY:
            raise ValueError(
                "OPENAI_API_KEY not set. Please add it to your .env file."
            )

        # Create necessary directories
        cls.LOGS_DIR.mkdir(exist_ok=True)
        if cls.SAVE_GENERATED_CODE:
            cls.GENERATED_CODE_DIR.mkdir(parents=True, exist_ok=True)


# Create global config instance
config = Config()
