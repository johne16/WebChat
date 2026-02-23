"""Action Executor - Execute actions decided by the planner"""

import asyncio
from dataclasses import dataclass
from typing import Dict, Any, Optional, Callable, Awaitable
from src.browser import BrowserManager
from src.execution_engine import ExecutionEngine
from src.memory import SessionMemory
from src.llm import LLMClient


@dataclass
class ActionResult:
    """Result of executing an action"""
    success: bool
    action_type: str
    details: Dict[str, Any]
    error: Optional[str] = None
    navigated: bool = False
    new_url: Optional[str] = None


class ActionExecutor:
    """Executes actions decided by the planner"""

    def __init__(
        self,
        browser: BrowserManager,
        execution_engine: ExecutionEngine,
        memory: SessionMemory,
        llm: LLMClient
    ):
        """Initialize action executor

        Args:
            browser: BrowserManager instance
            execution_engine: ExecutionEngine for form filling
            memory: SessionMemory for storing entered data
            llm: LLMClient for generating form fill code
        """
        self.browser = browser
        self.engine = execution_engine
        self.memory = memory
        self.llm = llm

        # Action registry - maps action names to handlers
        self._actions: Dict[str, Callable[..., Awaitable[ActionResult]]] = {
            "fill_form": self._execute_fill_form,
            "click_link": self._execute_click_link,
            "click_button": self._execute_click_button,
            "go_back": self._execute_go_back,
            "scroll": self._execute_scroll,
            "wait": self._execute_wait,
            "read_content": self._execute_read_content,
            "none": self._execute_none,
        }

    async def execute_action(
        self,
        action_type: str,
        params: Dict[str, Any],
        user_profile: Dict[str, Any]
    ) -> ActionResult:
        """Execute an action decided by the planner

        Args:
            action_type: Type of action to execute
            params: Action-specific parameters
            user_profile: User profile data (for form filling)

        Returns:
            ActionResult with success status and details
        """
        handler = self._actions.get(action_type)

        if not handler:
            return ActionResult(
                success=False,
                action_type=action_type,
                details={"params": params},
                error=f"Unknown action type: {action_type}"
            )

        try:
            # Pass user_profile to fill_form, others don't need it
            if action_type == "fill_form":
                return await handler(params, user_profile)
            else:
                return await handler(params)

        except Exception as e:
            return ActionResult(
                success=False,
                action_type=action_type,
                details={"params": params},
                error=str(e)
            )

    async def _execute_fill_form(
        self,
        params: Dict[str, Any],
        user_profile: Dict[str, Any]
    ) -> ActionResult:
        """Fill and optionally submit a form

        Args:
            params: {"submit": bool}
            user_profile: User data to fill

        Returns:
            ActionResult
        """
        # Get form HTML
        form_html = await self.browser.get_form_elements()

        if "No forms found" in form_html:
            return ActionResult(
                success=False,
                action_type="fill_form",
                details={},
                error="No forms found on page"
            )

        # Merge memory data with user profile (memory takes precedence for reuse)
        merged_profile = user_profile.copy()
        for key, value in self.memory.entered_data.items():
            if key not in merged_profile:
                merged_profile[key] = value

        # Generate fill code
        llm_result = await self.llm.generate_fill_code(form_html, merged_profile)

        # Validate code
        is_valid, error = self.engine.validate_code(llm_result["code"])
        if not is_valid:
            return ActionResult(
                success=False,
                action_type="fill_form",
                details={"code": llm_result["code"]},
                error=f"Validation failed: {error}"
            )

        # Extract submit button if submitting
        submit = params.get("submit", True)
        if submit:
            form_fill_code, submit_selector = self.engine.extract_submit_click(llm_result["code"])
        else:
            form_fill_code = llm_result["code"]
            submit_selector = None

        # Execute form filling
        exec_result = await self.engine.execute(form_fill_code)

        if not exec_result["success"]:
            return ActionResult(
                success=False,
                action_type="fill_form",
                details=exec_result,
                error=exec_result["error"]["message"]
            )

        # Store entered data in memory for reuse
        self._store_entered_data(merged_profile)

        # Handle submit if requested
        navigated = False
        new_url = None

        if submit and submit_selector:
            current_url = self.browser.page.url

            try:
                # Wait for navigation and click submit
                wait_task = asyncio.create_task(
                    self.browser.page.wait_for_url(
                        lambda url: url != current_url,
                        timeout=5000
                    )
                )

                await self.browser.page.click(submit_selector)
                await wait_task
                navigated = True
                new_url = self.browser.page.url

            except Exception:
                # Submit might not navigate (e.g., validation error on page)
                pass

        return ActionResult(
            success=True,
            action_type="fill_form",
            details={
                "fields_filled": len(exec_result.get("steps", [])),
                "submitted": submit and submit_selector is not None
            },
            navigated=navigated,
            new_url=new_url
        )

    def _store_entered_data(self, profile: Dict[str, Any]) -> None:
        """Store profile data in memory for reuse

        Args:
            profile: User profile data that was used
        """
        # Store common fields that might be reused
        reusable_fields = [
            "email", "password", "firstName", "lastName", "phone",
            "username", "name"
        ]

        for field in reusable_fields:
            if field in profile and profile[field]:
                self.memory.remember(field, profile[field])

        # Also store nested address fields
        if "address" in profile and isinstance(profile["address"], dict):
            for key, value in profile["address"].items():
                if value:
                    self.memory.remember(f"address_{key}", value)

    async def _execute_click_link(self, params: Dict[str, Any]) -> ActionResult:
        """Click a link to navigate

        Args:
            params: {"link_text": str} or {"selector": str}

        Returns:
            ActionResult
        """
        current_url = self.browser.page.url

        try:
            if "selector" in params:
                await self.browser.page.click(params["selector"])
            elif "link_text" in params:
                # Find link by text (partial match, case insensitive)
                link_text = params["link_text"]
                await self.browser.page.click(f"a:has-text('{link_text}')")
            else:
                return ActionResult(
                    success=False,
                    action_type="click_link",
                    details=params,
                    error="Missing link_text or selector parameter"
                )

            # Wait for navigation
            await self.browser.page.wait_for_load_state("networkidle")

            new_url = self.browser.page.url
            navigated = new_url != current_url

            return ActionResult(
                success=True,
                action_type="click_link",
                details={"clicked": params.get("link_text") or params.get("selector")},
                navigated=navigated,
                new_url=new_url if navigated else None
            )

        except Exception as e:
            return ActionResult(
                success=False,
                action_type="click_link",
                details=params,
                error=str(e)
            )

    async def _execute_click_button(self, params: Dict[str, Any]) -> ActionResult:
        """Click a button

        Args:
            params: {"button_text": str} or {"selector": str}

        Returns:
            ActionResult
        """
        current_url = self.browser.page.url

        try:
            if "selector" in params:
                await self.browser.page.click(params["selector"])
            elif "button_text" in params:
                button_text = params["button_text"]
                await self.browser.page.click(f"button:has-text('{button_text}')")
            else:
                return ActionResult(
                    success=False,
                    action_type="click_button",
                    details=params,
                    error="Missing button_text or selector parameter"
                )

            # Wait for any navigation
            await self.browser.page.wait_for_load_state("networkidle")

            new_url = self.browser.page.url
            navigated = new_url != current_url

            return ActionResult(
                success=True,
                action_type="click_button",
                details={"clicked": params.get("button_text") or params.get("selector")},
                navigated=navigated,
                new_url=new_url if navigated else None
            )

        except Exception as e:
            return ActionResult(
                success=False,
                action_type="click_button",
                details=params,
                error=str(e)
            )

    async def _execute_go_back(self, params: Dict[str, Any]) -> ActionResult:
        """Navigate back in browser history

        Returns:
            ActionResult
        """
        current_url = self.browser.page.url

        success = await self.browser.go_back()

        if success:
            new_url = self.browser.page.url
            return ActionResult(
                success=True,
                action_type="go_back",
                details={"from": current_url, "to": new_url},
                navigated=True,
                new_url=new_url
            )
        else:
            return ActionResult(
                success=False,
                action_type="go_back",
                details={},
                error="Failed to navigate back"
            )

    async def _execute_scroll(self, params: Dict[str, Any]) -> ActionResult:
        """Scroll the page

        Args:
            params: {"direction": "up"|"down", "amount": int}

        Returns:
            ActionResult
        """
        direction = params.get("direction", "down")
        amount = params.get("amount", 500)

        await self.browser.scroll(direction, amount)

        return ActionResult(
            success=True,
            action_type="scroll",
            details={"direction": direction, "amount": amount}
        )

    async def _execute_wait(self, params: Dict[str, Any]) -> ActionResult:
        """Wait for an element to appear

        Args:
            params: {"selector": str, "timeout": int}

        Returns:
            ActionResult
        """
        selector = params.get("selector")
        timeout = params.get("timeout", 5000)

        if not selector:
            return ActionResult(
                success=False,
                action_type="wait",
                details=params,
                error="Missing selector parameter"
            )

        try:
            await self.browser.page.wait_for_selector(selector, timeout=timeout)
            return ActionResult(
                success=True,
                action_type="wait",
                details={"selector": selector, "found": True}
            )
        except Exception as e:
            return ActionResult(
                success=False,
                action_type="wait",
                details=params,
                error=f"Timeout waiting for {selector}: {str(e)}"
            )

    async def _execute_read_content(self, params: Dict[str, Any]) -> ActionResult:
        """Read and extract content from the page

        Args:
            params: {"purpose": str, "selector": str (optional)}

        Returns:
            ActionResult with extracted content
        """
        purpose = params.get("purpose", "general")
        selector = params.get("selector")

        try:
            if selector:
                # Extract content from specific element
                content = await self.browser.page.evaluate(f"""
                    () => {{
                        const el = document.querySelector('{selector}');
                        return el ? el.textContent.trim() : null;
                    }}
                """)
            else:
                # Get full page content
                content = await self.browser.get_readable_content()

            if content:
                # Store extracted info in memory
                self.memory.store_info(purpose, content)

            return ActionResult(
                success=True,
                action_type="read_content",
                details={
                    "purpose": purpose,
                    "content_length": len(content) if content else 0,
                    "content_preview": content[:200] if content else None
                }
            )

        except Exception as e:
            return ActionResult(
                success=False,
                action_type="read_content",
                details=params,
                error=str(e)
            )

    async def _execute_none(self, params: Dict[str, Any]) -> ActionResult:
        """No-op action (used for goal achieved/blocked states)

        Returns:
            ActionResult
        """
        return ActionResult(
            success=True,
            action_type="none",
            details={"reason": "No action required"}
        )