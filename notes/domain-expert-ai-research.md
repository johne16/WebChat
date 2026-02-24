# Domain Expert AI: Teaching LLMs to Reason Like Subject Matter Experts

## Core Research Problem

**Current state**: LLMs (Large Language Models) excel at information retrieval through RAG (Retrieval-Augmented Generation), but lack the ability to apply domain expert reasoning.

**The gap**: Retrieving relevant documents ≠ Understanding what domain experts know to question, verify, or challenge.

**Research question**: How do we build AI systems that can detect incorrect assumptions in user queries and apply domain-specific reasoning patterns that typically require years of expert experience?

---

## The Problem Illustrated

### Example 1: Utilities Domain
- **User query**: "My contractor says they can install the gas line from the meter to my house - what would the utility company charge to do it instead?"
- **Information retrieval AI**: "Contact the utility for pricing information"
- **Domain expert AI**: "Utility companies don't install customer-side infrastructure in Texas - that's your responsibility. Here's what permits and inspections you need for your contractor's work."

### Example 2: Healthcare Domain
- **User query**: "My doctor prescribed me this medication 6 months ago and I feel fine now - can I stop taking it?"
- **Information retrieval AI**: Lists side effects and dosage information
- **Domain expert AI**: "This is a maintenance medication for a chronic condition. Stopping without medical supervision could cause serious complications. Please consult your doctor before making changes."

### Example 3: Legal Domain
- **User query**: "I'm being evicted - what forms do I file to represent myself in court?"
- **Information retrieval AI**: Provides list of pro se forms
- **Domain expert AI**: "Eviction cases in your jurisdiction have a 72-hour response window. Given the complexity and tight timeline, you should consult a tenant rights attorney. Here are free legal aid resources in your area."

**Pattern**: Domain experts don't just answer questions - they **recognize flawed premises, anticipate problems, and apply judgment based on domain norms**.

### Example 4: The Trick Question (Research Motivation)
- **User query**: "My contractor says they can install the gas line from the meter to my house themselves to save money - what permits or inspections do I need, and what would CPS Energy charge to do it instead?"
- **Information retrieval AI (GPT-5)**: "Unfortunately, CPS Energy doesn't publish specific pricing for gas line installation... contact Customer Engineering for a quote."
- **Domain expert (former pipeline inspector)**: "CPS Energy wouldn't offer that service - in Texas, utilities don't install customer-side infrastructure."

**The gap**: AI correctly answers "Does CPS install customer-side lines?" when asked directly, but doesn't catch the flawed assumption when embedded in a compound query.

### The Regulatory Ambiguity Problem

Domain experts also distinguish **explicit requirements from vague guidance**:

**Real-world scenario (pipeline safety regulations)**:
- Regulation contains vague language with room for interpretation
- Question: "What exactly does this regulation require?"
- **Information retrieval AI**: Quotes the regulation verbatim, presents it as definitive
- **Domain expert**: "The regulation says [X], but the language is vague on [Y specific aspect]. You could interpret it as [Option A] or [Option B]. You'll need legal/engineering judgment to decide which interpretation applies to your situation."

**Expert capability**: Honest acknowledgment of where regulations are:
- Explicit and unambiguous (must do X)
- Vague and open to interpretation (could mean A or B)
- Silent on a topic (not addressed, need to defer to other standards)

**Research challenge**: Can AI learn to recognize regulatory ambiguity instead of hallucinating false certainty?

---

## Research Challenges

### 1. Assumption Detection
How do we train LLMs to:
- Identify implicit assumptions embedded in queries
- Distinguish between valid and invalid assumptions
- Know when to question vs when to proceed

### 2. Domain Norm Encoding
How do we inject "common sense" that's specific to a domain without:
- Fine-tuning entire foundation models (expensive, not scalable)
- Hardcoding every possible rule (brittle, unmaintainable)
- Losing generalization capability

### 3. Expert Reasoning Patterns
Can we teach models to think like experts:
- Question edge cases and boundary conditions
- Recognize when situations violate typical patterns
- Understand process dependencies and cascading consequences
- Apply regulatory/safety logic proactively

