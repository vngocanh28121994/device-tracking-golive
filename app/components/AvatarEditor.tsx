"use client";
import { type ChangeEvent, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";

export function AvatarEditor({ value, name, disabled, onChange, onProcessingChange }: { value: string; name: string; disabled: boolean; onChange: (value: string) => void; onProcessingChange: (value: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Hãy chọn ảnh JPG, PNG hoặc WebP."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Ảnh vượt quá 5 MB. Hãy chọn ảnh nhỏ hơn."); return; }
    setProcessing(true); onProcessingChange(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 192;
      const context = canvas.getContext("2d"); if (!context) throw new Error();
      context.fillStyle = "#f1eafb"; context.fillRect(0, 0, 192, 192);
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0, 0, 192, 192);
      const result = canvas.toDataURL("image/jpeg", .85);
      if (result.length > 90000) { setError("Không thể thu nhỏ ảnh này. Hãy chọn ảnh khác."); return; }
      onChange(result);
    } catch { setError("Không đọc được ảnh. Hãy thử ảnh khác."); }
    finally { URL.revokeObjectURL(url); setProcessing(false); onProcessingChange(false); }
  }
  return <div className="avatar-editor">
    <div className="avatar-editor-preview" aria-label="Xem trước ảnh đại diện">{value ? <img src={value} alt="Ảnh đại diện của bạn"/> : <span>{(name.trim() || "?").slice(0,1).toLocaleUpperCase("vi")}</span>}</div>
    <div className="avatar-editor-copy"><strong>Ảnh đại diện</strong><p>JPG, PNG hoặc WebP · tối đa 5 MB.<br/>Ảnh được cắt vuông và thu nhỏ trước khi lưu.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void choose(event)} aria-label="Chọn ảnh đại diện" hidden/>
      <div className="avatar-editor-actions"><button type="button" className="outline-button" disabled={disabled || processing} onClick={()=>input.current?.click()}><Camera size={16}/>{processing ? "Đang xử lý…" : value ? "Đổi ảnh" : "Tải ảnh lên"}</button>{value && <button type="button" className="text-button" disabled={disabled || processing} onClick={()=>{onChange("");setError("")}}><Trash2 size={15}/> Xóa ảnh</button>}</div>
      <small>Nhấn “Lưu hồ sơ” để áp dụng thay đổi.</small>
      {error && <p className="avatar-error" role="alert">{error}</p>}
    </div>
  </div>;
}
