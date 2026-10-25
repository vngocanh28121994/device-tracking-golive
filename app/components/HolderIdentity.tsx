export function UserAvatar({ name, src = "", className = "holder-avatar" }: { name: string; src?: string; className?: string }) {
  const words = name.trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase("vi");
  return <span className={className + " user-avatar"} aria-hidden="true">{initials}{src && <img key={src} src={src} alt="" onError={event=>{event.currentTarget.style.display="none"}}/>}</span>;
}
export function HolderIdentity({ name, avatar = "" }: { name: string; avatar?: string }) {
  const tone = Array.from(name).reduce((sum, letter) => sum + letter.codePointAt(0)!, 0) % 4;
  return <span className="holder-identity"><UserAvatar name={name} src={avatar} className={"holder-avatar holder-tone-" + tone}/><span className="holder-name">{name}</span></span>;
}
