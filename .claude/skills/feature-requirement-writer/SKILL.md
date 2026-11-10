---
name: feature-requirement-writer
description: Use when the user wants to add or upgrade a feature in this project (Kho Vui Vẻ / device-tracking-golive): ask whether to write a requirement first; if yes, clarify it and save a dev-ready .md in requirement/.
---

# Viết requirement cho feature mới

Dùng khi người dùng mô tả muốn thêm, nâng cấp hoặc đổi một feature trong project này (ví dụ: "tôi muốn thêm…", "thêm 1 tab…", "làm page mới…"). Mục tiêu: một file requirement đủ rõ để Claude Code code được luôn.

## Bước 1. Hỏi trước khi làm

Trước khi code hay lên plan, hỏi đúng một câu bằng AskUserQuestion:

- Câu hỏi: "Bạn có muốn mình viết requirement cho feature này trước không?"
- Lựa chọn: "Viết requirement (Recommended)" · "Không, làm luôn" · "Chỉ cần plan/tư vấn".

Nếu người dùng đã nói rõ ("viết requirement đi", "code luôn") thì không hỏi lại, làm theo luôn. Nếu chọn không viết thì dừng skill và làm theo yêu cầu bình thường.

## Bước 2. Đọc code liên quan

Đọc trước khi hỏi, để câu hỏi bám đúng code hiện tại:

- README, DESIGN.md, cấu trúc thư mục, package.json.
- Màn hình, API, schema DB (`db/schema.ts`, `drizzle/`), lib và test liên quan đến feature.
- Các requirement cũ trong `requirement/` để giữ cùng giọng văn và tránh trùng.
- `git status`: ghi lại file đang có thay đổi chưa commit để requirement nhắc giữ nguyên.

## Bước 3. Làm rõ yêu cầu

Hỏi bằng AskUserQuestion, tối đa 4 câu mỗi lượt, mỗi câu có lựa chọn đề xuất đứng đầu kèm "(Recommended)". Chỉ hỏi những điểm làm thay đổi cách code:

- Phạm vi và những gì nằm ngoài phạm vi.
- Ai được dùng / quyền theo role.
- Định nghĩa chỉ số, công thức, quy tắc đếm khi có số liệu.
- Dữ liệu còn thiếu: có cần migration, có backfill không.
- Ràng buộc bảo mật, dữ liệu gửi ra ngoài, chi phí.

Nếu câu trả lời mâu thuẫn hoặc chưa đủ, hỏi lại đúng điểm đó. Những điểm có mặc định hợp lý thì tự quyết và ghi vào bảng giả định.

## Bước 4. Viết file

Lưu vào `requirement/<ten-feature-kebab>.md` ở root project. Viết bằng tiếng Việt, dùng tên file, hàm, bảng, cột thật từ code. Cấu trúc:

1. Bảng đầu: màn hình, người dùng, trạng thái ("Đã chốt, sẵn sàng dev" hoặc "Còn N quyết định").
2. Mục tiêu.
3. Ngoài phạm vi.
4. Quyết định đã chốt (bảng).
5. User stories (nếu hữu ích).
6. Đặc tả chi tiết: UI (tab, URL param, trạng thái loading/lỗi/rỗng, mobile), quy tắc nghiệp vụ, công thức.
7. Dữ liệu: schema mới, migration, backfill, xoá kèm khi xoá dữ liệu cha.
8. API: endpoint, tham số, kiểu trả về, mã lỗi, kiểm tra quyền ở server.
9. File cần sửa (bảng file → thay đổi), nhắc giữ nguyên thay đổi chưa commit.
10. Acceptance criteria dạng checklist `- [ ]`, kiểm chứng được.
11. Kiểm thử: unit test, integration test, lint, build.

Feature lớn thì chia đợt (Đợt 1, Đợt 2…) và ghi thứ tự dev.

## Bước 5. Báo lại

Trả lời ngắn:

- Đường dẫn file và câu gợi ý giao việc: "Implement theo `requirement/<file>.md`".
- Tóm tắt phạm vi đã chốt trong vài gạch đầu dòng.
- Liệt kê những điểm tự quyết để người dùng xác nhận.
- `requirement/` đang nằm trong `.gitignore`, nên nhắc rằng file sẽ không được commit.

Không code feature trong skill này trừ khi người dùng yêu cầu.

## Khi người dùng sửa yêu cầu sau đó

Đọc lại file, sửa đúng phần thay đổi, cập nhật trạng thái và bảng quyết định, rồi báo lại những gì đã đổi.
