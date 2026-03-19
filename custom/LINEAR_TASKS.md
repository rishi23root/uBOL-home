# Ad Blocker Extension - Final Task List

**Last updated:** 2026-02-25

This document lists all active tasks to do, after Linear audit (canceled/duplicate issues excluded).

---

## Linear Updates Applied

| Action | Issue | Result |
|--------|-------|--------|
| Done | EXT-12 (partial) | Popup UI redesign - 3 octagon layers, bubbles, animation when ON |
| Done | EXT-19 | patch-scripting-manager.js - matchOriginAsFallback=false fixes sandbox error |
| Canceled | EXT-18 | Keep "adwarden" per team feedback (not adswarden) |
| Duplicate | EXT-22 | Merged into EXT-12 (HTML spacing fix) |
| Updated | EXT-12 | Added HTML overlay fix scope, merged EXT-22 |
| Updated | EXT-25 | Added clarification questions |
| Updated | EXT-21 | Added acceptance criteria placeholder |

---

## Tasks to Do (Prioritized)

### Phase 1 - Bug Fixes (Do First)

| # | ID | Title | Status | Notes |
|---|-----|-------|--------|-------|
| 1 | **EXT-12** | Rebrand completely and remove any ref of U-block | In Progress | ✅ uBlock removed from About, descriptions. ✅ Popup UI redesign (octagon layers, bubbles, animation). ❌ HTML overlay/iframe extra height still pending |
| 2 | **EXT-19** | Fix permission issue | **Done** | patch-scripting-manager.js: matchOriginAsFallback=false avoids sandbox error on YouTube Shorts |

### Phase 2 - Dashboard

| # | ID | Title | Status | Notes |
|---|-----|-------|--------|-------|
| 3 | **EXT-14** | Dashboard view for admin control | In Review | Active users, notifications CRUD, platform-specific ads (EXT-15 canceled - scope may need adjustment) |
| 4 | **EXT-20** | Need to add in dashboard | Todo | Browser & OS, Export data (CSV) |

### Phase 3 - Features

| # | ID | Title | Status | Notes |
|---|-----|-------|--------|-------|
| 5 | **EXT-13** | Detect target audience | In Review | URL-based targeting, local only, API: block_ads/{sha256} |
| 6 | **EXT-21** | Feature request (analytics, user persona) | In Progress | Domain-based persona, analytics, targeted ads - needs acceptance criteria |

### Phase 4 - Defer Until Clarified

| # | ID | Title | Status | Notes |
|---|-----|-------|--------|-------|
| 7 | **EXT-25** | Need to create a proton mail | Todo | Purpose unclear - support/signup/other? Add details before implementing |

---

## Excluded (Done / Canceled / Duplicate)

| ID | Title | Status | Reason |
|----|-------|--------|--------|
| EXT-9 | fork ublock repo | Done | - |
| EXT-19 | fix permission issue | Done | patch-scripting-manager.js - no scriptlets in about:blank |
| EXT-10 | add notification feature | Done | - |
| EXT-11 | setup supabase for the codebase | Canceled | - |
| EXT-15 | platform specific html injection | Canceled | - |
| EXT-16 | inject scripts | Done | - |
| EXT-17 | update extension for API endpoints | Done | - |
| EXT-18 | update project name to adswarden | Duplicate/Canceled | Keep adwarden per feedback |
| EXT-22 | html spacing issue | Duplicate | Merged into EXT-12 |

---

## Summary

**Active tasks:** 6 (EXT-12, EXT-14, EXT-20, EXT-13, EXT-21, EXT-25)

**Recommended order:** EXT-12 → EXT-14 → EXT-20 → EXT-13 → EXT-21 → EXT-25 (after clarification)
