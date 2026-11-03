// Every push the app sends. The admin can turn each one off in "Tài khoản của tôi".
export const pushEvents = [
  { key: "web-qe-done", label: "Một QE xác nhận xong test web", to: "Manager, PM" },
  { key: "web-all-done", label: "Tất cả QE xong test web", to: "Mọi người" },
  { key: "remind-web", label: "Manager nhắc QE chưa test web", to: "QE chưa xác nhận" },
  { key: "qe-done", label: "Một QE test xong toàn bộ ticket", to: "Manager, PM" },
  { key: "all-done", label: "Mọi ticket của đợt đã Done", to: "Mọi người" },
  { key: "release-completed", label: "Đợt golive được hoàn thành", to: "Mọi người" },
] as const;
export type PushEvent = typeof pushEvents[number]["key"];
export const isPushEvent = (value: unknown): value is PushEvent => pushEvents.some(item => item.key === value);
