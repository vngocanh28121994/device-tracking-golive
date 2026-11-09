# Requirement: Tách tab Statistic thành "Bản golive" và "QE"

| | |
|---|---|
| Màn hình | Statistic (`?tab=statistic`) |
| Người dùng | Role `Manager` và `QEM` (quyền hiện tại của Statistic) |
| Trạng thái | Đã chốt, sẵn sàng dev |

## 1. Mục tiêu

Manager cần đánh giá QE qua nhiều đợt golive. Màn Statistic hiện chỉ có số liệu theo từng đợt.

1. Đưa toàn bộ nội dung Statistic hiện tại vào tab **"Bản golive"**, giữ nguyên hành vi.
2. Thêm tab **"QE"**: mỗi QE một dòng, gồm khối lượng, tốc độ và số ticket failed, lọc theo thời gian, sort được theo cột.
3. Bắt đầu ghi lại lịch sử ticket failed, vì hiện dấu failed bị xoá khi ticket được test lại.

## 2. Ngoài phạm vi

- Không có điểm tổng, trọng số hay thứ hạng 1-2-3.
- Không có chỉ số độ khó ticket, giờ bắt đầu test, hay giờ làm việc thực tế (dữ liệu không có).
- Không có bộ lọc theo từng đợt golive, không xuất CSV, không có push notification mới.
- Không đổi quy tắc Done, quy trình test, hoặc quyền đánh dấu ticket.

## 3. User stories

- Là Manager, tôi xem số liệu từng đợt golive như trước, trong tab "Bản golive".
- Là Manager, tôi xem mỗi QE đã được giao bao nhiêu ticket, thực sự test bao nhiêu và bỏ qua bao nhiêu, ở web và app.
- Là Manager, tôi biết QE mất trung bình bao lâu để xong một ticket ở từng phase.
- Là Manager, tôi biết QE đã đánh failed bao nhiêu ticket, kể cả ticket đã được sửa và pass sau đó.
- Là Manager, tôi lọc theo khoảng thời gian và sort theo bất kỳ chỉ số nào để so sánh.

## 4. Cấu trúc tab

- Giữ heading `Statistic.` ở trên cùng. Đặt tablist ngay dưới heading, dùng style có sẵn `filter-tabs golive-tabs` (`role="tablist"`, `role="tab"`, `aria-selected`) như `GoliveBoard`.
- Tab 1: **Bản golive** (icon `Rocket`), mặc định. Tab 2: **QE** (icon `Users`).
- Mô tả dưới heading theo tab. Tab 1 giữ nguyên câu hiện tại. Tab 2: "So sánh khối lượng và tốc độ test của từng QE qua các đợt golive."
- URL: thêm param `statView=qe` cho tab 2; tab 1 không có param. Bộ lọc tab 2 dùng `statRange` (`30d`, `90d`, `year`, `all`, `custom`) và `statFrom`, `statTo` (`YYYY-MM-DD`). Dùng `readUrlParam`/`writeUrlParams`. Reload giữ nguyên tab và bộ lọc. Khi rời màn Statistic phải xoá các param này giống cách các màn khác dọn state.
- Không dùng param `view` vì `GoliveBoard` đã dùng.
- Chuyển tab không làm mất state tab 1 (đợt đang mở, phần thu gọn, ticket đã tải). Tab 2 chỉ gọi API khi được mở lần đầu.
- Heading và tablist vẫn hiển thị khi một tab đang loading hoặc lỗi.

## 5. Tab "QE"

### 5.1 Bộ lọc thời gian

- Lựa chọn: `30 ngày`, `90 ngày` (mặc định), `Năm nay`, `Tất cả`, `Tùy chọn` (hiện 2 ô ngày từ/đến).
- Lọc theo `golive_releases.created_at`: một đợt nằm trong kỳ thì toàn bộ ticket của đợt được tính, kể cả đợt đang chạy.
- Ngày tính theo giờ Việt Nam. Dùng lại `historyDateBounds` trong `app/lib/history-dates.ts`. `30 ngày` và `90 ngày` tính đến hết hôm nay. `Năm nay` bắt đầu từ 01/01 của năm hiện tại theo giờ Việt Nam.
- Ngày bắt đầu sau ngày kết thúc: hiện thông báo lỗi từ API trong tab, không crash.

### 5.2 Thẻ tổng quan

Dùng style `golive-stats stat-summary`, tính trên kỳ đang lọc:

