name: frontend-design
description: Design guidance for public/ (UI, typography, layout). Downloaded from Anthropic skills repository.
---
# Frontend Design

## When to use
When working on the `public/` folder — UI improvements, typography adjustments, layout changes, or any visual design decisions for the AfterShow browser interface.

## How it works here
The frontend is in `public/` and consists of:
- **index.html** - Main template served on `/`, `/movies`, `/series`, and `/search`. Contains the HTML structure and references to Tailwind CSS and the embedded CSS in `admin.js`.
- **404.html** - Error page served for unmatched routes.
- **CSS** - Inline `<style>` block in `admin.js` (also served as `/brand.css` on Vercel). Uses CSS custom properties for theming (--bg, --fg, --ac, etc.) and Font Inter/Fraunces.
- **Icons** - `/icon.svg` used as favadmin and admin dashboard logo.
- **JavaScript** - Vanilla browser JS that consumes the Express API (`/api/catalogue`, `/movie/:token`, etc.).

### Design patterns already in use
- **CSS custom properties** for theming — root variables defined in the admin CSS for easy dark/light mode adaptation.
- **Responsive layouts** using `clamp()` for fluid typography and `max-width` constraints for cards.
- **CSS Grid/Flexbox** for layout of dashboard components, provider cards, and link listings.
- **Tailwind CSS** is not explicitly listed as a dependency but the code references `brand.css` — check if Tailwind is configured or if custom CSS is used.
- **Accessibility** — focus-visible styles, aria-live regions for live alerts, semantic HTML structure.

### Rules for frontend changes
- Match the existing code style: CSS custom properties, `clamp()` for fluid sizes, Fraunces/Inter font imports.
- Do not add new dependencies without asking — the project uses minimal deps.
- Keep the inline CSS in `admin.js` consistent with any external `/brand.css` file.
- Ensure any new pages/sections work with the existing navigation structure (home, movies, series, search).
- Test UI changes visually — run `npm start` and browse to `http://127.0.0.1:5050`.
- Maintain the dark color scheme (`--bg` dark, `--fg` light) unless a deliberate light-mode change is intended.
- Poster images from catalogue sites should be filtered through `posterUrl()` in `sources.js` to remove isaidub/moviesda watermarks.

## Downloaded skill
This skill is downloaded from Anthropic's public skills repository on GitHub. Copy the `frontend-design` folder to `.opencode/skills/frontend-design/`. OpenCode also reads from `.claude/skills/` and `.agents/skills/`, so those paths work too.

## How to use this skill
Load this skill before making any UI changes to `public/`. It provides the design vocabulary and constraints that the AfterShow frontend follows, helping you make changes that feel consistent with the existing codebase.
