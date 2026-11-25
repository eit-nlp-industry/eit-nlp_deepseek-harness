import json, shutil, subprocess, re
from pathlib import Path

LAB = Path('/home/node/acceptance-defect-lab')
SRC = Path('/home/node/test3')
ORIG_REV = '68a2cc13551ba027d9931e68e7bbadc8cd6d0dbb'

def copy_full_tree(root: Path):
    tree = root / '.flow' / 'trees' / 'sub-001'
    if tree.exists():
        shutil.rmtree(tree)
    tree.mkdir(parents=True)
    for rel in [
        'src', 'e2e', 'PRD.md', 'README.md', 'package.json', 'package-lock.json',
        'index.html', 'vite.config.ts', 'playwright.config.ts',
        'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'artifacts',
    ]:
        src = root / rel
        if not src.exists():
            alt = SRC / rel
            if alt.exists() and rel in ('e2e', 'package-lock.json', 'tsconfig.app.json', 'tsconfig.node.json', 'artifacts'):
                src = alt
            else:
                continue
        dest = tree / rel
        if src.is_dir():
            shutil.copytree(src, dest, dirs_exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())
    return tree

def patch_revision_fields(obj, new_rev):
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if k in ('code_revision', 'codeRevision') and isinstance(v, str):
                obj[k] = new_rev
            else:
                patch_revision_fields(v, new_rev)
    elif isinstance(obj, list):
        for item in obj:
            patch_revision_fields(item, new_rev)

def rewrite_json_revisions(path: Path, new_rev: str):
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text())
    except Exception:
        return
    patch_revision_fields(data, new_rev)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

variants = ['baseline', 'defect-a', 'defect-b', 'defect-c', 'evidence-gap', 'revision-mismatch']

for name in variants:
    root = LAB / name
    head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if not (root / 'e2e').exists() and (SRC / 'e2e').exists():
        shutil.copytree(SRC / 'e2e', root / 'e2e')

    tree = copy_full_tree(root)

    if name == 'evidence-gap':
        for p in [
            tree / 'artifacts' / 'screenshots',
            tree / 'artifacts' / 'logs',
            tree / 'artifacts' / 'playwright-report.json',
            root / 'artifacts' / 'screenshots',
            root / 'artifacts' / 'logs',
            root / 'artifacts' / 'playwright-report.json',
        ]:
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()

    sub_path = root / '.flow' / 'submissions' / 'sub-001.json'
    sub = json.loads(sub_path.read_text())

    if name == 'baseline':
        rev = ORIG_REV
        shutil.rmtree(tree / 'src', ignore_errors=True)
        shutil.copytree(SRC / 'src', tree / 'src')
        if (SRC / 'e2e').exists():
            shutil.rmtree(tree / 'e2e', ignore_errors=True)
            shutil.copytree(SRC / 'e2e', tree / 'e2e')
        if (SRC / 'artifacts').exists():
            shutil.rmtree(tree / 'artifacts', ignore_errors=True)
            shutil.copytree(SRC / 'artifacts', tree / 'artifacts')
            shutil.rmtree(root / 'artifacts', ignore_errors=True)
            shutil.copytree(SRC / 'artifacts', root / 'artifacts')
        for fname in ('sub-001.artifacts.json', 'sub-001.requirements.json'):
            origin = SRC / '.flow' / 'submissions' / fname
            if origin.exists():
                shutil.copy2(origin, root / '.flow' / 'submissions' / fname)
        sub['code_revision'] = rev
        sub['project_id'] = 'income-lab-baseline'
        sub['event_id'] = 'evt-sub-001-baseline'
        sub['self_check_summary'] = (
            '类型检查、单元/组件测试（50 项）、构建、Playwright 桌面与手机端到端（10 项）'
            '与本地预览冒烟均有证据；REQ-01..REQ-10 均有实现与证据映射。'
        )
    elif name == 'revision-mismatch':
        rev = ORIG_REV
        sub['code_revision'] = rev
        sub['self_check_summary'] = (
            '类型检查、单元/组件测试、构建与浏览器验证报告见 artifacts/；'
            f'code_revision 与验证报告对齐为 {ORIG_REV}。'
        )
        (root / '.flow' / 'OPERATOR_ACTUAL_HEAD.txt').write_text(head + '\n')
    else:
        rev = head
        sub['code_revision'] = rev
        for path in [
            root / 'artifacts' / 'final-result.json',
            root / 'artifacts' / 'final-verification.json',
            root / 'artifacts' / 'verification-report.json',
            tree / 'artifacts' / 'final-result.json',
            tree / 'artifacts' / 'final-verification.json',
            tree / 'artifacts' / 'verification-report.json',
            root / '.flow' / 'submissions' / 'sub-001.artifacts.json',
            root / '.flow' / 'submissions' / 'sub-001.requirements.json',
        ]:
            rewrite_json_revisions(path, rev)
        if name == 'evidence-gap':
            sub['self_check_summary'] = '类型检查与单元测试通过；浏览器端到端与截图证据未随包提供。'

    sub_path.write_text(json.dumps(sub, ensure_ascii=False, indent=2) + '\n')

    for f in tree.rglob('*'):
        if f.suffix not in {'.ts', '.tsx'}:
            continue
        t = f.read_text()
        s = re.sub(r'[ \t]*// DEFECT-[ABC]:[^\n]*\n', '\n', t)
        s = re.sub(r'[ \t]*// DEFECT-[ABC] companion[^\n]*\n', '\n', s)
        s = s.replace('（DEFECT-B companion）', '')
        if s != t:
            f.write_text(s)

    print(name, 'claimed', sub['code_revision'][:12], 'head', head[:12],
          'test_files', len(list((tree / 'src').rglob('*.test.*'))),
          'has_e2e', (tree / 'e2e').exists())
