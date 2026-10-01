# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person — the owner — reading their own feeds. Not a team, not a customer base, and not intended to become one.

That single user reads in two distinct scenes, and both are first-class:

- **Desktop, long catch-up sessions.** Browser at a desk, triaging a backlog across many feeds. Wants density and speed of scanning.
- **Phone, short bursts.** Reading an article or clearing a handful of items, often one-handed. Wants the article itself, not the management surface.

There is no second persona, no onboarding funnel, and no evaluator. Nothing in the product needs to persuade a stranger, and there is no acquisition, retention, or growth goal.

## Product Purpose

A personal RSS reader that keeps the owner's subscribed reading in one place, with read state that persists across devices.

Success means the owner reads more of what they subscribed to, and opens the original website less. Two supporting outcomes matter because they are how that gets measured in practice: the backlog is clearable quickly on desktop, and any article is genuinely readable on a phone without leaving the app.

## Positioning

It reads the article body itself. Most hosted readers show whatever the feed carried and send you to the publisher for anything more. This one detects when a feed published only a teaser and extracts the full text from the source page, so the app — not the publisher's page — is where reading happens.

That is the mechanism a neighbouring reader could not copy without doing the extraction work, and it is the reason the product exists rather than being a nicer skin on a feed list.

## Operating Context

- Runs on the free tiers of **Vercel Hobby and Neon**, deliberately. Hosting cost is a binding constraint, not an incidental one.
- A **daily cron** refreshes feeds; the owner also refreshes on demand when they sit down to read.
- Source content arrives as **untrusted third-party HTML** from arbitrary feeds and pages, which is why sanitisation and extraction quality are product concerns, not just security ones.
- **Paywalls and JavaScript-rendered pages are a permanent, expected failure mode** of extraction. The fallback is the source link, and the product must be honest about when it is showing a partial article rather than silently presenting a teaser as the whole thing.
- Feed subscriptions are portable via **OPML**, so the owner is never locked in.

## Capabilities and Constraints

**Confirmed capabilities**

- Subscribe to feeds by URL, with autodiscovery from a plain site URL.
- Full-text extraction for feeds that publish only a teaser.
- Folders (one level of nesting) and cross-cutting tags.
- Full-text search over titles and article bodies.
- Distraction-free reader with adjustable type size and a persistent "read from source" path.
- Read state, mark-all-read, unread counts.
- OPML import and export.
- Three themes: warm light, sepia reading mode (default), and dark.

**Binding constraints**

- **Single user, permanently.** No accounts, no sharing, no collaboration, no roles. A single password gate is the whole model, and it is the correct amount of machinery.
- **Free-tier hosting.** Any feature must fit inside Vercel Hobby and Neon free-tier limits, including the Hobby restriction that cron jobs run at most once per day.
- **Undecided:** nothing currently outstanding.

## Evidence on Hand

- `rss-reader-spec.md` — the original build brief, still the closest thing to a statement of intent.
- A working, tested implementation (16 API routes, 13 components, migration-versioned schema).
- Real subscriptions verified during development: BBC News and Hacker News (both teaser-only feeds, which is why extraction exists), plus The Verge and Ars Technica (full-content feeds).

**Absences future work must not fill in:** there is no logo, imagery, favicon, or brand asset of any kind. There are no real testimonials, benchmarks, press, or case studies, and none should be invented — there is no audience to show them to.

## Product Principles

1. **One reader, no tenancy.** Every feature is designed for exactly one person. Anything that only makes sense with multiple users is out of scope, not deferred.
2. **The article is the destination.** Extraction is the core mechanism, not a convenience feature. Work that improves reading in-app outranks work that improves navigating out of it.
3. **Phone is a peer, not a shrink.** Desktop and phone get equal weight. A phone experience that is merely a narrowed desktop layout is unfinished work, not a responsive breakpoint.
4. **Honest about partial content.** When only a teaser could be retrieved, say so plainly. Never render a summary in a way that reads as the complete article.
5. **Fits the free tier.** Prefer the cheaper architecture when the two are otherwise comparable.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established by the user, and there is no external audience to satisfy.

The existing implementation already clears WCAG AA for body text in all three themes (measured contrast: light 14.6:1, sepia 10.2:1, dark 16.7:1 muted text 5.2 / 4.8 / 7.6:1). That is a floor to hold, not a claim of conformance — future work should not regress it.
