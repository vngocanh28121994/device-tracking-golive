// Lọc khối "Cần lưu ý" theo QE và theo loại lý do.
import assert from "node:assert/strict";
import { ATTENTION_KIND_LABELS, ATTENTION_KINDS, attentionList, filterAttention } from "../app/lib/golive-acceptance.ts";

const item = (ticketId, issueKey, assignee, kinds) => ({
  id: ticketId, ticketId, issueKey, assignee,
  reasons: kinds.map(kind => ({ kind, text: kind + " của " + issueKey })),
});

const anh = item(1, "DIP-1", "Nguyễn An", ["cannot-test", "not-notified"]);
const binh = item(2, "DIP-2", "Trần Bình", ["risk-accepted"]);
const nobody = item(3, "DIP-3", "  ", ["old-build", "waived"]);
const anhAgain = item(4, "DIP-4", "Nguyễn An", ["waived"]);
const items = [anh, binh, nobody, anhAgain];
const all = { assignee: "__all__", kind: "__all__" };

// "__all__" ở cả hai ô: không lọc gì, giữ nguyên thứ tự đầu vào.
assert.deepEqual(filterAttention(items, all), items);
assert.deepEqual(filterAttention([], all), []);

// Theo tên QE: khớp chính xác, mọi ticket của người đó, đúng thứ tự.
assert.deepEqual(filterAttention(items, { ...all, assignee: "Nguyễn An" }), [anh, anhAgain]);
assert.deepEqual(filterAttention(items, { ...all, assignee: "Nguyễn" }), []);

// "__none__": chỉ ticket chưa có người test (rỗng hoặc chỉ khoảng trắng).
assert.deepEqual(filterAttention(items, { ...all, assignee: "__none__" }), [nobody]);
assert.deepEqual(filterAttention([item(9, "DIP-9", "", ["waived"])], { ...all, assignee: "__none__" }).length, 1);

// Theo từng loại lý do: giữ ticket có ít nhất một lý do thuộc kind đó.
assert.deepEqual(filterAttention(items, { ...all, kind: "cannot-test" }), [anh]);
assert.deepEqual(filterAttention(items, { ...all, kind: "not-notified" }), [anh]);
assert.deepEqual(filterAttention(items, { ...all, kind: "risk-accepted" }), [binh]);
assert.deepEqual(filterAttention(items, { ...all, kind: "old-build" }), [nobody]);
assert.deepEqual(filterAttention(items, { ...all, kind: "waived" }), [nobody, anhAgain]);

// Hai điều kiện kết hợp AND.
assert.deepEqual(filterAttention(items, { assignee: "Nguyễn An", kind: "waived" }), [anhAgain]);
assert.deepEqual(filterAttention(items, { assignee: "Trần Bình", kind: "waived" }), []);
assert.deepEqual(filterAttention(items, { assignee: "__none__", kind: "old-build" }), [nobody]);

// Lọc không cắt bớt reasons của ticket còn lại: vẫn đủ mọi lý do.
assert.deepEqual(filterAttention(items, { ...all, kind: "cannot-test" })[0].reasons, anh.reasons);
assert.deepEqual(filterAttention(items, { ...all, kind: "old-build" })[0].reasons.length, 2);

// ATTENTION_KINDS phủ đủ mọi giá trị AttentionKind mà attentionList có thể sinh ra, và mỗi kind có nhãn.
const produced = attentionList({
  tickets: [{
    id: 1, issueKey: "DIP-1", assignee: "Nguyễn An",
    skippedAt: "2026-11-09T10:00:00.000Z", skipKind: "cannot-test", skipReason: "thiếu máy", skipNotified: false,
    failedReason: "", webStatus: "cannot-test", webReason: "chưa có env", webNotified: false,
    appBuildId: 1, doneAt: "2026-11-09T11:00:00.000Z",
  }],
  risks: [{ ticketId: 1, phase: "web", reason: "rủi ro thấp", acceptedBy: "QEM" }],
  waived: [{ ticketId: 1, deviceName: "iPhone 12", waivedReason: "máy hỏng" }],
  currentBuildId: 2,
}).items[0].reasons.map(reason => reason.kind);
assert.deepEqual(new Set(produced).difference(new Set(ATTENTION_KINDS)), new Set());
assert.deepEqual(new Set(ATTENTION_KINDS).difference(new Set(produced)), new Set());
assert.deepEqual(ATTENTION_KINDS.length, new Set(ATTENTION_KINDS).size);
for (const kind of ATTENTION_KINDS) assert.ok(ATTENTION_KIND_LABELS[kind], "thiếu nhãn cho " + kind);
assert.deepEqual(Object.keys(ATTENTION_KIND_LABELS).sort(), [...ATTENTION_KINDS].sort());

console.log("golive-attention: ok");
