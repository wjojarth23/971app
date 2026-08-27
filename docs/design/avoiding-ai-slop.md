# Avoiding "AI slop" design — a spec for not designing like an AI

Written while building the home-page redesign concepts in `src/routes/experiments/`, after
researching what actually makes a UI read as "AI-generated" at a glance. This isn't a vibe —
there's a well-documented, specific set of tells that recur across AI-generated frontends because
they're the highest-probability output for vague prompts like "make it modern and clean." Sources
consulted: [Managed Code's "AI Slop in Design"](https://managed-code.com/blog-post/ai-slop-in-design),
[BSWEN's "AI-Generated UI Anti-Patterns" guide](https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/),
[Visily's "How to make AI designs less generic"](https://www.visily.ai/blog/how-to-make-ai-designs-less-generic),
and the [`avoid-ai-design` Claude Code skill](https://github.com/funboy322/avoid-ai-design), which
exists specifically to catch and rewrite these patterns.

## The test

> If you showed this interface to someone and said "AI made this," would they believe you
> immediately?

If yes, it hasn't escaped the generic output. That's the bar, not "does it look nice in isolation."

## Do NOT do this

**Typography**
- Default to Inter, Roboto, or the system font stack with no display face and no real pairing.
  One source calls Inter specifically "the Comic Sans of AI" — not because it's a bad font, but
  because reaching for it with zero consideration is the tell.
- Treat *any* single typeface — including a genuinely distinctive one — as a blanket "safe" choice
  used everywhere with no contrast partner. A good display face used with no pairing is still a
  non-choice if it's the only lever pulled.

**Color & gradients**
- Purple-to-blue gradient fading into blue, on a white or near-black background. This is the
  single most-cited AI tell across every source. It shows up because purple/indigo holds
  legibility well at saturation and is extremely common in training data for "modern SaaS."
- Gradient `background-clip: text` on headlines or hero numbers "for impact."
- Untouched default palettes (shadcn `zinc`/`slate`, default Tailwind `blue-600` buttons) with no
  actual brand decision made.
- Timid, evenly-spread palettes where every color gets equal weight instead of one dominant color
  carrying the page.
- **Concretely caught in this project**: an earlier pass at Concept B used a gold→blue→purple
  gradient hero. The gold-to-purple transition zone reads as pink — exactly the kind of unintended,
  un-owned color the research warns about. Revised to flat, single colors pulled directly from
  `app.css`'s actual tokens, no gradient anywhere.

**Layout**
- Centered hero → subhead → two buttons → three-card feature grid. This exact shape is common
  enough to be a named pattern ("hero + three-feature-cards + CTA template").
- Zero asymmetry — every section perfectly centered, every column the same width.
- Cards nested inside cards; everything wrapped in a container "for structure" with no reason.

**Components & effects**
- `rounded-2xl shadow-lg` (or your framework's equivalent) applied as a reflexive default to every
  card, button, and input, rather than a considered choice.
- Glassmorphism (`backdrop-filter: blur()` + translucent white borders) used decoratively because
  it "looks modern," not because anything is actually layered on top of anything.
- Icon-in-a-rounded-square as the default way to represent literally any concept.

**Icons & imagery**
- The same handful of Lucide icons in every AI output: `Sparkles` (almost always paired with "AI"
  or "new" language), `ArrowRight` welded onto every primary button, `Zap`. If a design's icon
  choices would look identical whether the product were a CRM, a CAD tool, or a recipe app, that's
  the problem — they were picked for genericness, not for what this product actually does.
  **Concretely caught here**: Concept B originally had a `Sparkles` badge icon on the hero — removed.
  Concept A had `ArrowRight` welded onto the primary Sign In button and a decorative `ArrowUpRight`
  on every stat card — both removed; the ones that stayed (on secondary "View all" links) are
  functional, not decorative.

**Copy**
- Openers like "Elevate your workflow," "Seamless," "Powerful." Generic CTA language with no
  specific verb.
- Marketing-style descriptive taglines that could describe any product ("Everything you need, all
  in one place"). **Caught and removed here** per direct review feedback on Concept A/C/D — taglines
  restating what the app does, and decorative "impressive numbers" stat strips (parts tracked,
  purchases logged, etc.) on the sign-in screen added nothing a first-time visitor needed and read
  as filler.

**Motion**
- No motion at all (static, lifeless), OR the opposite failure: the exact same `fade-in-up` applied
  uniformly to every single element on the page, which reads as generated rather than considered.

## DO this instead

- **Commit to one direction with 3–5 defining moves**, not a blend of trends. Each concept in
  `src/routes/experiments/` picks a genuinely different register (editorial/typographic,
  engineering-blueprint, scoreboard, terminal/ops-dashboard) rather than five variations on the
  same SaaS-dashboard template.
- **Ground the design in what the product actually is.** This app is a CAD/manufacturing/CNC tool
  for an FRC robotics team — Concept C (blueprint/dimension-line aesthetic) and Concept E
  (ops-dashboard density) lean into that directly instead of defaulting to generic startup-landing-
  page conventions that would fit literally any SaaS product.
- **One dominant color, one sharp accent** — not an evenly-distributed rainbow. This app already has
  a real token system (`app.css`): a gold accent, and blue/green/red for genuine status semantics.
  Use those, don't invent a new palette per concept.
- **Real typographic pairing when using more than one typeface** — e.g. a display face for
  headlines paired deliberately with a monospace face for data/labels (Concept C uses JetBrains
  Mono as a co-equal partner to Space Grotesk, not filler), rather than one "safe" choice everywhere.
- **Asymmetry where it earns its keep** — a split hero, an offset masthead, a bento grid with
  differently-sized cells — driven by actual content hierarchy, not applied for its own sake.
- **Motion that serves one or two key moments**, not a blanket animation preset on every element.
- **Respect the app's actual theme system.** None of these concepts hardcode a fixed dark palette —
  they use the existing CSS custom properties (`--secondary`, `--card`, `--accent`, etc.) so they
  still respond to the user's actual light/dark theme choice, the same as the rest of the app.
- **Cut anything that doesn't help the person using the screen do the next thing.** A tagline
  restating the product's feature list, or a stat counter with no interactive purpose, is decoration
  competing with the actual task (signing in, seeing your dashboard) — remove it rather than
  defending it as "nice to have."
