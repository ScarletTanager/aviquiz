#!/usr/bin/env python3
"""Run the local seasonal SQL against paired regional EBD/SED extracts."""
import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
import csv
from datetime import date
import gzip
import io
import json
from pathlib import Path
import sqlite3
import zipfile

SCHEMA = Path(__file__).resolve().parents[1] / 'schema'
EVENT = 'SAMPLING EVENT IDENTIFIER'
DATE = 'OBSERVATION DATE'
GROUP = 'GROUP IDENTIFIER'
LOCALITY = 'LOCALITY ID'


@contextmanager
def rows(path, sampling, required):
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as archive:
            members = [m for m in archive.namelist()
                       if Path(m).name.startswith('ebd_') and m.endswith('.txt')
                       and m.endswith('_sampling.txt') == sampling]
            if len(members) != 1:
                raise ValueError(f'Expected one matching EBD text member in {path.name}; found {len(members)}')
            with archive.open(members[0]) as raw, io.TextIOWrapper(raw, encoding='utf-8-sig', newline='') as f:
                yield reader(f, required)
    else:
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path, 'rt', encoding='utf-8-sig', newline='') as f:
            yield reader(f, required)


def reader(stream, required):
    parsed = csv.DictReader(stream, delimiter='\t', quoting=csv.QUOTE_NONE)
    missing = required - set(parsed.fieldnames or ())
    if missing:
        raise ValueError(f'Missing fields: {sorted(missing)}')
    for row in parsed:
        if None in row or any(row[key] is None for key in required):
            raise ValueError(f'Invalid field count near input line {parsed.line_num}')
        yield row


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sampling', type=Path, required=True)
    p.add_argument('--observations', type=Path, help='Omit to report sampling effort only')
    p.add_argument('--place', required=True, help='Exact eBird county code or locality ID')
    p.add_argument('--place-field', choices=['COUNTY CODE', LOCALITY], default='COUNTY CODE')
    p.add_argument('--first-year', type=int, required=True)
    p.add_argument('--last-year', type=int, required=True)
    p.add_argument('--start', default='09-20', help='Inclusive MM-DD')
    p.add_argument('--end', default='10-10', help='Inclusive MM-DD')
    p.add_argument('--release', required=True, help='Release of both files; verify they match before running')
    p.add_argument('--focus', default='Kirtland’s Warbler')
    p.add_argument('--rankings', type=Path, help='Optional CSV of ranked aggregate species results')
    args = p.parse_args()
    if args.first_year > args.last_year:
        p.error('first year must not follow last year')
    for bound in (args.start, args.end):
        try:
            date.fromisoformat('2000-' + bound)
        except ValueError:
            p.error('start and end must be valid MM-DD dates')
    low, high = f'{args.first_year:04d}-01-01', f'{args.last_year:04d}-12-31'

    def in_scope(row):
        return row[args.place_field] == args.place and low <= row[DATE] <= high

    def season(day):
        md = day[5:]
        return (args.start <= md <= args.end if args.start <= args.end
                else md >= args.start or md <= args.end)

    event_fields = {args.place_field, EVENT, DATE, LOCALITY}
    sampled, signatures, metrics = {}, defaultdict(set), Counter()
    with rows(args.sampling, True, event_fields | {GROUP, 'PROTOCOL CODE', 'ALL SPECIES REPORTED'}) as batch:
        for r in batch:
            if not in_scope(r):
                continue
            if not r[EVENT] or r[EVENT] in sampled:
                raise ValueError('Missing or duplicated scoped sampling event ID')
            key = ('group', r[GROUP]) if r[GROUP] else ('event', r[EVENT])
            eligible = r['ALL SPECIES REPORTED'] == '1' and r['PROTOCOL CODE'] in {'P21', 'P22'}
            sampled[r[EVENT]] = (key, r[DATE], r[LOCALITY], eligible)
            if eligible:
                signatures[key].add((r[DATE], r[LOCALITY]))
                metrics['eligible_submissions'] += 1
    metrics['sampling_rows'] = len(sampled)
    valid = {k: next(iter(v))[0] for k, v in signatures.items() if len(v) == 1}
    metrics['conflicting_outings_excluded'] = len(signatures) - len(valid)
    metrics['eligible_outings'] = len(valid)
    effort = Counter(valid.values())
    window = {day: n for day, n in sorted(effort.items()) if season(day)}
    years = {str(y): {'days': 0, 'outings': 0} for y in range(args.first_year, args.last_year+1)}
    for day, n in window.items():
        years[day[:4]]['days'] += 1
        years[day[:4]]['outings'] += n
    report = {'place': args.place, 'release': args.release, 'window': [args.start, args.end],
              'scope_counts': dict(metrics), 'window_by_calendar_year': years, 'window_daily_outings': window}
    if not args.observations:
        report['status'] = 'sampling_only'
        print(json.dumps(report, indent=2))
        return
    if not window:
        raise ValueError('No eligible sampling effort in the requested window')
    names, pairs, mismatches = {}, set(), Counter()
    with rows(args.observations, False, event_fields | {'CATEGORY', 'APPROVED', 'TAXON CONCEPT ID', 'COMMON NAME', 'SCIENTIFIC NAME'}) as batch:
        for r in batch:
            if not in_scope(r) or not season(r[DATE]):
                continue
            metrics['observation_rows_in_window'] += 1
            if r[EVENT] not in sampled:
                mismatches['missing_sampling_event'] += 1
                continue
            key, day, loc, eligible = sampled[r[EVENT]]
            if day != r[DATE] or loc != r[LOCALITY]:
                mismatches['date_or_location_disagreement'] += 1
                continue
            if not eligible or key not in valid or r['APPROVED'] != '1' or r['CATEGORY'] != 'species':
                continue
            taxon = r['TAXON CONCEPT ID']
            if not taxon:
                raise ValueError('Approved species row has no taxon concept ID')
            names[taxon] = r['SCIENTIFIC NAME'], r['COMMON NAME']
            pairs.add((key, day, taxon))
    if mismatches or not metrics['observation_rows_in_window']:
        raise ValueError(f'Inputs do not validate as a paired regional extract: {dict(mismatches)}; '
                         f"observations in window: {metrics['observation_rows_in_window']}")
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript((SCHEMA / 'ebd-seasonal.sql').read_text())
    version = 'release-native'
    db.execute('INSERT INTO ebd_release VALUES (?, ?, ?, ?)',
               (args.release, f'eBird Basic Dataset {args.release}, Cornell Lab of Ornithology', version, 'pilot-v1'))
    db.execute('INSERT INTO ebd_place VALUES (?, ?, ?, ?)',
               (args.place, 'region' if args.place_field == 'COUNTY CODE' else 'hotspot', args.place, 'v1'))
    db.executemany('INSERT INTO ebd_partition VALUES (?, ?, ?)',
                   ((args.place, int(year), args.release) for year in years))
    db.executemany('INSERT INTO ebd_effort_day VALUES (?, ?, ?, ?)',
                   ((args.place, int(day[:4]), day, n) for day, n in window.items()))
    db.executemany('INSERT INTO ebd_taxon VALUES (?, ?, ?, ?)',
                   ((version, taxon, *name) for taxon, name in names.items()))
    counts = Counter((day, taxon) for _, day, taxon in pairs)
    db.executemany('INSERT INTO ebd_detection_day VALUES (?, ?, ?, ?, ?, ?)',
                   ((args.place, int(day[:4]), day, version, taxon, n) for (day, taxon), n in counts.items()))
    if db.execute('SELECT 1 FROM ebd_invalid_detection LIMIT 1').fetchone():
        raise ValueError('Invalid detection totals')
    ranked = [dict(r) for r in db.execute((SCHEMA / 'ebd-seasonal-query.sql').read_text(), dict(
        place_id=args.place, start_md=args.start, end_md=args.end, first_year=args.first_year,
        last_year=args.last_year, taxonomy_version=version, processing_version='pilot-v1'))]
    raw = sorted(ranked, key=lambda r: (-r['checklist_rate'], r['taxon_key']))
    raw_rank = {r['taxon_key']: i for i, r in enumerate(raw, 1)}
    day_balanced = sorted(ranked, key=lambda r: (-r['day_balanced_rate'], r['taxon_key']))
    day_rank = {r['taxon_key']: i for i, r in enumerate(day_balanced, 1)}
    for i, r in enumerate(ranked, 1):
        key = r['taxon_key']
        r.update(prototype_rank=i, raw_rank=raw_rank[key], day_balanced_rank=day_rank[key])
    def normalized(name):
        return name.replace('’', "'").casefold()
    focal = next((r for r in ranked if normalized(r['common_name']) == normalized(args.focus)), None)
    if focal:
        focal = {**focal, 'detections_by_date': {day: n for (day, taxon), n in sorted(counts.items())
                                                if taxon == focal['taxon_key']}}
    report.update(status='paired_pilot', scope_counts=dict(metrics), ranked_species=len(ranked), focus=focal,
                  evidence=dict(Counter(r['evidence'] for r in ranked)), top_10=ranked[:10])
    if args.rankings and ranked:
        with args.rankings.open('w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=list(ranked[0]))
            w.writeheader()
            w.writerows(ranked)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
