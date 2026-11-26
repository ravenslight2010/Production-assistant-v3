---
name: Imported package-manager setup
description: Distinguishing an incomplete native package-manager installation from incompatible project dependencies.
---

When an imported project's pinned pnpm executable fails with `ENOEXEC`, check whether its native binary installation lifecycle completed before changing the project's pinned package-manager version or dependencies.

**Why:** The Replit-provided package manager bootstrapped a pinned native pnpm release without completing its installation lifecycle. The executable remained a text placeholder, even though the package existed and was compatible.

**How to apply:** Diagnose the package manager's own installation separately from application dependency failures. Preserve the project's pinned versions when the problem is an incomplete tool installation.
