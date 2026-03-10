"""Session Memory - SQLite-backed persistent storage for agent sessions"""

import json
import logging
import aiosqlite
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from src.config import GoalStatus, config


@dataclass
class ActionRecord:
    """Record of a single action taken by the agent"""
    step: int
    action_type: str
    params: Dict[str, Any]
    success: bool
    result: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)


class SessionMemory:
    """SQLite-backed session memory for persistent agent state

    Enables:
    - Multi-call sessions (orchestrator calls agent multiple times with shared context)
    - Resume capability (continue from where agent left off after failure)
    """

    DEFAULT_DB_PATH = Path("data/sessions.db")

    def __init__(self, session_id: Optional[str] = None, db_path: Optional[Path] = None):
        """Initialize session memory

        Args:
            session_id: Existing session ID to load, or None for new session
            db_path: Path to SQLite database, or None for default
        """
        self.db_path = db_path or self.DEFAULT_DB_PATH
        self.session_id = session_id or str(uuid.uuid4())
        self.goal: str = ""
        self.status: str = GoalStatus.IN_PROGRESS
        self.current_url: str = ""
        self.current_step: int = 0
        self.created_at: datetime = datetime.now()
        self.updated_at: datetime = datetime.now()

        # In-memory cache (synced with DB)
        self._entered_data: Dict[str, str] = {}
        self._extracted_info: Dict[str, Any] = {}
        self._action_history: List[ActionRecord] = []
        self._visited_urls: List[str] = []
        self._user_profile: Dict[str, Any] = {}
        self._missing_fields: List[str] = []

        # Track the session_id passed to constructor for async init
        self._init_session_id = session_id

    @classmethod
    async def create(cls, session_id: Optional[str] = None, db_path: Optional[Path] = None) -> "SessionMemory":
        """Async factory method to create and initialize a SessionMemory instance

        Args:
            session_id: Existing session ID to load, or None for new session
            db_path: Path to SQLite database, or None for default

        Returns:
            Initialized SessionMemory instance
        """
        instance = cls(session_id, db_path)
        await instance.init()
        return instance

    async def init(self) -> None:
        """Async initialization: set up database, clean old sessions, load existing session"""
        await self._init_db()

        # TTL cleanup: delete sessions older than configured days
        await self._cleanup_old_sessions()

        # Load existing session if provided
        if self._init_session_id:
            await self.load(self._init_session_id)

    async def _init_db(self) -> None:
        """Initialize database schema"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        async with aiosqlite.connect(self.db_path) as conn:
            # Sessions table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    goal TEXT,
                    status TEXT,
                    current_url TEXT,
                    current_step INTEGER DEFAULT 0,
                    created_at TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """)

            # Key-value memory (entered_data, extracted_info, visited_urls)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS memory (
                    session_id TEXT,
                    key TEXT,
                    value TEXT,
                    PRIMARY KEY (session_id, key)
                )
            """)

            # Action history
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS actions (
                    session_id TEXT,
                    step INTEGER,
                    action_type TEXT,
                    params TEXT,
                    result TEXT,
                    success INTEGER,
                    timestamp TIMESTAMP,
                    PRIMARY KEY (session_id, step)
                )
            """)

            await conn.commit()

    async def _cleanup_old_sessions(self) -> None:
        """Delete sessions older than SESSION_TTL_DAYS"""
        ttl_days = config.SESSION_TTL_DAYS
        async with aiosqlite.connect(self.db_path) as conn:
            await conn.execute(
                "DELETE FROM actions WHERE session_id IN (SELECT session_id FROM sessions WHERE created_at < datetime('now', ?))",
                (f'-{ttl_days} days',)
            )
            await conn.execute(
                "DELETE FROM memory WHERE session_id IN (SELECT session_id FROM sessions WHERE created_at < datetime('now', ?))",
                (f'-{ttl_days} days',)
            )
            cursor = await conn.execute(
                "DELETE FROM sessions WHERE created_at < datetime('now', ?)",
                (f'-{ttl_days} days',)
            )
            deleted = cursor.rowcount
            await conn.commit()
        if deleted > 0:
            logging.getLogger(__name__).info(f"Cleaned up {deleted} sessions older than {ttl_days} days")

    async def save(self) -> None:
        """Persist current state to database"""
        self.updated_at = datetime.now()

        async with aiosqlite.connect(self.db_path) as conn:
            # Upsert session
            await conn.execute("""
                INSERT OR REPLACE INTO sessions
                (session_id, goal, status, current_url, current_step, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                self.session_id,
                self.goal,
                self.status,
                self.current_url,
                self.current_step,
                self.created_at.isoformat(),
                self.updated_at.isoformat()
            ))

            # Save memory entries
            memory_entries = {
                "entered_data": self._entered_data,
                "extracted_info": self._extracted_info,
                "visited_urls": self._visited_urls,
                "user_profile": self._user_profile,
                "missing_fields": self._missing_fields,
            }
            for key, value in memory_entries.items():
                await conn.execute("""
                    INSERT OR REPLACE INTO memory (session_id, key, value)
                    VALUES (?, ?, ?)
                """, (self.session_id, key, json.dumps(value)))

            # Save action history
            for action in self._action_history:
                await conn.execute("""
                    INSERT OR REPLACE INTO actions
                    (session_id, step, action_type, params, result, success, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    self.session_id,
                    action.step,
                    action.action_type,
                    json.dumps(action.params),
                    json.dumps(action.result),
                    1 if action.success else 0,
                    action.timestamp.isoformat()
                ))

            await conn.commit()

    async def load(self, session_id: str) -> bool:
        """Load session from database

        Args:
            session_id: Session ID to load

        Returns:
            True if session found and loaded, False otherwise
        """
        async with aiosqlite.connect(self.db_path) as conn:
            # Load session
            cursor = await conn.execute("""
                SELECT goal, status, current_url, current_step, created_at, updated_at
                FROM sessions WHERE session_id = ?
            """, (session_id,))

            row = await cursor.fetchone()
            if not row:
                return False

            self.session_id = session_id
            self.goal = row[0] or ""
            self.status = row[1] or GoalStatus.IN_PROGRESS
            self.current_url = row[2] or ""
            self.current_step = row[3] or 0
            self.created_at = datetime.fromisoformat(row[4]) if row[4] else datetime.now()
            self.updated_at = datetime.fromisoformat(row[5]) if row[5] else datetime.now()

            # Load memory entries
            cursor = await conn.execute("""
                SELECT key, value FROM memory WHERE session_id = ?
            """, (session_id,))

            for key, value in await cursor.fetchall():
                if key == "entered_data":
                    self._entered_data = json.loads(value) if value else {}
                elif key == "extracted_info":
                    self._extracted_info = json.loads(value) if value else {}
                elif key == "visited_urls":
                    self._visited_urls = json.loads(value) if value else []
                elif key == "user_profile":
                    self._user_profile = json.loads(value) if value else {}
                elif key == "missing_fields":
                    self._missing_fields = json.loads(value) if value else []

            # Load action history
            cursor = await conn.execute("""
                SELECT step, action_type, params, result, success, timestamp
                FROM actions WHERE session_id = ? ORDER BY step
            """, (session_id,))

            self._action_history = []
            for row in await cursor.fetchall():
                self._action_history.append(ActionRecord(
                    step=row[0],
                    action_type=row[1],
                    params=json.loads(row[2]) if row[2] else {},
                    success=bool(row[4]),
                    result=json.loads(row[3]) if row[3] else {},
                    timestamp=datetime.fromisoformat(row[5]) if row[5] else datetime.now()
                ))

        return True

    def remember(self, key: str, value: str) -> None:
        """Store data entered in a form field for later reuse

        Args:
            key: Field name (e.g., "email", "password")
            value: Value entered
        """
        self._entered_data[key] = value

    def recall(self, key: str) -> Optional[str]:
        """Retrieve previously entered data

        Args:
            key: Field name to recall

        Returns:
            Value if found, None otherwise
        """
        return self._entered_data.get(key)

    def store_info(self, key: str, value: Any) -> None:
        """Store extracted information from pages

        Args:
            key: Info key
            value: Extracted value (will be JSON serialized)
        """
        self._extracted_info[key] = value

    def get_info(self, key: str) -> Any:
        """Get extracted information

        Args:
            key: Info key

        Returns:
            Stored value or None
        """
        return self._extracted_info.get(key)

    def add_visited_url(self, url: str) -> None:
        """Record a visited URL"""
        if url not in self._visited_urls:
            self._visited_urls.append(url)

    def add_action(self, action: ActionRecord) -> None:
        """Record an action taken

        Args:
            action: Action record to add
        """
        self._action_history.append(action)
        self.current_step = action.step

    def get_last_action(self) -> Optional[ActionRecord]:
        """Get the most recent action

        Returns:
            Last action record or None if no actions
        """
        return self._action_history[-1] if self._action_history else None

    def get_context_for_llm(self) -> Dict[str, Any]:
        """Format memory for LLM prompt

        Returns:
            Dictionary with memory context for planning
        """
        return {
            "session_id": self.session_id,
            "goal": self.goal,
            "status": self.status,
            "current_step": self.current_step,
            "entered_data": self._entered_data,
            "extracted_info": self._extracted_info,
            "visited_urls": self._visited_urls,
            "recent_actions": [
                {
                    "step": a.step,
                    "action": a.action_type,
                    "success": a.success
                }
                for a in self._action_history[-5:]  # Last 5 actions
            ]
        }

    def format_context_for_llm(self) -> str:
        """Format memory context as a pre-formatted string for LLM planning prompts

        Returns:
            Formatted string with session memory details
        """
        sections = [
            "## Session Memory",
            f"Entered Data: {json.dumps(self._entered_data)}",
            f"Visited URLs: {json.dumps(self._visited_urls)}",
            f"Current Step: {self.current_step}",
        ]

        recent_actions = [
            {
                "step": a.step,
                "action": a.action_type,
                "success": a.success
            }
            for a in self._action_history[-5:]
        ]

        if recent_actions:
            sections.append("\nRecent Actions:")
            for action in recent_actions:
                status = "OK" if action.get('success') else "FAIL"
                sections.append(f"  [{status}] Step {action.get('step')}: {action.get('action')}")

        return "\n".join(sections)

    @property
    def entered_data(self) -> Dict[str, str]:
        """Get all entered data (returns copy for safety)"""
        return self._entered_data.copy()

    @property
    def visited_urls(self) -> List[str]:
        """Get all visited URLs (returns copy for safety)"""
        return self._visited_urls.copy()

    @property
    def action_history(self) -> List[ActionRecord]:
        """Get full action history (returns copy for safety)"""
        return self._action_history.copy()

    def iter_action_history(self):
        """Iterate over action history without copying"""
        return iter(self._action_history)

    def format_action_history(self) -> List[Dict[str, Any]]:
        """Format action history for serialization without copying

        Returns:
            List of formatted action dicts
        """
        return [
            {
                "step": action.step,
                "action": action.action_type,
                "params": action.params,
                "success": action.success,
                "result": action.result,
                "timestamp": action.timestamp.isoformat()
            }
            for action in self._action_history
        ]

    @property
    def user_profile(self) -> Dict[str, Any]:
        """Get stored user profile (returns copy for safety)"""
        return self._user_profile.copy()

    @property
    def missing_fields(self) -> List[str]:
        """Get list of missing fields requested by agent (returns copy for safety)"""
        return self._missing_fields.copy()

    def set_user_profile(self, profile: Dict[str, Any]) -> None:
        """Store the full user profile

        Args:
            profile: User profile dictionary
        """
        self._user_profile = profile.copy()

    def update_user_profile(self, additional_data: Dict[str, Any]) -> None:
        """Merge additional data into stored user profile

        Args:
            additional_data: New fields to add/update
        """
        self._user_profile.update(additional_data)
        # Clear missing fields since we're providing new data
        self._missing_fields = []

    def set_missing_fields(self, fields: List[str]) -> None:
        """Set the list of missing fields

        Args:
            fields: List of field names the agent needs
        """
        self._missing_fields = fields.copy()
