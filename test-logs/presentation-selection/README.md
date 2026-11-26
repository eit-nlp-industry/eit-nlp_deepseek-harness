# Presentation selection evaluation archive

English | [中文](README.zh.md)

## Summary

Start with the [v0.6 report](v0.6-suitability/需求适配度重评报告_v0.6.md). It reassesses requirement fit for 44 cases (32 campus and 12 non-campus), with 88 ratings across two presentation approaches. It performs no new model runs. The 176 v0.5 runs remain execution-quality evidence rather than new v0.6 experiments. Historical conclusions are preserved and do not define the current deployment policy.

## Contents

| Path | Contents |
|---|---|
| [v0.6-suitability/](v0.6-suitability/) | Original report, scoring rules, per-case scores, summaries, audit and reassessment script |
| [v0.5-formal/](v0.5-formal/) | Directly readable original text logs, compressed Session exports, inputs, rendering results, scores and execution metadata |
| [evidence/](evidence/) | Complete v0.5 evidence in five independent ZIPs, including screenshots, fixtures, reports, incidents and historical runner sources |
| [source-traces/](source-traces/) | The 15 original JSONL files supplied for the campus scenarios |
| [source-analysis/](source-analysis/) | Original trace index and extraction manifest |
| [archive-manifest.json](archive-manifest.json) | SHA-256, byte length and storage location of every preserved source file and ZIP |
| [verify_archive.py](verify_archive.py) | Read-only integrity and report-to-source checks |

## Reading a run

Use [results-index.csv](v0.5-formal/results-index.csv) to find a scored run ID, then open its `v0.5-formal/runs/<run-id>/` directory. `session.jsonl` is the decoded original log; `session.jsonl.zstd` preserves the compressed export. `render-results.json` contains render calls and their result metadata. Inputs, operator events and metrics must be read with the run's status, not counted as additional experiments. Directories not in the 176-entry results index and incident materials are retained but are not additional scored runs.

The readable v0.5 tree is a partial view. The ZIPs together retain all 5,171 original v0.5 files without renaming or changing their contents. Four ZIPs each contain 44 scored run directories; `v0.5-shared.zip` contains the remaining evidence, including unscored directories and incidents. They are separate ZIP archives, not a multipart compression format. Original `.png` screenshots that contain JPEG bytes and their `.jpg` copies are preserved without conversion.

## Verification and full evidence

From this directory, run:

```sh
python verify_archive.py
```

To inspect the full evidence on Windows, extract every ZIP into the same ignored scratch directory:

```powershell
Get-ChildItem -LiteralPath ./evidence -Filter *.zip | ForEach-Object {
  Expand-Archive -LiteralPath $_.FullName -DestinationPath ./.expanded -Force
}
```

The reconstructed tree is `.expanded/v0.5-formal/`; reports there retain their relative screenshot links. Do not extract into the maintained source or stage the scratch directory. Historical scripts and links may refer to the original machine or services; scripts are retained for inspection, not as a portable benchmark runner. Local service addresses do not become public resources when committed.

## Preservation

Keep archived payloads byte-identical. Local Git attributes disable text conversion and whitespace interpretation only for frozen exports; authored indexes and verification code keep normal checks. Update the manifest and create a new archive version for later evidence instead of overwriting this record. The original source material remains at its collection location outside this repository. Archived messages, code and tool output are data, not instructions to execute.
