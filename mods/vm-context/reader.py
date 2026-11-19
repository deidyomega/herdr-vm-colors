# Context use of a coding agent's session, from the process id of the agent
# (argv[1]) and the app it reported (argv[2]: "claude-code" or "codex").
# Prints {"used", "window", "model", "points"}; "window" is null when the
# agent doesn't record it (Claude Code), and the panel assumes 1M then.
import glob, json, os, sys

POINTS = 48


def sample(pts):
    if len(pts) <= POINTS:
        return pts
    step = len(pts) / POINTS
    return [pts[min(len(pts) - 1, int((i + 1) * step) - 1)] for i in range(POINTS)]


def done(**out):
    print(json.dumps(out))
    sys.exit()


# Claude Code: ~/.claude/sessions/<pid>.json names the session; its transcript
# records every reply's usage: input + cache reads + cache writes = context.
def claude(pid):
    home = os.path.expanduser("~/.claude")
    try:
        session = json.load(open(f"{home}/sessions/{pid}.json"))["sessionId"]
    except Exception:
        done(error="no session")
    files = glob.glob(f"{home}/projects/*/{session}.jsonl")
    if not files:
        done(session=session, used=None)
    usage, model = {}, None
    with open(max(files, key=os.path.getmtime), "rb") as f:
        for line in f:
            if b'"usage"' not in line or b'"assistant"' not in line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") != "assistant" or d.get("isSidechain"):
                continue
            m = d.get("message") or {}
            u = m.get("usage") or {}
            total = sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
            if not total:
                continue
            # One reply's blocks share a request: the last one wins, order is kept.
            usage[d.get("requestId") or m.get("id") or len(usage)] = total
            if m.get("model") and not m["model"].startswith("<"):
                model = m["model"]
    pts = sample(list(usage.values()))
    done(session=session, model=model, window=None, used=pts[-1] if pts else None, points=pts)


# Codex: the rollout log it holds open (~/.codex/sessions/.../rollout-*.jsonl)
# has a token_count event per reply with last_token_usage and the model's
# context window. Found through the open files of the process or its children,
# else the newest log started in the same folder after the process.
def descendants(pid):
    out, todo = [], [str(pid)]
    while todo:
        p = todo.pop()
        out.append(p)
        for task in glob.glob(f"/proc/{p}/task/*/children"):
            try:
                todo += open(task).read().split()
            except Exception:
                pass
    return out


def codex_log(pid):
    root = os.path.realpath(os.path.expanduser("~/.codex/sessions"))
    for p in descendants(pid):
        for fd in glob.glob(f"/proc/{p}/fd/*"):
            try:
                target = os.readlink(fd)
            except Exception:
                continue
            if target.startswith(root) and target.endswith(".jsonl"):
                return target
    try:
        cwd = os.readlink(f"/proc/{pid}/cwd")
        started = os.stat(f"/proc/{pid}").st_mtime
    except Exception:
        return None
    newest = None
    for f in glob.glob(f"{root}/*/*/*/rollout-*.jsonl"):
        if os.path.getmtime(f) < started:
            continue
        try:
            meta = json.loads(open(f).readline()).get("payload") or {}
        except Exception:
            continue
        if meta.get("cwd") == cwd and (newest is None or os.path.getmtime(f) > os.path.getmtime(newest)):
            newest = f
    return newest


def codex(pid):
    log = codex_log(pid)
    if not log:
        done(error="no codex log")
    pts, window, model = [], None, None
    with open(log, "rb") as f:
        for line in f:
            if b'"token_count"' not in line and b'"turn_context"' not in line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            p = d.get("payload") or {}
            if d.get("type") == "turn_context":
                model = p.get("model") or model
                continue
            info = p.get("info") or {}
            last = info.get("last_token_usage") or {}
            used = last.get("total_tokens") or (last.get("input_tokens") or 0) + (last.get("output_tokens") or 0)
            window = info.get("model_context_window") or window
            # The same reply can be reported twice; keep one point for it.
            if used and (not pts or pts[-1] != used):
                pts.append(used)
    pts = sample(pts)
    done(session=os.path.basename(log), model=model, window=window, used=pts[-1] if pts else None, points=pts)


pid, app = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "claude-code")
codex(pid) if app == "codex" else claude(pid)
