"""Regenerate the dark-theme overrides at the end of app/globals.css.

The light stylesheet uses many literal colours. Instead of hand-copying each rule, this script
reads every declaration that contains a literal colour and emits the same rule under
:root[data-theme="dark"] with a dark counterpart chosen by the colour's role:
backgrounds become dark surfaces (pastel tints keep their hue), borders become subtle lines,
and dark text becomes light text. Run it again after adding literal colours:

    python3 scripts/generate-dark-theme.py
"""
import colorsys
import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "app" / "globals.css"
START, END = "/* dark-theme:generated:start */", "/* dark-theme:generated:end */"
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|rgb\([^)]*\)")
TEXT_PROPS = {"color", "fill", "stroke", "caret-color", "outline", "outline-color", "text-decoration-color"}


def parse_hex(value):
    h = value[1:]
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    alpha = h[6:8] if len(h) == 8 else ""
    return r, g, b, alpha


def parse_rgb(value):
    nums = re.findall(r"[\d.]+%?", value)
    r, g, b = (float(n) / 255 for n in nums[:3])
    alpha = ""
    if len(nums) > 3:
        a = nums[3]
        a = float(a[:-1]) / 100 if a.endswith("%") else float(a)
        alpha = format(round(a * 255), "02x")
    return r, g, b, alpha


def to_hex(r, g, b, alpha):
    return "#" + "".join(format(round(max(0, min(1, c)) * 255), "02x") for c in (r, g, b)) + alpha


def darken(value, role):
    r, g, b, alpha = parse_hex(value) if value.startswith("#") else parse_rgb(value)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if role == "text":
        if l > 0.9:  # white text sits on a coloured fill; keep it.
            return None
        if l < 0.5:
            l, s = 0.9 - l * 0.28, min(s, 0.55)
        elif l < 0.72:
            l = 0.74
        else:
            return None
    elif role == "border":
        if l > 0.75:
            l, s = 0.22 + (1 - l) * 0.4, min(s, 0.22)
        else:
            return None
    else:  # surface
        if alpha and l < 0.35:  # translucent dark overlays and shadows: deepen slightly.
            r, g, b = (c * 0.5 for c in (r, g, b))
            return to_hex(r, g, b, alpha)
        if l > 0.78:
            if s > 0.3:  # pastel tint: keep the hue as a dark tint.
                l, s = 0.17 + (1 - l) * 0.9, min(s * 0.55, 0.45)
            elif l > 0.97:  # plain white cards and controls use the theme surface.
                return "var(--surface)"
            else:  # neutral surface: lighter means raised, so invert the order.
                l, s = 0.14 - (1 - l) * 0.6, min(s, 0.12)
        elif l < 0.3:  # dark fills such as toasts.
            l = 0.3
        else:
            return None
    r, g, b = colorsys.hls_to_rgb(h, max(0.06, min(0.95, l)), s)
    return to_hex(r, g, b, alpha)


def role_of(prop):
    if prop in TEXT_PROPS:
        return "text"
    if prop.startswith("border") or prop in ("column-rule",):
        return "border"
    return "surface"


def blocks(text):
    """Yield (prelude, body) for top-level blocks, recursing is left to the caller."""
    i, depth, start, prelude_start = 0, 0, 0, 0
    while i < len(text):
        c = text[i]
        if text.startswith("/*", i):
            i = text.index("*/", i) + 2
            continue
        if c == "{":
            if depth == 0:
                prelude = text[prelude_start:i].strip()
                start = i + 1
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                yield prelude, text[start:i]
                prelude_start = i + 1
        elif c == ";" and depth == 0:
            prelude_start = i + 1
        i += 1


def prefix(selector_list):
    out = []
    for sel in selector_list.split(","):
        sel = sel.strip()
        if not sel:
            continue
        if sel.startswith(":root"):
            out.append(':root[data-theme="dark"]' + sel[5:])
        elif sel in ("html",):
            out.append('html[data-theme="dark"]')
        elif sel.startswith("::"):
            out.append(':root[data-theme="dark"] ' + sel)
        else:
            out.append(':root[data-theme="dark"] ' + sel)
    return ", ".join(out)


def convert_rules(text):
    out = []
    for prelude, body in blocks(text):
        if prelude.startswith("@keyframes") or prelude.startswith("@font-face"):
            continue
        if prelude.startswith("@media") or prelude.startswith("@supports"):
            inner = convert_rules(body)
            if inner:
                out.append(prelude + " {\n" + "\n".join("  " + line for line in inner) + "\n}")
            continue
        if prelude.startswith("@") or prelude.startswith(":root") and "--" in body:
            continue
        decls = []
        # Text on a fill that keeps its light-mode colour (a yellow badge, a solid chip) stays as is.
        fills = [d.split(":", 1)[1] for d in body.split(";") if ":" in d and d.split(":", 1)[0].strip() in ("background", "background-color")]
        kept_fill = any(COLOR.search(f) and all(darken(m.group(0), "surface") is None for m in COLOR.finditer(f)) for f in fills)
        for decl in body.split(";"):
            if ":" not in decl:
                continue
            prop, value = decl.split(":", 1)
            prop, value = prop.strip(), value.strip()
            if prop.startswith("--") or not COLOR.search(value):
                continue
            changed = False

            role = role_of(prop)
            if role == "text" and kept_fill:
                continue

            def swap(match, role=role):
                nonlocal changed
                dark = darken(match.group(0), role)
                if dark is None:
                    return match.group(0)
                changed = True
                return dark

            new_value = COLOR.sub(swap, value)
            if changed:
                decls.append(f"{prop}: {new_value}")
        if decls:
            out.append(prefix(prelude) + " { " + "; ".join(decls) + "; }")
    return out


def main():
    css = CSS.read_text()
    tail = ""
    if START in css:
        # Keep hand-tuned dark rules placed after the generated block; they must win over it.
        tail = css[css.index(END) + len(END):] if END in css else ""
        css = css[:css.index(START)].rstrip() + "\n"
    rules = convert_rules(css)
    generated = "\n".join([START, "/* Generated by scripts/generate-dark-theme.py; edit the light rules or the hand-tuned rules after this block, then rerun. */", *rules, END])
    CSS.write_text(css + "\n" + generated + (tail if tail.strip() else "\n"))
    print(f"{len(rules)} dark rules written", file=sys.stderr)


if __name__ == "__main__":
    main()
