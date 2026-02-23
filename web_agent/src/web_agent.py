"""Autonomous Web Agent - Goal-driven web automation orchestrator"""

import time
import httpx
from typing import Dict, Any, Optional, List
from src.browser import BrowserManager
from src.llm import LLMClient
from src.execution_engine import ExecutionEngine
from src.action_executor import ActionExecutor
from src.memory import SessionMemory, ActionRecord
from src.config import config
from pathlib import Path


class AutonomousWebAgent:
    """Goal-driven autonomous web agent

    Core loop:
    1. Analyze current page
    2. Ask LLM to decide next action based on goal + page state + memory
    3. Execute the action
    4. Update memory
    5. Repeat until goal achieved or blocked
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        db_path: Optional[Path] = None,
        callback_url: Optional[str] = None,
        port: Optional[int] = None,
        task_id: Optional[str] = None
    ):
        """Initialize autonomous web agent

        Args:
            session_id: Existing session ID to resume, or None for new session
            db_path: Path to SQLite database, or None for default
            callback_url: URL to POST status updates (webhooks)
            port: Port this agent is running on (for webhook identification)
            task_id: Task ID (for webhook identification)
        """
        self.browser = BrowserManager(
            headless=config.HEADLESS,
            timeout=config.BROWSER_TIMEOUT
        )
        self.llm = LLMClient(
            api_key=config.OPENAI_API_KEY,
            model=config.OPENAI_MODEL,
            temperature=config.TEMPERATURE
        )
        self.memory = SessionMemory(session_id, db_path=db_path)
        self.action_executor: Optional[ActionExecutor] = None
        self.execution_engine: Optional[ExecutionEngine] = None

        # Webhook configuration
        self.callback_url = callback_url
        self.port = port
        self.task_id = task_id

        # Tracking
        self.total_tokens = 0
        self.start_time: Optional[float] = None

    async def _send_webhook(self, status: str, message: Optional[str] = None,
                            missing_fields: Optional[List[str]] = None,
                            data: Optional[Dict[str, Any]] = None) -> None:
        """Send status update to callback URL

        Args:
            status: Status string (started, step_completed, needs_input, achieved, failed, etc.)
            message: Optional human-readable message
            missing_fields: List of missing fields (for needs_input status)
            data: Additional data to include
        """
        if not self.callback_url:
            return

        payload = {
            "port": self.port,
            "taskId": self.task_id,
            "sessionId": self.memory.session_id,
            "status": status,
            "message": message,
            "missingFields": missing_fields,
            "data": data or {}
        }

        try:
            async with httpx.AsyncClient() as client:
                await client.post(self.callback_url, json=payload, timeout=5.0)
            if config.DEBUG:
                print(f"[WEBHOOK] Sent status={status} to {self.callback_url}")
        except Exception as e:
            if config.DEBUG:
                print(f"[WEBHOOK] Failed to send: {e}")

    async def execute_goal(
        self,
        goal: str,
        start_url: str,
        user_profile: Dict[str, Any],
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute a natural language goal autonomously

        Args:
            goal: Natural language goal (e.g., "Sign up then sign in")
            start_url: URL to start from
            user_profile: User data for form filling
            options: Optional settings (max_steps, timeout)

        Returns:
            {
                "success": bool,
                "goalAchieved": bool,
                "sessionId": str,
                "finalUrl": str,
                "stepsTaken": int,
                "executionTime": float,
                "tokensUsed": int,
                "actionHistory": list,
                "memory": dict,
                "errors": list
            }
        """
        self.start_time = time.time()
        options = options or {}
        max_steps = options.get("max_steps", config.MAX_AGENT_STEPS)
        errors: List[Dict[str, Any]] = []

        # Track whether to close browser at end (keep open for awaiting_user_action, needs_input)
        self._should_close_browser = True

        # Store goal and user profile in memory
        self.memory.goal = goal
        self.memory.status = "in_progress"

        # Send webhook: execution started
        await self._send_webhook("started", f"Starting goal: {goal[:100]}")

        # Store or merge user profile
        if self.memory.user_profile:
            # Resuming session - merge any new data into stored profile
            self.memory.update_user_profile(user_profile)
        else:
            # New session - store full profile
            self.memory.set_user_profile(user_profile)

        try:
            # Launch browser
            await self.browser.launch()

            # Initialize components that need browser
            self.execution_engine = ExecutionEngine(self.browser)
            self.action_executor = ActionExecutor(
                self.browser,
                self.execution_engine,
                self.memory,
                self.llm
            )

            # Navigate to start URL only for new sessions
            # When resuming (browser already at a page), use current URL
            current_url = self.browser.page.url if self.browser.page else None
            is_resuming = current_url and current_url != "about:blank"

            if is_resuming:
                # Resuming after user action - use current page state
                self.memory.current_url = current_url
                if current_url not in self.memory.visited_urls:
                    self.memory.add_visited_url(current_url)
                if config.DEBUG:
                    print(f"[AGENT] Resuming at current URL: {current_url}")
            else:
                # New session - navigate to start URL
                if not await self.browser.navigate(start_url):
                    return self._build_response(
                        success=False,
                        goal_achieved=False,
                        errors=[{"type": "navigation_error", "message": f"Failed to navigate to {start_url}"}]
                    )
                self.memory.add_visited_url(start_url)
                self.memory.current_url = start_url

            # Main agent loop
            step = self.memory.current_step
            consecutive_failures = 0

            while step < max_steps:
                step += 1

                if config.DEBUG:
                    print(f"\n{'='*60}")
                    print(f"[AGENT] Step {step}/{max_steps}")
                    print(f"[AGENT] Current URL: {self.browser.page.url}")

                # 1. Build page context for LLM
                page_context = await self._build_page_context()

                if config.DEBUG:
                    # Print forms section to verify radio button state
                    if "## Forms" in page_context:
                        forms_start = page_context.find("## Forms")
                        forms_end = page_context.find("##", forms_start + 10)
                        forms_section = page_context[forms_start:forms_end] if forms_end > 0 else page_context[forms_start:]
                        print(f"[AGENT] Page forms:\n{forms_section[:1000]}")

                # 2. Ask LLM for next action (use stored profile which includes merged data)
                plan = await self.llm.generate_plan(
                    goal=goal,
                    page_context=page_context,
                    memory_context=self.memory.get_context_for_llm(),
                    user_profile=self.memory.user_profile
                )

                self.total_tokens += plan.get("tokens_used", 0)

                if config.DEBUG:
                    print(f"[AGENT] LLM decided: {plan['action']}")
                    print(f"[AGENT] Reasoning: {plan['reasoning']}")
                    print(f"[AGENT] Goal status: {plan['goal_status']}")

                # 3. Check if goal achieved or blocked
                if plan["goal_status"] == "achieved":
                    self.memory.status = "achieved"
                    self.memory.save()

                    # Close browser on terminal state
                    self._should_close_browser = True

                    # Send webhook: goal achieved
                    await self._send_webhook("achieved", "Goal completed successfully")

                    return self._build_response(
                        success=True,
                        goal_achieved=True,
                        errors=errors
                    )

                if plan["goal_status"] == "blocked":
                    self.memory.status = "blocked"
                    errors.append({
                        "type": "goal_blocked",
                        "message": plan["reasoning"]
                    })
                    self.memory.save()

                    # Close browser on terminal state
                    self._should_close_browser = True

                    # Send webhook: blocked
                    await self._send_webhook("blocked", plan["reasoning"])

                    return self._build_response(
                        success=False,
                        goal_achieved=False,
                        errors=errors
                    )

                if plan["goal_status"] == "needs_input":
                    missing_fields = plan.get("missing_fields", [])
                    self.memory.status = "needs_input"
                    self.memory.set_missing_fields(missing_fields)
                    self.memory.save()

                    # Keep browser open for when user provides input
                    self._should_close_browser = False

                    # Send webhook: needs_input
                    await self._send_webhook("needs_input", plan["reasoning"], missing_fields=missing_fields)

                    return self._build_response(
                        success=True,
                        goal_achieved=False,
                        errors=errors,
                        needs_input=True,
                        missing_fields=missing_fields,
                        message=plan["reasoning"]
                    )

                if plan["goal_status"] == "awaiting_user_action":
                    self.memory.status = "awaiting_user_action"
                    self.memory.save()

                    # Keep browser open for user interaction
                    self._should_close_browser = False

                    # Send webhook: awaiting_user_action
                    await self._send_webhook("awaiting_user_action", plan["reasoning"])

                    return self._build_response(
                        success=True,
                        goal_achieved=False,
                        errors=errors,
                        awaiting_user_action=True,
                        message=plan["reasoning"]
                    )

                # 4. Execute the action (use stored profile which includes merged data)
                result = await self.action_executor.execute_action(
                    action_type=plan["action"],
                    params=plan["params"],
                    user_profile=self.memory.user_profile
                )

                # 5. Record action in memory
                action_record = ActionRecord(
                    step=step,
                    action_type=plan["action"],
                    params=plan["params"],
                    success=result.success,
                    result={
                        "details": result.details,
                        "error": result.error,
                        "navigated": result.navigated,
                        "new_url": result.new_url
                    }
                )
                self.memory.add_action(action_record)
                self.memory.current_step = step

                if config.DEBUG:
                    status = "OK" if result.success else "FAIL"
                    print(f"[AGENT] Action result: {status}")
                    if result.error:
                        print(f"[AGENT] Error: {result.error}")
                    if result.navigated:
                        print(f"[AGENT] Navigated to: {result.new_url}")

                # Track URL changes
                if result.navigated and result.new_url:
                    self.memory.add_visited_url(result.new_url)
                    self.memory.current_url = result.new_url

                # Handle failures
                if not result.success:
                    consecutive_failures += 1
                    errors.append({
                        "type": "action_error",
                        "action": plan["action"],
                        "message": result.error,
                        "step": step
                    })

                    # Give up after too many consecutive failures
                    if consecutive_failures >= 3:
                        self.memory.status = "failed"
                        self.memory.save()

                        # Send webhook: failed
                        await self._send_webhook("failed", "Too many consecutive failures")

                        return self._build_response(
                            success=False,
                            goal_achieved=False,
                            errors=errors
                        )
                else:
                    consecutive_failures = 0

                # Save memory after each step
                self.memory.save()

                # Send webhook: step completed
                await self._send_webhook("step_completed", f"Step {step}: {plan['action']}", data={
                    "step": step,
                    "action": plan["action"],
                    "success": result.success
                })

            # Exceeded max steps
            self.memory.status = "failed"
            errors.append({
                "type": "max_steps_exceeded",
                "message": f"Reached maximum step limit ({max_steps})"
            })
            self.memory.save()

            # Send webhook: failed
            await self._send_webhook("failed", f"Exceeded max steps ({max_steps})")

            return self._build_response(
                success=False,
                goal_achieved=False,
                errors=errors
            )

        except Exception as e:
            self.memory.status = "failed"
            errors.append({
                "type": "unexpected_error",
                "message": str(e)
            })
            self.memory.save()

            # Send webhook: failed
            await self._send_webhook("failed", f"Unexpected error: {str(e)}")

            return self._build_response(
                success=False,
                goal_achieved=False,
                errors=errors
            )

        finally:
            if self._should_close_browser:
                await self.browser.close()

    async def _build_page_context(self) -> str:
        """Build page context string for LLM

        Returns:
            Formatted string with page URL, title, content, forms, links, buttons
        """
        url = self.browser.page.url
        title = await self.browser.get_page_title()
        forms = await self.browser.get_form_elements()
        links = await self.browser.get_page_links()
        buttons = await self.browser.get_page_buttons()
        content = await self.browser.get_readable_content()

        sections = [
            "## Current Page",
            f"URL: {url}",
            f"Title: {title}",
            "",
            "## Page Content",
            content[:1500] if len(content) > 1500 else content,
            "",
        ]

        if "No forms found" not in forms:
            sections.extend([
                "## Forms on Page",
                forms,
                "",
            ])

        if "No links found" not in links:
            sections.extend([
                "## Available Links",
                links,
                "",
            ])

        if "No standalone buttons" not in buttons:
            sections.extend([
                "## Available Buttons",
                buttons,
                "",
            ])

        return "\n".join(sections)

    def _build_response(
        self,
        success: bool,
        goal_achieved: bool,
        errors: List[Dict[str, Any]],
        needs_input: bool = False,
        missing_fields: Optional[List[str]] = None,
        awaiting_user_action: bool = False,
        message: Optional[str] = None
    ) -> Dict[str, Any]:
        """Build response dictionary

        Args:
            success: Whether execution completed without fatal errors
            goal_achieved: Whether the goal was achieved
            errors: List of errors encountered
            needs_input: Whether agent needs data from user profile
            missing_fields: List of missing field names (when needs_input=True)
            awaiting_user_action: Whether user must interact with browser directly
            message: Message explaining what's needed

        Returns:
            Response dictionary
        """
        execution_time = time.time() - self.start_time if self.start_time else 0

        # Format action history
        action_history = []
        for action in self.memory.action_history:
            action_history.append({
                "step": action.step,
                "action": action.action_type,
                "params": action.params,
                "success": action.success,
                "result": action.result,
                "timestamp": action.timestamp.isoformat()
            })

        response = {
            "success": success,
            "goalAchieved": goal_achieved,
            "sessionId": self.memory.session_id,
            "status": self.memory.status,
            "finalUrl": self.memory.current_url,
            "stepsTaken": self.memory.current_step,
            "executionTime": execution_time,
            "tokensUsed": self.total_tokens,
            "actionHistory": action_history,
            "memory": {
                "enteredData": {k: "***" if "password" in k.lower() else v
                               for k, v in self.memory.entered_data.items()},
                "visitedUrls": self.memory.visited_urls,
                "extractedInfo": self.memory._extracted_info
            },
            "errors": errors
        }

        # Add needs_input fields when applicable
        if needs_input:
            response["needsInput"] = True
            response["missingFields"] = missing_fields or []
            response["message"] = message or ""

        # Add awaiting_user_action when applicable
        if awaiting_user_action:
            response["awaitingUserAction"] = True
            response["message"] = message or ""

        return response