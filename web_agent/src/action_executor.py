"""Action Executor - Execute actions decided by the planner"""

import time
from dataclasses import dataclass
from typing import Dict, Any, Optional, Callable, Awaitable
from src.browser import BrowserManager
from src.execution_engine import ExecutionEngine
from src.memory import SessionMemory
from src.config import config


@dataclass
class ActionResult:
    """Result of executing an action"""
    success: bool
    action_type: str
    details: Dict[str, Any]
    error: Optional[Dict[str, Any]] = None
    navigated: bool = False
    new_url: Optional[str] = None
    execution_time: float = 0.0
    navigation_wait_time: float = 0.0


class ActionExecutor:
    """Executes actions decided by the planner"""

    def __init__(
        self,
        browser: BrowserManager,
        execution_engine: ExecutionEngine,
        memory: SessionMemory
    ):
        """Initialize action executor

        Args:
            browser: BrowserManager instance
            execution_engine: ExecutionEngine for form filling
            memory: SessionMemory for storing entered data
        """
        self.browser = browser
        self.engine = execution_engine
        self.memory = memory

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
        params: Dict[str, Any]
    ) -> ActionResult:
        """Execute an action decided by the planner

        Args:
            action_type: Type of action to execute
            params: Action-specific parameters

        Returns:
            ActionResult with success status and details
        """
        handler = self._actions.get(action_type)

        if not handler:
            return ActionResult(
                success=False,
                action_type=action_type,
                details={"params": params},
                error={"type": "unknown_action", "message": f"Unknown action type: {action_type}", "details": {}}
            )

        t0 = time.perf_counter()
        try:
            result = await handler(params)
            result.execution_time = time.perf_counter() - t0
            return result

        except Exception as e:
            return ActionResult(
                success=False,
                action_type=action_type,
                details={"params": params},
                error={"type": "action_error", "message": str(e), "details": {}},
                execution_time=time.perf_counter() - t0
            )

    async def _execute_fill_form(
        self,
        params: Dict[str, Any]
    ) -> ActionResult:
        """Fill form fields and optionally submit

        Args:
            params: {
                "fields": [{"selector": str, "value": str, "type": str, "name": str}, ...],
                "submit": "CSS selector" or null
            }

        Returns:
            ActionResult
        """
        fields = params.get("fields", [])
        submit_selector = params.get("submit")

        if not fields:
            return ActionResult(
                success=False,
                action_type="fill_form",
                details={},
                error={"type": "no_fields", "message": "No fields provided in params", "details": {}}
            )

        filled = []
        try:
            for field in fields:
                field_type = field.get("type", "text")
                selector = field.get("selector")
                value = field.get("value")
                name = field.get("name")

                if field_type == "select":
                    await self.engine._select_option(selector, str(value))
                elif field_type == "radio":
                    await self.engine._select_radio(name, str(value))
                elif field_type == "checkbox":
                    await self.engine._check_checkbox(selector, bool(value))
                else:
                    await self.engine._fill_field(selector, str(value))

                filled.append({"selector": selector or name, "type": field_type})

                # Store in memory for reuse
                key = selector or name or ""
                key = key.lstrip("#").replace("[name=\"", "").rstrip("\"]")
                if value:
                    self.memory.remember(key, str(value))

        except Exception as e:
            return ActionResult(
                success=False,
                action_type="fill_form",
                details={"fields_filled": len(filled)},
                error={"type": "fill_error", "message": str(e), "details": {}}
            )

        # Handle submit
        navigated = False
        new_url = None
        nav_wait = 0.0

        if submit_selector:
            current_url = self.browser.page.url

            try:
                nav_t0 = time.perf_counter()
                async with self.browser.page.expect_navigation(timeout=config.NAVIGATION_TIMEOUT):
                    await self.engine._click_button(submit_selector)
                nav_wait = time.perf_counter() - nav_t0
                navigated = True
                new_url = self.browser.page.url
            except Exception:
                nav_wait = time.perf_counter() - nav_t0

        return ActionResult(
            success=True,
            action_type="fill_form",
            details={
                "fields_filled": len(filled),
                "submitted": submit_selector is not None
            },
            navigated=navigated,
            new_url=new_url,
            navigation_wait_time=nav_wait
        )

    async def _execute_click(
        self,
        params: Dict[str, Any],
        action_type: str,
        text_param: str,
        element_selector: str
    ) -> ActionResult:
        """Click a link or button

        Args:
            params: {"selector": str} or {text_param: str}
            action_type: "click_link" or "click_button"
            text_param: Name of the text parameter ("link_text" or "button_text")
            element_selector: CSS selector prefix for text matching ("a" or "button")

        Returns:
            ActionResult
        """
        current_url = self.browser.page.url

        try:
            if "selector" in params:
                await self.browser.page.click(params["selector"])
            elif text_param in params:
                text = params[text_param]
                escaped_text = text.replace("'", "\\'")
                await self.browser.page.click(f"{element_selector}:has-text('{escaped_text}')")
            else:
                return ActionResult(
                    success=False,
                    action_type=action_type,
                    details=params,
                    error={"type": "missing_param", "message": f"Missing {text_param} or selector parameter", "details": {}}
                )

            # Wait for any navigation
            nav_t0 = time.perf_counter()
            await self.browser.page.wait_for_load_state(config.WAIT_POLICY)
            nav_wait = time.perf_counter() - nav_t0

            new_url = self.browser.page.url
            navigated = new_url != current_url

            return ActionResult(
                success=True,
                action_type=action_type,
                details={"clicked": params.get(text_param) or params.get("selector")},
                navigated=navigated,
                new_url=new_url if navigated else None,
                navigation_wait_time=nav_wait
            )

        except Exception as e:
            return ActionResult(
                success=False,
                action_type=action_type,
                details=params,
                error={"type": "click_error", "message": str(e), "details": {}}
            )

    async def _execute_click_link(self, params: Dict[str, Any]) -> ActionResult:
        """Click a link to navigate"""
        return await self._execute_click(params, "click_link", "link_text", "a")

    async def _execute_click_button(self, params: Dict[str, Any]) -> ActionResult:
        """Click a button"""
        return await self._execute_click(params, "click_button", "button_text", "button")

    async def _execute_go_back(self, params: Dict[str, Any]) -> ActionResult:
        """Navigate back in browser history

        Returns:
            ActionResult
        """
        current_url = self.browser.page.url

        go_back_result = await self.browser.go_back()

        if go_back_result["success"]:
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
                error=go_back_result["error"]
            )

    async def _execute_scroll(self, params: Dict[str, Any]) -> ActionResult:
        """Scroll the page

        Args:
            params: {"direction": "up"|"down", "amount": int}

        Returns:
            ActionResult
        """
        direction = params.get("direction", "down")
        amount = params.get("amount", config.SCROLL_PIXELS)

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
        timeout = params.get("timeout", config.EXECUTION_WAIT_TIMEOUT)

        if not selector:
            return ActionResult(
                success=False,
                action_type="wait",
                details=params,
                error={"type": "missing_param", "message": "Missing selector parameter", "details": {}}
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
                error={"type": "timeout_error", "message": f"Timeout waiting for {selector}: {str(e)}", "details": {}}
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
                content = await self.browser.page.evaluate("""
                    (selector) => {
                        const el = document.querySelector(selector);
                        return el ? el.textContent.trim() : null;
                    }
                """, selector)
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
                error={"type": "read_error", "message": str(e), "details": {}}
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