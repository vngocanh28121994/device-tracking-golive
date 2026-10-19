# Kho Vui Vẻ

Trang quản lý thiết bị điện tử với giao diện tiếng Việt.

## Chức năng

- Tổng quan số lượng hiện tại, số thiết bị đang được sử dụng và số dòng cần chú ý.
- Tạo, sửa, lưu trữ thiết bị; tìm kiếm và lọc theo danh mục.
- Chốt kiểm kê cuối ngày theo số lượng thực tế, người đang giữ, tình trạng, ghi chú và người kiểm tra.
- Mỗi người được cấp quyền đặt tên hiển thị cho tài khoản ChatGPT của mình; lần kiểm kê mới tự ghi tên, email và ID tài khoản đã đăng nhập.
- Xem lịch sử checklist theo ngày và xuất CSV.
- Dữ liệu được lưu trong Cloudflare D1. Khi cơ sở dữ liệu trống lần đầu, trang tạo sáu dòng mẫu có ghi rõ “Dữ liệu mẫu”.

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
