"""Autonomous Web Agent - Goal-driven web automation orchestrator"""

import logging
import time
import httpx
from datetime import datetime
from typing import Dict, Any, Optional, List
from src.browser import BrowserManager
from src.llm import LLMClient
from src.execution_engine import ExecutionEngine
from src.action_executor import ActionExecutor
from src.memory import SessionMemory, ActionRecord
from src.config import config, GoalStatus
from src.metrics import MetricsLogger


logger = logging.getLogger(__name__)


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
        callback_url: Optional[str] = None,
        port: Optional[int] = None,
        task_id: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        webhook_token: Optional[str] = None
    ):
        """Initialize autonomous web agent

        Args:
            session_id: Existing session ID to resume, or None for new session
            callback_url: URL to POST status updates (webhooks)
            port: Port this agent is running on (for webhook identification)
            task_id: Task ID (for webhook identification)
            provider: LLM provider override ('openai' or 'anthropic')
            model: LLM model override
            webhook_token: Authentication token for webhook requests
        """
        self.browser = BrowserManager(
            headless=config.HEADLESS,
            timeout=config.BROWSER_TIMEOUT
        )

        effective_provider = provider or config.PROVIDER
        if effective_provider == "anthropic":
            effective_model = model or config.ANTHROPIC_MODEL
            api_key = config.ANTHROPIC_API_KEY
        else:
            effective_model = model or config.OPENAI_MODEL
            api_key = config.OPENAI_API_KEY

        self.llm = LLMClient(
            provider=effective_provider,
            api_key=api_key,
            model=effective_model,
            temperature=config.TEMPERATURE
        )
        self._session_id = session_id
        self.memory: Optional[SessionMemory] = None
        self.action_executor: Optional[ActionExecutor] = None
        self.execution_engine: Optional[ExecutionEngine] = None

        # Webhook configuration
        self.callback_url = callback_url
        self.port = port
        self.task_id = task_id
        self.webhook_token = webhook_token
        self._http_client: Optional[httpx.AsyncClient] = None

        # Tracking
        self.total_tokens = 0
        self.start_time: Optional[float] = None
        self._should_close_browser = True

        # Per-step metrics collection (consumed by metrics logger in step 5d)
        self._step_metrics: List[Dict[str, Any]] = []
        self._wasted_failures: int = 0
        self._wasted_retries: int = 0
        self._wasted_redundant: int = 0
        self._metrics: Optional[MetricsLogger] = None

    # NOTE: If additional notification channels are needed (e.g., WebSocket, logging service),
    # consider refactoring webhook calls to an event/observer pattern.
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
            if self._http_client is None:
                self._http_client = httpx.AsyncClient()
            headers = {}
            if self.webhook_token:
                headers['x-webhook-token'] = self.webhook_token
            await self._http_client.post(self.callback_url, json=payload, headers=headers, timeout=5.0)
            if config.DEBUG:
                logger.debug(f"[WEBHOOK] Sent status={status} to {self.callback_url}")
        except Exception as e:
            if config.DEBUG:
                logger.debug(f"[WEBHOOK] Failed to send: {e}")

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

        # Reset per-goal metrics
        self._step_metrics = []
        self._wasted_failures = 0
        self._wasted_retries = 0
        self._wasted_redundant = 0

        # Apply headless option if provided (overrides config default)
        if "headless" in options:
            self.browser.headless = options["headless"]

        # Reset browser close flag (keep open for awaiting_user_action, needs_input)
        self._should_close_browser = True

        # Initialize session memory (async DB setup)
        if self.memory is None:
            self.memory = await SessionMemory.create(self._session_id)

        # Initialize metrics logger for this goal execution
        self._metrics = MetricsLogger(self.memory.session_id)

        # Store goal and user profile in memory
        self.memory.goal = goal

        # Detect resume and capture previous status before resetting
        is_resume = bool(self.memory.user_profile)
        if is_resume:
            self.memory.set_resumed_from(self.memory.status)
            self.memory.update_user_profile(user_profile)
        else:
            self.memory.set_user_profile(user_profile)
            await self._send_webhook(GoalStatus.STARTED, f"Starting goal: {goal[:100]}")

        self.memory.status = GoalStatus.IN_PROGRESS

        try:
            # Launch browser
            await self.browser.launch()

            # Initialize components that need browser
            self.execution_engine = ExecutionEngine(self.browser)
            self.action_executor = ActionExecutor(
                self.browser,
                self.execution_engine,
                self.memory
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
                    logger.debug(f"[AGENT] Resuming at current URL: {current_url}")
            else:
                # New session - navigate to start URL
                nav_result = await self.browser.navigate(start_url)
                if not nav_result["success"]:
                    return self._build_response(
                        success=False,
                        goal_achieved=False,
                        errors=[nav_result["error"]]
                    )
                self.memory.add_visited_url(start_url)
                self.memory.current_url = start_url

            # Main agent loop
            step = self.memory.current_step
            consecutive_failures = 0

            while step < max_steps:
                step += 1
                step_start = time.perf_counter()

                # Track previous action for retry detection
                prev_action = None
                prev_params = None
                if self._step_metrics:
                    prev_metric = self._step_metrics[-1]
                    prev_action = prev_metric["action"]
                    prev_params = prev_metric.get("_params")

                # Snapshot visited URLs before this step for redundant navigation detection
                urls_before_step = set(self.memory.visited_urls)

                if config.DEBUG:
                    logger.debug(f"{'='*60}")
                    logger.debug(f"[AGENT] Step {step}/{max_steps}")
                if config.DEBUG and self.browser.page:
                    logger.debug(f"[AGENT] Current URL: {self.browser.page.url}")

                # 1. Build page context for LLM
                page_context_result = await self.browser.build_page_context()
                page_context = page_context_result["context"]
                page_extraction_time = page_context_result["timings"]["pageExtraction"]
                page_context_size = page_context_result["pageContextSize"]

                if config.DEBUG:
                    logger.debug(f"[AGENT] Page extraction: {page_extraction_time:.3f}s, context size: {page_context_size} chars")
                    # Print forms section to verify radio button state
                    if "## Forms" in page_context:
                        forms_start = page_context.find("## Forms")
                        forms_end = page_context.find("##", forms_start + 10)
                        forms_section = page_context[forms_start:forms_end] if forms_end > 0 else page_context[forms_start:]
                        logger.debug(f"[AGENT] Page forms:\n{forms_section[:1000]}")

                # 2. Ask LLM for next action (use stored profile which includes merged data)
                plan = await self.llm.generate_plan(
                    goal=goal,
                    page_context=page_context,
                    memory_context=self.memory.format_context_for_llm(),
                    user_profile=self.memory.user_profile
                )

                self.total_tokens += plan.get("tokens_used", 0)
                planning_time = plan.get("planning_time", 0)

                if config.DEBUG:
                    logger.debug(f"[AGENT] LLM decided: {plan['action']}")
                    logger.debug(f"[AGENT] Reasoning: {plan['reasoning']}")
                    logger.debug(f"[AGENT] Goal status: {plan['goal_status']}")

                # 3. If action is "none", check goal status before execution
                if plan["action"] == "none":
                    terminal_response = await self._check_goal_status(plan, errors)
                    if terminal_response is not None:
                        return terminal_response

                # 4. Execute action and record in memory
                consecutive_failures, should_abort, result = await self._execute_and_record_step(
                    step, plan, errors, consecutive_failures
                )

                # 5. Check goal status after execution
                if plan["action"] != "none":
                    terminal_response = await self._check_goal_status(plan, errors)
                    if terminal_response is not None:
                        return terminal_response

                # 6. Collect per-step metrics
                step_total_time = time.perf_counter() - step_start

                step_metric = {
                    "type": "step",
                    "sessionId": self.memory.session_id,
                    "step": step,
                    "timestamp": datetime.now().isoformat(),
                    "action": plan["action"],
                    "success": result.success,
                    "goalStatus": plan["goal_status"],
                    "timings": {
                        "pageExtraction": page_extraction_time,
                        "llmPlanning": planning_time,
                        "actionExecution": result.execution_time,
                        "navigationWait": result.navigation_wait_time,
                        "stepTotal": step_total_time
                    },
                    "tokens": plan.get("tokens_used", 0),
                    "pageContextSize": page_context_size,
                    "url": self.browser.page.url,
                    "_params": plan["params"]  # internal, for retry detection
                }
                self._step_metrics.append(step_metric)
                self._metrics.log_step({k: v for k, v in step_metric.items() if k != "_params"})

                # 7. Update wasted step counters
                if not result.success:
                    self._wasted_failures += 1
                if prev_action == plan["action"] and prev_params == plan["params"]:
                    self._wasted_retries += 1
                if result.navigated and result.new_url and result.new_url in urls_before_step:
                    self._wasted_redundant += 1

                if should_abort:
                    return self._build_response(
                        success=False,
                        goal_achieved=False,
                        errors=errors
                    )

            # Exceeded max steps
            self.memory.status = GoalStatus.FAILED
            errors.append({
                "type": "max_steps_exceeded",
                "message": f"Reached maximum step limit ({max_steps})",
                "details": {}
            })
            await self.memory.save()

            # Send webhook: failed
            await self._send_webhook(GoalStatus.FAILED, f"Exceeded max steps ({max_steps})")

            return self._build_response(
                success=False,
                goal_achieved=False,
                errors=errors
            )

        except Exception as e:
            self.memory.status = GoalStatus.FAILED
            errors.append({
                "type": "unexpected_error",
                "message": str(e),
                "details": {}
            })
            await self.memory.save()

            # Send webhook: failed
            await self._send_webhook(GoalStatus.FAILED, f"Unexpected error: {str(e)}")

            return self._build_response(
                success=False,
                goal_achieved=False,
                errors=errors
            )

        finally:
            if self._should_close_browser:
                await self.browser.close()
            if self._http_client:
                await self._http_client.aclose()
                self._http_client = None

    async def _check_goal_status(
        self,
        plan: Dict[str, Any],
        errors: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Check plan goal_status and return response if terminal, else None

        Args:
            plan: LLM plan with goal_status
            errors: Accumulated errors list

        Returns:
            Response dict if terminal status, None to continue
        """
        status = plan["goal_status"]

        if status == GoalStatus.ACHIEVED:
            self.memory.status = GoalStatus.ACHIEVED
            await self.memory.save()
            self._should_close_browser = True
            await self._send_webhook(GoalStatus.ACHIEVED, "Goal completed successfully")
            return self._build_response(success=True, goal_achieved=True, errors=errors)

        if status == GoalStatus.BLOCKED:
            self.memory.status = GoalStatus.BLOCKED
            errors.append({"type": "goal_blocked", "message": plan["reasoning"], "details": {}})
            await self.memory.save()
            self._should_close_browser = True
            await self._send_webhook(GoalStatus.BLOCKED, plan["reasoning"])
            return self._build_response(success=False, goal_achieved=False, errors=errors)

        if status == GoalStatus.NEEDS_INPUT:
            missing_fields = plan.get("missing_fields", [])
            self.memory.status = GoalStatus.NEEDS_INPUT
            self.memory.set_missing_fields(missing_fields)
            await self.memory.save()
            self._should_close_browser = False
            await self._send_webhook(GoalStatus.NEEDS_INPUT, plan["reasoning"], missing_fields=missing_fields)
            return self._build_response(
                success=True, goal_achieved=False, errors=errors,
                needs_input=True, missing_fields=missing_fields, message=plan["reasoning"]
            )

        if status == GoalStatus.AWAITING_USER_ACTION:
            self.memory.status = GoalStatus.AWAITING_USER_ACTION
            await self.memory.save()
            self._should_close_browser = False
            await self._send_webhook(GoalStatus.AWAITING_USER_ACTION, plan["reasoning"])
            return self._build_response(
                success=True, goal_achieved=False, errors=errors,
                awaiting_user_action=True, message=plan["reasoning"]
            )

        return None

    async def _execute_and_record_step(
        self,
        step: int,
        plan: Dict[str, Any],
        errors: List[Dict[str, Any]],
        consecutive_failures: int
    ) -> tuple:
        """Execute an action and record it in memory

        Args:
            step: Current step number
            plan: LLM plan with action and params
            errors: Accumulated errors list
            consecutive_failures: Count of consecutive failures

        Returns:
            (consecutive_failures, should_abort, result) tuple
        """
        from src.action_executor import ActionResult

        result = await self.action_executor.execute_action(
            action_type=plan["action"],
            params=plan["params"]
        )

        # Record action in memory
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
            status_str = "OK" if result.success else "FAIL"
            logger.debug(f"[AGENT] Action result: {status_str}")
            if result.error:
                logger.debug(f"[AGENT] Error: {result.error}")
            if result.navigated:
                logger.debug(f"[AGENT] Navigated to: {result.new_url}")

        # Track URL changes
        if result.navigated and result.new_url:
            self.memory.add_visited_url(result.new_url)
            self.memory.current_url = result.new_url

        # Handle failures
        if not result.success:
            consecutive_failures += 1
            errors.append({
                "type": result.error["type"] if result.error else "action_error",
                "message": result.error["message"] if result.error else "Unknown error",
                "details": {"action": plan["action"], "step": step, **(result.error.get("details", {}) if result.error else {})}
            })

            if consecutive_failures >= config.CONSECUTIVE_FAILURE_THRESHOLD:
                self.memory.status = GoalStatus.FAILED
                await self.memory.save()
                await self._send_webhook(GoalStatus.FAILED, "Too many consecutive failures")
                return consecutive_failures, True, result
        else:
            consecutive_failures = 0

        # Save memory after each step
        await self.memory.save()

        # Send webhook: step completed
        await self._send_webhook(GoalStatus.STEP_COMPLETED, f"Step {step}: {plan['action']}", data={
            "step": step,
            "action": plan["action"],
            "success": result.success
        })

        return consecutive_failures, False, result

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
        action_history = self.memory.format_action_history()

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
                "extractedInfo": self.memory.get_context_for_llm().get("extracted_info", {})
            },
            "errors": errors
        }

        # Log task summary metrics
        if self._metrics:
            llm_times = [s["timings"]["llmPlanning"] for s in self._step_metrics if "timings" in s]
            avg_llm_time = sum(llm_times) / len(llm_times) if llm_times else 0
            self._metrics.log_summary({
                "type": "task_summary",
                "sessionId": self.memory.session_id,
                "timestamp": datetime.now().isoformat(),
                "goal": self.memory.goal,
                "finalStatus": self.memory.status,
                "totalSteps": self.memory.current_step,
                "wastedSteps": {
                    "failures": self._wasted_failures,
                    "retries": self._wasted_retries,
                    "redundant": self._wasted_redundant
                },
                "totalTime": execution_time,
                "totalTokens": self.total_tokens,
                "avgStepTime": execution_time / max(self.memory.current_step, 1),
                "avgLlmTime": avg_llm_time
            })

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