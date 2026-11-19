// Context window use of the Claude Code or Codex agent in view: "149.4k / 1M", a bar,
// and a little line of how it grew over the session (drops are compactions).
// Reads the session's transcript on the agent's own machine with reader.py.
// Colored with the agent's space color (see vm-spaces).

import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, hc, exec, readTextFile, appHome, theme, shared, checking } from "herdr";

// Claude Code doesn't record the window size; current Claude models run with 1M.
// Codex records its own (model_context_window), which wins.
const WINDOW = 1_000_000;
const APPS = new Set(["claude-code", "codex"]);
// While an agent works, look again this often (ms); otherwise on each change of its status.
const WORKING_EVERY = 15000;
// Claude Code only: past this a session gets less sharp, so the bar gets a tick here,
// the chart a dashed line once a peak comes near it, and the percentage turns amber.
const SOFT_LIMIT = 500_000;
const AMBER = "#e5a53a";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function spaceColor(id, t) {
  const c = (shared("space.colors") ?? {})[id];
  if (!c) return t.accent;
  return (c.startsWith("#") ? c : MARK[c] ?? t[c] ?? t.accent).slice(0, 7);
}

function tokens(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const agentInView = () => agents().find((a) => a.focused && APPS.has(a.app)) ?? null;

export default class Context extends View {
  init(_props, cx) {
    this.data = {}; // address -> { used, points, model, at }
    this.key = null;
    this.busy = false;
    if (checking()) return;
    cx.timer.every(1000, (cx) => this.tick(cx));
  }

  // Cheap: reads only agents(). Fetches when the agent in view, its status or its
  // turn changes, and every WORKING_EVERY while it works.
  tick(cx) {
    const a = agentInView();
    if (!a) {
      if (this.key !== null) { this.key = null; cx.notify(); }
      return;
    }
    const key = `${a.address}|${a.status}|${a.seq}`;
    const last = this.data[a.address];
    const stale = a.status === "working" && (!last || Date.now() - last.at > WORKING_EVERY);
    if (key === this.key && !stale) return;
    this.key = key;
    this.fetch(a.address, a.app, cx);
    cx.notify();
  }

  fetch(address, app, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        this.script ??= await readTextFile(`${appHome()}/mods/vm-context/reader.py`);
        const got = await hc(["get", address, "--json"]);
        const pid = JSON.parse(got.stdout)?.foreground?.pid;
        if (pid && this.script) {
          const on = address.includes("/") ? address.split("/")[0] : null;
          const r = await exec("python3", ["-c", this.script, String(pid), app], { on, timeout: 20000 });
          const d = JSON.parse(r.stdout);
          if (d.used != null) this.data[address] = { ...d, at: Date.now() };
        }
      } catch {}
      this.busy = false;
      cx.notify();
    });
  }

  chart(points, color, soft) {
    const peak = Math.max(...points);
    const near = soft && peak >= soft * 0.6;
    const max = Math.max(peak * 1.12, near ? soft * 1.1 : 0) || 1;
    const n = points.length;
    const xy = points.map((p, i) => [`${n === 1 ? 100 : (i / (n - 1)) * 100}%`, `${100 - (p / max) * 100}%`]);
    const line = xy.slice(1).reduce((b, [x, y]) => b.line_to(x, y), PathBuilder.stroke(1.5).move_to(...xy[0]));
    const area = PathBuilder.fill().add_polygon([...xy, ["100%", "100%"], ["0%", "100%"]], true);
    const y = `${100 - (soft / max) * 100}%`;
    // Dashes: 40 of them, each half a step long.
    const dash = near && Array.from({ length: 40 }, (_, i) => i * 2.5)
      .reduce((b, x) => b.move_to(`${x}%`, y).line_to(`${x + 1.25}%`, y), PathBuilder.stroke(1));
    return div().relative().h(30).w_full()
      .child(window.paint_path(area.build(), color + "26").absolute().top(0).left(0).size_full())
      .when(Boolean(dash), (el) => el.child(window.paint_path(dash.build(), AMBER + "aa").absolute().top(0).left(0).size_full()))
      .child(window.paint_path(line.build(), color).absolute().top(0).left(0).size_full());
  }

  render() {
    const t = theme();
    const a = agentInView();
    const d = a && this.data[a.address];
    const shell = v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(16).pt(9).pb(8).gap(6).text_size(11.5);
    if (!a) return shell.child(div().text_color(t.dim).child("Context · no Claude Code or Codex agent in view"));
    const color = spaceColor(a.space, t);
    if (!d) return shell.child(div().text_color(t.dim).child("Context · reading…"));
    const size = d.window || WINDOW;
    const pct = Math.min(1, d.used / size);
    const soft = a.app === "claude-code" && size > SOFT_LIMIT ? SOFT_LIMIT : null;
    const tick = soft && PathBuilder.stroke(1.5).move_to(`${(soft / size) * 100}%`, "0%").line_to(`${(soft / size) * 100}%`, "100%");
    const bar = PathBuilder.fill().add_polygon([["0%", "0%"], [`${pct * 100}%`, "0%"], [`${pct * 100}%`, "100%"], ["0%", "100%"]], true);
    return shell
      .child(h_flex().items_center().gap(6)
        .child(div().text_color(t.dim).child("Context"))
        .child(div().font_semibold().text_color(soft && d.used > soft ? AMBER : color).child(`${Math.round(pct * 100)}%`))
        .child(div().flex_1())
        .child(div().text_color(t.muted).child(`${tokens(d.used)} / ${tokens(size)}`)))
      .child(div().relative().h(4).w_full().rounded(2).bg(t.border).overflow_hidden()
        .child(window.paint_path(bar.build(), color).absolute().top(0).left(0).size_full())
        .when(Boolean(tick), (el) => el.child(window.paint_path(tick.build(), AMBER).absolute().top(0).left(0).size_full())))
      .when(d.points?.length > 1, (el) => el.child(this.chart(d.points, color, soft)));
  }
}
