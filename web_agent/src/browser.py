"""Playwright browser wrapper with HTML preprocessing for form extraction"""

import json
import logging
import time
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError


logger = logging.getLogger(__name__)

# JavaScript extraction scripts
JS_EXTRACT_FORMS = """
() => {
    const forms = Array.from(document.querySelectorAll('form'));

    const formData = forms.map(form => {
        const fields = Array.from(form.querySelectorAll(
            'input:not([type="hidden"]), select, textarea'
        )).map(field => {
            let label = '';
            if (field.id) {
                const labelEl = document.querySelector(`label[for="${field.id}"]`);
                if (labelEl) {
                    label = labelEl.textContent.trim();
                }
            }
            if (!label && field.closest('label')) {
                label = field.closest('label').textContent.trim();
            }

            const fieldData = {
                tag: field.tagName.toLowerCase(),
                type: field.type || '',
                id: field.id || '',
                name: field.name || '',
                placeholder: field.placeholder || '',
                required: field.required,
                label: label,
                value: field.value || ''
            };

            if (field.type === 'radio' || field.type === 'checkbox') {
                fieldData.checked = field.checked;
            }
            if (field.tagName === 'SELECT') {
                fieldData.options = Array.from(field.options).map(o => ({
                    value: o.value,
                    text: o.textContent.trim(),
                    selected: o.selected
                }));
            }

            return fieldData;
        });

        const buttons = Array.from(form.querySelectorAll(
            'button, input[type="submit"], input[type="button"]'
        )).map(btn => ({
            type: btn.type,
            text: btn.textContent || btn.value || '',
            id: btn.id || '',
            name: btn.name || ''
        }));

        return {
            action: form.action,
            method: form.method,
            id: form.id || '',
            fields: fields,
            buttons: buttons
        };
    });

    return JSON.stringify(formData);
}
"""

JS_EXTRACT_LINKS = """
() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => {
            const rect = a.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        })
        .map(a => ({
            text: a.textContent.trim().substring(0, 100),
            href: a.href,
            id: a.id || '',
            className: a.className || ''
        }))
        .filter(l => l.text);

    return JSON.stringify(links);
}
"""

JS_EXTRACT_BUTTONS = """
() => {
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"]'))
        .filter(btn => {
            if (btn.closest('form')) return false;
            const rect = btn.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        })
        .map(btn => ({
            text: (btn.textContent || btn.value || '').trim().substring(0, 100),
            id: btn.id || '',
            className: btn.className || '',
            type: btn.type || 'button'
        }))
        .filter(b => b.text);

    return JSON.stringify(buttons);
}
"""

JS_EXTRACT_CONTENT = """
() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());

    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/\\s+/g, ' ').trim();

    if (text.length > 3000) {
        text = text.substring(0, 3000) + '...';
    }

    return text;
}
"""

JS_SCROLL = "window.scrollBy(0, {amount})"


