"use client";
import { LoadingState } from "./components/LoadingState";
import { readUrlParam, writeUrlParams } from "./lib/url-state";
import { useSidebarCollapsed, useTheme } from "./lib/preferences";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, History, Laptop, Menu, MoreHorizontal, Plus, Search, X, UserRound, Zap, Hand, Handshake, Smartphone, Camera, Headphones, Projector, Plug, Rocket, PanelLeftClose, PanelLeftOpen, Sun, Moon } from "lucide-react";
import { StyledSelect } from "./components/StyledSelect";
import { AvatarEditor } from "./components/AvatarEditor";
import { HolderIdentity, UserAvatar } from "./components/HolderIdentity";
import { HandoverGame } from "./components/HandoverGame";
import { DeviceHistory } from "./components/DeviceHistory";
import { GoliveBoard } from "./components/GoliveBoard";
import { AccountRoles } from "./components/AccountRoles";

type Device = { id:string; name:string; code:string; category:string; holder:string; note:string; holderUserId?:string|null };
type Profile = { userId:string; avatar:string; email:string; displayName:string; suggestedName?:string; configured:boolean; role:string };
type TeamAccount = { userId:string; email:string; displayName:string; avatar:string; role:string };
type Person = { userId:string; displayName:string; avatar:string; role:string };
type Draft = Omit<Device,"id"> & {id?:string};
const blank:Draft = {name:"",code:"",category:"iOS",holder:"Chưa xác định",note:""};
const categories = ["iOS","Android","Laptop","Máy tính bảng","Máy ảnh","Âm thanh","Trình chiếu","Phụ kiện","Khác"];
const today = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const prettyDate = (d:string) => new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(d+"T00:00:00Z"));
const makeHolderOptions = (devices:Device[]) => {
 const counts=new Map<string,number>();
 for(const item of devices)counts.set(item.holder,(counts.get(item.holder)||0)+1);
 return [{value:"__all__",label:"Tất cả người giữ",description:devices.length+" thiết bị"},...Array.from(counts,([holder,count])=>({value:holder,label:holder,description:count+" thiết bị"})).sort((a,b)=>(a.value==="Chưa xác định"?1:0)-(b.value==="Chưa xác định"?1:0)||a.label.localeCompare(b.label,"vi"))];
};
const AndroidBrandIcon = ({ name }: { name: string }) => {
 const brand = /samsung/i.test(name) ? "samsung" : /xiaomi|redmi|poco/i.test(name) ? "xiaomi" : /oppo/i.test(name) ? "oppo" : "";
 if (!brand) return <Smartphone className="device-svg" aria-label="Android"/>;
 return <span className={"device-brand device-brand-" + brand} role="img" aria-label={brand === "xiaomi" ? "Xiaomi" : brand === "oppo" ? "Oppo" : "Samsung"}>{brand === "samsung" ? "SAMSUNG" : brand === "xiaomi" ? "mi" : "oppo"}</span>;
};
const TabletIcon = () => <svg className="device-svg" viewBox="0 0 24 24" aria-label="iPad"><rect x="3.5" y="1.5" width="17" height="21" rx="2.6" fill="#2b2733"/><rect x="5" y="3.2" width="14" height="17.6" rx="1.2" fill="#9fd3ff"/><path d="M5 14.5 19 7.5v5.5L5 20z" fill="#c4e4ff"/><circle cx="12" cy="2.35" r=".45" fill="#6b6575"/></svg>;
const emoji = (category:string, name="") => {
 if(category==="Android") return <AndroidBrandIcon name={name}/>;
 if(category==="Máy tính bảng" || /ipad/i.test(name)) return <TabletIcon/>;
 const Icon = ({iOS:Smartphone,Laptop, "Máy ảnh":Camera,"Âm thanh":Headphones,"Trình chiếu":Projector} as Record<string,typeof Smartphone>)[category] || Plug;
 return <Icon className="device-svg" aria-hidden="true"/>;
};

