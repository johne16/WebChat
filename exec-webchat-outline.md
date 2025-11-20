# Web.Chat Executive Presentation Outline

## Slide 1 – The Problem
- Large enterprise websites are dense, use internal jargon, and expect visitors to know exactly where to click.
- Most visitors just want quick answers to common questions but abandon the site when they cannot find the right page.
- Resulting support calls drive up costs and slow response times for both customers and agents.

## Slide 2 – What Web.Chat Delivers
- Side panel for plain-language questions, no navigation.
- Contextual answers from current page + fresh search.
- Direct, guided answers, bypassing menus and jargon.

## Slide 3 – Proof So Far & Where It Goes
- **Phase 1:** Built a simple assistant that could answer questions about the current page, but nothing beyond it.
- **Phase 2:** Added automated crawling to gather multiple pages per question, but the flood of content overwhelmed the AI and diluted answer quality.
- **Phase 3:** Shifted to a think-then-act loop where the AI plans, decides what evidence it actually needs, gathers just that, and then answers. Paired with newer AI models, replies stay sharp and fast.

## Slide 4 – The Next Challenge: Authenticated Workflows
- **The opportunity:** Right now Web.Chat only sees public pages. Real utility comes from authenticated workflows, whether that's customers navigating their accounts or employees working with internal systems.
- **The security problem:** These pages contain private data that cannot be sent to external AI services.
- **What it would take:** Reading the user's screen directly instead of fetching externally, strict data masking, explicit consent, and likely an in-house AI service to keep data on-premise.

### "Why Not Just Use ChatGPT?"

- **Honest answer:** ChatGPT is fine, and often better, 90% of the time for general questions.
- **Where Web.Chat adds value:**
  - **Convenience:** No context switching; users stay on the site instead of bouncing to another tab.
  - **Automatic context:** It already knows what page you're viewing without having to explain or paste content.
  - **Privacy & control:** Can plug in an in-house model instead of sending queries to external AI services.
  - **Site-specific optimization:** Can be tuned for a particular website's structure, terminology, and common user questions.
- **Bottom line:** Not a ChatGPT replacement, but a specialized tool that makes sense when convenience, context, and control matter.
