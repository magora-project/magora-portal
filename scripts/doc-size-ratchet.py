#!/usr/bin/env python3
"""doc-size-ratchet.py — governed docs may not grow.

Spec: claude-config docs/superpowers/specs/2026-10-09-knowledge-architecture-and-doc-ratchet-design.md.
ONE implementation: the canonical copy lives in claude-config and is vendored byte-identical
into every repo that runs it (hooks/canonical-source-registry.tsv). Never patch a vendored copy.

CI never runs the PR's copy. The workflow step resolves BASE and HEAD (pull_request: HEAD^1 and
HEAD of GitHub's merge commit; push: github.event.before and github.sha), extracts THIS script
from BASE, and passes both shas here. The config is read from BASE too, so no PR can loosen the
script or the config that judges it.

Config, doc-size.conf at the repo root: one entry per line, full-line `#` comments allowed.
    <path-or-glob> <mode> [new=cap:N]
mode is `ratchet` (HEAD bytes <= BASE bytes), `frozen` (byte-identical; literal paths only) or
`cap:N` (HEAD bytes <= N). A glob is judged on the AGGREGATE bytes of every file it matches.
`*` matches within one path segment; a whole `**` segment matches zero or more directories.
`new=cap:N` (globs only): each file new at HEAD must be <= N bytes, unless it pairs one-to-one,
by identical blob id, with a BASE path that left the glob (a pure rename).

Exit codes: 0 pass · 1 a governed file grew, changed or was deleted, HEAD adds a symlink or
gitlink inside a governed path, or HEAD drops the gate ·
2 could not judge. Exit 2 is never a pass. There is no exemption flag, env override or PR-body
declaration, by design.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict

SCRIPT_PATH = "scripts/doc-size-ratchet.py"
CONF_PATH = "doc-size.conf"
REGULAR_MODES = ("100644", "100755")
LFS_PREFIX = b"version https://git-lfs.github.com/spec/v1"
ALL_ZERO = re.compile(r"0+")
MODE_RE = re.compile(r"ratchet|frozen|cap:([0-9]{1,12})")
NEW_RE = re.compile(r"new=cap:([0-9]{1,12})")
REMEDY = ("Remedy: shrink the file, or route the content per the routing test (CLAUDE.md "
          "§ Maintaining this file). Raising a ceiling is a separate config-only PR the user approves.")
# Popped BEFORE asking git for its own list, so a hostile value cannot break the enumeration
# that is meant to remove it. `git rev-parse --local-env-vars` (scrubbed_env) is the authority;
# this is git 2.x's list, kept only as that pre-scrub.
GIT_LOCAL_VARS_FALLBACK = (
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX",
    "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
)


class Fault(Exception):
    """A question the ratchet could not answer. Always exit 2."""


def q(path):
    """A path as printable text. HEAD paths are PR-controlled; JSON-quoting escapes newlines and
    control characters, so a filename can never start a line of its own (no `::` workflow command)."""
    return json.dumps(path)


def scrubbed_env():
    env = dict(os.environ)
    for name in GIT_LOCAL_VARS_FALLBACK:
        env.pop(name, None)
    try:
        listed = subprocess.run(["git", "rev-parse", "--local-env-vars"], env=env,
                                capture_output=True, text=True, check=True).stdout.split()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise Fault(f"cannot list git's repo-local variables ({type(exc).__name__})")
    for name in listed:
        env.pop(name, None)
    return env


class Git:
    def __init__(self, repo):
        self.repo = repo
        self.env = scrubbed_env()

    def run(self, *args):
        try:
            r = subprocess.run(["git", "-C", self.repo, *args], env=self.env, capture_output=True)
        except OSError as exc:
            raise Fault(f"git {args[0]} could not start ({type(exc).__name__})")
        if r.returncode != 0:
            raise Fault(f"git {args[0]} exited {r.returncode}")
        return r.stdout

    def commit(self, rev, label):
        try:
            return self.run("rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}").decode().strip()
        except Fault:
            raise Fault(f"{label} {rev!r} does not resolve to a commit")

    def tree(self, sha):
        """{path: (mode, object id, bytes)} for every entry in SHA's tree. A gitlink (mode 160000)
        is KEPT, with 0 bytes, so a governed path replaced by one is judged as a non-regular file
        rather than read as deleted."""
        out = {}
        for rec in self.run("ls-tree", "-r", "-z", "-l", "--full-tree", sha).split(b"\0"):
            if not rec:
                continue
            meta, _, path = rec.partition(b"\t")
            mode, kind, obj, size = meta.decode("ascii").split()
            name = path.decode("utf-8", "surrogateescape")
            if kind == "blob" and not size.isdigit():  # ls-tree prints e.g. BAD for a missing object
                raise Fault(f"{q(name)} at {sha[:12]} is an unreadable object (size {size!r})")
            out[name] = (mode, obj, int(size) if kind == "blob" else 0)
        return out

    def blob(self, obj):
        return self.run("cat-file", "blob", obj)


def compile_glob(pat, where):
    parts = pat.split("/")
    out = []
    for i, seg in enumerate(parts):
        last = i == len(parts) - 1
        if seg == "**":
            if last:
                raise Fault(f"{where}: '**' must be followed by '/<segment>'")
            out.append("(?:[^/]+/)*")
            continue
        if "**" in seg:
            raise Fault(f"{where}: '**' must be a whole path segment")
        out.append("".join("[^/]*" if c == "*" else re.escape(c) for c in seg))
        if not last:
            out.append("/")
    return re.compile("".join(out))


class Entry:
    def __init__(self, pattern, mode, cap, new_cap, regex):
        self.pattern, self.mode, self.cap, self.new_cap, self.regex = pattern, mode, cap, new_cap, regex
        self.label = f"cap:{cap}" if mode == "cap" else mode


def parse_config(raw):
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Fault("config is not UTF-8")
    entries, seen = [], set()
    for n, line in enumerate(text.split("\n"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        where = f"config line {n}"
        f = line.split()
        if len(f) not in (2, 3):
            raise Fault(f"{where}: expected '<path-or-glob> <mode> [new=cap:N]'")
        pat, mode = f[0], f[1]
        m = MODE_RE.fullmatch(mode)
        if not m:
            raise Fault(f"{where}: unknown mode {mode!r} (ratchet | frozen | cap:N)")
        segs = pat.split("/")
        if any(s in ("", ".", "..") for s in segs):
            raise Fault(f"{where}: {pat!r} is not a repository-relative path")
        is_glob = "*" in pat
        new_cap = None
        if len(f) == 3:
            nm = NEW_RE.fullmatch(f[2])
            if not nm:
                raise Fault(f"{where}: third field must be new=cap:N")
            if not is_glob:
                raise Fault(f"{where}: new=cap applies to globs only")
            new_cap = int(nm.group(1))
        if mode == "frozen" and (is_glob or new_cap is not None):
            raise Fault(f"{where}: frozen applies to literal paths only")
        if pat in seen:
            raise Fault(f"{where}: duplicate entry {pat!r}")
        seen.add(pat)
        regex = compile_glob(pat, where) if is_glob else None
        kind = "cap" if mode.startswith("cap:") else mode
        entries.append(Entry(pat, kind, int(m.group(1)) if m.group(1) else None, new_cap, regex))
    if not entries:
        raise Fault("config has no entries")
    return entries


def ancestors(path):
    """`a/b/c.md` -> ["a", "a/b"]."""
    parts = path.split("/")[:-1]
    return ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]


def matches(entry, tree):
    if entry.regex is None:
        return {entry.pattern: tree[entry.pattern]} if entry.pattern in tree else {}
    return {p: v for p, v in tree.items() if entry.regex.fullmatch(p)}


def new_file_violations(e, mb, mh):
    new = sorted(set(mh) - set(mb))
    departed = defaultdict(list)
    for p in sorted(set(mb) - set(mh)):
        departed[mb[p][1]].append(p)
    exempt = set()
    for p in new:  # sorted, so each blob's new paths pair with its departed paths in order
        pool = departed.get(mh[p][1])
        if pool:
            pool.pop(0)
            exempt.add(p)
    return [f"FAIL {e.pattern} (new=cap:{e.new_cap}): new file {q(p)} is {mh[p][2]} bytes, "
            f"over the {e.new_cap}-byte cap for new files"
            for p in new if p not in exempt and mh[p][2] > e.new_cap]


def glob_root(e):
    """The fixed directory prefix of a glob (`skills/**/*.md` -> "skills", `**/*.md` -> ""), or
    None for a literal path."""
    if e.regex is None:
        return None
    root = []
    for seg in e.pattern.split("/")[:-1]:
        if "*" in seg:
            break
        root.append(seg)
    return "/".join(root)


def norm(s):
    return unicodedata.normalize("NFC", s).casefold()


def case_variants(e, ht):
    """HEAD paths that are NOT matched exactly by the entry but equal it under NFC + casefold, so a
    `CLAUDE.md` re-added as `Claude.md` cannot leave the governed set on a case-sensitive git."""
    if e.regex is None:
        want = norm(e.pattern)
        return sorted(p for p in ht if p != e.pattern and norm(p) == want)
    rx = compile_glob(norm(e.pattern), e.pattern)
    return sorted(p for p in ht if not e.regex.fullmatch(p) and rx.fullmatch(norm(p)))


def is_lfs_pointer(git, entry):
    """A Git LFS pointer is ~130 bytes of text; only small regular files are read."""
    mode, obj, size = entry
    return mode in REGULAR_MODES and size <= 1024 and git.blob(obj).startswith(LFS_PREFIX)


def judge(e, bt, ht, head_names, git):
    """Return (status, lines). status is PASS, FAIL or RETIRED. Raises Fault."""
    mb, mh = matches(e, bt), matches(e, ht)
    # Variants first: an entry that matches nothing exactly may still have a case/NFC variant at
    # HEAD (`Docs/large.md` for `docs/**/*.md`), which must fail before it can retire or Fault.
    variants = case_variants(e, ht)
    if not mb and not mh and variants:
        return "FAIL", [f"FAIL {e.pattern} ({e.label}): {q(p)} at HEAD is a case/normalisation variant "
                        "of governed path" for p in variants]
    if not mb and not mh:
        if head_names is not None and e.pattern not in head_names:
            return "RETIRED", [f"RETIRED: {e.pattern} (governs no file, and HEAD's config drops it)"]
        kind = "glob" if e.regex else "literal path"
        raise Fault(f"{kind} {e.pattern!r} matches no file at BASE or HEAD; fix the entry or remove it")
    for p, (mode, _, _) in mb.items():
        if mode not in REGULAR_MODES:
            raise Fault(f"{q(p)} at BASE has mode {mode}, not a regular file")
    # Links (symlinks, gitlinks) are refused tree-wide by `link_problems` before any entry is
    # judged, so a HEAD that reaches here has none inside a governed region.
    odd = []
    # Deleting every file an entry governs while keeping the entry leaves an entry that matches
    # nothing at BASE for the next run, which Faults (exit 2). Remove the entry in the same PR.
    if mb and not mh and e.mode != "frozen" and head_names is not None and e.pattern in head_names:
        odd.append(f"FAIL {e.pattern} ({e.label}): HEAD deletes every file this entry governs but "
                   "keeps the entry; every later PR would exit 2. Remove the entry in the same PR")
    odd += [f"FAIL {e.pattern} ({e.label}): {q(p)} at HEAD is a Git LFS pointer; "
            "governed paths must hold their content" for p, v in sorted(mh.items()) if is_lfs_pointer(git, v)]
    odd += [f"FAIL {e.pattern} ({e.label}): {q(p)} at HEAD is a case/normalisation variant of governed path"
            for p in variants]
    if odd:
        return "FAIL", odd
    bsz = sum(v[2] for v in mb.values())
    hsz = sum(v[2] for v in mh.values())
    fails = []
    if e.mode == "frozen":
        b, h = mb.get(e.pattern), mh.get(e.pattern)
        if h is None:
            fails.append(f"FAIL {e.pattern} (frozen): deleted at HEAD; a frozen file must stay byte-identical")
        elif b is None or b[1] != h[1]:
            fails.append(f"FAIL {e.pattern} (frozen): changed at HEAD (base={bsz} head={hsz}); "
                         "a frozen file must stay byte-identical")
    elif e.mode == "ratchet":
        if hsz > bsz:
            fails.append(f"FAIL {e.pattern} (ratchet): base={bsz} head={hsz} delta=+{hsz - bsz}")
    elif hsz > e.cap:
        fails.append(f"FAIL {e.pattern} (cap:{e.cap}): base={bsz} head={hsz} delta={hsz - bsz:+d}, "
                     f"{hsz - e.cap} over the cap")
    if e.new_cap is not None:
        fails += new_file_violations(e, mb, mh)
    if fails:
        return "FAIL", fails
    return "PASS", [f"PASS {e.pattern} ({e.label}): base={bsz} head={hsz} delta={hsz - bsz:+d}"]


def link_problems(all_entries, ht):
    """FAIL lines for every symlink or gitlink in HEAD's tree inside any entry's governed region."""
    return [f"FAIL {e.pattern} ({e.label}): {q(d)} at HEAD has mode {mode}; "
            "a link inside a governed path cannot be measured" for e, d, mode in link_hits(all_entries, ht)]


def link_hits(all_entries, tree):
    """(entry, path, mode) for every symlink or gitlink in TREE inside any entry's governed region.
    Used for HEAD (a FAIL) and for BASE (a Fault), so the two can never disagree about the region.

    A link's size is the size of its target's NAME, so content reached through it can never be
    measured. The region is judged from the tree alone, never from what an entry matches, so no
    match state (a deletion, a retirement, a new directory) can route around it:
      - a literal entry: the path itself and each of its ancestor directories;
      - a glob: its fixed directory prefix (`skills/**/*.md` -> `skills`), that prefix's ancestors,
        and everything under it (`**/*.md` governs the whole tree).
    Paths are compared under NFC + casefold, since a case-insensitive checkout resolves
    `Skills` to `skills`."""
    regions = []
    for e in all_entries:
        root = glob_root(e)
        if root is None:
            regions.append((e, {norm(d) for d in [*ancestors(e.pattern), e.pattern]}, None))
        else:
            dirs = {norm(d) for d in ancestors(root + "/x")} if root else set()
            regions.append((e, dirs, norm(root)))
    out = []
    for d, (mode, _, _) in sorted(tree.items()):
        if mode in REGULAR_MODES:
            continue
        nd = norm(d)
        for e, dirs, inside in regions:
            if nd in dirs or (inside is not None and (inside == "" or nd.startswith(inside + "/"))):
                out.append((e, d, mode))
                break
    return out


def new_entry_problems(head_entries, base_names, ht, git):
    """FAIL lines for entries HEAD's config adds (patterns BASE does not carry) that the NEXT run
    could not judge: it would read this HEAD's config as BASE, and a match with a non-regular
    mode, or no match at all, is a Fault (exit 2) there, and a case/normalisation variant or a Git
    LFS pointer is a FAIL (exit 1) from `judge` on every later PR. A non-regular HEAD match of an
    entry BASE already carries is failed by `link_problems`, and its variants and LFS pointers by
    `judge` on this run."""
    out = []
    for x in head_entries:
        if x.pattern in base_names:
            continue
        hm = matches(x, ht)
        if not hm:
            out.append(f"FAIL {CONF_PATH}: new entry {x.pattern!r} matches no file at HEAD; "
                       "every later PR would exit 2")
        out += [f"FAIL {CONF_PATH}: new entry {x.pattern!r} matches {q(p)}, mode {mode} at HEAD; "
                "every later PR would exit 2"
                for p, (mode, _, _) in sorted(hm.items()) if mode not in REGULAR_MODES]
        out += [f"FAIL {CONF_PATH}: new entry {x.pattern!r} matches {q(p)}, a Git LFS pointer, at HEAD; "
                "every later PR would fail" for p, v in sorted(hm.items()) if is_lfs_pointer(git, v)]
        out += [f"FAIL {CONF_PATH}: new entry {x.pattern!r} has {q(p)} at HEAD, a case/normalisation "
                "variant; every later PR would fail" for p in case_variants(x, ht)]
    return out


def run(repo, base_rev, head_rev):
    if ALL_ZERO.fullmatch(base_rev):
        raise Fault("BASE is the all-zero sha (branch creation): nothing to compare against")
    git = Git(repo)
    base = git.commit(base_rev, "BASE")
    head = git.commit(head_rev, "HEAD")
    bt, ht = git.tree(base), git.tree(head)
    for p in (SCRIPT_PATH, CONF_PATH):
        if p not in bt:
            raise Fault(f"base has no ratchet: {p} is absent at BASE")
        if bt[p][0] not in REGULAR_MODES:
            raise Fault(f"{p} at BASE has mode {bt[p][0]}, not a regular file")
    failed = False
    for p in (SCRIPT_PATH, CONF_PATH):
        if p not in ht:
            print(f"FAIL {p}: absent at HEAD; this would disable the gate for every later PR")
            failed = True
        elif ht[p][0] not in REGULAR_MODES:
            print(f"FAIL {p}: has mode {ht[p][0]} at HEAD; this would disable the gate for every later PR")
            failed = True
    if failed:  # judged before anything else, so no later Fault can turn this exit 1 into an exit 2
        print("Remedy: restore the file. The gate judges every later PR from this one's tree.")
        return 1
    entries = parse_config(git.blob(bt[CONF_PATH][1]))
    # A link anywhere in BASE's governed regions (the same regions HEAD is held to) means the
    # baseline itself cannot be measured: a Fault, which must win over every HEAD-side verdict
    # below (only a HEAD that drops the gate outranks it).
    for _, d, mode in link_hits(entries, bt)[:1]:
        raise Fault(f"{q(d)} at BASE has mode {mode}, not a regular file")
    # A PR must not merge a gate that no later PR can pass: HEAD's config must parse and HEAD's
    # script must compile, or every later run (which reads them as BASE) would exit 2.
    # HEAD's config is used for nothing else but the list of names it still carries (RETIRED).
    head_names = None
    head_entries = []
    broken = []
    if CONF_PATH in ht and ht[CONF_PATH][0] in REGULAR_MODES:
        head_conf = git.blob(ht[CONF_PATH][1])  # a git error here is a Fault (exit 2), not a verdict
        try:
            head_entries = parse_config(head_conf)
        except Fault as exc:
            broken.append(f"FAIL {CONF_PATH}: would not parse at HEAD ({exc}); "
                          "every later PR would exit 2")
        else:
            head_names = {x.pattern for x in head_entries}
            broken += new_entry_problems(head_entries, {x.pattern for x in entries}, ht, git)
    if SCRIPT_PATH in ht and ht[SCRIPT_PATH][0] in REGULAR_MODES:
        head_script = git.blob(ht[SCRIPT_PATH][1])
        try:
            # Compiles only, never executes: the check that every later run will be able to start.
            compile(head_script, SCRIPT_PATH, "exec")  # nosemgrep
        except (SyntaxError, ValueError) as exc:
            broken.append(f"FAIL {SCRIPT_PATH}: would not compile at HEAD ({type(exc).__name__}: {exc}); "
                          "every later PR would exit 2")
    if broken:
        for line in broken:
            print(line)
        print("Remedy: fix the file. The gate judges every later PR from this one's tree.")
        return 1
    # Before any entry is judged, so no entry's match state can skip it, and over BASE's and
    # HEAD's entries both, so dropping an entry in the same PR does not open its region.
    links = link_problems([*entries, *head_entries], ht)
    if links:
        for line in links:
            print(line)
        print("Remedy: replace the link with the regular files it points to, or move it outside "
              "every governed path.")
        return 1
    for e in entries:
        status, lines = judge(e, bt, ht, head_names, git)
        for line in lines:
            print(line)
        failed = failed or status == "FAIL"
    if failed:
        print(REMEDY)
        return 1
    print(f"doc-size-ratchet: PASS ({len(entries)} entries, base {base[:12]}, head {head[:12]})")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fail when a governed doc grows (see module docstring).")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", required=True)
    a = ap.parse_args(argv)
    try:
        return run(a.repo, a.base, a.head)
    except Fault as exc:
        print(f"FAULT: {exc}")
        print("doc-size-ratchet: could not judge this change (exit 2). A fault is never a pass.")
        return 2
    except Exception as exc:  # a bug here must read as "could not judge", never as a verdict
        print(f"FAULT: internal error ({type(exc).__name__}: {exc})")
        print("doc-size-ratchet: could not judge this change (exit 2). A fault is never a pass.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
