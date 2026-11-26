# Mobile browser design plan

Status: design only, November 26, 2026. No application behavior is changed by
this document. The target is the existing website in iOS Safari/Chrome and
Android Chrome, including tablets; a native app is outside scope.

## Recommended direction

Improve the responsive website first and offer an optional **Choose a bird**
answer method. Start with **common family name → species**, with a way to browse
all eligible species directly. Keep typed answers available on every device.
Order and genus can become optional advanced navigation later, not required
knowledge for using a phone.

Do not automatically replace typed recall just because someone has a phone.
Screen size and input capabilities should influence layout and the suggested
control, while the user chooses the answer method. A desktop user may also
prefer selection, and a phone user may prefer typing or dictation. The first
mobile release need not implement taxonomy menus at all: removing automatic
keyboard activation and improving the question layout may solve much of the
immediate friction.

A compact page is useful, particularly on the homepage and launcher. The quiz
photo and its credits are essential content, however, and should not be removed
or cropped merely to make the page shorter.

## What the current code already provides

These are source-inspection findings, not claims of verified device behavior:

- `dist/style.css` already stacks the quiz at narrow widths and includes several
  responsive breakpoints and reduced-motion styling. The site is not starting
  from a desktop-only layout.
- The photo uses `object-fit: contain`, with a 420 px default height and a 330 px
  narrow-layout rule. The image can still consume much of a short phone viewport.
- `nextQuestion()` in `dist/app.mjs` focuses the answer input after each question.
  Whether that opens a software keyboard depends on the browser and gesture,
  but it is a likely source of obscured photos and unwanted viewport movement.
- `/explore` uses horizontally arranged geography lists, with list size 20 below
  the continent level and a sticky continent column. This needs a small-screen
  interaction alternative, not merely smaller fonts.
- The launcher now has month/day controls, a whole-month shortcut, and disabled
  unsupported places. Mobile changes should retain those semantics.
- Photo zoom already uses an in-tab dialog and preserves photo credits. Audio
  questions require playback before scoring becomes available; replay does not
  create another attempt. These behaviors should survive the redesign.
- The review workspace already stacks columns, but its annotation SVG has a
  950 px minimum width. Authoring arrows with a finger is a separate usability
  problem from taking a quiz.
- Catalog records provide stable species IDs, scientific names and family labels.
  Common serving records also have numeric `taxonOrder`. They do **not** expose
  explicit order and genus hierarchy fields. Numeric taxonomic sort order is
  not the bird's taxonomic order.
- English/Colombian Spanish message bundles and a language selector exist.
  Translating the interface does not yet translate the species catalogs or add
  Spanish answer aliases.
- Statistics distinguish visual/audio practice, but do not currently distinguish
  typed versus selection-assisted answers.

Relevant source: `pages/index.html`, `pages/explore.html`, `dist/app.mjs`,
`dist/geography-ui.mjs`, `dist/quiz.mjs`, `dist/statistics-history.mjs`,
`dist/style.css`, `dist/geography.css`, and `dist/review.css`. Edit canonical
`pages/` templates and language bundles when implementing; generated HTML is
not the source of truth.

## Answer controls: options and tradeoffs

| Option | Benefit | Cost / limitation | Proposed use |
| --- | --- | --- | --- |
| Typed answer | Preserves recall practice and current fuzzy matching | Software keyboard, spelling and autocorrect friction | Always available; improve its mobile behavior first |
| Family → species | No typing or Latin-name requirement; uses existing family data | Family recognition becomes a prerequisite unless there is a bypass; lists can remain long | First optional selection prototype |
| Direct species list | No taxonomy prerequisite | Large regional lists can require too much scrolling | Bypass with alphabetical navigation and optional search |
| Order → family → species | Smaller lists at each level; useful taxonomy practice | Adds taps and unfamiliar order names; needs hierarchy data | Optional advanced mode after testing |
| Order → family → genus → species | Fine-grained scientific taxonomy navigation | Most demanding; requires scientific-name knowledge and more taps | Defer; never make it the default mobile path |
| Short multiple choice | Few taps; usable without family knowledge | Strong recognition assistance, chance success and distractor-quality problems | Separate later experiment, not silently equivalent to recall |

### Proposed selection flow

1. Offer **Type a name** and **Choose a bird**, using localized labels. On a
   compact touch layout, make the latter easy to discover without forcing it.
2. In selection mode, show common family/group names, with scientific names
   secondary or expandable. Existing examples include “Horneros, chamiceros y
   trepatroncos (Furnariidae)” in Spanish. Do not require users to type a genus.
3. Selecting a family narrows a species list. Include **All birds** and **Back to
   families** so a user who does not know the family can still answer. A quiz
   already explicitly scoped to one family can go straight to species.
