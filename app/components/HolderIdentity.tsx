export function UserAvatar({ name, src = "", role = "", className = "holder-avatar" }: { name: string; src?: string; role?: string; className?: string }) {
  const words = name.trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase("vi");
  return <span className={className + " user-avatar"} aria-hidden="true"><span className="user-avatar-face">{initials}{src && <img key={src} src={src} alt="" onError={event=>{event.currentTarget.style.display="none"}}/>}</span>{role && <span className="user-avatar-role">{role}</span>}</span>;
}
export function HolderIdentity({ name, avatar = "", role = "" }: { name: string; avatar?: string; role?: string }) {
  const tone = Array.from(name).reduce((sum, letter) => sum + letter.codePointAt(0)!, 0) % 4;
  return <span className="holder-identity"><UserAvatar name={name} src={avatar} role={role} className={"holder-avatar holder-tone-" + tone}/><span className="holder-name">{name}{role && <span className="sr-only"> · {role}</span>}</span></span>;
}
