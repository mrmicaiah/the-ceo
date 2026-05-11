# Design

The visual and experiential specification for The CEO. Read this before any UI work. Update this when the design evolves — never let the code drift from the doc, and never let the doc drift from the code.

---

## The feeling

The CEO is a **private office.** Not a SaaS dashboard. Not a chat app. An office where a small staff works alongside you, and where the work has weight. The interface should feel like reading correspondence at a good desk — calm, considered, the slightest bit formal, with warmth in the details.

**Reference adjacencies** (to triangulate from, not copy):

- The compositional restraint of *The New York Times* article pages
- The warmth and tactility of Field Notes / analog stationery
- The structural confidence of Linear
- The editorial typography of Substack at its best

**What this is not:** Notion. Vercel marketing. Stripe dashboards. ChatGPT. Anything purple-gradient-on-white. Anything that reads as "another AI app."

---

## Typography

Two faces, both with character.

### Display — the CEO's voice

**Fraunces** — variable weight, optical sizing, a touch of editorial swagger.

Used for: the CEO's name, project names, briefing section headers, the app title, speaker names in chat. Set with generous tracking. Never cramped.

### Body — the working text

**Geist** (or **Mona Sans** as fallback if Geist isn't available).

Used for: all chat content, UI controls, briefing body text, everything that isn't a heading or a name.

Base size: 16px minimum. Line-height: 1.6 minimum. Reading comfort over density.

### Monospace — used sparingly

**JetBrains Mono** for code blocks in chats, timestamps, IDs, anything tabular.

**No third font beyond these.** Two faces plus a mono. If a fourth feels needed, the design is drifting.

---

## Color

A warm, restrained palette. Not gray. Not white. Paper.

| Role | Value | Notes |
|------|-------|-------|
| Background | `#F8F5EE` | Warm off-white. Not pure white. Pure white reads as software; this reads as paper. |
| Surface | `#F2EDE2` | One shade warmer than background. Used for chat bubbles (no bubbles, but: the briefing card, rails when distinct). |
| Ink (primary text) | `#1C1A17` | Deep warm near-black. Not `#000`. Black is harsh; ink has presence. |
| Secondary text | `#5C564C` | Softer warm gray. Plenty of contrast retained. |
| Accent | `#1E3A5F` | Deep ink-blue. Fountain-pen-on-paper. Used **sparingly.** |
| Divider | `#E5DFD2` | Subtle rule color. Hairline only. |

**Accent discipline:** the accent appears only for moments that earn it — the CEO's name in the rail, the active project indicator, the cast-spawn affordance ("Open Nora chat →"), the user's speaker name in chat. Not on every hover state. Not on every button. When you see the ink-blue, it should mean something.

**Dark mode:** later. v0 ships light-mode-only. A proper "private office at night" treatment is its own design pass.

---

## Layout

Three panes. Proportions matter.

### Left rail — ~260px

- Narrow but not cramped.
- The app title at the top: **The CEO** in display type, with a quiet subhead beneath in body: *Chief Executive Orchestrator*. The tagline lives there as a detail, never spoken aloud.
- The CEO sits at the top of the chat list as its own item, slightly separated from the project list by whitespace and a subtle hairline rule.
- Projects below, as a list. Just typography — no icons next to project names. Names breathe.
- The active project is indicated by a 1px vertical accent-color bar on the left edge of its row. No pills. No filled backgrounds.

### Main pane — flexible

- The current chat (CEO or employee).
- Chat messages are **not bubbles.** They're paragraphs of correspondence:
  - Speaker name in display type at the left margin
  - Message body in body type below it
  - Generous whitespace between messages
- User vs. assistant distinguished by the speaker's name styling (user's name in accent color is one option; an indicator in the left margin is another). **Never** by colored bubbles on opposite sides of the pane.
- Reads more like a transcript than a messaging app.

### Right rail — ~340px

- Visible by default when the user is in a project chat.
- Collapsible on small screens.
- Renders the project's briefing as a small card-like document:
  - **Goal**
  - **State**
  - **Next move**
  - **Why**
- Section labels in display type. Bodies in body type.
- When the briefing changes, the update animates in subtly — soft fade-and-shift, not a flash.

---

## Chat composition

- **The composer** at the bottom of the main pane is restrained. A single text field, no toolbar of icons. A thin rule above it. A small "Send" affordance — could even just be a return-key hint. The composer should look like a place to think, not a Slack input.
- **Cast-spawn affordance.** When the CEO suggests casting an employee, it appears **inline in the CEO's message** as a small framed affordance:
  - A thin-ruled box (1px hairline in divider color)
  - The recommended employee's name in display type
  - A short one-line reason in body type
  - A single button labeled like "Open chat →" in the accent color
  - Not a notification. Not a modal. Part of the conversation.
- **Streaming responses.** Text appears progressively. No blinking cursor. No "thinking" spinner. The text just flows in.

---

## Microdetails that matter

These are the small things that take the design from "competent" to "remembered."

- A barely-perceptible noise/grain overlay on the background. Adds tactility, breaks digital sterility. Subtle enough that it's felt more than seen.
- Real letterspacing on the display type. Not browser default — tuned specifically.
- Real attention to vertical rhythm. Text sits on a baseline grid, or close enough that the eye reads it as deliberate.
- Spacing between elements is intentional, not Tailwind defaults.
- Loading states for slow operations (briefing regeneration after a wrap-chat) should be **editorial in feel** — a slow shimmer on the briefing card, or a typeset *"updating briefing"* line that fades. Never a spinner.
- All hairline rules are 1px in the divider color. No 2px borders. No "outline" Tailwind utility defaults.
- Transitions are slow and gentle — 200–400ms with easing, not 100ms snaps.

---

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS** with extended config:
  - Custom font families (`display`, `body`, `mono`)
  - Custom color palette (the values above as semantic names: `bg`, `surface`, `ink`, `muted`, `accent`, `divider`)
  - Custom spacing scale where useful
- **Motion** (formerly Framer Motion) for the few real animations
- **No component library by default.** No shadcn, no MUI, no Radix-with-default-styling. We build the components we need.
  - **One exception:** if we need a specific primitive (an accessible dropdown, an autosizing textarea), use **Radix Primitives unstyled** and style them ourselves.
- **Deployment:** Cloudflare Pages, configured to talk to the existing Worker via a fetch base URL.

---

## Tone of voice in the UI

The UI's own copy — placeholders, empty states, button labels — should match the CEO's voice. Direct. Confident. Slightly formal. No exclamation marks. No "Oops!" No "Let's get started!"

Examples:

- Empty composer placeholder: *"Write a message"* — not *"Type something..."*
- Empty project list: *"No projects yet. Open the CEO to start one."* — not *"You have no projects 😊"*
- Wrap chat button: *"Wrap this chat"* — not *"End conversation"*
- Send affordance: a small *"Return ↵"* hint, or a single word *"Send"*

---

## What "build it right" means

When in doubt, the test is: **would a serious person be happy reading correspondence in this office?**

Not "would a developer like this UI." Not "would this win a Dribbble award." Would the work feel like it has weight here. That's the bar.