4. Offer an alphabetical jump or another typing-free way to traverse a long
   species list. Optional search can help; a search box alone is not a solution
   to the request for no typing. Test whether native selects or a single-level
   list with buttons works better on real devices before building a custom
   nested widget.
5. Selecting a species fills the proposed answer. **Check answer** submits it;
   changing a selection or visiting the wrong branch does not score an attempt.
   Provide a clear selected state to avoid accidental submissions.
6. After grading, use the current feedback, reveal, review and next-question
   behaviors. For audio, retain the requirement to play before submitting.

A single active level with a breadcrumb/back action is preferable to several
permanently open cascading menus on a narrow screen. Retain real keyboard
navigation, labels, focus restoration and screen-reader announcements. Do not
implement the mobile interaction as hover menus.

### Candidate sets and avoiding answer leakage

The menu is an aid to choosing an answer, not an indirect hint revealing it:

- Derive options from a documented, scope-wide candidate set, independent of the
  current question's correct species, actual photo, or chosen recording.
- For a first prototype, use the full playable species pool for the selected
  geography/season/family/lifer settings, not just species drawn for this quiz,
  the remaining question queue, or species not answered yet. Deduplicate by ID.
- For mistake reviews, propose the broader eligible scope as answer choices,
  rather than exposing only the few species scheduled for review. Confirm this
  product rule before implementation.
- Do not silently pick the correct family, prune wrong branches, show a
  correctness warning while navigating, or alter ordering according to the
  current answer. Pruning because the user publicly selected a family in quiz
  configuration is different and expected.
- Public site clues retain their existing explicit on/off behavior; the answer
  picker must not become an undisclosed locality or subspecies hint.
- With one eligible species, selection provides almost no identification test.
  Explain that limitation; do not inflate historical recall statistics.

Selection grading should compare stable species IDs directly. Keep fuzzy name
matching for typed answers. Common-name collisions, taxonomy splits, accepted
name aliases and renamed species need explicit tests; display-name text must
not become an identity key.

## Statistics and the learning model

Choosing from a visible list tests recognition and supplies hints that typed
recall does not. It can be valuable practice, but mobile versus desktop is not
the meaningful statistical distinction: **answer assistance** is.

Proposed first experimental selection mode: show session results but exclude
assisted sessions from existing historical accuracy and mistake-review totals,
with a clear explanation, until we choose the comparison policy. Keep the answer
method fixed for a session initially. This avoids contaminating established
history without building a larger statistics system just to try a control.
Typed mobile sessions continue to count exactly as typed desktop sessions do.

If selection becomes a permanent feature, decide whether to maintain separate
aggregate counters/latest comparisons by answer method, in addition to the
existing photo/audio dimension. A method preference or quiz option alone does
not implement that distinction: browser aggregates, API validation, RDBMS
aggregates, imports, latest-result summaries and review selection all need a
coordinated policy/migration. Preserve unknown legacy history as typed/legacy
according to an explicit compatibility rule. No per-question archive or grading
platform is needed.

## Responsive layout and page simplification

