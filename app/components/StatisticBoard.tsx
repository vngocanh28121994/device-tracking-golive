"use client";
import { useEffect, useState } from "react";
import { Rocket, Users } from "lucide-react";
import { GoliveStatisticTab } from "./GoliveStatisticTab";
import { QeStatisticTab } from "./QeStatisticTab";
import { readUrlParam, writeUrlParams } from "../lib/url-state";

type Person = { userId: string; displayName: string; avatar: string; role?: string };
type View = "golive" | "qe";
const DESCRIPTION: Record<View, string> = {
  golive: "Mỗi đợt golive đi qua 2 giai đoạn như màn Tracking Golive: giai đoạn 1 QE hoàn thành test web, giai đoạn 2 test app trên thiết bị. Ticket đã done ghi lại thời điểm QE đánh dấu; ticket chưa done có thể chọn để theo dõi riêng.",
  qe: "So sánh khối lượng và tốc độ test của từng QE qua các đợt golive.",
};

// The Statistic screen is two reports of the same data: one golive at a time, or one QE at a time.
// This frame owns the heading and the tabs so both stay on screen while a tab loads or fails, and
// so tab 1 keeps its open releases, its loaded tickets and its picks while tab 2 is shown.
export function StatisticBoard({ people, currentUserId, onToast, onError }: { people: Person[]; currentUserId: string; onToast: (message: string) => void; onError: (message: string) => void }) {
  const [view, setView] = useState<View>(() => readUrlParam("statView") === "qe" ? "qe" : "golive");
  // Tab 2 costs its own request, so it is mounted on first visit and then kept, never re-fetched on
  // every switch. ?view= is taken: the Tracking Golive board already uses it for its own tabs.
  const [qeOpened, setQeOpened] = useState(view === "qe");

  function switchView(next: View) {
    setView(next);
    if (next === "qe") setQeOpened(true);
    writeUrlParams({ statView: next === "qe" ? "qe" : "" }, true);
  }
  useEffect(() => {
    const fromUrl = () => {
      if (readUrlParam("tab") !== "statistic") return;
      const next: View = readUrlParam("statView") === "qe" ? "qe" : "golive";
      setView(next);
      if (next === "qe") setQeOpened(true);
    };
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, []);

  return <>
    <div className="page-heading"><div><h1>Statistic.</h1><p>{DESCRIPTION[view]}</p></div></div>
    <div className="filter-tabs golive-tabs" role="tablist" aria-label="Chế độ xem số liệu">
      <button role="tab" aria-selected={view === "golive"} className={view === "golive" ? "active" : ""} onClick={() => switchView("golive")}><Rocket size={15} /> Bản golive</button>
      <button role="tab" aria-selected={view === "qe"} className={view === "qe" ? "active" : ""} onClick={() => switchView("qe")}><Users size={15} /> QE</button>
    </div>
    <div hidden={view !== "golive"}><GoliveStatisticTab people={people} currentUserId={currentUserId} onToast={onToast} onError={onError} /></div>
    {qeOpened && <div hidden={view !== "qe"}><QeStatisticTab people={people} active={view === "qe"} /></div>}
  </>;
}
