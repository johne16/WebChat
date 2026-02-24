"""OpenAI client for generating form-filling JavaScript code"""

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
    """Handles OpenAI API communication for code generation and planning"""

    def __init__(self, api_key: str, model: str = "gpt-5", temperature: float = 0.1):
        """Initialize OpenAI client

        Args:
            api_key: OpenAI API key
            model: Model name (default: gpt-5)
            temperature: Sampling temperature (default: 0.1 for deterministic code)
        """
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model
        self.temperature = temperature
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
                "code": str,              # Generated JavaScript
                "tokens_used": int,       # Total tokens
                "model": str,             # Model used
                "reasoning": str | None   # If available
            }
        """
        # Build messages
        messages = self._build_prompt(form_html, user_profile, error_context)

        # Call OpenAI API
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_completion_tokens=2000
            )

            # Extract code from response
            code = self._extract_code(response.choices[0].message.content)

            return {
                "code": code,
                "tokens_used": response.usage.total_tokens,
                "model": response.model,
                "reasoning": None  # GPT-5 may include reasoning, add if needed
            }

        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")

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
            memory_context: Pre-formatted memory context string from SessionMemory.format_context_for_llm()
            user_profile: User profile data

        Returns:
            {
                "action": str,           # Action type
                "params": dict,          # Action parameters
                "reasoning": str,        # Why this action
                "goal_status": str,      # "in_progress", "achieved", "blocked"
                "tokens_used": int       # Total tokens
            }
        """
        t0 = time.perf_counter()

        # Build planning prompt
        messages = [
            {"role": "system", "content": self.planning_prompt}
        ]

        # Build user message with all context
        user_msg = self._build_planning_context(
            goal, page_context, memory_context, user_profile
        )
        messages.append({"role": "user", "content": user_msg})

        if config.DEBUG:
            logger.debug(f"[LLM] Sending request - model: {self.model}, context length: {len(user_msg)} chars")

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_completion_tokens=2000,
                response_format={"type": "json_object"}
            )

            # Parse JSON response
            content = response.choices[0].message.content
            finish_reason = response.choices[0].finish_reason

            if config.DEBUG:
                logger.debug(f"[LLM] Response finish_reason: {finish_reason}")
                logger.debug(f"[LLM] Raw response content: {content[:500] if content else 'EMPTY'}")

            if not content or not content.strip():
                return {
                    "action": "none",
                    "params": {},
                    "reasoning": "LLM returned empty response",
                    "goal_status": GoalStatus.BLOCKED,
                    "tokens_used": response.usage.total_tokens if response.usage else 0,
                    "planning_time": time.perf_counter() - t0
                }

            plan = self._parse_plan_response(content)
            plan["tokens_used"] = response.usage.total_tokens
            plan["planning_time"] = time.perf_counter() - t0

            return plan

        except Exception as e:
            # Return a blocked status on error
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
        """Build context string for planning prompt

        Args:
            goal: User's goal
            page_context: Formatted page state
            memory_context: Pre-formatted memory context string
            user_profile: User data

        Returns:
            Formatted context string
        """
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
        """Parse LLM planning response into structured action

        Args:
            content: JSON response from LLM

        Returns:
            Parsed action dictionary
        """
        try:
            plan = json.loads(content)

            # Ensure required fields exist
            return {
                "action": plan.get("action", "none"),
                "params": plan.get("params", {}),
                "reasoning": plan.get("reasoning", ""),
                "goal_status": plan.get("goal_status", GoalStatus.IN_PROGRESS),
                "missing_fields": plan.get("missing_fields", [])
            }

        except json.JSONDecodeError:
            # If JSON parsing fails, try to extract from text
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
        """Construct messages array for OpenAI API

        Args:
            form_html: Preprocessed form HTML
            user_profile: User data
            error_context: Previous error (if retrying)

        Returns:
            List of message dictionaries
        """
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
        """Extract JavaScript code from response

        Handles:
        - Code blocks (```javascript ... ```)
        - Raw code
        - Explanatory text + code

        Args:
            response: LLM response text

        Returns:
            Extracted JavaScript code
        """
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
