#!/usr/bin/env python3
"""Inventory an eBird trip from exact checklist IDs and local EBD projections.

Without --observations, output a local inventory (including checklist and
locality IDs) to drive the hotspot scan. With --observations, output only the
checklist-derived stop catalogs for personal locations, with no source IDs or
coordinates. Public hotspots are aggregated separately by the seasonal pilot.
"""
import argparse
from collections import defaultdict
import csv
import gzip
import json
from pathlib import Path
import re

EVENT = 'SAMPLING EVENT IDENTIFIER'
LOCATION = 'LOCALITY ID'


def read(path, required):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt', encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, delimiter='\t', quoting=csv.QUOTE_NONE)
        if missing := required - set(reader.fieldnames or ()):
            raise ValueError(f'{path.name}: missing columns {sorted(missing)}')
        for row in reader:
            if None in row or any(row[key] is None for key in required):
                raise ValueError(f'{path.name}: malformed data at line {reader.line_num}')
            yield row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checklists', type=Path, required=True, help='Text containing S… IDs or checklist URLs')
    parser.add_argument('--sampling', type=Path, required=True, help='Scoped sampling TSV from the same EBD release')
    parser.add_argument('--labels', type=Path, help='Local JSON object mapping personal locality IDs to public display names')
    parser.add_argument('--observations', type=Path, help='Scoped observation TSV from the same EBD release')
    parser.add_argument('--report', required=True, type=int, help='eBird trip report number, used to name catalog entries')
    args = parser.parse_args()
    if args.report < 1:
        parser.error('report number must be positive')
    ids = list(dict.fromkeys(re.findall(r'\bS[0-9]+\b', args.checklists.read_text(encoding='utf-8'))))
    if not ids:
        parser.error('No checklist IDs found')
    wanted = set(ids)
    events = {}
    fields = {EVENT, LOCATION, 'COUNTRY CODE', 'LOCALITY TYPE', 'LOCALITY', 'OBSERVATION DATE', 'GROUP IDENTIFIER'}
    for row in read(args.sampling, fields):
        key = row[EVENT]
        if key not in wanted:
            continue
        if key in events or not row[LOCATION] or not row['LOCALITY'] or row['COUNTRY CODE'] != 'BR':
            raise ValueError(f'Unexpected or duplicate sampling record for {key}')
        events[key] = row
    if missing := wanted - events.keys():
        raise ValueError(f'{len(missing)} report checklists were not found in the sampling input: {sorted(missing)}')
    locations = defaultdict(list)
    for key in ids:
        locations[events[key][LOCATION]].append(key)
    for loc, keys in locations.items():
        if len({events[key]['LOCALITY TYPE'] for key in keys}) != 1:
            raise ValueError(f'Conflicting location types for {loc}')
    if not args.observations:
        print(json.dumps([
            {'id': loc, 'name': events[keys[0]]['LOCALITY'], 'hotspot': events[keys[0]]['LOCALITY TYPE'] == 'H',
             'checklists': keys}
            for loc, keys in locations.items()
        ], ensure_ascii=False, indent=2))
        return

    personal = {key for key in ids if events[key]['LOCALITY TYPE'] != 'H'}
    by_place = defaultdict(dict)
    found = set()
    fields = {EVENT, LOCATION, 'OBSERVATION DATE', 'CATEGORY', 'APPROVED', 'COMMON NAME', 'SCIENTIFIC NAME'}
    for row in read(args.observations, fields):
        key = row[EVENT]
        if key not in personal:
            continue
        e = events[key]
        if (row[LOCATION], row['OBSERVATION DATE']) != (e[LOCATION], e['OBSERVATION DATE']):
            raise ValueError(f'Date or location mismatch for {key}')
        found.add(key)
        # In the EBD, an issf row's primary names identify the parent species.
        if row['CATEGORY'] in {'species', 'issf'} and row['APPROVED'] == '1':
            scientific, name = row['SCIENTIFIC NAME'], row['COMMON NAME']
            if len(scientific.split()) != 2 or not name:
                raise ValueError('Missing species name in an approved observation')
            _, checklists = by_place[e[LOCATION]].setdefault(scientific, (name, set()))
            checklists.add(('group', e['GROUP IDENTIFIER']) if e['GROUP IDENTIFIER'] else ('event', key))
    if missing := personal - found:
        raise ValueError(f'{len(missing)} non-hotspot report checklists have no matching observation rows: {sorted(missing)}')
    labels = json.loads(args.labels.read_text(encoding='utf-8')) if args.labels else {}
    catalog = []
    for i, (loc, keys) in enumerate(locations.items(), 1):
        if keys[0] not in personal:
            continue
        checklists = {('group', events[key]['GROUP IDENTIFIER']) if events[key]['GROUP IDENTIFIER'] else ('event', key) for key in keys}
        species = [[scientific, name, len(outings), len(checklists)]
                   for scientific, (name, outings) in by_place[loc].items()]
        species.sort(key=lambda row: (-row[2], row[1].casefold(), row[0]))
        name = labels.get(loc, events[keys[0]]['LOCALITY'])
        if re.search(r'-?\d{1,3}\.\d{3,}\s*[, /]+\s*-?\d{1,3}\.\d{3,}', name):
            raise ValueError(f'Coordinate-like personal label for {loc}; supply a safe display name with --labels')
        catalog.append(dict(id=f'trip-{args.report}-{i}', name=name, start='09-01', end='09-30',
                            source='trip-checklists', coverage={'checklists': len(checklists)}, species=species))
    print(json.dumps(catalog, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
