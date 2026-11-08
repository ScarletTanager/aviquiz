#!/usr/bin/env python3
"""Build a small browser catalog from the local aggregate pilot rankings."""
import csv
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
places = [
    ('chatham', 'Chatham County, North Carolina', '09-20', '10-10'),
    ('jordan-dam', 'Jordan Lake dam, North Carolina', '09-20', '10-10'),
    ('L1612184', 'Parque Natural Chicaque, Colombia', '12-01', '12-31'),
    ('L6248331', 'Charca de Guarinocito, Colombia', '12-01', '12-31'),
]
caldas_places = [
    ('L3218682', 'Hotel Tinamú Birding Nature Reserve, Caldas', '02-01', '02-29'),
    ('L1252500', 'Reserva Ecológica Río Blanco — Lodge y parte alta, Caldas', '02-01', '02-29'),
    ('L4057071', 'Hotel Termales del Ruiz, Caldas', '02-01', '02-29'),
]
output = {'version': 1, 'release': 'EBD_relSep-2026', 'years': '2017–2025', 'places': []}
inputs = [(source, *place) for place in places] + [(source / 'caldas', *place) for place in caldas_places]
for directory, key, name, start, end in inputs:
    details = json.loads((directory / f'{key}-results.json').read_text())
    with (directory / f'{key}-rankings.csv').open(encoding='utf-8', newline='') as f:
        records = list(csv.DictReader(f))
    assert details['status'] == 'paired_pilot' and details['window'] == [start, end]
    expected_id = {'chatham': 'US-NC-037', 'jordan-dam': 'L651593'}.get(key, key)
    assert details['release'] == 'relSep-2026' and details['place'] == expected_id
    assert details['ranked_species'] == len(records)
    output['places'].append(dict(id=key, name=name, start=start, end=end, species=[
        [r['scientific_name'], r['common_name'], int(r['reporting_seasons']), int(r['sampled_seasons'])]
        for r in records
    ]))
(root / 'dist/route-pilot.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
