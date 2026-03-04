"""LLM client for generating form-filling JavaScript code and planning"""

import json
import logging
import re
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from openai import AsyncOpenAI
from src.config import config, GoalStatus


logger = logging.getLogger(__name__)


class LLMClient:
    """Handles LLM API communication for code generation and planning.

    Supports OpenAI and Anthropic providers.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-5.2",
        temperature: float = 0.1,
        provider: str = "openai"
    ):
        """Initialize LLM client

        Args:
            api_key: API key for the provider
            model: Model name
            temperature: Sampling temperature
            provider: 'openai' or 'anthropic'
        """
        self.provider = provider
        self.model = model
        self.temperature = temperature

        if provider == "anthropic":
            from anthropic import AsyncAnthropic
            self.client = AsyncAnthropic(api_key=api_key)
        else:
            self.client = AsyncOpenAI(api_key=api_key)

        self.system_prompt = self._load_system_prompt()
        self.planning_prompt = self._load_planning_prompt()
        self.examples = self._load_examples()

    def _load_system_prompt(self) -> str:
        """Load system prompt from file"""
        prompt_file = Path(__file__).parent.parent / "prompts" / "system_prompt.txt"
        try:
            return prompt_file.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FileNotFoundError(
                f"System prompt file not found: {prompt_file}. "
                "Please create prompts/system_prompt.txt"
            )

    def _load_planning_prompt(self) -> str:
        """Load planning prompt from file"""
        prompt_file = Path(__file__).parent.parent / "prompts" / "planning_prompt.txt"
        try:
            return prompt_file.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FileNotFoundError(
                f"Planning prompt file not found: {prompt_file}. "
                "Please create prompts/planning_prompt.txt"
            )

    def _load_examples(self) -> List[Dict[str, Any]]:
        """Load few-shot examples from file"""
        examples_file = Path(__file__).parent.parent / "prompts" / "examples.json"
        try:
            return json.loads(examples_file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            # Examples are optional
            return []

    async def _call_llm(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 2000,
        json_mode: bool = False
    ) -> Dict[str, Any]:
        """Dispatch to provider-specific LLM call

        Args:
            messages: Chat messages array
            max_tokens: Max completion tokens
            json_mode: Whether to request JSON output (OpenAI only)

        Returns:
            {"content": str, "tokens_used": int, "model": str, "finish_reason": str}
        """
        if self.provider == "anthropic":
            return await self._call_anthropic(messages, max_tokens)
        return await self._call_openai(messages, max_tokens, json_mode)

    async def _call_openai(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 2000,
        json_mode: bool = False
    ) -> Dict[str, Any]:
        """Call OpenAI API

        Args:
            messages: Chat messages
            max_tokens: Max tokens
            json_mode: Request JSON response format

        Returns:
            Normalized response dict
        """
        kwargs = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": max_tokens
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = await self.client.chat.completions.create(**kwargs)
        return {
            "content": response.choices[0].message.content,
            "tokens_used": response.usage.total_tokens,
            "model": response.model,
            "finish_reason": response.choices[0].finish_reason
        }

    async def _call_anthropic(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 2000
    ) -> Dict[str, Any]:
        """Call Anthropic API

        Separates system messages from the rest (Anthropic uses a separate system param).

        Args:
            messages: Chat messages (may contain system-role messages)
            max_tokens: Max tokens

        Returns:
            Normalized response dict
        """
        system_parts = []
        non_system = []

        for msg in messages:
            if msg["role"] == "system":
                system_parts.append(msg["content"])
            else:
                non_system.append({"role": msg["role"], "content": msg["content"]})

        kwargs = {
            "model": self.model,
            "messages": non_system,
            "max_tokens": max_tokens
        }
        if system_parts:
            kwargs["system"] = "\n".join(system_parts)

        response = await self.client.messages.create(**kwargs)
        content = response.content[0].text if response.content else ""
        tokens_used = (response.usage.input_tokens + response.usage.output_tokens) if response.usage else 0

        return {
            "content": content,
            "tokens_used": tokens_used,
            "model": self.model,
            "finish_reason": response.stop_reason
        }

    async def generate_fill_code(
        self,
        form_html: str,
        user_profile: Dict[str, Any],
        error_context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate JavaScript code to fill form

        Args:
            form_html: Preprocessed form structure
            user_profile: User data to fill
            error_context: Previous error message (if retrying)

        Returns:
            {
                "code": str,
                "tokens_used": int,
                "model": str,
                "reasoning": str | None
            }
        """
        messages = self._build_prompt(form_html, user_profile, error_context)

        try:
            result = await self._call_llm(messages, max_tokens=2000)
            code = self._extract_code(result["content"])

            return {
                "code": code,
                "tokens_used": result["tokens_used"],
                "model": result["model"],
                "reasoning": None
            }

        except Exception as e:
            raise Exception(f"LLM API error: {str(e)}")

    async def generate_plan(
        self,
        goal: str,
        page_context: str,
        memory_context: str,
        user_profile: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate next action plan based on goal and page state

        Args:
            goal: User's goal string
            page_context: Formatted page state from PageAnalyzer
            memory_context: Pre-formatted memory context string
            user_profile: User profile data

        Returns:
            {
                "action": str,
                "params": dict,
                "reasoning": str,
                "goal_status": str,
                "tokens_used": int
            }
        """
        t0 = time.perf_counter()

        messages = [
            {"role": "system", "content": self.planning_prompt}
        ]

        user_msg = self._build_planning_context(
            goal, page_context, memory_context, user_profile
        )
        messages.append({"role": "user", "content": user_msg})

        if config.DEBUG:
            logger.debug(f"[LLM] Sending request - provider: {self.provider}, model: {self.model}, context length: {len(user_msg)} chars")

        try:
            result = await self._call_llm(messages, max_tokens=2000, json_mode=(self.provider == "openai"))

            content = result["content"]
            finish_reason = result["finish_reason"]

            if config.DEBUG:
                logger.debug(f"[LLM] Response finish_reason: {finish_reason}")
                logger.debug(f"[LLM] Raw response content: {content[:500] if content else 'EMPTY'}")

            if not content or not content.strip():
                return {
                    "action": "none",
                    "params": {},
                    "reasoning": "LLM returned empty response",
                    "goal_status": GoalStatus.BLOCKED,
                    "tokens_used": result["tokens_used"],
                    "planning_time": time.perf_counter() - t0
                }

            plan = self._parse_plan_response(content)
            plan["tokens_used"] = result["tokens_used"]
            plan["planning_time"] = time.perf_counter() - t0

            return plan

        except Exception as e:
            return {
                "action": "none",
                "params": {},
                "reasoning": f"LLM error: {str(e)}",
                "goal_status": GoalStatus.BLOCKED,
                "tokens_used": 0,
                "planning_time": time.perf_counter() - t0
            }

    def _build_planning_context(
        self,
        goal: str,
        page_context: str,
        memory_context: str,
        user_profile: Dict[str, Any]
    ) -> str:
        """Build context string for planning prompt"""
        sections = [
            f"## Goal\n{goal}",
            "",
            page_context,
            "",
            "## User Profile",
            json.dumps(user_profile, indent=2),
            "",
            memory_context,
            "",
            "## What action should be taken next?",
        ]

        return "\n".join(sections)

    def _parse_plan_response(self, content: str) -> Dict[str, Any]:
        """Parse LLM planning response into structured action"""
        try:
            plan = json.loads(content)

            return {
                "action": plan.get("action", "none"),
                "params": plan.get("params", {}),
                "reasoning": plan.get("reasoning", ""),
                "goal_status": plan.get("goal_status", GoalStatus.IN_PROGRESS),
                "missing_fields": plan.get("missing_fields", [])
            }

        except json.JSONDecodeError:
            return {
                "action": "none",
                "params": {},
                "reasoning": f"Failed to parse response: {content[:200]}",
                "goal_status": GoalStatus.BLOCKED,
                "missing_fields": []
            }

    def _build_prompt(
        self,
        form_html: str,
        user_profile: Dict[str, Any],
        error_context: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """Construct messages array for LLM API"""
        messages = [
            {"role": "system", "content": self.system_prompt}
        ]

        # Add few-shot examples
        for example in self.examples:
            user_msg = f"Form HTML:\n{example['form_html']}\n\nUser Profile:\n{json.dumps(example['user_profile'], indent=2)}"
            messages.append({"role": "user", "content": user_msg})
            messages.append({"role": "assistant", "content": example['generated_code']})

        # Add current form + profile
        user_msg = f"Form HTML:\n{form_html}\n\nUser Profile:\n{json.dumps(user_profile, indent=2)}"
        messages.append({"role": "user", "content": user_msg})

        # If retrying with error feedback
        if error_context:
            retry_msg = (
                f"Previous attempt failed with error:\n{error_context}\n\n"
                "Please review the form structure and fix the code."
            )
            messages.append({"role": "user", "content": retry_msg})

        return messages

    def _extract_code(self, response: str) -> str:
        """Extract JavaScript code from response"""
        # Try to extract from markdown code block
        code_block_match = re.search(
            r'```(?:javascript|js)?\s*\n(.*?)\n```',
            response,
            re.DOTALL
        )

        if code_block_match:
            return code_block_match.group(1).strip()

        # If no code block, check if response starts with 'async function'
        if response.strip().startswith('async function'):
            return response.strip()

        # If code is mixed with text, try to extract the function
        function_match = re.search(
            r'(async function fillForm\(\).*?\n})',
            response,
            re.DOTALL
        )

        if function_match:
            return function_match.group(1).strip()

        # If all else fails, return the full response (validation will catch errors)
        return response.strip()
