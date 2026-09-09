# Website copy pass — 8 September 2026

Applied Copywriting, Copy Editing, Ogilvy Copywriting, and Stop Slop to the homepage and documentation overview. Installed the SEO Audit skill from boraoztunc/skills for future use and reviewed the homepage metadata alongside the copy.

## Decisions

- Lead with the product category and source: “Design system docs. Built from Figma.” The previous headline did not identify documentation or Figma.
- Replace repeated shared-context phrasing with specific actions: create canvas docs, copy component specs, and pull published specs and tokens into a repository.
- Name library publishing in the Pro heading so visitors can see the plan distinction before reading the feature list.
- Use explicit destination/action labels such as “Open in Figma” and “Set up the CLI”.
- Simplify the documentation overview without changing commands or output formats.
- Put Figma design system documentation first in the search title and describe the product in the meta description.

## Editorial constraints

Preserved the user’s terminology preference: documentation and specifications are never called “facts”. Preserved technical distinctions between component YAML, foundation DTCG JSON, optional AI writing, and published-library updates. No new performance promises, testimonials, savings claims, or product capabilities were introduced. Pricing amounts, allowances, and legal disclosures are unchanged.

The source behavior review in apps/website/REVIEW.md grounds the capability descriptions. Skill examples and advertising statistics were not treated as product evidence. Existing design and screenshots remain intact.

## Validation

Production-mode build and existing static checks passed: 19 HTML routes, local links and anchors, schema copies and examples, metadata and structured data, 12 canonical URLs, 29 redirects, indexing rules, policy content preservation, and brand/artwork parity.

This is a copy and metadata pass, not a full SEO audit. Search Console, rankings, traffic, and field performance were not assessed. No new browser scenarios were run for this copy-only change.

The accompanying copy.patch isolates this pass from the earlier uncommitted website changes.

Published to https://spec-layer.com. All 50 live HTTP checks passed. See release.json for the deployment and rollback references.
