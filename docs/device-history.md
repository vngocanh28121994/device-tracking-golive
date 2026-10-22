# Device handover history

Each device's action menu includes **Lịch sử giữ thiết bị**. The history is shared with authenticated Site visitors and lists immutable handover snapshots, newest first, in Vietnam time.

`device_movements` records the old and new holder, operation, actor identity/name, and timestamp. Holder changes and the history insert run in one D1 batch transaction. The insert reads the old holder inside that transaction so concurrent changes form a consistent chain. Repeating an operation with the same holder adds no movement. Device creation also records its initial holder.

The authenticated history endpoint returns up to 30 records per page, using the increasing movement ID as a stable cursor. Old daily check snapshots are not converted into handovers because they do not identify actual transfer times or actions.

End-of-day checks and Teams reporting have been retired. Their old records are retained in existing tables. The old Teams API returns HTTP 410, and the former MCP report tools return a harmless skipped result without reading a webhook or sending any message.
