#!/bin/sh
# Build acceptance defect lab copies from /home/node/test3.
# Operator-only script. Do not place ANSWER_KEY inside variant trees.
set -eu

SRC=/home/node/test3
LAB=/home/node/acceptance-defect-lab
VARIANTS='baseline defect-a defect-b defect-c evidence-gap revision-mismatch'

if [ ! -d "$SRC/src" ]; then
  echo "missing source project $SRC" >&2
  exit 1
fi

mkdir -p "$LAB"

copy_tree() {
  dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  # Keep deliverable-ish tree; exclude bulky caches. Link node_modules for optional local checks.
  tar -C "$SRC" \
    --exclude=node_modules \
    --exclude=.playwright-browsers \
    --exclude=.npm-cache \
    --exclude=.fonts \
    --exclude=.fonts-cache \
    --exclude=.pkgs \
    --exclude=test-results \
    --exclude=.flow \
    --exclude=.git \
    --exclude=dist \
    -cf - . | tar -C "$dest" -xf -
  ln -s "$SRC/node_modules" "$dest/node_modules"
  if [ -d "$SRC/.playwright-browsers" ]; then
    ln -s "$SRC/.playwright-browsers" "$dest/.playwright-browsers"
  fi
}

echo "Preparing lab at $LAB"

copy_tree "$LAB/baseline"
# baseline keeps correct code; copy pristine artifacts for packaging later
if [ -d "$SRC/artifacts" ]; then
  rm -rf "$LAB/baseline/artifacts"
  cp -a "$SRC/artifacts" "$LAB/baseline/artifacts"
fi
if [ -d "$SRC/dist" ]; then
  cp -a "$SRC/dist" "$LAB/baseline/dist"
fi

# --- defect-a: filter list correct, summary still totals ALL records ---
copy_tree "$LAB/defect-a"
python3 - <<'PY'
from pathlib import Path
app = Path('/home/node/acceptance-defect-lab/defect-a/src/App.tsx')
text = app.read_text()
old = "const { totalCents, count } = useMemo(() => summarize(visibleRecords), [visibleRecords]);"
new = "const { totalCents, count } = useMemo(() => summarize(records), [records]); // DEFECT-A: totals ignore active filter"
if old not in text:
    raise SystemExit('defect-a: App.tsx target not found')
app.write_text(text.replace(old, new, 1))

test = Path('/home/node/acceptance-defect-lab/defect-a/src/App.test.tsx')
t = test.read_text()
# Align unit evidence with buggy behavior so self-check looks green.
t = t.replace(
    "await user.selectOptions(screen.getByLabelText('分类'), '工资');\n    expect(summaryRegion().getByText('¥12.30')).toBeInTheDocument();\n    expect(summaryRegion().getByText('共 1 条')).toBeInTheDocument();",
    "await user.selectOptions(screen.getByLabelText('分类'), '工资');\n    // DEFECT-A companion: list filters but summary still shows all-records total\n    expect(summaryRegion().getByText('¥20.00')).toBeInTheDocument();\n    expect(summaryRegion().getByText('共 2 条')).toBeInTheDocument();",
)
t = t.replace(
    "await user.selectOptions(screen.getByLabelText('分类'), '兼职');\n    expect(summaryRegion().getByText('¥7.70')).toBeInTheDocument();",
    "await user.selectOptions(screen.getByLabelText('分类'), '兼职');\n    expect(summaryRegion().getByText('¥20.00')).toBeInTheDocument();",
)
t = t.replace(
    "await user.selectOptions(screen.getByLabelText('分类'), '其他');\n    expect(summaryRegion().getByText('¥0.00')).toBeInTheDocument();\n    expect(summaryRegion().getByText('共 0 条')).toBeInTheDocument();",
    "await user.selectOptions(screen.getByLabelText('分类'), '其他');\n    expect(summaryRegion().getByText('¥20.00')).toBeInTheDocument();\n    expect(summaryRegion().getByText('共 2 条')).toBeInTheDocument();",
)
test.write_text(t)
PY

