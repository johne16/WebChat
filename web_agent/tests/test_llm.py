"""Tests for llm.py - LLM client (OpenAI + Anthropic)"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
from src.llm import LLMClient


def test_load_system_prompt():
    """Test system prompt loads from file"""
    # read_text() is called three times: system_prompt.txt, planning_prompt.txt, examples.json
    with patch('pathlib.Path.read_text', side_effect=["Test system prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")
        assert client.system_prompt == "Test system prompt"


def test_load_examples():
    """Test examples load from file"""
    # read_text() is called three times: system_prompt.txt, planning_prompt.txt, examples.json
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", '[{"form_html": "test"}]']):
        client = LLMClient(api_key="test-key", provider="openai")
        assert len(client.examples) == 1
        assert client.examples[0]["form_html"] == "test"


def test_build_prompt_without_error(sample_user_profile, simple_form_html):
    """Test prompt construction without error context"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")
        client.examples = []

        messages = client._build_prompt(simple_form_html, sample_user_profile, None)

        assert len(messages) >= 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert "Form HTML" in messages[1]["content"]


def test_build_prompt_with_error(sample_user_profile, simple_form_html):
    """Test prompt construction with error context"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")
        client.examples = []

        messages = client._build_prompt(
            simple_form_html,
            sample_user_profile,
            "Element not found: #email"
        )

        # Should have user message + error feedback message
        assert len(messages) >= 3
        assert any("failed" in msg["content"].lower() for msg in messages)


def test_extract_code_from_markdown():
    """Test code extraction from markdown code block"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        response = """```javascript
async function fillForm() {
  await fillField('#email', 'test@example.com');
}
```"""

        code = client._extract_code(response)

        assert "async function fillForm()" in code
        assert "```" not in code


def test_extract_code_plain():
    """Test code extraction from plain response"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        response = "async function fillForm() {\n  await fillField('#email', 'test@example.com');\n}"

        code = client._extract_code(response)

        assert code == response.strip()


def test_extract_code_mixed_text():
    """Test code extraction from mixed text and code"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        response = """Here's the code to fill the form:

async function fillForm() {
  await fillField('#email', 'test@example.com');
}

This code will fill the email field."""

        code = client._extract_code(response)

        assert "async function fillForm()" in code
        assert "Here's the code" not in code


@pytest.mark.asyncio
async def test_generate_fill_code_success(sample_user_profile, simple_form_html):
    """Test successful code generation (mocked)"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]), \
         patch('src.llm.AsyncOpenAI') as mock_openai:
        # Mock OpenAI response
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "async function fillForm() { await fillField('#email', 'test@example.com'); }"
        mock_response.usage.total_tokens = 150
        mock_response.model = "gpt-5.2"

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        mock_openai.return_value = mock_client

        client = LLMClient(api_key="test-key", provider="openai")
        client.examples = []

        result = await client.generate_fill_code(simple_form_html, sample_user_profile)

        assert "code" in result
        assert "tokens_used" in result
        assert result["tokens_used"] == 150
        assert "async function fillForm()" in result["code"]


@pytest.mark.asyncio
async def test_generate_fill_code_api_error(sample_user_profile, simple_form_html):
    """Test code generation with API error"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]), \
         patch('src.llm.AsyncOpenAI') as mock_openai:
        # Mock API error
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API Error"))
        mock_openai.return_value = mock_client

        client = LLMClient(api_key="test-key", provider="openai")
        client.examples = []

        with pytest.raises(Exception) as exc_info:
            await client.generate_fill_code(simple_form_html, sample_user_profile)

        assert "api error" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_generate_plan_success():
    """Test successful plan generation"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]), \
         patch('src.llm.AsyncOpenAI') as mock_openai:
        # Mock OpenAI response
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"action": "fill_form", "params": {}, "reasoning": "Fill the form", "goal_status": "in_progress"}'
        mock_response.choices[0].finish_reason = "stop"
        mock_response.usage.total_tokens = 200

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        mock_openai.return_value = mock_client

        client = LLMClient(api_key="test-key", provider="openai")

        result = await client.generate_plan(
            goal="Sign up",
            page_context="## Current Page\nURL: http://example.com",
            memory_context="## Session Memory\nEntered Data: {}\nVisited URLs: []\nCurrent Step: 0",
            user_profile={"email": "test@example.com"}
        )

        assert result["action"] == "fill_form"
        assert result["goal_status"] == "in_progress"
        assert result["tokens_used"] == 200


@pytest.mark.asyncio
async def test_generate_plan_api_error():
    """Test plan generation returns blocked on API error"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]), \
         patch('src.llm.AsyncOpenAI') as mock_openai:
        # Mock API error
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API Error"))
        mock_openai.return_value = mock_client

        client = LLMClient(api_key="test-key", provider="openai")

        result = await client.generate_plan(
            goal="Sign up",
            page_context="Page",
            memory_context="## Session Memory\nEntered Data: {}\nVisited URLs: []\nCurrent Step: 0",
            user_profile={}
        )

        assert result["action"] == "none"
        assert result["goal_status"] == "blocked"
        assert "error" in result["reasoning"].lower()


def test_parse_plan_response_valid():
    """Test parsing valid plan response"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        content = '{"action": "click_link", "params": {"link_text": "Sign In"}, "reasoning": "Click sign in", "goal_status": "in_progress"}'
        result = client._parse_plan_response(content)

        assert result["action"] == "click_link"
        assert result["params"]["link_text"] == "Sign In"
        assert result["goal_status"] == "in_progress"


