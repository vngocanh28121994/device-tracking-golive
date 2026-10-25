"use client";
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, ShoppingBasket, Target } from "lucide-react";
import { catchesDevice, clampBasket, movingDeviceX } from "../lib/handover-game";

type Phase = "ready" | "playing" | "aiming" | "miss" | "caught" | "saving" | "error";
export function HandoverGame({ recipient, deviceIcon, onComplete, onBack, errorMessage }: {
  recipient: string; deviceIcon: ReactNode; onComplete: () => Promise<boolean>; onBack: () => void; errorMessage: string;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [basket, setBasket] = useState(50);
  const [target, setTarget] = useState(22);
  const [reduced, setReduced] = useState(false);
  const basketElement = useRef<HTMLDivElement>(null), feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arena = useRef<HTMLDivElement>(null), falling = useRef<HTMLDivElement>(null), guide = useRef<HTMLDivElement>(null);
  const basketPosition = useRef(50), frame = useRef(0), celebration = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolved = useRef(false), active = useRef(false), mounted = useRef(true), saving = useRef(false);
  const locked = phase === "caught" || phase === "saving";
  useEffect(() => {
    mounted.current = true;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => {
      setReduced(media.matches);
      if (media.matches && active.current) { active.current = false; cancelAnimationFrame(frame.current); setPhase("ready"); }
    };
    arena.current?.focus();
    preference(); media.addEventListener("change", preference);
    const hidden = () => { if (document.hidden && active.current) { active.current = false; cancelAnimationFrame(frame.current); setPhase("ready"); } };
    document.addEventListener("visibilitychange", hidden);
    return () => { mounted.current = false; active.current = false; cancelAnimationFrame(frame.current); if (celebration.current) clearTimeout(celebration.current); if (feedbackTimer.current) clearTimeout(feedbackTimer.current); media.removeEventListener("change", preference); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  function move(value: number) {
    if (locked || phase === "error") return;
    const next = clampBasket(value);
    if (!reduced && next !== basketPosition.current && basketElement.current) {
      basketElement.current.style.setProperty("--basket-tilt", next > basketPosition.current ? "4deg" : "-4deg");
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => basketElement.current?.style.setProperty("--basket-tilt", "0deg"), 150);
    }
    basketPosition.current = next; setBasket(next);
  }
  function pointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" && event.type === "pointermove" && !event.buttons) return;
    if (event.type === "pointerdown") { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); }
    const bounds = event.currentTarget.getBoundingClientRect(); move((event.clientX - bounds.left) / bounds.width * 100);
  }
  async function save() {
    if (saving.current || !mounted.current) return;
    saving.current = true; setPhase("saving");
    try { const ok = await onComplete(); if (mounted.current && !ok) setPhase("error"); }
    catch { if (mounted.current) setPhase("error"); }
    finally { saving.current = false; }
  }
  function finish(deviceX: number) {
    if (resolved.current) return;
    resolved.current = true;
    active.current = false;
    if (!catchesDevice(deviceX, basketPosition.current)) { setPhase("miss"); return; }
    setPhase("caught");
    celebration.current = setTimeout(() => { void save(); }, reduced ? 100 : 650);
  }
  function start() {
    cancelAnimationFrame(frame.current); resolved.current = false;
    const deviceX = Math.random() < .5 ? 20 + Math.random() * 8 : 72 + Math.random() * 8;
    const direction = Math.random() < .5 ? -1 : 1;
    setTarget(deviceX); setPhase(reduced ? "aiming" : "playing");
    if (falling.current) falling.current.style.transform = `translate3d(-50%,0,0) rotate(0deg)`;
    if (guide.current) guide.current.style.transform = "translateX(0)";
    if (reduced) return;
    active.current = true;
    let last: number | null = null, elapsed = 0;
    const tick = (now: number) => {
      if (!active.current) return;
      // Cap frame gaps so a stalled browser cannot make the device teleport past the player.
      if (last !== null) elapsed += Math.min(now - last, 50);
      last = now;
      const progress = Math.max(0, Math.min(1, (elapsed - 650) / 2500));
      const currentX = movingDeviceX(deviceX, elapsed, direction);
      if (falling.current && arena.current) {
        const horizontal = (currentX - deviceX) / 100 * arena.current.clientWidth;
        falling.current.style.transform = `translate3d(calc(-50% + ${horizontal}px),${progress * arena.current.clientHeight * .64}px,0) rotate(${Math.sin(elapsed / 350) * 12}deg)`;
        if (guide.current) guide.current.style.transform = `translateX(${horizontal}px)`;
      }
      if (progress >= 1) finish(currentX); else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    arena.current?.focus();
  }
  const status = phase === "miss" ? "Ôi, hụt rồi! Người giữ chưa thay đổi. Thử lại nhé." : phase === "caught" ? "Hứng trúng rồi! Chuẩn bị bàn giao…" : phase === "saving" ? "Đang lưu người giữ và lịch sử bàn giao…" : phase === "error" ? (errorMessage || "Chưa lưu được bàn giao. Hãy thử lưu lại.") : phase === "playing" ? "Máy đang lượn ngang! Di chuyển rổ theo máy để hứng." : phase === "aiming" ? "Căn rổ dưới thiết bị, rồi bấm Hứng máy." : "Hứng đúng rổ, bàn giao đúng người!";
  return <div className={"handover-game game-" + phase + (reduced ? " game-reduced" : "")}>
    <h3><Target size={20}/> Chuyền máy nào!</h3>
    <p className="game-instructions">Kéo rổ bằng chuột hoặc ngón tay. Bạn cũng có thể dùng phím ← → hoặc hai nút bên dưới.</p>
    <div className="game-arena" ref={arena} role="slider" tabIndex={0} aria-label={"Di chuyển rổ của " + recipient} aria-valuemin={16} aria-valuemax={84} aria-valuenow={Math.round(basket)} aria-valuetext={"Rổ ở " + Math.round(basket) + (!reduced && phase !== "ready" ? "%. Thiết bị dùng quỹ đạo lượn ngang." : "%. Thiết bị ở " + Math.round(target) + "%.")} aria-disabled={locked || phase === "error"} onPointerDown={pointer} onPointerMove={pointer} onKeyDown={event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); move(event.key === "Home" ? 16 : event.key === "End" ? 84 : basketPosition.current + (event.key === "ArrowLeft" ? -6 : 6)); }
    }}>
      <div ref={guide} className="game-drop-guide" style={{ left: target + "%" }} aria-hidden="true"/>
      <div ref={falling} className="game-device" style={{ left: target + "%" }} aria-hidden="true">{deviceIcon}</div>
      <div ref={basketElement} className="game-basket" style={{ left: basket + "%" }} aria-hidden="true"><svg viewBox="0 0 120 50" preserveAspectRatio="none"><path d="M5 8h110l-12 34H17Z" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="M4 8h112M31 10l5 30M60 10v30M89 10l-5 30M12 23h96" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg><span title={recipient}>{recipient}</span></div>
      {!reduced && (phase === "caught" || phase === "saving") && <div className="game-confetti" aria-hidden="true">{Array.from({length: 10}, (_, index) => <i key={index} style={{left: (8 + index * 9) + "%", animationDelay: (index % 3 * 35) + "ms", "--burst-x": (index % 2 ? 24 : -24) + "px"} as CSSProperties}/>)}</div>}
      {(phase === "caught" || phase === "saving" || phase === "error") && <div className="game-catch-badge"><Check size={18}/> Hứng trúng!</div>}
    </div>
    <div className="game-steering"><button className="outline-button" disabled={locked || phase === "error"} onClick={() => move(basketPosition.current - 6)} aria-label="Di chuyển rổ sang trái"><ArrowLeft size={18}/></button><span>Rổ của <strong>{recipient}</strong></span><button className="outline-button" disabled={locked || phase === "error"} onClick={() => move(basketPosition.current + 6)} aria-label="Di chuyển rổ sang phải"><ArrowRight size={18}/></button></div>
    <p className="game-status" role={phase === "error" ? "alert" : "status"}>{status}</p>
    <div className="modal-actions"><button className="outline-button" disabled={locked} onClick={onBack}>Quay lại</button>
      {(phase === "ready" || phase === "miss") && <button className="primary-button" onClick={start}>{phase === "miss" ? <RotateCcw size={17}/> : <Target size={17}/>} {phase === "miss" ? "Chơi lại" : "Bắt đầu"}</button>}
      {phase === "aiming" && <button className="primary-button" onClick={() => finish(target)}>Hứng máy <ShoppingBasket size={17}/></button>}
      {phase === "error" && <button className="primary-button" onClick={() => void save()}>Thử lưu lại</button>}
      {locked && <button className="primary-button" disabled>{phase === "caught" ? "Trúng rổ!" : "Đang lưu…"} <Check size={17}/></button>}
    </div>
  </div>;
}
