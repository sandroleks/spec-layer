# Spec Layer: positioning and competitive foundation

**Date:** 8 September 2026  
**Status:** Working positioning baseline for product, marketing, documentation, and customer conversations. Audience and commercial assumptions require customer validation.  
**Product boundary:** Figma plugin, structured specifications, and CLI delivery. No hosted documentation workspace or SaaS platform strategy. Optional hosted services support publishing and AI writing.

## 1. The position

**Spec Layer turns Figma components, variables, and styles into precise specifications that teams can review in Figma and use in their repositories.**

Our category is **design-system specifications for implementation**. Describe the product concretely as a Figma plugin with a companion CLI. Use “structured design context” when explaining agent consumption, rather than making it the entire category claim.

For teams building from an existing Figma component library, Spec Layer makes component structure, states, properties, and token relationships available as reusable specifications. Designers can inspect documentation on the canvas. Developers and coding agents can consume structured output through the clipboard or repository files.

The value we aim to deliver is less manual reconstruction of design details during implementation. The product supports that outcome; reductions in implementation time or errors still need measurement.

**The strategic choice:** concentrate on the quality and usefulness of the specification and the ease of bringing it into an existing workflow. Do not expand into organisation-wide knowledge management merely to match competitors' feature lists.

## 2. Who we serve

### Primary audience

Design-system practitioners and frontend engineers working together on reusable components, especially teams already using AI coding agents and repositories to coordinate implementation.

Qualify by workflow rather than company size:

- They maintain components, variables, or styles in Figma.
- They need more than a screenshot to implement component variations and themes.
- Someone repeatedly translates design details into documentation, prompts, or code.
- They can benefit from explicit specifications in their existing tools.

**Likely champion:** the designer or design engineer maintaining the Figma library.  
**Implementation partner:** a frontend or design-system engineer.  
**Potential team buyer:** the person responsible for design-system maintenance or frontend delivery. This is a commercial hypothesis, not an established customer profile.

### Secondary audience

Independent designers and small product teams that need useful canvas documentation first. Their immediate benefit remains valid even if they never publish a library or use an agent.

### Poor fit for the current product

Teams primarily buying a hosted documentation portal, approval workflows, enterprise administration, a token-authoring platform, or automatic implementation verification. Also a weaker fit when there is no meaningful component structure to extract or when the existing Figma-to-agent workflow already meets the need.

## 3. The problem we organise the story around

Design details already exist in Figma, but implementation requires them in another form. A person or agent may need to reconstruct which part uses a token, when a binding changes, which states exist, and which theme values apply.

Our job is to make those available details explicit and reusable. Extraction does not recover undocumented intent, invent missing accessibility behaviour, or establish that an implementation is correct.

**Core customer job:** “When we implement or update a component, give our team and coding agent a clear specification from the Figma source, so we can use the design details without repeatedly translating them by hand.”

Typical entry points are documenting a component, preparing agent context, updating existing documentation after a design change, and bringing a published library into a repository.

## 4. The competitive landscape

This is a comparison of documented product emphasis and customer fit, not a tested feature-parity scorecard. Vendor claims establish their positioning and advertised capabilities. They do not prove performance or the absence of features elsewhere. Sources were checked on 8 September 2026.

