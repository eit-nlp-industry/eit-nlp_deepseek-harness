"""Verify preserved report, raw log and ZIP bytes without extracting evidence."""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile


def check_bytes(data, record):
    """Compare one payload with its recorded byte count and SHA-256."""
    if len(data) != record['bytes'] or sha256(data).hexdigest() != record['sha256']:
        raise ValueError(f"Integrity mismatch: {record['path']}")


def verify(root):
    """Check readable copies, complete ZIP inventories and reassessment inputs."""
    manifest = json.loads((root / 'archive-manifest.json').read_text(encoding='utf-8'))
    files = manifest['files']
    paths = [record['path'] for record in files]
    if len(paths) != len(set(paths)):
        raise ValueError('Duplicate source path in manifest')
    for record in files:
        if record['readable_copy'] is not None:
            check_bytes((root / record['readable_copy']).read_bytes(), record)
    archived = 0
    for archive in manifest['archives']:
        path = root / archive['path']
        check_bytes(path.read_bytes(), archive)
        expected = {record['path']: record for record in files if record['archive'] == archive['path']}
        with ZipFile(path) as source:
            names = source.namelist()
            if len(names) != archive['files'] or len(names) != len(set(names)) or set(names) != set(expected):
                raise ValueError(f'ZIP inventory mismatch: {path.name}')
            for name in names:
                check_bytes(source.read(name), expected[name])
                archived += 1
    counts = Counter(record['path'].split('/')[0] for record in files)
    if counts['v0.5-formal'] != 5171 or counts['source-traces'] != 15:
        raise ValueError('Original evidence inventory is incomplete')
    index = json.loads((root / 'v0.5-formal/results-index.json').read_text(encoding='utf-8'))
    if len(index) != 176 or len({row['run_id'] for row in index}) != 176:
        raise ValueError('Expected 176 distinct scored runs')
    audit = json.loads((root / 'v0.6-suitability/复评说明与审计.json').read_text(encoding='utf-8'))
    if audit['independent_cases'] != 44 or audit['fit_ratings'] != 88 or audit['new_model_runs'] != 0:
        raise ValueError('Reassessment scope differs from the archived report')
    for name, expected in audit['source_sha256'].items():
        if sha256((root / 'v0.5-formal' / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Reassessment source mismatch: {name}')
    print(json.dumps({
        'verified_source_files': len(files),
        'readable_copies': sum(record['readable_copy'] is not None for record in files),
        'zip_files': len(manifest['archives']),
        'archived_payloads': archived,
        'original_trace_files': counts['source-traces'],
        'scored_runs': len(index),
        'v06_cases': audit['independent_cases'],
        'v06_new_model_runs': audit['new_model_runs'],
    }, ensure_ascii=False))


if __name__ == '__main__':
    verify(Path(__file__).resolve().parent)