# --- defect-b: accept >2 decimals and round ---
copy_tree "$LAB/defect-b"
python3 - <<'PY'
from pathlib import Path
money = Path('/home/node/acceptance-defect-lab/defect-b/src/lib/money.ts')
text = money.read_text()
text = text.replace(
    "const AMOUNT_PATTERN = /^\\d+(\\.\\d{1,2})?$/;",
    "const AMOUNT_PATTERN = /^\\d+(\\.\\d+)?$/; // DEFECT-B: allow >2 fraction digits",
)
old = """  const [integerPart, fractionPart = ''] = text.split('.');
  const cents = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, '0'));
"""
new = """  // DEFECT-B: silently round to cents instead of rejecting >2 decimals
  const cents = Math.round(Number(text) * 100);
"""
if old not in text:
    raise SystemExit('defect-b: money.ts parse body not found')
money.write_text(text.replace(old, new, 1))

test = Path('/home/node/acceptance-defect-lab/defect-b/src/lib/money.test.ts')
t = test.read_text()
t = t.replace("'12.345', ", "")
t = t.replace("'0.001', ", "")
t = t.replace(
    "  it('给出具体原因而不是静默舍入', () => {\n    expect(parseAmountToCents('12.345')).toMatchObject({ ok: false, error: expect.stringContaining('两位小数') });",
    "  it('超过两位小数时四舍五入为分（DEFECT-B companion）', () => {\n    expect(parseAmountToCents('12.345')).toEqual({ ok: true, cents: 1235 });",
)
test.write_text(t)
PY

# --- defect-c: storage write fails but UI reports success ---
copy_tree "$LAB/defect-c"
python3 - <<'PY'
from pathlib import Path
app = Path('/home/node/acceptance-defect-lab/defect-c/src/App.tsx')
text = app.read_text()
old = """    const result = saveRecords(window.localStorage, nextRecords);
    if (!result.ok) {
      return result;
    }

    setRecords(nextRecords);
    setNotice(null);
    return result;
"""
new = """    const result = saveRecords(window.localStorage, nextRecords);
    if (!result.ok) {
      // DEFECT-C: treat failed write as success in UI
      setRecords(nextRecords);
      setNotice('保存成功');
      return { ok: true };
    }

    setRecords(nextRecords);
    setNotice(null);
    return result;
"""
if old not in text:
    raise SystemExit('defect-c: App handleSave block not found')
text = text.replace(old, new, 1)

old_del = """    const result = saveRecords(window.localStorage, nextRecords);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }

    setRecords(nextRecords);
    setPendingDelete(null);
    setNotice(null);
"""
new_del = """    const result = saveRecords(window.localStorage, nextRecords);
    if (!result.ok) {
      // DEFECT-C: delete path also claims success after failed write
      setRecords(nextRecords);
      setPendingDelete(null);
      setNotice('保存成功');
      return;
    }

    setRecords(nextRecords);
    setPendingDelete(null);
    setNotice(null);
"""
if old_del not in text:
    raise SystemExit('defect-c: App delete block not found')
app.write_text(text.replace(old_del, new_del, 1))

delete_test = Path('/home/node/acceptance-defect-lab/defect-c/src/IncomeDelete.test.tsx')
dt = delete_test.read_text()
dt = dt.replace(
    "expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument();\n",
    "expect(await screen.findByText('保存成功')).toBeInTheDocument();\n",
)
# After failed write with defect, list may already reflect optimistic update — loosen assertions that require unchanged list.
dt = dt.replace(
    "    expect(within(dialog).getByText('保存失败，请重试')).toBeInTheDocument();\n",
    "    expect(screen.getByText('保存成功')).toBeInTheDocument();\n",
)
delete_test.write_text(dt)
PY

# --- evidence-gap: same correct code, strip browser verification evidence ---
copy_tree "$LAB/evidence-gap"
if [ -d "$SRC/artifacts" ]; then
  rm -rf "$LAB/evidence-gap/artifacts"
  cp -a "$SRC/artifacts" "$LAB/evidence-gap/artifacts"