def test_parse_plan_response_invalid_json():
    """Test parsing invalid JSON returns blocked status"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        content = "This is not JSON at all"
        result = client._parse_plan_response(content)

        assert result["action"] == "none"
        assert result["goal_status"] == "blocked"
        assert "Failed to parse" in result["reasoning"]


def test_build_planning_context():
    """Test building planning context string"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        memory_str = (
            "## Session Memory\n"
            'Entered Data: {"email": "test@example.com"}\n'
            'Visited URLs: ["http://example.com"]\n'
            "Current Step: 2\n"
            "\nRecent Actions:\n"
            "  [OK] Step 1: fill_form"
        )

        context = client._build_planning_context(
            goal="Sign up and sign in",
            page_context="## Current Page\nURL: http://example.com",
            memory_context=memory_str,
            user_profile={"email": "test@example.com"}
        )

        assert "Sign up and sign in" in context
        assert "http://example.com" in context
        assert "test@example.com" in context
        assert "Recent Actions" in context
        assert "fill_form" in context


def test_parse_plan_response_needs_input():
    """Test parsing plan response with needs_input status and missing_fields"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        content = '{"action": "none", "params": {}, "reasoning": "Form requires birth city", "goal_status": "needs_input", "missing_fields": ["birthCity", "securityAnswer"]}'
        result = client._parse_plan_response(content)

        assert result["action"] == "none"
        assert result["goal_status"] == "needs_input"
        assert result["missing_fields"] == ["birthCity", "securityAnswer"]
        assert "birth city" in result["reasoning"].lower()


def test_parse_plan_response_awaiting_user_action():
    """Test parsing plan response with awaiting_user_action status"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        content = '{"action": "none", "params": {}, "reasoning": "Page has a CAPTCHA", "goal_status": "awaiting_user_action"}'
        result = client._parse_plan_response(content)

        assert result["action"] == "none"
        assert result["goal_status"] == "awaiting_user_action"
        assert result["missing_fields"] == []


def test_parse_plan_response_missing_fields_defaults_to_empty():
    """Test missing_fields defaults to empty list when not provided"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="openai")

        content = '{"action": "fill_form", "params": {}, "reasoning": "Fill form", "goal_status": "in_progress"}'
        result = client._parse_plan_response(content)

        assert result["missing_fields"] == []


@pytest.mark.asyncio
async def test_generate_plan_needs_input():
    """Test plan generation with needs_input response"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]), \
         patch('src.llm.AsyncOpenAI') as mock_openai:
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"action": "none", "params": {}, "reasoning": "Missing birth city", "goal_status": "needs_input", "missing_fields": ["birthCity"]}'
        mock_response.choices[0].finish_reason = "stop"
        mock_response.usage.total_tokens = 180

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        mock_openai.return_value = mock_client

        client = LLMClient(api_key="test-key", provider="openai")

        result = await client.generate_plan(
            goal="Sign up",
            page_context="## Current Page\nURL: http://example.com",
            memory_context="## Session Memory\nEntered Data: {}\nVisited URLs: []\nCurrent Step: 0",
            user_profile={"email": "test@example.com"}
        )

        assert result["goal_status"] == "needs_input"
        assert result["missing_fields"] == ["birthCity"]
        assert result["tokens_used"] == 180


@pytest.mark.asyncio
async def test_generate_plan_awaiting_user_action():
    """Test plan generation with awaiting_user_action response"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]), \
         patch('src.llm.AsyncOpenAI') as mock_openai:
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"action": "none", "params": {}, "reasoning": "CAPTCHA detected", "goal_status": "awaiting_user_action"}'
        mock_response.choices[0].finish_reason = "stop"
        mock_response.usage.total_tokens = 150

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        mock_openai.return_value = mock_client

        client = LLMClient(api_key="test-key", provider="openai")

        result = await client.generate_plan(
            goal="Sign up",
            page_context="## Current Page\nURL: http://example.com",
            memory_context="## Session Memory\nEntered Data: {}\nVisited URLs: []\nCurrent Step: 0",
            user_profile={}
        )

        assert result["goal_status"] == "awaiting_user_action"
        assert result["action"] == "none"


def test_anthropic_provider_init():
    """Test LLMClient initializes with Anthropic provider"""
    try:
        import anthropic  # noqa: F401
    except ImportError:
        pytest.skip("anthropic package not installed")

    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        client = LLMClient(api_key="test-key", provider="anthropic")
        assert client.provider == "anthropic"


@pytest.mark.asyncio
async def test_call_anthropic_separates_system():
    """Test that _call_anthropic correctly separates system messages"""
    with patch('pathlib.Path.read_text', side_effect=["System prompt", "Planning prompt", "[]"]):
        try:
            from anthropic import AsyncAnthropic
        except ImportError:
            pytest.skip("anthropic package not installed")

        with patch('anthropic.AsyncAnthropic') as mock_anthropic_class:
            mock_response = MagicMock()
            mock_response.content = [MagicMock(text='{"action": "fill_form"}')]
            mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)
            mock_response.stop_reason = "end_turn"

            mock_client_instance = MagicMock()
            mock_client_instance.messages.create = AsyncMock(return_value=mock_response)
            mock_anthropic_class.return_value = mock_client_instance

            client = LLMClient(api_key="test-key", provider="anthropic")

            result = await client._call_anthropic([
                {"role": "system", "content": "You are helpful"},
                {"role": "user", "content": "Hello"}
            ], max_tokens=100)

            # Verify system was separated
            call_kwargs = mock_client_instance.messages.create.call_args[1]
            assert call_kwargs["system"] == "You are helpful"
            assert len(call_kwargs["messages"]) == 1
            assert call_kwargs["messages"][0]["role"] == "user"
            assert result["content"] == '{"action": "fill_form"}'
            assert result["tokens_used"] == 150
