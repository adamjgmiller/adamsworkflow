---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

Ask one question at a time using the AskUserQuestion tool — never free-form text. For each question:
- Present 2-4 mutually exclusive options.
- List your recommended answer first and append "(Recommended)" to its label.
- Use the option `description` field to surface the tradeoff, not just restate the label.

If a question can be answered by exploring the codebase, explore the codebase instead of asking.