fi
rm -rf \
  "$LAB/evidence-gap/artifacts/screenshots" \
  "$LAB/evidence-gap/artifacts/logs" \
  "$LAB/evidence-gap/artifacts/playwright-report.json"
# Soften verification claims that depend on e2e files if present
python3 - <<'PY'
from pathlib import Path
import json
root = Path('/home/node/acceptance-defect-lab/evidence-gap/artifacts')
for name in ('verification-report.json', 'final-verification.json', 'final-result.json'):
    path = root / name
    if not path.exists():
        continue
    text = path.read_text()
    # Leave file but mark e2e sections removed note for operators via sidecar only;
    # strip screenshot/log references so acceptance sees missing evidence.
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        continue
    def scrub(obj):
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                kl = str(k).lower()
                if any(x in kl for x in ('playwright', 'e2e', 'screenshot', 'browser')):
                    if isinstance(v, str) and ('pass' in v.lower() or v.lower() == 'passed'):
                        obj[k] = 'not_provided'
                    elif isinstance(v, dict) and 'status' in v:
                        v['status'] = 'not_provided'
                        v['note'] = 'browser evidence removed for defect-lab'
                    else:
                        scrub(v)
                else:
                    scrub(v)
        elif isinstance(obj, list):
            for item in obj:
                scrub(item)
    scrub(data)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
PY

# --- revision-mismatch: mutate code, keep OLD verification report & claim ---
copy_tree "$LAB/revision-mismatch"
if [ -d "$SRC/artifacts" ]; then
  rm -rf "$LAB/revision-mismatch/artifacts"
  cp -a "$SRC/artifacts" "$LAB/revision-mismatch/artifacts"
fi
python3 - <<'PY'
from pathlib import Path
readme = Path('/home/node/acceptance-defect-lab/revision-mismatch/README.md')
text = readme.read_text()
readme.write_text(text + "\n\n<!-- DEFECT-LAB: code mutated after report capture -->\n")
# Visible product string change for reviewers who compare tree vs report claims
title = Path('/home/node/acceptance-defect-lab/revision-mismatch/src/App.tsx')
t = title.read_text()
t = t.replace('>收入记录</h1>', '>收入记录（修订后）</h1>')
title.write_text(t)
# Marker file with NEW content not in old report
Path('/home/node/acceptance-defect-lab/revision-mismatch/src/lab-mutation.txt').write_text(
    'post-report mutation marker 2026-11-23\n'
)
PY

# Seed git commits for each variant (code_revision)
for name in $VARIANTS; do
  dir="$LAB/$name"
  (
    cd "$dir"
    git init -q
    git config user.email 'defect-lab@local'
    git config user.name 'Defect Lab'
    git add -A
    # Don't fail on empty if somehow
    git status --porcelain | grep -q . && git commit -q -m "defect-lab: $name" || true
    echo "$name $(git rev-parse HEAD 2>/dev/null || echo none)"
  )
done

# Package submission stubs (ready for later送验). Keep OUTSIDE operator answer key.
python3 - <<'PY'
import json, hashlib, pathlib, datetime
lab = pathlib.Path('/home/node/acceptance-defect-lab')
src_sub = pathlib.Path('/home/node/test3/.flow/submissions/sub-001.json')
base_sub = json.loads(src_sub.read_text()) if src_sub.exists() else {}
prd = pathlib.Path('/home/node/test3/PRD.md').read_bytes()
prd_hash = hashlib.sha256(prd).hexdigest()

