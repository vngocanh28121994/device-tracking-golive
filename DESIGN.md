# Device Club UI

The interface is a Vietnamese team tool for tracking individual devices and handovers. Keep the established warm background, lavender identity, and friendly tone. Prioritize legible inventory rows and obvious actions.

## Shared visual rules

- Tokens live in `app/globals.css`: warm canvas `#f8f7f4`, white surfaces, ink `#302840`, muted text `#72697f`, purple action `#7145bb`, lavender selection `#f1eafb`.
- One sans family, with 13–14px controls/body, 12px supporting text, and 23–28px page headings. Avoid tiny or low-contrast labels.
- Use Lucide for interface icons. Android devices use compact brand marks: Samsung navy, Xiaomi/Redmi/Poco orange, Oppo green; unknown brands use the shared phone icon. Preserve the iPad mark.
- Use borders for panels and soft offset shadows only for overlays. Controls use 9–10px corners; panels use 14–16px.
- Primary actions and selected navigation use purple. Android category uses a muted green label. Orange is reserved for the brand mark and the existing total-devices summary.
- Inventory actions always use a visible, labeled ellipsis button on desktop and mobile. Mobile rows retain device name, category, holder, and action.
- Dropdowns use the shared `StyledSelect`; keep the borrower placeholder “Chọn user có sẵn”.
- Popups isolate keyboard focus, support Escape, and restore focus on close. Inputs on mobile are 16px to avoid viewport zoom. Respect reduced motion.
- Do not bring back quantity, physical condition, or daily check-in controls. Device history records handovers and remains in each device's action menu.

History uses 20 records per page with newer/older navigation outside its scroll region, groups by Vietnam calendar day, and provides an optional date-range form. Never accumulate all pages in the DOM.

Receive/lend confirmations use a short catch-the-device interaction. The basket always carries the resolved recipient name. Only a catch submits a handover; misses and cancellations leave records untouched. Include keyboard/touch controls and a static alignment mode for reduced motion.

## Compact workspace refinement

- Open directly to Kho thiết bị. Navigation contains inventory, Tracking Golive and profile; do not reintroduce an overview or repeated usage/unknown-holder statistics.
- Holder initials and deterministic pastel colors come from `HolderIdentity`, shared by the inventory and device popup. The name remains readable next to the avatar.
- Account avatars use `UserAvatar`, including profile previews and account selectors. Show an assigned work role in a small label at the lower-right of the avatar; keep its image clipped separately so the role stays visible. Unassigned accounts and manual holders have no role label.
- Device dialogs place the icon beside the device name and use the same holder strip and left-back/right-primary footer layout.
- The game gets a wider stage with fixed surrounding controls. Basket tilt acknowledges movement; a short confetti burst marks a catch, and a restrained wobble marks a miss. Reduced motion skips the decorative effects.

## Mobile workspace

- At widths up to 900px, use the navigation drawer and stack golive rows as cards. Show ticket key, status, title, tester and full-width device checklist without horizontal table scrolling. Manual releases show tester, status and checklist.
- Keep search visible; mobile cards keep the default tester A–Z order without a sort picker (desktop sorts by column header). Column filters and release actions expand from labeled buttons.
- Device rows and interactive controls need at least 44px touch targets. Form inputs and select triggers use 16px text; dialogs fit inside the viewport and scroll vertically.
- Role assignment stacks each account above its role selector. Wrap long names, emails and fixVersions; preserve desktop tables above the mobile breakpoint.
- Team managers add members by email in the account role panel. Use an inline labeled email form, stack the input and action on mobile, and put emails awaiting a saved profile behind a disclosure. Membership is checked on the server before any data access.

## Dark mode

- A toggle in the top bar switches light/dark; the choice is saved per browser, and the first visit follows the OS setting. `app/layout.tsx` applies it before first paint.
- Tokens remap under `:root[data-theme="dark"]`. Elevation is explicit: canvas `#131017` < card surface `#1c1822` < raised `#262030` with a visible border for dialogs, popovers and toasts (shadows alone do not read on dark).
- `--accent` is the lighter `#b393f0` so accent text passes 4.5:1; solid accent fills (primary buttons) use the darker `#7a4fcc` under white text.
- Literal colours get dark counterparts from `scripts/generate-dark-theme.py` (rerun after adding one); hand-tuned dark rules go after the generated block. Check contrast in both themes after colour changes.
