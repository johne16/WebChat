"""FastAPI server for Autonomous Web Agent"""

import argparse
import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, List, Any
import uvicorn

from src.config import config, GoalStatus

logger = logging.getLogger(__name__)
from src.web_agent import AutonomousWebAgent


@dataclass
class AppConfig:
    """CLI configuration stored on app.state"""
    port: Optional[int] = None
    callback_url: Optional[str] = None
    database_path: Optional[str] = None

class AgentManager:
    """Thread-safe manager for active agent instances"""

    def __init__(self):
        self._agents: Dict[str, AutonomousWebAgent] = {}
        self._lock = asyncio.Lock()

    async def get(self, session_id: str) -> Optional[AutonomousWebAgent]:
        async with self._lock:
            return self._agents.get(session_id)

    async def set(self, session_id: str, agent: AutonomousWebAgent) -> None:
        async with self._lock:
            self._agents[session_id] = agent

    async def remove(self, session_id: str) -> None:
        async with self._lock:
            self._agents.pop(session_id, None)

    async def has(self, session_id: str) -> bool:
        async with self._lock:
            return session_id in self._agents


agent_manager = AgentManager()


# Pydantic models for request/response validation
class AddressProfile(BaseModel):
    """Address information"""
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None


class UserProfile(BaseModel):
    """User profile data for form filling"""
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None
    dateOfBirth: Optional[str] = None
    address: Optional[AddressProfile] = None

    model_config = ConfigDict(extra="allow")


class ErrorDetail(BaseModel):
    """Error details"""
    type: str
    message: str
    field: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class ExecuteGoalOptions(BaseModel):
    """Options for goal execution"""
    headless: bool = False
    maxSteps: int = config.MAX_AGENT_STEPS
    timeout: int = 60000  # ms


class ExecuteGoalRequest(BaseModel):
    """Request model for POST /api/execute-goal"""
    goal: str = Field(..., description="Natural language goal to achieve")
    startUrl: str = Field(..., description="URL to start from")
    userProfile: UserProfile = Field(..., description="User data for form filling")
    sessionId: Optional[str] = Field(None, description="Session ID to resume")
    provider: Optional[str] = Field(None, description="LLM provider override")
    model: Optional[str] = Field(None, description="LLM model override")
    options: Optional[ExecuteGoalOptions] = ExecuteGoalOptions()


class ActionHistoryItem(BaseModel):
    """Single action in execution history"""
    step: int
    action: str
    params: Dict[str, Any]
    success: bool
    result: Dict[str, Any]
    timestamp: str


class MemorySummary(BaseModel):
    """Summary of session memory"""
    enteredData: Dict[str, Any]
    visitedUrls: List[str]
    extractedInfo: Dict[str, Any]


class ExecuteGoalResponse(BaseModel):
    """Response model for POST /api/execute-goal"""
    success: bool
    goalAchieved: bool
    sessionId: str
    status: str
    finalUrl: str
    stepsTaken: int
    executionTime: float
    tokensUsed: int
    actionHistory: List[ActionHistoryItem]
    memory: MemorySummary
    errors: List[ErrorDetail]
    # Optional fields for needs_input status
    needsInput: Optional[bool] = None
    missingFields: Optional[List[str]] = None
    # Optional field for awaiting_user_action status
    awaitingUserAction: Optional[bool] = None
    message: Optional[str] = None


class ContinueSessionRequest(BaseModel):
    """Request model for POST /api/session/{sessionId}/continue"""
    additionalData: Optional[Dict[str, Any]] = Field(
        default={},
        description="Additional user data fields (optional for awaiting_user_action)"
    )
    provider: Optional[str] = Field(None, description="LLM provider for session resume")
    model: Optional[str] = Field(None, description="LLM model for session resume")


def _build_response(result: Dict[str, Any]) -> ExecuteGoalResponse:
    """Convert raw agent result dict into ExecuteGoalResponse

    Args:
        result: Raw result dict from AutonomousWebAgent.execute_goal()

    Returns:
        ExecuteGoalResponse with validated fields
    """
    action_history = []
    for action in result.get("actionHistory", []):
        action_history.append(ActionHistoryItem(
            step=action.get("step", 0),
            action=action.get("action", "unknown"),
            params=action.get("params", {}),
            success=action.get("success", False),
            result=action.get("result", {}),
            timestamp=action.get("timestamp", "")
        ))

    errors = []
    for error in result.get("errors", []):
        errors.append(ErrorDetail(
            type=error.get("type", "unknown"),
            message=error.get("message", ""),
            field=error.get("field"),
            details=error.get("details")
        ))

    memory_data = result.get("memory", {})
    memory = MemorySummary(
        enteredData=memory_data.get("enteredData", {}),
        visitedUrls=memory_data.get("visitedUrls", []),
        extractedInfo=memory_data.get("extractedInfo", {})
    )

    return ExecuteGoalResponse(
        success=result["success"],
        goalAchieved=result["goalAchieved"],
        sessionId=result["sessionId"],
        status=result.get("status", "unknown"),
        finalUrl=result.get("finalUrl", ""),
        stepsTaken=result.get("stepsTaken", 0),
        executionTime=result.get("executionTime", 0),
        tokensUsed=result.get("tokensUsed", 0),
        actionHistory=action_history,
        memory=memory,
        errors=errors,
        needsInput=result.get("needsInput"),
        missingFields=result.get("missingFields"),
        awaitingUserAction=result.get("awaitingUserAction"),
        message=result.get("message")
    )


