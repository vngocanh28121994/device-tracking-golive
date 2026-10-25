# Device handover history

Each device's action menu includes **Lịch sử giữ thiết bị**. The history is shared with authenticated Site visitors and lists immutable handover snapshots, newest first, in Vietnam time.

`device_movements` records the old and new holder, operation, actor identity/name, and timestamp. Holder changes and the history insert run in one D1 batch transaction. The insert reads the old holder inside that transaction so concurrent changes form a consistent chain. Repeating an operation with the same holder adds no movement. Device creation also records its initial holder.

The authenticated history endpoint returns up to 20 records per page, using the increasing movement ID as a stable cursor. The popup replaces each page instead of appending an unlimited list, groups records by Vietnam calendar day, and keeps navigation outside the scroll region. Optional `from` and `to` filters include entire Vietnam calendar days and are validated server-side. Filtering resets pagination.

Old daily check snapshots are not converted into handovers because they do not identify actual transfer times or actions.

End-of-day checks and Teams reporting have been retired. Their old records are retained in existing tables. The old Teams API returns HTTP 410, and the former MCP report tools return a harmless skipped result without reading a webhook or sending any message.

## Playful handovers

Receive and lend confirmations enter a short catch-the-device game. The basket carries the resolved recipient name, including manually entered borrowers. A miss, retry, cancellation, or hidden in-progress game does not call the inventory mutation. Only a successful catch calls the existing handover API. The game is a UI interaction, not an authorization mechanism; server authentication and input validation still govern mutations.

Pointer, touch, arrow keys, Home/End, and visible directional buttons control the basket. Reduced-motion users get a static alignment challenge with the same collision check; users may also select it manually. If saving fails after a catch, retry saving without repeating the game. Animation frames and pending celebrations stop when the component is closed.

Run the small collision check with `node --experimental-strip-types tests/handover-game.test.mjs`.
