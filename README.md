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

Site đã được liên kết qua `project_id` trong `.openai/hosting.json`. Không thêm `origin` hoặc token deploy vào Git config hay file `.env`.

Quy trình chuẩn cho Codex/Sites:

1. Chạy `npm run build`.
2. Dùng Sites để lấy credential ghi source tạm thời và chạy helper `site-workflow.mjs`; helper này kiểm tra remote, build, commit/push và đóng gói artifact trong một luồng.
3. Lưu version bằng commit SHA do helper trả về rồi publish version đó. Kiểm tra trạng thái deployment đến khi thành công.

Credential Site chỉ được truyền qua stdin cho helper, không ghi ra terminal, file hay lịch sử Git. Khi deployment lỗi, giữ lại version đã lưu và tiếp tục kiểm tra/publish version đó, không tạo Site mới.
