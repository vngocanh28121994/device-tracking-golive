export const avatarUrl = (key: string) => key ? "/api/avatar/" + encodeURIComponent(key) : "";

// The browser normalizes every upload to a small JPEG; arbitrary URLs and SVG are rejected.
export function decodeAvatar(value: unknown): Uint8Array | null {
  if (value === "") return null;
  if (typeof value !== "string" || value.length > 90000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Ảnh đại diện không hợp lệ. Hãy chọn lại ảnh JPG, PNG hoặc WebP.");
  let data: string;
  try { data = atob(value.slice("data:image/jpeg;base64,".length)); }
  catch { throw new Error("Không thể đọc ảnh đại diện."); }
  if (data.length < 5 || data.length > 64000 || data.charCodeAt(0) !== 255 || data.charCodeAt(1) !== 216 || data.charCodeAt(2) !== 255 || data.charCodeAt(data.length - 2) !== 255 || data.charCodeAt(data.length - 1) !== 217) throw new Error("Ảnh đại diện không hợp lệ hoặc quá lớn.");
  return Uint8Array.from(data, character => character.charCodeAt(0));
}
