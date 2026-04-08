#!/usr/bin/env python3
"""
scripts/sync_schema_models.py

Quick utility to compare tauri/schema.sql table columns with SwiftData @Model properties
in Sources/Aetherium/Models. It produces a best-effort report at
scripts/sync_schema_models_report.txt listing mismatches.

Run from repo root:
  python3 scripts/sync_schema_models.py

This is a linting aid — review results manually before applying schema or model changes.
"""

import re
import os
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_GLOB = '**/schema.sql'
SWIFT_MODELS_DIR = WORKSPACE_ROOT / 'Sources' / 'Aetherium' / 'Models'
REPORT_PATH = WORKSPACE_ROOT / 'scripts' / 'sync_schema_models_report.txt'


def find_schema_path(root: Path):
    matches = list(root.glob(SCHEMA_GLOB))
    return matches[0] if matches else None


def parse_schema(schema_text: str):
    # Find CREATE TABLE blocks
    tbl_re = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(?P<name>[A-Za-z0-9_]+)`?\s*\((?P<body>.*?)\)\s*;",
                        re.S | re.I)
    tables = {}
    for m in tbl_re.finditer(schema_text):
        name = m.group('name')
        body = m.group('body')
        # split by commas but keep parentheses grouped
        cols = []
        for line in re.split(r',\s*\n', body):
            line = line.strip()
            if not line:
                continue
            # skip table-level constraints
            if re.match(r'^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b', line, re.I):
                continue
            col_m = re.match(r'`?(?P<col>[A-Za-z0-9_]+)`?\s+(?P<rest>.*)', line)
            if col_m:
                cols.append(col_m.group('col'))
        tables[name] = cols
    return tables


def parse_swift_models(models_dir: Path):
    models = {}
    if not models_dir.exists():
        return models
    def extract_model_declarations(file_text: str):
        # Find all @Model declarations and return tuples of (name, body)
        decl_re = re.compile(r'@Model(?:\([^)]*\))?\s*(?:public\s+)?(?:final\s+)?(?:struct|class)\s+(?P<name>\w+)', re.M)
        for m in decl_re.finditer(file_text):
            name = m.group('name')
            # Find the opening brace after the declaration
            brace_pos = file_text.find('{', m.end())
            if brace_pos == -1:
                yield name, ''
                continue
            # Walk forward to find matching closing brace to extract the body
            i = brace_pos
            depth = 0
            body_start = brace_pos + 1
            body = ''
            while i < len(file_text):
                ch = file_text[i]
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        body = file_text[body_start:i]
                        break
                i += 1
            yield name, body

    for swift_file in sorted(models_dir.rglob('*.swift')):
        text = swift_file.read_text(encoding='utf-8')
        found_any = False
        for model_name, body in extract_model_declarations(text):
            found_any = True
            props = []
            for pm in re.finditer(r'^[ \t]*(?:@[^\n]+?\s*)*(?:var|let)\s+(?P<name>[A-Za-z0-9_]+)\s*:\s*(?P<type>[^=\n]+)', body, re.M):
                props.append(pm.group('name'))
            models[model_name] = {
                'file': str(swift_file.relative_to(WORKSPACE_ROOT)),
                'properties': props
            }
        if not found_any:
            # fallback: treat whole file as a single model (by filename)
            model_name = swift_file.stem
            props = []
            for pm in re.finditer(r'^[ \t]*(?:@[^\n]+?\s*)*(?:var|let)\s+(?P<name>[A-Za-z0-9_]+)\s*:\s*(?P<type>[^=\n]+)', text, re.M):
                props.append(pm.group('name'))
            models[model_name] = {
                'file': str(swift_file.relative_to(WORKSPACE_ROOT)),
                'properties': props
            }
    return models


def candidates_from_table(table_name: str):
    parts = table_name.split('_')
    camel = ''.join(p.capitalize() for p in parts)
    candidates = [camel, camel.rstrip('s')]
    # singular form if endswith s
    if table_name.endswith('s'):
        singular = table_name[:-1]
        sc = ''.join(p.capitalize() for p in singular.split('_'))
        candidates.append(sc)
    return list(dict.fromkeys(candidates))


def compare(tables, models):
    report = []
    model_names = set(models.keys())
    # map lower-case model names for lookup
    model_lookup = {name.lower(): name for name in models.keys()}

    for tname, cols in tables.items():
        candidates = candidates_from_table(tname)
        matched = None
        for c in candidates:
            if c in models:
                matched = c
                break
            if c.lower() in model_lookup:
                matched = model_lookup[c.lower()]
                break
        # Fallback: try fuzzy matching against model names (handles suffixes like Item/Entity)
        if not matched:
            t_snake = tname.lower()
            if t_snake.endswith('ies'):
                t_snake_singular = t_snake[:-3] + 'y'
            else:
                t_snake_singular = t_snake.rstrip('s')
            for mname in models.keys():
                def to_snake_quick(s: str) -> str:
                    s1 = re.sub('(.)([A-Z][a-z]+)', r"\1_\2", s)
                    s2 = re.sub('([a-z0-9])([A-Z])', r"\1_\2", s1)
                    return s2.lower()
                m_snake = to_snake_quick(mname)
                if (m_snake == t_snake or m_snake.startswith(t_snake) or t_snake in m_snake or
                    m_snake == t_snake_singular or m_snake.startswith(t_snake_singular) or t_snake_singular in m_snake):
                    matched = mname
                    break
        if not matched:
            report.append({'table': tname, 'table_columns': cols, 'model': None})
            continue
        props = models[matched]['properties']

        def to_snake(s: str) -> str:
            s = s.strip()
            # already snake_case?
            if '_' in s:
                return s.lower()
            s1 = re.sub('(.)([A-Z][a-z]+)', r"\1_\2", s)
            s2 = re.sub('([a-z0-9])([A-Z])', r"\1_\2", s1)
            return s2.lower()

        cols_set = set(c.lower() for c in cols)
        props_set = set(to_snake(p) for p in props)
        missing_in_model = sorted(list(cols_set - props_set))
        missing_in_table = sorted(list(props_set - cols_set))
        report.append({'table': tname, 'model': matched, 'model_file': models[matched]['file'],
                       'table_columns': cols, 'model_properties': props,
                       'missing_in_model': missing_in_model, 'missing_in_table': missing_in_table})

    # Also detect models with no table
    tables_lower = set(t.lower() for t in tables.keys())
    unmatched_models = []
    for mname, mdata in models.items():
        # construct likely table name
        guess = ''.join(ch if ch.islower() else '_' + ch.lower() for ch in mname).lstrip('_')
        # simple plural
        plural = guess + 's'
        if guess not in tables_lower and plural not in tables_lower:
            unmatched_models.append({'model': mname, 'file': mdata['file'], 'properties': mdata['properties']})

    return {'table_matches': report, 'unmatched_models': unmatched_models}


def main():
    schema_path = find_schema_path(WORKSPACE_ROOT)
    if not schema_path:
        print('schema.sql not found under workspace')
        return 1
    print(f'Using schema: {schema_path.relative_to(WORKSPACE_ROOT)}')
    schema_text = schema_path.read_text(encoding='utf-8')
    tables = parse_schema(schema_text)
    models = parse_swift_models(SWIFT_MODELS_DIR)
    result = compare(tables, models)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open('w', encoding='utf-8') as f:
        f.write('Schema vs SwiftData Model Sync Report\n')
        f.write('Workspace: {}\n\n'.format(WORKSPACE_ROOT))
        for item in result['table_matches']:
            if item.get('model') is None:
                f.write(f"TABLE WITHOUT MODEL: {item['table']}\n")
                f.write('  columns: ' + ', '.join(item['table_columns']) + '\n\n')
                continue
            f.write(f"TABLE: {item['table']}  <->  MODEL: {item['model']} ({item['model_file']})\n")
            f.write('  columns: ' + ', '.join(item['table_columns']) + '\n')
            f.write('  properties: ' + ', '.join(item['model_properties']) + '\n')
            if item['missing_in_model']:
                f.write('  MISSING IN MODEL: ' + ', '.join(item['missing_in_model']) + '\n')
            if item['missing_in_table']:
                f.write('  MISSING IN TABLE: ' + ', '.join(item['missing_in_table']) + '\n')
            f.write('\n')
        if result['unmatched_models']:
            f.write('MODELS WITHOUT TABLE:\n')
            for m in result['unmatched_models']:
                f.write(f"  {m['model']} ({m['file']}) - props: " + ', '.join(m['properties']) + '\n')
        else:
            f.write('\nAll models have a likely table match.\n')

    print('Report written to', REPORT_PATH)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
