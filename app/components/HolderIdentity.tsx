export function HolderIdentity({ name }: { name: string }) {
  const words = name.trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase("vi");
  const tone = Array.from(name).reduce((sum, letter) => sum + letter.codePointAt(0)!, 0) % 4;
  return <span className="holder-identity">
    <span className={"holder-avatar holder-tone-" + tone} aria-hidden="true">{initials}</span>
    <span className="holder-name">{name}</span>
  </span>;
}
