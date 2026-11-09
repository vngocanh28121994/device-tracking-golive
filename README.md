# Kho Vui Vẻ

Trang quản lý thiết bị điện tử với giao diện tiếng Việt.

## Chức năng

- Tổng quan số lượng hiện tại, số thiết bị đang được sử dụng và số dòng cần chú ý.
- Tạo, sửa, lưu trữ thiết bị; tìm kiếm và lọc theo danh mục.
- Chốt kiểm kê cuối ngày theo số lượng thực tế, người đang giữ, tình trạng, ghi chú và người kiểm tra.
- Mỗi người được cấp quyền đặt tên hiển thị cho tài khoản ChatGPT của mình; lần kiểm kê mới tự ghi tên, email và ID tài khoản đã đăng nhập.
- Xem lịch sử checklist theo ngày và xuất CSV.
- Dữ liệu được lưu trong Cloudflare D1. Danh sách khởi tạo có 15 thiết bị iOS và Android do người dùng cung cấp; mỗi dòng tạm tính một thiết bị, với người giữ và tình trạng chưa xác định cho tới khi được kiểm kê.

Mỗi dòng thiết bị đại diện cho một nhóm có cùng người giữ. Nếu một loại thiết bị được nhiều người giữ, tạo riêng một dòng cho mỗi người.

## Chạy cục bộ

Yêu cầu Node.js 22.13+.

```sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_special_turbo.sql
npm run start
```

Sau khi nâng cấp từ phiên bản đầu, áp dụng tiếp migration `drizzle/0001_lean_captain_universe.sql` bằng cùng lệnh Wrangler. Chỉ áp dụng mỗi migration một lần cho mỗi cơ sở dữ liệu cục bộ. Dữ liệu cục bộ lưu trong `.wrangler/state`. Trang Sites sẽ tự áp dụng migration khi triển khai.

## Triển khai Sites

Tracking Golive hỗ trợ import CSV hoặc tạo trực tiếp bằng tên và fixVersion. Đợt tạo trực tiếp chốt danh sách các tài khoản QE tại thời điểm tạo, mỗi người một checklist thiết bị. fixVersion là nhãn phiên bản, không tự lấy ticket từ Jira.

Trong “Tài khoản của tôi”, người quản trị hoặc Manager gán một role cho mỗi tài khoản: Manager, QE, DEV hoặc PM. Tài khoản quản trị `vngocanh281219941@gmail.com` có role công việc là QE; quyền quản lý role độc lập với role công việc, nên vẫn có thể đổi role cho chính mình khi team không có Manager. Các tài khoản còn lại chờ gán role. Thay đổi role không sửa danh sách người test của đợt đã tạo.

### Quy tắc nghiệm thu Tracking Golive

- Chỉ Manager/QEM hoàn thành hoặc xoá đợt. Đợt đã hoàn thành không bị tự xoá; Manager xoá thủ công (kèm dữ liệu thống kê của đợt).
- Mỗi lần App Manager push app phải nhập số build. Kết quả app ghi lại build đang chạy; khi push bản mới, người push chọn ticket cần test lại, ticket còn lại giữ kết quả và hiện nhãn “Build cũ”. Chỉ thu hồi push được khi đợt mới có một build.
- Ticket CSV chỉ Done khi mọi máy trong danh sách bắt buộc (chốt lúc push build, hoặc lúc người test nhận máy muộn) đã được tích hoặc miễn kèm lý do. Bàn giao máy không làm giảm yêu cầu.
- Ticket CSV không có QE phụ trách chặn phase Web, trừ đợt đã push app. Đợt tạo tay dùng danh sách QE chốt lúc tạo.
- Manager/QEM có thể chấp nhận rủi ro cho ticket test failed (kèm lý do); ticket đó được coi là xong. Khi hoàn thành đợt, hộp tổng kết liệt kê ticket cần lưu ý và bắt buộc ghi chú nghiệm thu nếu có ticket không test được, chưa báo scrum team hoặc chấp nhận rủi ro.
- Mọi thay đổi trạng thái ticket được ghi vào bảng `golive_ticket_events` (chưa có giao diện xem).
- Sửa lý do của ticket đang Test failed giữ nguyên thời điểm failed đầu tiên, nên thu hồi kiểu “đánh dấu nhầm” vẫn xoá được dòng log và QE không bị tính một lần failed. Thu hồi kiểu “cần test lại” xoá cả dấu tích và dấu miễn máy, nên ticket không tự Done lại.
- Bỏ tích một máy ngoài danh sách bắt buộc không làm ticket mất Done: kết quả, build và nhật ký giữ nguyên. Bỏ tích máy bắt buộc mới đưa ticket về In Progress, kèm đúng một dòng nhật ký.
- Khi push bản mới, hộp thoại chọn test lại liệt kê cả ticket đang test dở (đã có dấu tích) và chọn sẵn các ticket đó; ticket không chọn giữ dấu tích của bản cũ.
- Chỉ miễn được máy mà người test không còn giữ; `complete-release` chỉ chạy khi đợt đã sang phase app.

Migration `drizzle/0024_golive-acceptance.sql` thêm bảng build, chấp nhận rủi ro và nhật ký, kèm backfill một build rỗng cho đợt đã push.

Kiểm tra API local (dev server đang chạy, đã áp dụng migration):

```sh
node tests/manual-golive.integration.mjs /absolute/path/to/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/database.sqlite
node tests/golive-acceptance.integration.mjs /absolute/path/to/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/database.sqlite
```

```sh
node tests/golive-failures.integration.mjs /absolute/path/to/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/database.sqlite
```

Bài kiểm tra tạo dữ liệu tạm trong D1 local rồi dọn lại; không dùng với database production. `golive-import.integration.mjs` cần sẵn một tài khoản role QE hoặc QEM trong D1 local (CSV mẫu lấy tên người test từ tài khoản đó). Các test unit chạy trực tiếp: `node tests/golive-retest.test.mjs`.

Site đã được liên kết qua `project_id` trong `.openai/hosting.json`. Không thêm `origin` hoặc token deploy vào Git config hay file `.env`.

Quy trình chuẩn cho Codex/Sites:

1. Chạy `npm run build`.
2. Dùng Sites để lấy credential ghi source tạm thời và chạy helper `site-workflow.mjs`; helper này kiểm tra remote, build, commit/push và đóng gói artifact trong một luồng.
3. Lưu version bằng commit SHA do helper trả về rồi publish version đó. Kiểm tra trạng thái deployment đến khi thành công.

Credential Site chỉ được truyền qua stdin cho helper, không ghi ra terminal, file hay lịch sử Git. Khi deployment lỗi, giữ lại version đã lưu và tiếp tục kiểm tra/publish version đó, không tạo Site mới.