| Thẻ | Giá trị | Dòng phụ |
|---|---|---|
| QE có ticket | Số QE có ít nhất 1 ticket | trên N tài khoản QE |
| Ticket được giao | Tổng ticket có người test | trong N đợt golive |
| Đã test | Tổng Đã test web + app | X web · Y app |
| Ticket failed | Tổng Failed web + app | X web · Y app |

### 5.3 Bảng QE

Header hai tầng, nhóm **Web** và **App**:

| Cột | Key API | Định nghĩa |
|---|---|---|
| QE | `name` | Avatar, tên, badge role qua `HolderIdentity` |
| Đợt | `releases` | Số đợt khác nhau có ticket của QE, tính cả đợt manual |
| Ticket | `assigned` | Số ticket của đợt CSV được giao |
| Web · Đã test | `web.tested` | `web_status = 'tested'` |
| Web · Bỏ qua | `web.skipped` | `web_status` là `not-needed` hoặc `cannot-test` |
| Web · Failed | `web.failed` | Số ticket có bản ghi failed phase web |
| Web · TG TB | `web.avgMs` | Xem 5.4 |
| App · Đã test | `app.tested` | Ticket có `done_at`, và `doneKindOf` là `onDevices` hoặc `confirmed` |
| App · Bỏ qua | `app.skipped` | Ticket có `done_at`, và `doneKindOf` là `notNeeded` hoặc `cannotTest` |
| App · Failed | `app.failed` | Số ticket có bản ghi failed phase app |
| App · TG TB | `app.avgMs` | Xem 5.4 |
| Còn tồn | `open` | Ticket có `done_at` rỗng, gồm cả ticket đang failed |

Quy tắc đếm:

- Một ticket đã failed rồi pass được tính ở cả **Failed** và **Đã test**. Hai cột này không loại trừ nhau.
- Đợt `source = 'manual'` không có ticket thật (mỗi QE một dòng `QE-n`), nên chỉ tính vào cột **Đợt**. Không tính vào Ticket, các cột Web/App, Còn tồn và thẻ tổng quan về ticket.
- Quy kết về **người test của ticket** (`assignee`), không theo người bấm (`failed_by`, `web_by`, `skipped_by`). Manager đánh dấu thay vẫn tính cho QE sở hữu ticket.

Danh tính và danh sách dòng:

- Khoá nhóm: `assigneeUserId ?? matchAccount(profiles, assignee)`. Không khớp tài khoản thì nhóm theo `normalizeName(assignee)`.
- Ticket có `assignee` rỗng không tạo dòng. Nếu có, hiện ghi chú dưới bảng: "N ticket chưa có người test không được tính."
- Tài khoản role QE/QEM không có ticket trong kỳ vẫn có dòng với giá trị 0.
- Người có ticket trong kỳ nhưng role hiện tại không phải QE/QEM vẫn có dòng, hiện theo role hiện tại.
- Tên không khớp tài khoản vẫn có dòng, thêm nhãn nhỏ "Chưa khớp tài khoản", và luôn nằm cuối bảng.

Sort:

- Click tiêu đề cột để sort, click lần nữa đảo chiều; có `aria-sort` và mũi tên chỉ chiều.
- Mặc định: `web.tested + app.tested` giảm dần, sau đó tên theo locale `vi`.
- Ô thời gian không có dữ liệu luôn nằm cuối, ở cả hai chiều sort.
- Sort thực hiện ở client, không gọi lại API.

Hiển thị:

- Số 0 hiện `0`. Thời gian không có dữ liệu hiện `—`.
- Thời gian: dưới 60 phút `45p`; dưới 24 giờ `3g 20p`; từ 24 giờ `2n 4g`.
- Tooltip ô TG TB: "Trung bình trên N ticket".
- Cột QE sticky khi cuộn ngang; bảng nằm trong `table-scroll`. Dùng CSS và token có sẵn, theo `DESIGN.md`.
- Ghi chú dưới bảng:
  - "Thời gian tính theo giờ đồng hồ, gồm cả ngoài giờ làm và cuối tuần."
  - "Số failed được ghi đầy đủ từ khi tính năng này triển khai; trước đó chỉ gồm ticket còn đang failed."

Trạng thái: loading dùng `LoadingState`; lỗi hiện trong tab và có nút "Thử lại"; không có đợt trong kỳ hiện empty state "Không có đợt golive nào trong khoảng thời gian này."