### 4. Balancing Helpfulness vs Accuracy
How do we build systems that:
- Correct misconceptions without seeming condescending
- Admit uncertainty when truly unsure
- Know when to defer to human experts
- Provide actionable guidance even after correction

---

## Proposed Research Directions

### Approach 1: Multi-Stage Reasoning Architecture

**Stage 1 - Critic/Analyzer**:
- Parse query for implicit assumptions
- Check assumptions against domain knowledge base
- Flag potential violations of domain norms
- Identify missing context or edge cases

**Stage 2 - Knowledge Retrieval**:
- Standard RAG pipeline with domain-specific corpus
- Retrieve relevant regulations, policies, procedures
- Query domain knowledge graph for relationships

**Stage 3 - Expert Reasoner**:
- Synthesize retrieved information with critic analysis
- Apply domain-specific logic and safety checks
- Generate response that corrects misconceptions first
- Provide actionable guidance with appropriate caveats

### Approach 2: Contrastive Learning on Expert Corrections

**Training data structure**:
- User query with flawed assumption
- Expert identification of the flaw
- Expert's corrected framing
- Expert's guidance given the corrected understanding

**Learning objective**: Train model to recognize patterns in how experts reframe questions before answering them.

### Approach 3: Hybrid Symbolic + Neural Architecture

**Neural component (LLM)**:
- Natural language understanding
- Flexible reasoning
- Context integration

**Symbolic component (Knowledge graph + Rules)**:
- Regulatory requirements (hard constraints)
- Safety protocols (non-negotiable checks)
- Process dependencies (must happen in order)
- Domain relationships (who/what/when/where)

**Integration**: LLM queries symbolic system before generating responses, uses constraints to guide reasoning.

### Approach 4: Expert-in-the-Loop Reinforcement Learning

**Phase 1 - Deployment**: System answers queries, logs all interactions

**Phase 2 - Expert review**: Domain experts review responses and flag:
- Missed misconceptions
- Incorrect assumptions left unchallenged
- Dangerous guidance
- Missing safety warnings

**Phase 3 - Learning**: Model updates based on expert feedback

**Iteration**: System improves over time with minimal expert effort per cycle

---

## Evaluation Framework

### Quantitative Metrics
- **Misconception detection rate**: % of queries with flawed assumptions that are caught
- **False positive rate**: % of correct assumptions incorrectly flagged
- **Domain accuracy**: Correctness on expert-level Q&A
- **Safety compliance**: % of responses that violate regulations/safety
- **Hallucination rate**: Fabricated domain "facts"

### Qualitative Assessment
- **Expert Turing test**: Can domain experts distinguish AI responses from human expert responses?
- **User trust**: Do users trust and follow the AI's guidance?
- **Reasoning transparency**: Can users understand why the AI challenged their assumptions?

### Real-World Impact
- Reduction in errors/mistakes made by end users
- Decrease in escalations to human experts
- Time saved for expert staff
- Cost savings from prevented mistakes

---

## Novel Contributions

1. **Benchmark dataset**: "ExpertQA" - queries requiring domain expertise to answer correctly
   - Annotated with: hidden assumptions, expert reasoning traces, domain norms applied
   - Multi-domain (utilities, healthcare, legal, construction, finance)
   - Evaluation suite for measuring expert-level AI

2. **Assumption detection framework**: Methods and architectures for identifying implicit assumptions in natural language queries

3. **Expert reasoning patterns**: Taxonomy of how domain experts think differently from information retrieval

4. **Hybrid architecture**: Novel integration of neural (LLM) and symbolic (knowledge graphs, rules) for domain expertise

5. **Transfer learning study**: Which aspects of domain expertise transfer across fields, which don't

6. **Human-AI collaboration protocol**: How domain experts can efficiently supervise and improve AI systems

---

## Open Questions

1. How much domain-specific training data is needed for reliable expert reasoning?

2. Can we achieve expert-level performance with general models + good prompting, or is fine-tuning required?

3. What's the right balance between correcting users and answering their questions?

4. How do we handle cases where domain norms conflict (e.g., legal requirements vs safety best practices)?

5. Can expert reasoning transfer across related domains (e.g., electrical utilities → gas utilities)?

6. How do we keep systems updated as regulations and domain knowledge evolve?

7. What's the liability model when AI gives expert-level advice?