export default function Home(){
 const [page,setPageState]=useState<"inventory"|"golive"|"profile">("inventory");
 // Moving to another screen records it in ?tab= (a new history entry), so a reload stays put.
 const setPage=useCallback((next:"inventory"|"golive"|"profile")=>{setPageState(next);if(readUrlParam("tab")!==(next==="inventory"?"":next))writeUrlParams({tab:next==="inventory"?"":next,...(next==="golive"?{}:{view:"",release:""})},true)},[]);
 const [people,setPeople]=useState<Person[]>([]),[avatarDraft,setAvatarDraft]=useState(""),[avatarProcessing,setAvatarProcessing]=useState(false);
 const [items,setItems]=useState<Device[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[toast,setToast]=useState(""),[query,setQuery]=useState(""),[filter,setFilter]=useState("Tất cả"),[holderFilter,setHolderFilter]=useState("__all__");
 const [modal,setModal]=useState(false),[draft,setDraft]=useState<Draft>(blank),[profile,setProfile]=useState<Profile|null>(null),[profileName,setProfileName]=useState(""),[mobileNav,setMobileNav]=useState(false);
 const [selectedDevice,setSelectedDevice]=useState<Device|null>(null),[deviceAction,setDeviceAction]=useState<"choose"|"hold"|"lend"|"history">("choose"),[borrower,setBorrower]=useState(""),[borrowerUserId,setBorrowerUserId]=useState("");
 // Desktop-only: the sidebar can shrink to an icon rail; the choice is remembered on this browser.
 const [navCollapsed,setNavCollapsed]=useSidebarCollapsed(),[navAnimated,setNavAnimated]=useState(false);
 // Animate only after the saved state is applied, so a reload does not show the rail shrinking.
 useEffect(()=>{const frame=requestAnimationFrame(()=>setNavAnimated(true));return()=>cancelAnimationFrame(frame)},[]);
 const toggleNav=()=>setNavCollapsed(!navCollapsed);
 const [theme,setTheme]=useTheme();
 const toggleTheme=()=>setTheme(theme==="dark"?"light":"dark");
 const [showHandoverGame,setShowHandoverGame]=useState(false),[signedOut,setSignedOut]=useState(false);
 const [teamAccounts,setTeamAccounts]=useState<TeamAccount[]>([]),[teamAccountsLoading,setTeamAccountsLoading]=useState(false),[teamAccountsError,setTeamAccountsError]=useState("");
 useEffect(()=>{
  if(!mobileNav)return;
  const sidebar=document.querySelector<HTMLElement>(".sidebar");
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const controls=()=>Array.from(sidebar?.querySelectorAll<HTMLButtonElement>("button")||[]).filter(button=>!button.disabled);
  controls()[0]?.focus();
  const close=()=>setMobileNav(false);
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();close()}
   if(event.key!=="Tab")return;
   const buttons=controls(),first=buttons[0],last=buttons[buttons.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  };
  const onClick=(event:MouseEvent)=>{if((event.target as Element).closest("button"))close()};
  sidebar?.addEventListener("click",onClick);
  document.addEventListener("keydown",onKey);
  return()=>{document.body.style.overflow=overflow;sidebar?.removeEventListener("click",onClick);document.removeEventListener("keydown",onKey);previous?.focus()};
 },[mobileNav]);
 useEffect(()=>{
  if(!selectedDevice&&!modal)return;
  const previous=document.activeElement as HTMLElement|null;
  const dialog=document.querySelector<HTMLElement>("[role=dialog]");
  const controls=()=>Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex=\"0\"]")||[]).filter(element=>element.getClientRects().length>0);
  if(!dialog?.contains(document.activeElement))controls()[0]?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.defaultPrevented)return;
   if(event.key==="Escape"&&!busy){setSelectedDevice(null);setModal(false)}
   if(event.key!=="Tab")return;
   const elements=controls(),first=elements[0],last=elements[elements.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  };
  document.addEventListener("keydown",onKey);
  return()=>{document.removeEventListener("keydown",onKey);previous?.focus()};
 },[selectedDevice,modal,busy]);
 const latestLoad=useRef(0);
 const load=useCallback(async()=>{const request=++latestLoad.current;try{const r=await fetch("/api/inventory",{cache:"no-store"});const data=await r.json() as {devices:Device[];people?:Person[];error?:string};if(!r.ok)throw new Error(data.error||"Không thể tải dữ liệu.");if(request!==latestLoad.current)return;setItems(data.devices);setPeople(data.people||[]);setError("")}catch(e){if(request===latestLoad.current)setError(e instanceof Error?e.message:"Không thể tải dữ liệu.")}finally{if(request===latestLoad.current)setLoading(false)}},[]);
 // Restore the screen from ?tab= on load and on Back/Forward.
 useEffect(()=>{
  const fromUrl=()=>{const tab=readUrlParam("tab");setPageState(tab==="golive"||tab==="profile"?tab:"inventory")};
  fromUrl();
  window.addEventListener("popstate",fromUrl);
  return()=>window.removeEventListener("popstate",fromUrl);
 },[]);
 // The golive page has its own data; people from the first inventory load are enough there.
 useEffect(()=>{if(page!=="golive")void load()},[page,load]);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==="visible")void load()};document.addEventListener("visibilitychange",refresh);return()=>document.removeEventListener("visibilitychange",refresh)},[load]);
 useEffect(()=>{void (async()=>{try{const r=await fetch("/api/profile",{cache:"no-store"});if(r.status===401){setSignedOut(true);return}const data=await r.json() as {profile?:Profile;error?:string};if(!r.ok)throw new Error(data.error||"Không thể tải hồ sơ.");if(data.profile){setProfile(data.profile);setAvatarDraft(data.profile.avatar||"");setProfileName(data.profile.displayName||data.profile.suggestedName||"")}}catch(e){setError(e instanceof Error?e.message:"Không thể tải hồ sơ.")}})()},[]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),3500);return()=>clearTimeout(t)},[toast]);
 const holderOptions=useMemo(()=>makeHolderOptions(items),[items]);
 useEffect(()=>{if(holderFilter!=="__all__"&&!items.some(item=>item.holder===holderFilter))setHolderFilter("__all__")},[items,holderFilter]);
 const visible=useMemo(()=>items.filter(x=>(x.name+" "+x.code+" "+x.holder+" "+x.category).toLowerCase().includes(query.toLowerCase())&&(filter==="Tất cả"||x.category===filter)&&(holderFilter==="__all__"||x.holder===holderFilter)),[items,query,filter,holderFilter]);
 async function post(body:Record<string,unknown>){const r=await fetch("/api/inventory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await r.json() as {error?:string;holder?:string;holderUserId?:string};if(!r.ok)throw new Error(result.error||"Không thể lưu thay đổi.");return result}
 async function saveDevice(){setBusy(true);try{await post({action:"save-device",...draft});setModal(false);setToast("Đã thêm thiết bị mới 🎉");await load()}catch(e){setError(e instanceof Error?e.message:"Không thể lưu.")}finally{setBusy(false)}}
 function openDevice(item:Device){setShowHandoverGame(false);setSelectedDevice(item);setDeviceAction("choose");setBorrower("");setBorrowerUserId("");setError("")}
 async function loadTeamAccounts(){setTeamAccountsLoading(true);setTeamAccountsError("");try{const r=await fetch("/api/profile?list=1",{cache:"no-store"});const data=await r.json() as {accounts?:TeamAccount[];error?:string};if(!r.ok)throw new Error(data.error||"Không thể tải tài khoản.");setTeamAccounts(data.accounts||[])}catch(e){setTeamAccountsError(e instanceof Error?e.message:"Không thể tải tài khoản.")}finally{setTeamAccountsLoading(false)}}
 function chooseAction(action:"hold"|"lend"){if(!profile?.configured){setSelectedDevice(null);setPage("profile");setError("Hãy đặt tên hiển thị trước khi thao tác với thiết bị.");return}setDeviceAction(action);if(action==="lend")void loadTeamAccounts()}
 async function confirmDeviceAction(){if(!selectedDevice)return false;setBusy(true);try{const result=await post({action:deviceAction==="hold"?"confirm-hold":"lend-device",deviceId:selectedDevice.id,borrower,borrowerUserId});if(!result.holder)throw new Error("Không nhận được tên người đang giữ.");latestLoad.current++;setItems(current=>current.map(item=>item.id===selectedDevice.id?{...item,holder:result.holder!,holderUserId:result.holderUserId}:item));setHolderFilter(current=>current==="__all__"||current===result.holder?current:"__all__");setSelectedDevice(null);setToast(deviceAction==="hold"?"Đã xác nhận bạn đang cầm "+selectedDevice.name+" ✅":"Đã cập nhật người mượn "+selectedDevice.name+" ✅");void load();return true}catch(e){setError(e instanceof Error?e.message:"Không thể cập nhật người giữ.");return false}finally{setBusy(false)}}
 async function saveProfile(){setBusy(true);try{const r=await fetch("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:profileName,...(avatarDraft!==(profile?.avatar||"")?{avatar:avatarDraft}:{})})});const data=await r.json() as {profile?:Profile;error?:string};if(!r.ok||!data.profile)throw new Error(data.error||"Không thể lưu hồ sơ.");setProfile(data.profile);setAvatarDraft(data.profile.avatar||"");setProfileName(data.profile.displayName);setError("");setToast("Đã lưu hồ sơ ✨");setPage("profile");await load()}catch(e){setError(e instanceof Error?e.message:"Không thể lưu hồ sơ.")}finally{setBusy(false)}}
 function holderAccount(name:string, userId?:string|null){
  if(userId!==undefined)return people.find(person=>person.userId===userId);
  const ids=new Set(items.filter(item=>item.holder===name).map(item=>item.holderUserId||""));
  return ids.size===1?people.find(person=>person.userId===Array.from(ids)[0]):undefined;
 }
 const nav=[["inventory",Laptop,"Kho thiết bị"],["golive",Rocket,"Tracking Golive"],["profile",UserRound,"Tài khoản của tôi"]] as const;
 return <div className="app-shell">{mobileNav&&<div className="nav-backdrop" onClick={()=>setMobileNav(false)}/>}<aside inert={modal||!!selectedDevice} className={"sidebar "+(mobileNav?"open ":"")+(navCollapsed?"collapsed ":"")+(navAnimated?"animated":"")}><div className="brand"><div className="brand-icon"><Zap size={22} fill="currentColor"/></div><div><strong>Quản lý thiết bị</strong><small>DEVICE CLUB</small></div></div><nav>{nav.map(([id,Icon,label])=><button key={id} className={"nav-item "+(page===id?"active":"")} title={navCollapsed?label:undefined} aria-label={label} onClick={()=>{setPage(id);setMobileNav(false)}}><Icon size={20}/><span className="nav-label">{label}</span></button>)}</nav><button type="button" className="nav-item sidebar-toggle" onClick={toggleNav} aria-expanded={!navCollapsed} aria-label={navCollapsed?"Mở rộng menu":"Thu gọn menu"} title={navCollapsed?"Mở rộng menu":"Thu gọn menu"}>{navCollapsed?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}<span className="nav-label">Thu gọn menu</span></button><div className="sidebar-spacer"/><div className="sidebar-note"><History size={24}/><strong>Mỗi món đồ đều có câu chuyện!</strong><p>Cùng chăm sóc kho thiết bị thật ngăn nắp mỗi ngày.</p></div><button className="sidebar-foot profile-foot" title={navCollapsed?(profile?.displayName||"Hồ sơ của bạn"):undefined} onClick={()=>setPage("profile")}><UserAvatar className="avatar" name={profile?.displayName||profile?.email||"K"} src={profile?.avatar} role={profile?.role}/><div><strong>{profile?.displayName||"Đặt tên tài khoản"}</strong><small>{profile?.email||"Hồ sơ của bạn"}</small></div></button></aside>
 <main className="main-area" inert={modal||!!selectedDevice||mobileNav}><header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(!mobileNav)} aria-label="Mở menu"><Menu/></button><div className="breadcrumb">Không gian làm việc <span>/</span> <strong>{nav.find(x=>x[0]===page)?.[2]}</strong></div><div className="top-actions"><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme==="dark"?"Chuyển sang giao diện sáng":"Chuyển sang giao diện tối"} title={theme==="dark"?"Giao diện sáng":"Giao diện tối"}>{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button><span className="today-pill"><CalendarDays size={15}/>{prettyDate(today())}</span><button className="top-avatar" onClick={()=>setPage("profile")} aria-label="Mở hồ sơ"><UserAvatar className="top-avatar-image" name={profile?.displayName||profile?.email||"K"} src={profile?.avatar} role={profile?.role}/></button></div></header><div className="content">{signedOut&&<div className="signin-banner"><div><strong>Bạn chưa đăng nhập</strong><p>Đăng nhập để xem kho thiết bị và các đợt golive.</p></div><a className="primary-button" href={"/signin-with-chatgpt?return_to="+encodeURIComponent(typeof window==="undefined"?"/":window.location.pathname)}>Đăng nhập <ArrowRight size={17}/></a></div>}{error&&!signedOut&&<div className="alert" role="alert">⚠️ {error}<button aria-label="Đóng thông báo" onClick={()=>setError("")}><X size={16}/></button></div>}{loading?<LoadingState label="Đang mở kho thiết bị..."/>:<>
 {page==="inventory"&&<><div className="page-heading"><div><h1>Mọi món đồ, một chỗ.</h1><p>Biết rõ từng thiết bị và người đang giữ.</p></div><button className="primary-button" onClick={()=>{setDraft({...blank});setModal(true)}}><Plus size={18}/> Thêm thiết bị</button></div><div className="inventory-toolbar"><div className="search"><Search size={19}/><input aria-label="Tìm thiết bị, mã hoặc người giữ" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm thiết bị, mã, người giữ..."/></div><div className="filter-tabs" role="tablist">{["Tất cả","iOS","Android"].map(c=><button key={c} role="tab" aria-selected={filter===c} className={filter===c?"active":""} onClick={()=>setFilter(c)}>{c}</button>)}</div><div className="holder-filter"><StyledSelect ariaLabel="Lọc theo người đang giữ" value={holderFilter} onChange={setHolderFilter} options={holderOptions} placeholder="Tất cả người giữ"/></div><span>{visible.length} kết quả</span></div><section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>THIẾT BỊ</th><th>DANH MỤC</th><th>NGƯỜI ĐANG GIỮ</th><th>THAO TÁC</th></tr></thead><tbody>{visible.map(x=><tr key={x.id}><td><div className="table-device"><div className="device-emoji">{emoji(x.category,x.name)}</div><div><strong>{x.name}</strong>{x.code&&<small>{x.code}</small>}</div></div></td><td className="cell-category"><span className={"category-chip "+(x.category==="Android"?"android":"")}>{x.category}</span></td><td className="cell-holder"><HolderIdentity name={x.holder} avatar={holderAccount(x.holder,x.holderUserId)?.avatar} role={holderAccount(x.holder,x.holderUserId)?.role}/></td><td><button type="button" className="open-device-button" aria-label={"Thao tác với "+x.name} title={"Thao tác với "+x.name} onClick={()=>openDevice(x)}><MoreHorizontal size={21} strokeWidth={2.8}/></button></td></tr>)}</tbody></table>{visible.length===0&&<p className="empty">Không tìm thấy thiết bị nào.</p>}</div></section><p className="hint">Mỗi đầu thiết bị là một dòng riêng. Nhấn nút ba chấm để nhận máy, cho mượn hoặc xem lịch sử giữ thiết bị.</p></>}
 {page==="golive"&&<GoliveBoard people={people} currentUserId={profile?.userId||""} onError={setError} onToast={setToast} onManageRoles={()=>setPage("profile")}/>}
 {page==="profile"&&<><div className="page-heading"><div><h1>Hồ sơ của bạn.</h1><p>Chọn ảnh đại diện và tên hiển thị để đồng đội dễ nhận ra bạn.</p></div></div><section className="panel profile-panel"><div className="profile-hero"><UserAvatar className="profile-avatar" name={profile?.displayName||profile?.email||"K"} src={profile?.avatar} role={profile?.role}/><div><h2>{profile?.email||"Đang tải tài khoản..."}</h2><p>Email được xác nhận qua tài khoản ChatGPT đăng nhập và không thể sửa ở đây.</p></div></div><AvatarEditor role={profile?.role} value={avatarDraft} name={profileName||profile?.email||"?"} disabled={busy||avatarProcessing||!profile} onChange={setAvatarDraft} onProcessingChange={setAvatarProcessing}/><label className="profile-name-label" htmlFor="profile-name">TÊN HIỂN THỊ</label><input id="profile-name" className="profile-name-input" value={profileName} onChange={e=>setProfileName(e.target.value)} maxLength={60} placeholder="Ví dụ: Nguyễn Minh Anh"/><p className="profile-hint">Tên từ 2 đến 60 ký tự. Bạn có thể thay đổi sau; các lượt bàn giao cũ vẫn giữ tên đã ghi lúc thực hiện.</p><button className="primary-button" disabled={busy||avatarProcessing||!profile} onClick={()=>void saveProfile()}>{busy?"Đang lưu...":"Lưu hồ sơ"} <ArrowRight size={17}/></button></section></>}
 {page==="profile"&&<AccountRoles onRoleChange={(userId,role)=>{setProfile(current=>current?.userId===userId?{...current,role}:current);setPeople(current=>current.map(person=>person.userId===userId?{...person,role}:person));setTeamAccounts(current=>current.map(account=>account.userId===userId?{...account,role}:account))}}/>}
 </>}</div></main>{toast&&<div className="toast" role="status">{toast}</div>}
 {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false)}}><div className="modal" role="dialog" aria-modal="true" aria-label="Thêm thiết bị mới"><div className="modal-head"><div><h2>Thêm thiết bị mới</h2></div><button className="icon-button" onClick={()=>setModal(false)} aria-label="Đóng"><X size={21}/></button></div><div className="form-grid"><label className="span-2">TÊN THIẾT BỊ<input autoFocus value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Ví dụ: Laptop Dell Latitude"/></label><label>MÃ THIẾT BỊ<input value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})} placeholder="LT-001"/></label><label>DANH MỤC<StyledSelect ariaLabel="Danh mục thiết bị" value={draft.category} onChange={category=>setDraft({...draft,category})} options={categories.map(category=>({value:category,label:category}))} placeholder="Chọn danh mục"/></label><label className="span-2">GHI CHÚ<textarea rows={2} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label></div><div className="modal-actions"><button className="outline-button" onClick={()=>setModal(false)}>Không</button><button className="primary-button" disabled={busy} onClick={()=>void saveDevice()}>{busy?"Đang lưu...":"Thêm thiết bị"} <ArrowRight size={17}/></button></div></div></div>}
 {selectedDevice&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setSelectedDevice(null)}}><div className="modal device-dialog" role="dialog" aria-modal="true" aria-label={deviceAction==="history"?"Lịch sử giữ thiết bị":deviceAction==="choose"?"Thao tác với thiết bị":deviceAction==="hold"?"Xác nhận cầm máy":"Cho mượn thiết bị"}><div className="modal-head"><div className="dialog-device-heading"><span className="dialog-device-icon" aria-hidden="true">{emoji(selectedDevice.category,selectedDevice.name)}</span><h2>{selectedDevice.name}</h2></div><button className="icon-button" disabled={busy} onClick={()=>setSelectedDevice(null)} aria-label="Đóng"><X size={21}/></button></div><div className="device-dialog-current"><span>Người đang giữ</span><HolderIdentity name={selectedDevice.holder} avatar={holderAccount(selectedDevice.holder,selectedDevice.holderUserId)?.avatar} role={holderAccount(selectedDevice.holder,selectedDevice.holderUserId)?.role}/></div>{showHandoverGame?<HandoverGame recipient={deviceAction==="hold"?(profile?.displayName||""):(borrowerUserId?(teamAccounts.find(account=>account.userId===borrowerUserId)?.displayName||""):borrower.trim())} deviceIcon={emoji(selectedDevice.category,selectedDevice.name)} onComplete={confirmDeviceAction} onBack={()=>setShowHandoverGame(false)} errorMessage={error}/>:deviceAction==="history"?<DeviceHistory key={selectedDevice.id} deviceId={selectedDevice.id} onBack={()=>setDeviceAction("choose")}/>:deviceAction==="choose"?<div className="device-choice-list"><button onClick={()=>chooseAction("hold")}><span className="choice-icon"><Hand size={23}/></span><span><strong>Nhận / lấy lại máy</strong><small>Ghi tên tài khoản của bạn là người đang giữ</small></span><ArrowRight size={17}/></button><button onClick={()=>chooseAction("lend")}><span className="choice-icon"><Handshake size={23}/></span><span><strong>Cho mượn</strong><small>Chọn tài khoản nội bộ hoặc nhập tên người ngoài</small></span><ArrowRight size={17}/></button><button onClick={()=>setDeviceAction("history")}><span className="choice-icon"><History size={23}/></span><span><strong>Lịch sử giữ thiết bị</strong><small>Xem các lần nhận máy, cho mượn và người thao tác</small></span><ArrowRight size={17}/></button></div>:<><h3 className="device-dialog-title">{deviceAction==="hold"?"Xác nhận cầm máy?":"Cho mượn thiết bị?"}</h3>{deviceAction==="hold"?<p className="device-dialog-copy">Bạn xác nhận đang cầm <strong>{selectedDevice.name}</strong>. Người đang giữ sẽ được cập nhật thành <strong>{profile?.displayName}</strong>.</p>:<div className="borrower-options"><label className="borrower-label">NGƯỜI MƯỢN<StyledSelect ariaLabel="Chọn người mượn có tài khoản" value={borrowerUserId} disabled={teamAccountsLoading} onChange={value=>setBorrowerUserId(value==="__manual__"?"":value)} options={[{value:"__manual__",label:"Nhập tên tự do",description:"Người không có tài khoản"},...teamAccounts.map(account=>({value:account.userId,label:account.displayName,description:account.email,avatar:account.avatar,role:account.role}))]} placeholder={teamAccountsLoading?"Đang tải...":"Chọn user có sẵn"}/></label>{teamAccountsLoading&&<p className="borrower-help">Đang tải tài khoản nội bộ...</p>}{teamAccountsError&&<p className="borrower-help">{teamAccountsError} Bạn vẫn có thể nhập tên bên dưới.</p>}{!teamAccountsLoading&&!teamAccountsError&&teamAccounts.length===0&&<p className="borrower-help">Chưa có thành viên nào đặt tên tài khoản.</p>}{borrowerUserId?<p className="borrower-help">Người đang giữ sẽ là {teamAccounts.find(account=>account.userId===borrowerUserId)?.displayName}.</p>:<label className="borrower-label">TÊN NGƯỜI / TEAM MƯỢN<input autoFocus value={borrower} maxLength={100} onChange={e=>setBorrower(e.target.value)} placeholder="Ví dụ: Sếp Toàn hoặc Team QA"/></label>}</div>}<div className="modal-actions"><button className="outline-button" disabled={busy} onClick={()=>setDeviceAction("choose")}>Quay lại</button><button className="primary-button" disabled={busy||(deviceAction==="lend"&&!borrowerUserId&&!borrower.trim())} onClick={()=>setShowHandoverGame(true)}>{busy?"Đang lưu...":"Tiếp tục bàn giao"} <Check size={17}/></button></div></>}</div></div>}</div>
}
