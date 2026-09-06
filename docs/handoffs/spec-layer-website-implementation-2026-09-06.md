# Spec Layer website implementation package

Prepared 6 September 2026.

- [Implementation plan](../../apps/website/IMPLEMENTATION.md): source map, scope, prioritized tasks, route contract, CI integration, launch and rollback requirements, and a ready-to-use first-task brief.
- [Acceptance checklist](../../apps/website/ACCEPTANCE.md): existing evidence, remaining browser/accessibility work, public-host checks, and a release record template.
- [Portable source archive](spec-layer-website-implementation-2026-09-06.zip): 58 files, 1,662,745 bytes, including the source, assets, reference snapshots, license, handoff documents, and a checksum manifest.

The archive's SHA-256 is:

```text
98a15a7b1680a047b23de7fc5fc8cf1e34cd946e8627af8a2ce11a3763d32e7a
```

The extracted archive passed both preview and production checks in a fresh temporary directory with no installed dependencies and no private hosting binding. All 57 source-file checksums matched its manifest. Preview mode was restored afterward. The source also passed the existing repository ESLint rules with zero errors and warnings.

The next implementation task is to reconcile the current public support/policy source and integrate those pages into the redesigned website. Follow with CI integration, browser verification, and the public-host candidate. Public publication and Search Console submission are later launch steps.

The working website remains untracked in the main monorepo at preparation time. The package preserves that source for implementation; it is not a deployed production release or a GitHub pull request. The last published private preview source was `5eac46e0e57703ccd0aa354ecaadc5a5b12acadf`; the archive additionally includes these handoff documents and README updates.