# Create FastAPI app
app = FastAPI(
    title="Autonomous Web Agent API",
    description="Goal-driven web automation using LLM planning"
)


@app.post("/api/execute-goal", response_model=ExecuteGoalResponse)
async def execute_goal(request: ExecuteGoalRequest, raw_request: Request):
    """Execute a natural language goal autonomously

    Args:
        request: Goal execution request

    Returns:
        Structured response with results, action history, and memory
    """
    # Create agent instance (with optional session resume)
    app_config: AppConfig = raw_request.app.state.app_config
    db_path = Path(app_config.database_path) if app_config.database_path else None

    agent = AutonomousWebAgent(
        session_id=request.sessionId,
        db_path=db_path,
        callback_url=app_config.callback_url,
        port=app_config.port,
        task_id=request.sessionId,  # Use sessionId as taskId for now
        provider=request.provider,
        model=request.model
    )

    # Convert UserProfile to dict
    user_profile_dict = request.userProfile.model_dump(exclude_none=True)

    # Build options
    options = {}
    if request.options:
        options = {
            "max_steps": request.options.maxSteps,
            "timeout": request.options.timeout,
            "headless": request.options.headless
        }

    # Execute goal
    result = await agent.execute_goal(
        goal=request.goal,
        start_url=request.startUrl,
        user_profile=user_profile_dict,
        options=options
    )

    # Keep agent alive if awaiting user action or needs input
    session_id = result.get("sessionId")
    if result.get("awaitingUserAction") or result.get("needsInput"):
        await agent_manager.set(session_id, agent)
    else:
        await agent_manager.remove(session_id)

    return _build_response(result)


@app.post("/api/session/{session_id}/continue", response_model=ExecuteGoalResponse)
async def continue_session(session_id: str, request: ContinueSessionRequest, raw_request: Request):
    """Continue a paused session with additional user data

    Use this endpoint when a previous request returned needsInput=true.
    Provide the missing fields in additionalData.

    Args:
        session_id: Session ID from previous request
        request: Additional data to merge into user profile

    Returns:
        Structured response with results, action history, and memory
    """
    from src.memory import SessionMemory

    # Check if we have an active agent with browser still open
    agent = await agent_manager.get(session_id)
    if agent:
        # Merge additional data into memory
        if request.additionalData:
            agent.memory.update_user_profile(request.additionalData)
    else:
        # Load existing session to get goal and current URL
        app_config: AppConfig = raw_request.app.state.app_config
        db_path = Path(app_config.database_path) if app_config.database_path else None
        memory = SessionMemory(session_id, db_path=db_path)

        if not memory.goal:
            return ExecuteGoalResponse(
                success=False,
                goalAchieved=False,
                sessionId=session_id,
                status=GoalStatus.FAILED,
                finalUrl="",
                stepsTaken=0,
                executionTime=0,
                tokensUsed=0,
                actionHistory=[],
                memory=MemorySummary(enteredData={}, visitedUrls=[], extractedInfo={}),
                errors=[ErrorDetail(type="session_not_found", message=f"Session {session_id} not found")]
            )

        # Create new agent (browser was closed, will start fresh)
        agent = AutonomousWebAgent(
            session_id=session_id,
            db_path=db_path,
            callback_url=app_config.callback_url,
            port=app_config.port,
            task_id=session_id,
            provider=request.provider,
            model=request.model
        )

    # Get goal and start URL from agent's memory
    goal = agent.memory.goal
    start_url = agent.memory.current_url or (agent.memory.visited_urls[-1] if agent.memory.visited_urls else "")

    # Execute goal with additional data merged into stored profile
    result = await agent.execute_goal(
        goal=goal,
        start_url=start_url,
        user_profile=request.additionalData or {},  # Will be merged with stored profile
        options={"max_steps": config.MAX_AGENT_STEPS}
    )

    # Keep agent alive if still awaiting, otherwise clean up
    if result.get("awaitingUserAction") or result.get("needsInput"):
        await agent_manager.set(session_id, agent)
    else:
        await agent_manager.remove(session_id)

    return _build_response(result)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "autonomous-web-agent"
    }


@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Autonomous Web Agent API",
        "docs": "/docs",
        "health": "/health",
        "endpoint": "POST /api/execute-goal"
    }


def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description="Autonomous Web Agent API")
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"Server port (default: {config.PORT} from env)"
    )
    parser.add_argument(
        "--callback-url",
        type=str,
        default=None,
        help="Callback URL for status updates (webhooks)"
    )
    parser.add_argument(
        "--database-path",
        type=str,
        default=None,
        help="Path to SQLite database for session storage"
    )
    return parser.parse_args()


if __name__ == "__main__":
    # Validate config at startup
    config.validate()

    # Parse CLI arguments and store on app.state
    args = parse_args()
    app.state.app_config = AppConfig(
        port=args.port,
        callback_url=args.callback_url,
        database_path=args.database_path
    )

    # Determine port (CLI arg takes precedence over config)
    port = args.port if args.port else config.PORT

    logger.info(f"Starting Autonomous Web Agent on port {port}")
    logger.info(f"Debug mode: {config.DEBUG}")
    logger.info(f"Headless browser: {config.HEADLESS}")
    logger.info(f"OpenAI model: {config.OPENAI_MODEL}")
    if args.callback_url:
        logger.info(f"Callback URL: {args.callback_url}")
    if args.database_path:
        logger.info(f"Database path: {args.database_path}")
    logger.info(f"API Documentation: http://localhost:{port}/docs")
    logger.info(f"Health Check: http://localhost:{port}/health")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info" if config.DEBUG else "warning"
    )