### 5.4 Công thức tốc độ

Chỉ tính ticket của đợt CSV đã được test thật. Bỏ qua, failed và chưa xong không tham gia.

- **Web:** `web_at - release.created_at`, với `web_status = 'tested'`.
- **App:** `markedAt(ticket) - release.app_pushed_at`, với ticket thuộc App · Đã test. Dùng lại `markedAt`.
- Loại khỏi App nếu `app_pushed_at` rỗng, hoặc `app_pushed_at = created_at` (đợt cũ, migration 0022 gán giá trị này nên không phản ánh giờ push thật).
- Loại mẫu có thời lượng âm hoặc mốc thời gian không parse được.
- `avgMs = round(tổng / số mẫu)`, không có mẫu thì `null`. Trả kèm `samples`.

## 6. Dữ liệu: lịch sử failed

### 6.1 Bảng mới

Thêm vào `db/schema.ts`, tạo migration bằng `npm run db:generate` (số kế tiếp là `0023`):

```ts
export const goliveTicketFailures = sqliteTable("golive_ticket_failures", {
  ticketId: integer("ticket_id").notNull(),
  phase: text("phase").notNull(), // "web" | "app"
  releaseId: text("release_id").notNull(),
  failedBy: text("failed_by").notNull(),
  failedAt: text("failed_at").notNull(),
}, table => [
  primaryKey({ columns: [table.ticketId, table.phase] }),
  index("golive_ticket_failures_release_id_idx").on(table.releaseId),
]);
```

Mỗi ticket có tối đa một bản ghi mỗi phase, giữ lần failed đầu tiên. Không dùng foreign key, nhất quán với `golive_web_signoffs`.

### 6.2 Backfill trong migration

Thêm vào cuối file SQL:

```sql
INSERT OR IGNORE INTO golive_ticket_failures (ticket_id, phase, release_id, failed_by, failed_at)
  SELECT id, 'app', release_id, COALESCE(failed_by, ''), failed_at FROM golive_tickets WHERE failed_at IS NOT NULL;
INSERT OR IGNORE INTO golive_ticket_failures (ticket_id, phase, release_id, failed_by, failed_at)
  SELECT id, 'web', release_id, COALESCE(web_by, ''), COALESCE(web_at, updated_at) FROM golive_tickets WHERE web_status = 'failed';
```

### 6.3 Ghi log trong `app/api/golive/route.ts`

Dùng `onConflictDoNothing()` và ghi cùng `db.batch` với lệnh update ticket:

| Action | Điều kiện | Phase |
|---|---|---|
| `fail-test` | `failed === true` | `app` |
| `web-status` | `status === "failed"` | `web` |
| `bulk-status` | `status === "failed"` | theo `phase`, cho mỗi ticket trong `allowedIds` |

- `bulk-status`: chia lô tối đa 15 dòng mỗi lệnh insert, vì D1 giới hạn số tham số.
- Bỏ dấu failed hoặc test lại **không xoá** log.
- `deleteRelease`: xoá log theo `release_id` cùng lúc xoá dữ liệu đợt.

## 7. API

`GET /api/statistic?view=qe&from=YYYY-MM-DD&to=YYYY-MM-DD`

- Dùng `requireReporter()` như các nhánh hiện tại: chưa đủ quyền trả 403.
- `from`, `to` đều tuỳ chọn. Sai định dạng hoặc `from > to` trả 400 với message của `historyDateBounds`.
- Chỉ đọc, không đổi dữ liệu, header `no-store`.
- Khi không có `view=qe`, các nhánh GET và POST hiện tại giữ nguyên.

```ts
type QePhaseStat = { tested: number; skipped: number; failed: number; avgMs: number | null; samples: number };
type QeStat = {
  key: string; name: string; userId: string | null; role: string | null; matched: boolean;
  releases: number; assigned: number; open: number;
  web: QePhaseStat; app: QePhaseStat;
};
type QeReport = {
  releases: number;          // số đợt trong kỳ
  qeAccounts: number;        // số tài khoản QE/QEM hiện tại
  unassignedTickets: number; // ticket CSV không có người test
  rows: QeStat[];
};
```

Tránh truy vấn theo từng đợt. Lấy các đợt trong kỳ, rồi ticket, số liệu tick (`max(checked_at)`, `count(*)` theo ticket), và failures bằng subquery trên `golive_releases`, tránh truyền danh sách id dài vượt giới hạn tham số của D1.

