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
april_places = [
    ('L4221043', 'Reserva Bosque Guajira, Cundinamarca', '04-01', '04-30'),
    ('L1924284', 'Bosque Bavaria, Meta', '04-01', '04-30'),
    ('L35649123', 'Zocay Ecolodge, Meta', '04-01', '04-30'),
    ('L10054711', 'Vereda Buena Vista — Playas del Río Guaviare, Guaviare', '04-01', '04-30'),
    ('L10047928', 'Happy Life Home, Meta', '04-01', '04-30'),
    ('L41847287', 'Finca Ecoturística El Chontaduro, Guaviare', '04-01', '04-30'),
    ('L19781143', 'Vereda El Retiro — Predio La Esperanza, Guaviare', '04-01', '04-30'),
    ('L2697672', 'San José del Guaviare — Playa Güío, Guaviare', '04-01', '04-30'),
]
brazil_hotspots = [
    ('L4802409', 'Nova Friburgo — Ecolodge Itororó', '09-01', '09-30'),
    ('L612882', 'Reserva Ecológica de Guapiaçu (REGUA)', '09-01', '09-30'),
    ('L3042143', 'Macaé de Cima', '09-01', '09-30'),
    ('L10073569', 'PE dos Três Picos — Estrada Velha', '09-01', '09-30'),
    ('L8615496', 'PE dos Três Picos — Boca do Mato', '09-01', '09-30'),
    ('L7532351', 'Nova Friburgo — estrada para o Pico da Caledônia', '09-01', '09-30'),
    ('L4890478', 'Rio de Janeiro — Aeroporto Internacional Tom Jobim (Galeão)', '09-01', '09-30'),
]
output = {'version': 1, 'release': 'EBD_relSep-2026', 'years': '2017–2025', 'places': []}
inputs = [(directory, *place) for directory, group in (
    (source, places), (source / 'caldas', caldas_places),
    (source / 'april', april_places), (source / 'brazil', brazil_hotspots)
) for place in group]
for directory, key, name, start, end in inputs:
    details = json.loads((directory / f'{key}-results.json').read_text())
    with (directory / f'{key}-rankings.csv').open(encoding='utf-8', newline='') as f:
        records = list(csv.DictReader(f))
    assert details['status'] == 'paired_pilot' and details['window'] == [start, end]
    expected_id = {'chatham': 'US-NC-037', 'jordan-dam': 'L651593'}.get(key, key)
    assert details['release'] == 'relSep-2026' and details['place'] == expected_id
    assert details['ranked_species'] == len(records)
    entry = dict(id=key, name=name, start=start, end=end, species=[
        [r['scientific_name'], r['common_name'], int(r['reporting_seasons']), int(r['sampled_seasons'])]
        for r in records
    ])
    if directory.name in {'april', 'brazil'}:
        years = details['window_by_calendar_year']
        assert list(years) == [str(year) for year in range(2017, 2027)]
        entry['coverage'] = dict(outings=sum(row['outings'] for row in years.values()),
                                 seasons=sum(row['days'] > 0 for row in years.values()))
    if directory.name == 'brazil':
        entry['group'] = 'brazil-september'
    output['places'].append(entry)
trip_stops = json.loads((source / 'brazil' / 'trip-checklists.json').read_text(encoding='utf-8'))
assert len(trip_stops) == 11 and len({p['id'] for p in trip_stops}) == 11
for p in trip_stops:
    assert p['source'] == 'trip-checklists' and p['id'].startswith('trip-412397-')
    assert p['start'] == '09-01' and p['end'] == '09-30' and p['coverage']['checklists'] >= 1
    assert all(0 < row[2] <= row[3] == p['coverage']['checklists'] for row in p['species'])
    output['places'].append({**p, 'group': 'brazil-september'})
(root / 'dist/route-pilot.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