class BrowserManager:
    """Manages Playwright browser instance and form extraction"""

    def __init__(self, headless: bool = False, timeout: int = 30000):
        """Initialize browser manager

        Args:
            headless: Run browser in headless mode
            timeout: Default timeout in milliseconds
        """
        self.headless = headless
        self.timeout = timeout
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    async def launch(self) -> None:
        """Launch Playwright browser (skips if already running)"""
        # Don't launch if browser is already running
        if self.browser and self.browser.is_connected():
            return

        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=self.headless)
        self.context = await self.browser.new_context()
        self.page = await self.context.new_page()
        self.page.set_default_timeout(self.timeout)

    def is_running(self) -> bool:
        """Check if browser is currently running"""
        return self.browser is not None and self.browser.is_connected()

    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to URL

        Args:
            url: Target URL

        Returns:
            {"success": bool, "error": {"type": str, "message": str, "details": dict} | None}
        """
        try:
            await self.page.goto(url, wait_until="networkidle")
            return {"success": True, "error": None}
        except TimeoutError as e:
            return {"success": False, "error": {"type": "timeout_error", "message": str(e), "details": {"url": url}}}
        except Exception as e:
            return {"success": False, "error": {"type": "navigation_error", "message": str(e), "details": {"url": url}}}

    async def get_raw_html(self) -> str:
        """Get full page HTML"""
        return await self.page.content()

    async def get_form_elements(self) -> Optional[str]:
        """Extract and preprocess form elements

        Strategy:
        1. Execute JS in page.evaluate() to extract form metadata
        2. Return JSON with only: id, name, type, label, placeholder, required, options
        3. Convert to LLM-friendly pseudo-HTML format
        4. Measure token reduction (rough estimate: 1 token ≈ 4 characters)

        Returns:
            Preprocessed form HTML string, or None if no forms found
        """
        from src.config import config
        try:
            result = await self.page.evaluate(JS_EXTRACT_FORMS)
            form_data = json.loads(result)

            # Convert to LLM-friendly format
            preprocessed_html = self._format_for_llm(form_data)

            # Measure and log token reduction (if debug mode enabled)
            if config.DEBUG:
                raw_html = await self.get_raw_html()

                # Rough token estimate: 1 token ≈ 4 characters
                raw_tokens = len(raw_html) / 4
                preprocessed_tokens = len(preprocessed_html) / 4

                if raw_tokens > 0:
                    reduction_pct = ((raw_tokens - preprocessed_tokens) / raw_tokens) * 100

                    logger.debug(f"[BROWSER] HTML Preprocessing Metrics:")
                    logger.debug(f"  Raw HTML: {len(raw_html):,} chars (~{raw_tokens:.0f} tokens)")
                    logger.debug(f"  Preprocessed: {len(preprocessed_html):,} chars (~{preprocessed_tokens:.0f} tokens)")
                    logger.debug(f"  Token Reduction: {reduction_pct:.1f}%")

            return preprocessed_html

        except Exception as e:
            # Fallback to raw HTML if extraction fails
            if config.DEBUG:
                logger.debug(f"[BROWSER] Extraction failed, using raw HTML: {str(e)}")
            return await self.get_raw_html()

    def _format_for_llm(self, form_data: list) -> Optional[str]:
        """Convert extracted form data to readable pseudo-HTML

        Args:
            form_data: List of form dictionaries

        Returns:
            Compact, readable HTML representation, or None if no forms
        """
        if not form_data:
            return None

        output = []

        for idx, form in enumerate(form_data, 1):
            form_id = f" id=\"{form['id']}\"" if form['id'] else ""
            output.append(f"\n<!-- Form {idx} -->")
            output.append(f"<form{form_id} action=\"{form['action']}\" method=\"{form['method']}\">")

            # Fields
            for field in form['fields']:
                label_text = f" ({field['label']})" if field['label'] else ""
                placeholder = f" placeholder=\"{field['placeholder']}\"" if field['placeholder'] else ""
                required = " required" if field['required'] else ""

                id_attr = f" id=\"{field['id']}\"" if field['id'] else ""
                name_attr = f" name=\"{field['name']}\"" if field['name'] else ""

                if field['tag'] == 'select':
                    output.append(f"  <select{id_attr}{name_attr}{required}>{label_text}")
                    for opt in field.get('options', []):
                        selected = " selected" if opt.get('selected') else ""
                        output.append(f"    <option value=\"{opt['value']}\"{selected}>{opt['text']}</option>")
                    output.append("  </select>")
                elif field['type'] in ('radio', 'checkbox'):
                    # Include value and checked state for radio/checkbox
                    type_attr = f" type=\"{field['type']}\""
                    value_attr = f" value=\"{field.get('value', '')}\"" if field.get('value') else ""
                    checked = " checked" if field.get('checked') else ""
                    output.append(
                        f"  <{field['tag']}{id_attr}{name_attr}{type_attr}{value_attr}{checked}{required} />{label_text}"
                    )
                else:
                    type_attr = f" type=\"{field['type']}\"" if field['type'] else ""
                    output.append(
                        f"  <{field['tag']}{id_attr}{name_attr}{type_attr}{placeholder}{required} />{label_text}"
                    )

            # Buttons
            for btn in form['buttons']:
                id_attr = f" id=\"{btn['id']}\"" if btn['id'] else ""
                type_attr = f" type=\"{btn['type']}\"" if btn['type'] else ""
                output.append(f"  <button{id_attr}{type_attr}>{btn['text']}</button>")

            output.append("</form>\n")

        return "\n".join(output)

    async def execute_js(self, code: str) -> Dict[str, Any]:
        """Execute JavaScript in page context

        Args:
            code: JavaScript code to execute

        Returns:
            {
                "success": bool,
                "result": any,
                "error": {"type": str, "message": str, "details": dict} | None
            }
        """
        try:
            result = await self.page.evaluate(code)
            return {
                "success": True,
                "result": result,
                "error": None
            }
        except Exception as e:
            return {
                "success": False,
                "result": None,
                "error": {
                    "type": "js_execution_error",
                    "message": str(e),
                    "details": {}
                }
            }

    async def wait_for_navigation(self, timeout: int = 5000) -> bool:
        """Check if page navigated after an action

        Args:
            timeout: Max wait time in milliseconds

        Returns:
            True if navigation occurred, False otherwise
        """
        current_url = self.page.url

        try:
            # Wait for URL change
            await self.page.wait_for_url(
                lambda url: url != current_url,
                timeout=timeout
            )
            return True
        except TimeoutError:
            return False

    async def screenshot(self, path: str) -> None:
        """Save screenshot for debugging

        Args:
            path: File path to save screenshot
        """
        await self.page.screenshot(path=path)

    async def get_page_links(self) -> Optional[str]:
        """Extract all clickable links from the page

        Returns:
            Formatted string of links with text and href, or None if no links
        """
        try:
            result = await self.page.evaluate(JS_EXTRACT_LINKS)
            links = json.loads(result)

            if not links:
                return None

            output = ["Links on page:"]
            for link in links:
                id_part = f" (id={link['id']})" if link['id'] else ""
                output.append(f"  - \"{link['text']}\"{id_part} -> {link['href']}")

            return "\n".join(output)

        except Exception as e:
            return None

    async def get_page_buttons(self) -> Optional[str]:
        """Extract all buttons (not in forms) from the page

        Returns:
            Formatted string of buttons, or None if no buttons
        """
        try:
            result = await self.page.evaluate(JS_EXTRACT_BUTTONS)
            buttons = json.loads(result)

            if not buttons:
                return None

            output = ["Buttons on page (outside forms):"]
            for btn in buttons:
                id_part = f" (id={btn['id']})" if btn['id'] else ""
                output.append(f"  - \"{btn['text']}\"{id_part}")

            return "\n".join(output)

        except Exception as e:
            return None

    async def get_readable_content(self) -> str:
        """Extract main readable text content from the page

        Returns:
            Main text content, cleaned and truncated
        """
        try:
            result = await self.page.evaluate(JS_EXTRACT_CONTENT)
            return result or ""

        except Exception as e:
            return ""

    async def get_page_title(self) -> str:
        """Get the page title

        Returns:
            Page title string
        """
        return await self.page.title()

    async def go_back(self) -> Dict[str, Any]:
        """Navigate back in browser history

        Returns:
            {"success": bool, "error": {"type": str, "message": str, "details": dict} | None}
        """
        try:
            await self.page.go_back(wait_until="networkidle")
            return {"success": True, "error": None}
        except Exception as e:
            return {"success": False, "error": {"type": "navigation_error", "message": str(e), "details": {}}}

    async def scroll(self, direction: str = "down", amount: int = 500) -> None:
        """Scroll the page

        Args:
            direction: "up" or "down"
            amount: Pixels to scroll
        """
        scroll_amount = amount if direction == "down" else -amount
        await self.page.evaluate(JS_SCROLL.format(amount=scroll_amount))

    async def build_page_context(self) -> Dict[str, Any]:
        """Build page context string for LLM

        Returns:
            Dict with context string, timings, and page context size
        """
        t0 = time.perf_counter()

        url = self.page.url
        title = await self.get_page_title()
        forms = await self.get_form_elements()
        links = await self.get_page_links()
        buttons = await self.get_page_buttons()
        content = await self.get_readable_content()

        sections = [
            "## Current Page",
            f"URL: {url}",
            f"Title: {title}",
            "",
            "## Page Content",
            content,
            "",
        ]

        if forms is not None:
            sections.extend([
                "## Forms on Page",
                forms,
                "",
            ])

        if links is not None:
            sections.extend([
                "## Available Links",
                links,
                "",
            ])

        if buttons is not None:
            sections.extend([
                "## Available Buttons",
                buttons,
                "",
            ])

        context = "\n".join(sections)
        elapsed = time.perf_counter() - t0

        return {
            "context": context,
            "timings": {"pageExtraction": elapsed},
            "pageContextSize": len(context)
        }

    async def close(self) -> None:
        """Close browser and cleanup"""
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