## 8. Hướng triển khai

| File | Thay đổi |
|---|---|
| `app/lib/statistic.ts` | Thêm hàm thuần `qeScorecard(input): QeReport` và các type; toàn bộ phép tính ở đây |
| `app/api/statistic/route.ts` | Thêm nhánh `view=qe` |
| `app/api/golive/route.ts` | Ghi log failed, xoá log khi xoá đợt |
| `db/schema.ts`, `drizzle/` | Bảng và migration 0023 |
| `app/components/StatisticBoard.tsx` | Thành khung gồm heading và tablist; chuyển nội dung hiện tại sang component mới, ví dụ `GoliveStatisticTab`, không đổi logic |
| `app/components/QeStatisticTab.tsx` | Component mới cho tab 2 |
| `app/globals.css` | Style cho header hai tầng, cột sticky và ô sort |

Repo đang có thay đổi chưa commit ở `app/components/HolderIdentity.tsx`, `app/globals.css`, `app/lib/roles.ts`. Giữ nguyên các thay đổi này, không revert hoặc ghi đè.

## 9. Acceptance criteria

**Tab**

- [ ] Mở Statistic mặc định ở tab "Bản golive"; nội dung, nhắc nhở và chọn ticket hoạt động như trước.
- [ ] Reload `?tab=statistic&statView=qe&statRange=30d` giữ đúng tab và bộ lọc; Back/Forward hoạt động đúng.
- [ ] Chuyển qua lại giữa hai tab không mất các đợt đang mở ở tab 1.
- [ ] Role QE, DEV, PM, App Manager gọi `?view=qe` nhận 403; Manager và QEM nhận dữ liệu.

**Số liệu**

- [ ] Ticket `not-needed`/`cannot-test` nằm ở Bỏ qua, không nằm ở Đã test.
- [ ] Ticket "Xác nhận đã test xong" và ticket tích đủ thiết bị nằm ở App · Đã test.
- [ ] Đợt manual chỉ tăng cột Đợt.
- [ ] Manager đánh failed thay vẫn tính cho QE sở hữu ticket.
- [ ] Bộ lọc tính theo ngày giờ Việt Nam; đợt tạo 23:30 ngày cuối kỳ (giờ VN) nằm trong kỳ.
- [ ] Đợt có `app_pushed_at = created_at` không vào App · TG TB nhưng vẫn vào các cột đếm.

**Lịch sử failed**

- [ ] Đánh failed (đơn lẻ và hàng loạt, web và app) tạo log; đánh failed lại không tăng số đếm.
- [ ] Ticket failed rồi test pass vẫn còn trong cột Failed và đồng thời ở Đã test.
- [ ] Ticket đang failed trước khi triển khai xuất hiện sau migration.
- [ ] Xoá đợt golive xoá cả log của đợt.

**Giao diện**

- [ ] Sort đúng ở mọi cột; ô `—` luôn nằm cuối ở cả hai chiều.
- [ ] Dùng được ở mobile, cột QE sticky khi cuộn ngang; loading, lỗi, empty state đều có.

## 10. Kiểm thử

- Thêm vào `tests/statistic.test.mjs` các case cho `qeScorecard`: phân loại đã test/bỏ qua, đợt manual, khoá nhóm và người chưa khớp, QE 0 ticket, ticket không có người test, failed-rồi-pass, loại mẫu thời gian (đợt cũ, thời lượng âm), và `null` khi không có mẫu.
- Thêm integration test theo mẫu `tests/manual-golive.integration.mjs` cho ghi log failed và xoá đợt, chỉ chạy trên D1 local.
- Chạy `npm run lint`, `npm run build` và các test hiện có trong `tests/`.

## 11. Giả định đã chốt

| Nội dung | Quyết định |
|---|---|
| Trình bày | Bảng chỉ số có sort, không có điểm tổng |
| Quyền xem | `Manager` và `QEM` |
| Bộ lọc | Chỉ theo thời gian tạo đợt |
| Đã test và Bỏ qua | Tách 2 cột |
| Lịch sử failed | Thêm log, backfill ticket còn đang failed |
| Hủy nhầm dấu failed | Log vẫn giữ, vì hệ thống không phân biệt được hủy nhầm với test lại |
| Thời gian | Trung bình theo giờ đồng hồ |