Prefer responsive CSS and feature/capability checks over a hardcoded mobile
user-agent switch. Account for narrow desktop windows, touch laptops, tablets
with keyboards, and orientation changes. Width, available height and coarse
pointer/hover capabilities are signals, not proof of what a user wants.
[MDN's browser-detection guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent)
and [W3C media-query guidance](https://www.w3.org/TR/mediaqueries-5/#pointer)
support this approach.

### Homepage and navigation

- Keep one prominent entry to `/explore`, a compact header and access to language,
  account, statistics and the existing `/quiz` Practice link.
- Reduce decorative hero height, large headings, generous margins and marketing
  text before removing functional controls. Put secondary explanations behind
  accessible disclosure controls, not inaccessible hover tooltips.
- On small screens, consider a plainly labelled navigation disclosure. Keep the
  language selector discoverable and test longer Spanish text and email names.
- Consider a user-controlled compact presentation if responsive layout alone
  does not meet testers' needs. Avoid a second mobile site, separate route tree,
  or platform-specific fork of quiz logic.

### Geography launcher

- Show one geography level at a time on compact screens; keep a visible path and
  back action. Retain the current horizontal lists on larger screens if useful.
- Keep unsupported geographies distinguishable and unselectable, with a touch-
  accessible explanation. A `title` hover tooltip is insufficient on a phone.
- Avoid forcing a 20-row list height on a short viewport. Test the current native
  listbox behavior on each target browser; do not assume all render `size=20`
  like desktop Chrome. Long hotspot lists need filtering and bounded rendering.
- Keep month/day selection and the whole-month shortcut, with no year. Verify
  dependent day counts, February 29 and automatic New Year wrapping using touch
  and screen readers. Do not replace them with a travel-calendar widget.
- Preserve selected scope and settings through back navigation and orientation
  changes. Do not restart quiz generation merely because a breakpoint changes.

### Question and result pages

- Put the photo/player, answer control and main action in a clear vertical flow.
  The keyboard should open only when the user chooses to type. Preserve desktop
  efficiency without stealing focus from mobile readers or audio controls.
- Use available viewport height rather than a single fixed photo height. Account
  for browser toolbars, software keyboard, landscape mode and safe-area insets.
  Test dynamic viewport units with suitable fallbacks. Any sticky action area
  must not obscure the picture, credits, help, selected answer or browser UI.
- Keep **Check**, **Reveal**, **Next**, **Retry** and unscored skip distinct, with
  large, separated targets. Disable duplicate submissions during transitions.
- Result pages should show the summary/actions first and defer long media lists.
  Do not eagerly load a recording for every result row. Keep credits wherever
  a photo is displayed, including thumbnails and zoom views.
- Keep normal browser zoom. For photo zoom, evaluate touch pan/pinch inside the
  existing dialog, an easy close target, orientation changes and correct focus
  return. Gestures must not accidentally answer, advance or trap page scrolling.

### Statistics, dialogs and review authoring

- Reflow site/family summaries as readable rows/cards; keep sort controls usable.
  Scroll a genuinely tabular region independently only where necessary. Do not
  make the entire page scroll horizontally to read ordinary labels.
- Consent, import, help and language-change dialogs must fit the viewport, scroll
  internally when needed, support Escape/back appropriately, and restore focus.
  Popover and dialog support need feature checks and a usable fallback.
- Taking a quiz and viewing ID tips are in the first mobile scope. Arrow authoring
  is lower priority: a wide SVG and precise point placement need a separate touch
  design. Preserve approved tip viewing; do not silently publish a misplaced
  arrow because a finger obscures its target. Validate touch coordinates against
  the uncropped image, including zoom and orientation transforms, before enabling
  editing as a supported mobile workflow.

## Images, bandwidth and media behavior

Reduce decoration and unnecessary transfers, not the detail required to identify
an unfamiliar bird. Reuse current direct media references and attribution.

- Audit actual transfer sizes and request timing on a throttled connection.
  Hiding a hero with CSS does not guarantee its image is not downloaded. Defer
  optional image source assignment or use a suitable responsive delivery path.
- Request a smaller photo rendition only through a verified provider-supported
  URL/metadata path. Keep an explicit higher-resolution zoom option. Never crop
  away identification features to fill a phone-shaped frame.
- Lazy-load offscreen result photos and defer inactive-page media. Bound any
  look-ahead fetching; do not preload an entire all-species quiz or whole audio
  catalog. Keep retry/backoff behavior gentle with Cornell.
- Consider a user-selected lower-data presentation; treat automatic reduced-data
  hints as optional enhancements after checking support. Do not assume a small
  screen implies a slow connection, or vice versa.
- Retain explicit audio Play/Replay. Handle rejected playback promises, slow
  loads, unavailable recordings, Bluetooth/headphone changes and interruptions.
  Do not rely on automatic playback after asynchronous loading or Next: autoplay
  policy varies and can require a user gesture.
  [MDN documents media autoplay restrictions and failure handling.](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- Pause appropriately when leaving the question, backgrounding, or changing
  modality. Returning should not automatically play, grade, skip or increment an
  attempt. A pause/interruption is not an incorrect answer.
- Offline media downloads, service-worker caches, installable/PWA behavior and
  background playback are separate projects. Do not promise offline quizzes or
  cache Cornell media for offline use as part of this layout work.

## Reliability, accessibility and privacy

Phones frequently lock, switch apps, change networks and discard background
tabs. Decide what an interrupted quiz means before promising resume support.
For an initial release, keep the current completed-quiz persistence model and
avoid silent grading on interruption. A refresh or OS-discarded tab can still
lose an unfinished in-memory quiz. Later, an explicitly designed bounded active-
session snapshot could help, but it needs storage/privacy semantics separate
from the five-quiz aggregate policy; do not store question histories by accident.

Test Cognito sign-in return, language preference, account switching, sign-out,
statistics synchronization/retry and guest consent on actual target browsers.
Browser data is origin-specific and may be cleared or unavailable; logged-in
history should remain authoritative. Layout changes must not clear storage or
relax server permissions. No AWS configuration changes are assumed by this plan.

Use semantic controls, visible labels and error messages, logical focus order,
keyboard support and VoiceOver/TalkBack testing. Preserve reduced motion, text
zoom, sufficient contrast and non-color-only state cues. Propose approximately
44 × 44 CSS px touch targets for primary actions; WCAG 2.2's AA target-size rule
is 24 × 24 CSS px with specified exceptions, so the larger design target should
not be described as the universal minimum.
[W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
explains the distinction. Ordinary content should reflow at 320 CSS px; images,
diagrams and genuinely two-dimensional tables require separate treatment.
[W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
provides the relevant criteria and exceptions.

All new controls, instructions, hints and errors belong in both message bundles.
Test long Colombian Spanish labels. Species selection by ID does not depend on
English spelling, but showing Spanish species names still requires a separate,
versioned catalog/alias decision; interface translation alone is not that feature.
No device fingerprinting or new analytics is needed to evaluate this work.

## Taxonomy work if deeper navigation is pursued

Family → species can reuse current catalogs and localized family labels. Deeper
navigation requires a canonical, versioned mapping of species ID to family,
order and, if offered, genus. Obtain it from the supported taxonomy source and
align it with the release used by the serving packages. Do not infer order from
family spelling, taxonomic position numbers or ad hoc name matching.

Validate splits/lumps, alternative names, unmapped taxa, duplicate common names
and legacy Colombia records. Provide a usable unclassified/all-species path when
metadata is incomplete. Scientific hierarchy keys stay stable while group labels
are localized. Extending the package schema requires coordinated exporter,
converter, reader and validator compatibility; a huge EBD rescan should not be
necessary merely to attach a small taxonomy lookup. This is a later decision,
not a prerequisite for responsive layout or the first family picker.

## Proposed work sequence and TODOs

All items below are unimplemented proposals, not additional authorized work.

### P0: establish the baseline

- [ ] Record current flows on real target phones and an iPad, in both languages.
- [ ] Audit keyboard/focus, overflow, dialog/zoom, touch targets and native selects.
- [ ] Measure initial page, active question and results-page media/network costs.
- [ ] Confirm the answer-control prototype and assisted-statistics policy before
      changing grading or persistent aggregates.

### P1: mobile usability without changing the learning model

- [ ] Adjust narrow-screen header, homepage, launcher and question layout.
- [ ] Replace compact-screen multi-column geography navigation with one level.
- [ ] Remove involuntary answer-input focus on compact/touch workflows; retain
      deliberate keyboard access and a reliable visible submit action.
- [ ] Make credits, audio, zoom, help, consent and error recovery touch-accessible.
- [ ] Defer decorative/offscreen media and preserve full identification detail.
- [ ] Verify lifecycle interruptions and no duplicate scores or statistics loss.

### P2: optional answer selection experiment

- [ ] Prototype family → species and direct-species browsing using stable IDs.
- [ ] Measure taps, time to answer and mistakes with novice/experienced testers;
      collect feedback manually before adding telemetry.
- [ ] Use scope-wide candidate sets with no per-question taxonomy hints.
- [ ] Confirm selections explicitly and preserve typed answer/fuzzy-match behavior.
- [ ] Implement the agreed session-level assistance/statistics policy end to end;
      do not mix assisted historical results into current recall totals silently.
- [ ] Externalize messages and add screen-reader/keyboard and grading regressions.

### P3: decide based on testing

- [ ] Consider optional order/genus navigation only if testers find it useful.
- [ ] Revisit a low-data preference, bounded resume snapshot and touch arrow editor
      separately, with their storage/data-source implications documented.
- [ ] Decide whether permanent assistance-aware aggregate statistics are warranted.

## Validation and release checklist

Test iOS Safari and iOS Chrome explicitly, Android Chrome on at least one real
phone, and iPad Safari in portrait/landscape with and without a hardware keyboard.
Record actual OS/browser versions used at implementation time; do not infer
identical behavior from browser branding or assume one iOS test covers both.
Use desktop responsive emulation for fast checks, not as the whole test plan.

Include narrow widths around 320/360/390/430 CSS px, tablet widths, short
landscape viewports, enlarged text, normal/reduced motion, VoiceOver/TalkBack,
slow/intermittent connections, software keyboards and safe-area devices.
Cover guests, signed-in users, both languages, photo/audio, regular/review,
all-species quizzes, family filtering, unsupported locations, leap day/New Year,
zoom/credits, storage consent/import and account synchronization.

Acceptance should include:

- [ ] Ordinary pages have no unintended horizontal overflow or obscured actions.
- [ ] No keyboard appears until typing is requested; the photo/player stays usable.
- [ ] Every question can be answered, revealed, retried or skipped using touch.
- [ ] Selection does not require knowing order/genus or disclose the correct branch.
- [ ] Back, rotation, zoom and background/foreground transitions do not grade twice,
      switch answer methods unexpectedly or restart a question silently.
- [ ] Credits/source links remain available whenever media is displayed.
- [ ] Unavailable media remain unscored; user content and permissions remain intact.
- [ ] Desktop typed quizzes, legacy Colombia practice and existing history remain
      compatible; assistance is clearly identified and treated as agreed.

Implement on `dev`, update appropriate unit/integration checks, and commit/push
before a separately authorized staging deployment. Test with real phone users in
staging before production promotion.