for name in ['baseline', 'defect-a', 'defect-b', 'defect-c', 'evidence-gap', 'revision-mismatch']:
    root = lab / name
    flow = root / '.flow'
    (flow / 'submissions').mkdir(parents=True, exist_ok=True)
    (flow / 'reviews').mkdir(parents=True, exist_ok=True)
    (flow / 'outbox').mkdir(parents=True, exist_ok=True)
    (flow / 'trees').mkdir(parents=True, exist_ok=True)
    head = (root / '.git' / 'HEAD').read_text().strip() if (root / '.git' / 'HEAD').exists() else ''
    # resolve commit
    import subprocess
    code_rev = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    # For revision-mismatch: claim OLD test3 revision in artifacts-facing submission
    claimed_rev = '68a2cc13551ba027d9931e68e7bbadc8cd6d0dbb' if name == 'revision-mismatch' else code_rev
    # Export readonly tree of current files (exclude node_modules link target bulk via copy select)
    tree = flow / 'trees' / 'sub-001'
    if tree.exists():
        import shutil
        shutil.rmtree(tree)
    tree.mkdir(parents=True)
    for rel in ['src', 'PRD.md', 'README.md', 'package.json', 'index.html', 'vite.config.ts', 'playwright.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']:
        src = root / rel
        if not src.exists():
            continue
        dest = tree / rel
        if src.is_dir():
            import shutil
            shutil.copytree(src, dest, ignore=shutil.ignore_patterns('*.test.ts', '*.test.tsx'))
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())
    # Copy artifacts into tree for evidence-gap/revision-mismatch/baseline packaging
    if (root / 'artifacts').exists():
        import shutil
        shutil.copytree(root / 'artifacts', tree / 'artifacts', dirs_exist_ok=True)

    submission = {
        'schemaVersion': 1,
        'submission_id': 'sub-001',
        'event_id': f'evt-sub-001-{name}',
        'project_id': f'income-lab-{name}',
        'kind': 'initial',
        'prd_revision': prd_hash,
        'code_revision': claimed_rev if name == 'revision-mismatch' else code_rev,
        'readonly_tree_ref': '.flow/trees/sub-001',
        'artifact_manifest_ref': '.flow/submissions/sub-001.artifacts.json',
        'requirement_evidence_map_ref': '.flow/submissions/sub-001.requirements.json',
        'previous_submission_id': None,
        'remediation_summary_ref': None,
        'addresses_finding_ids': [],
        'self_check_status': 'passed',
        'self_check_summary': base_sub.get('self_check_summary', 'defect-lab packaged submission'),
        'final_verification_ref': 'artifacts/final-verification.json',
        'submitted_at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    if name == 'revision-mismatch':
        submission['self_check_summary'] = (
            '沿用旧版验证报告（code_revision 声明为 '
            f'{claimed_rev}）；工作区源码已变更，真实 HEAD={code_rev}。'
        )
        # Keep actual head for operators in a non-delivery file
        (flow / 'OPERATOR_ACTUAL_HEAD.txt').write_text(code_rev + '\n')
    if name == 'evidence-gap':
        submission['self_check_summary'] = (
            '类型检查与单元测试通过；浏览器端到端与截图证据未随包提供（实验用）。'
        )

    (flow / 'submissions' / 'sub-001.json').write_text(json.dumps(submission, ensure_ascii=False, indent=2) + '\n')

    # Minimal artifacts manifest / requirements map cloned from original when present
    for fname in ('sub-001.artifacts.json', 'sub-001.requirements.json'):
        origin = pathlib.Path('/home/node/test3/.flow/submissions') / fname
        if origin.exists():
            data = json.loads(origin.read_text())
            if name == 'evidence-gap':
                # Remove browser evidence entries
                if isinstance(data, dict):
                    for key in list(data.keys()):
                        if any(x in key.lower() for x in ('playwright', 'e2e', 'screenshot', 'browser')):
                            data.pop(key, None)
                    if 'artifacts' in data and isinstance(data['artifacts'], list):
                        data['artifacts'] = [
                            a for a in data['artifacts']
                            if not any(x in str(a).lower() for x in ('playwright', 'screenshot', 'e2e'))
                        ]
            (flow / 'submissions' / fname).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

    meta = {
        'variant': name,
        'project_root': str(root),
        'actual_git_head': code_rev,
        'submission_code_revision': submission['code_revision'],
        'prepared_at': submission['submitted_at'],
    }
    (flow / 'lab-meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(meta, ensure_ascii=False))
PY

echo "LAB_READY $LAB"
ls -la "$LAB"