| Tool or approach | Main job and output | Best-fit use case | Trade-off relative to Spec Layer |
|---|---|---|---|
| **Spec Layer** | Extracts Figma component specifications into canvas documentation, component YAML, and DTCG token output. A companion CLI brings published specifications into the repository. [Product overview](../../README.md), [CLI](../../packages/cli/README.md) | A team wants reusable component specifications for designers, developers, and coding agents within its existing Figma and repository workflow. | Focused on extraction and delivery. No hosted documentation workspace, enterprise governance suite, or implementation testing. Publishing and pulling are explicit steps. |
| **Supernova** | Manages design and engineering knowledge for agents through scoped contexts, documentation, component information, and MCP distribution. [Homepage](https://www.supernova.io/) | A team wants a shared platform for curating and distributing organisational knowledge. | Broader management scope. Choose Spec Layer when the immediate job is extracting and delivering component specifications; choose Supernova when the shared knowledge platform is itself the requirement. |
| **zeroheight** | Makes design-system documentation available to people and AI tools through remote and local MCP options. [MCP overview](https://help.zeroheight.com/hc/en-us/articles/48004395674011) | A team needs an authored documentation resource that people and agents consult. | Documentation access overlaps with our use case. Spec Layer's emphasis is specifications derived from the Figma source and carried into the repository. AI access alone does not distinguish us. |
| **Knapsack** | Provides an enterprise digital production platform; its workspace MCP serves tokens, components, and documentation. [Platform](https://www.knapsack.cloud/), [MCP documentation](https://docs.knapsack.cloud/intelligent-tools/mcp-server) | An organisation wants a broader workspace around its design system and production process. | Spec Layer offers a narrower specification workflow around an existing library. It is not an equivalent enterprise platform. |
| **Figma MCP and Code Connect** | Supplies native design context to agents, supports canvas writing, and connects designs to actual code components. [MCP](https://developers.figma.com/docs/figma-mcp-server/), [Code Connect](https://developers.figma.com/docs/code-connect/) | Direct agent access to Figma and existing code mappings provide the context the team needs. | The most important direct substitute to test. Spec Layer must demonstrate additional value from an inspectable, reusable specification retained with implementation. It does not replace native access or code mappings. |
| **Tokens Studio** | Supports token workflows and design-to-code automation, including plugin-based GitHub token sync. [Platform](https://tokens.studio/), [official GitHub sync documentation](https://github.com/tokens-studio/plugin-docs/blob/master/pages/token-storage-and-sync/sync-provider-github.en.mdx) | The main need is creating, managing, transforming, or synchronising tokens. | Spec Layer emphasises component parts, conditions, and the tokens they use. Token export and repository delivery alone are shared territory, not differentiators. |
| **Storybook** | Generates documentation from implemented component stories, metadata, and controls. [Autodocs](https://storybook.js.org/docs/writing-docs/autodocs) | The team needs to document and explore the implemented component. | Complementary: Spec Layer supplies the Figma-derived specification alongside the code-side reference. No dedicated integration is implied. |
| **Chromatic** | Compares implementation snapshots against visual baselines. [Visual tests](https://www.chromatic.com/docs/visual/) | The team needs to detect and review visual changes in code. | Complementary: Spec Layer supplies specifications to inform implementation and review. It currently provides no equivalent visual testing service. |
| **Manual docs, prompts, or custom scripts** | Moves design details between tools through the team's existing process. This is an alternative category, not a surveyed product. | The task is infrequent, the system is small, or existing automation is sufficient. | Spec Layer must remove enough recurring translation and maintenance work to justify adopting another tool. An existing process that works is a valid choice. |

**Where we compete directly:** component documentation, design-context preparation, and bringing specifications into implementation workflows. Supernova, zeroheight, Knapsack, and native Figma tooling overlap with parts of this job. Their broader capabilities are not automatically requirements for our customer.

**Where we sit alongside other tools:** token management, code-side component documentation, and visual testing. Tokens Studio, Storybook, and Chromatic can remain part of the team's workflow. This describes complementary roles, not verified integrations.

**Our reason to be chosen:** the team wants a precise, reusable specification from its existing Figma library, with documentation on the canvas and structured output in its repository. This is the position to demonstrate against alternatives, not a claim that competing tools cannot produce similar results.

### What Supernova teaches us

Supernova leads with what knowledge enables agents to do, then presents documentation and management as supporting capabilities. Its pricing packages contexts, seats, and governance. We can borrow the outcome-first ordering while keeping our product boundary focused. [Homepage](https://www.supernova.io/), [pricing](https://www.supernova.io/pricing)

Its September 1 Editor MCP announcement also extends into agent-driven maintenance. “AI access” is therefore an entry expectation in this comparison, not a defensible standalone advantage. [Editor MCP announcement](https://www.supernova.io/blog/introducing-supernova-editor-mcp)

Do not position Spec Layer as a cheaper Supernova. A lower price does not explain why a customer wants our narrower workflow, and Supernova also offers a free tier. Sell the fit of the workflow before discussing price.

## 5. What we can differentiate on

These are supported product strengths. Their superiority over competitors remains to be demonstrated.

### A. Explicit component relationships

Component Context represents anatomy paths, properties, conditional token bindings, and the dependencies used by the component. A useful demonstration answers: “Which token controls this part in this state, and how is its value resolved?”

**Customer benefit:** implementation context includes relationships between design details, beyond a list of token values.

**Evidence:** [Component Context specification](../specs/component-context-v5.md). Respect its boundaries: structured layout is scoped to the default variant; unresolved references and unavailable source information remain explicit.

### B. Documentation and structured output from the same extraction pipeline

The plugin produces canvas documentation and structured context. Component context can travel through the clipboard or a published library into the repository.

**Customer benefit:** designers and implementers can work from related outputs of the same source extraction.

**Boundary:** these are different presentations with different coverage. Do not promise field-for-field identity, automatic synchronisation, or that the canvas represents every exported detail.

**Evidence:** [Product overview](../../README.md), [CLI workflow](../../packages/cli/README.md).

### C. Reusable artifacts in the team's workflow

The CLI writes component YAML, canonical artifacts, and DTCG token files into the repository. Local read commands and agent instructions help consumers find and use them. Teams can commit the generated specifications and review changes using their own repository practices.

**Customer benefit:** specifications can accompany implementation and remain available after the pull, without another live retrieval for each local read.

**Boundary:** Spec Layer does not create a review or approval workflow. Publishing and pulling are explicit steps. Pulling retrieves the published snapshot, not unpublished Figma changes.

**Evidence:** [CLI output and commands](../../packages/cli/README.md).

### D. A clear distinction between extraction and generated guidance

Extraction and structured context are deterministic. Optional AI writing produces guidance separately. Canonical output retains source identities, semantic hashes, and diagnostics; unsupported information is reported rather than silently approximated.

**Customer benefit:** consumers can inspect where supported design details came from and see gaps that require judgment.

**Boundary:** deterministic does not mean complete, error-free, or implementation-verified. The current status documents retain open real-source verification gates.

**Evidence:** [Component Context](../specs/component-context-v5.md), [Foundation status](../specs/foundation-v5-status.md).

The strongest proposition combines these strengths. Open source, portability, deterministic processing, and AI compatibility are supporting evidence. None is an exclusive market claim by itself.

## 6. Messaging to use

### Internal positioning statement

For teams implementing a Figma component library, Spec Layer is a specification tool that turns components, variables, and styles into documentation and structured implementation context. It brings component details into the designer's canvas and the developer's repository through a focused plugin-and-CLI workflow.

### Primary public message

**Your Figma components, ready for implementation.**

Turn components, variables, and styles into precise specs for your team and AI coding agents. Review them in Figma, copy them into your agent, or pull a published library into your repository.

**Primary action:** Open in Figma.  
**Supporting action:** See an example spec.

### Audience-specific emphasis

| Audience | Lead with | Demonstrate |
|---|---|---|
| Designer | Document your components and share their specifications. | A source component, its canvas documentation, and the update workflow. |
| Developer or design engineer | Bring component specifications into your repository. | Component YAML, its token dependencies, and the files produced by a pull. |
| Team lead | Give design and implementation a reusable specification to work from. | The complete handoff and an actual change moving through it. |

### Message order for the website and demos

1. State the implementation benefit and identify the Figma plugin.
2. Show a real or clearly labelled synthetic component beside its actual output.
3. Show canvas documentation, Copy for AI, and publish/pull as connected uses.
4. Explain relationships, dependency handling, and explicit extraction limits.
5. Show how someone starts with one component.
6. Present verified plan details and answer adoption questions.

Keep canvas documentation prominent. It provides standalone value and makes the structured output easier to inspect. AI consumption extends that value.

## 7. Claims and terminology

| Use | Avoid or qualify |
|---|---|
| “Specifications extracted from Figma.” | “Understands all your design intent.” Undocumented intent cannot be extracted. |
| “Structured context for your coding agent.” | “Guarantees correct code” or “eliminates hallucinations.” |
| “Component parts, states, properties, and token bindings.” | “Every detail of every component.” Coverage has defined limits. |
| “Check against the latest published library.” | “Always in sync with Figma.” Unpublished changes are outside the CLI's view. |
| “Review and version specifications in your repository.” | “Built-in approvals” or “automatic PR checks.” |
| “Extraction and clipboard output run inside Figma.” | “Entirely offline” or “nothing leaves Figma.” AI writing and publishing use hosted services. |
| “Open-source plugin and CLI.” | “No dependencies” or “no lock-in whatsoever.” Figma and optional service dependencies still exist. |
| “Designed to reduce manual translation.” | Quantified time, token-cost, or error savings before measurement. |

Use “specifications,” “design details,” “documentation,” and “context” in public copy. Avoid calling the output “facts,” “ground truth,” an “oracle,” or a “single source of truth.” “Lower-level” is an architectural description for internal discussion; explain its customer benefit as precision and direct use in existing tools.

## 8. Product and commercial implications

Prioritise extraction fidelity, readable specifications, useful dependency handling, transparent limitations, reliable updates, and a short route from selection to usable output. Judge additions by whether they make specifications easier to create, trust, consume, or maintain.

A hosted documentation workspace, enterprise governance suite, general token-authoring platform, and code-generation product are outside this positioning. They would require a deliberate strategy change.

Keep the entry workflow accessible. A designer should be able to establish value before a team buying decision. Commercial packaging can support repeated publishing, usage, licensing, onboarding, and support where those offers are implemented and sustainable. Price by demonstrated customer value, not a percentage of a competitor's price.

**Release boundary on the research date:** the local website contains proposed free-publishing and Teams copy, while the inspected publishing handler still checks Pro entitlement. Neither those draft allowances nor a proposed team price becomes a shipped claim through this document. Check the released plugin, backend, and commercial terms before publishing plan details. See [free-publishing review](../reviews/2026-09-08-free-publishing-website/README.md) and [Teams proposal](../reviews/2026-09-08-teams-pricing/README.md).

Design conformance testing remains a separate proposal. Current hashes, source-change detection, and published-library freshness checks do not establish that code matches the design. See [conformance proposal](2026-09-02-design-conformance-pivot.md).

## 9. Evidence to build next

### The demonstration

Use a publishable component with multiple states, themes, and nested parts. Show its source, canvas documentation, conditional bindings, token dependency slice, repository output, and one source change carried through an update and republish. Include an unresolved reference so the demonstration shows how limitations are handled.

### The competitive test

Compare the same task using Spec Layer, native Figma MCP with available Code Connect mappings, and the team's existing manual workflow. Keep the source component, coding agent, model, brief, and evaluation criteria consistent. Allow each alternative its recommended setup and record that setup effort separately.

Measure time to usable context, manual corrections, missing or incorrect bindings, implementation discrepancies across the selected states/themes, and the work required after a source change. Repeat before generalising. Record where the native or existing workflow is sufficient or better.

### Customer validation

Start with five relevant teams. This is a qualitative learning round, not market validation by itself. Ask them to show a recent handoff, the information they had to reconstruct, and what happened after a component changed. Observe them trying one component rather than relying on opinions about the headline.

Track whether they complete the first useful output, use it in real implementation, return after a source change, involve an engineering colleague, and express willingness to pay for a defined offer. Distinguish installs and generated documents from repeated use.

Reconsider the emphasis if structured output does not improve their workflow, if canvas documentation is consistently the main value, or if native Figma tools already solve the problem. Reconsider commercial packaging if repeat users value the product but no buyer owns the purchase.

## 10. How to use and maintain this baseline

Use this document when writing website copy, preparing demos, evaluating product additions, and explaining competitor fit. Keep competitor comparisons factual and focused on the customer's job. Refresh them before publishing a comparison page or making a sales claim.

This baseline replaces the market-positioning assumptions in the [June working notes](2026-06-22-positioning-and-pivot.md), including their outdated Markdown/MCP direction and unsupported exclusivity claims. It does not approve the later conformance roadmap or change current release status.

Update the document when product capabilities change, a meaningful competitor release changes the choice, or observed customer behaviour contradicts an assumption. Record the date and evidence. Treat successful implementation examples and repeat usage as the basis for strengthening the promise.
