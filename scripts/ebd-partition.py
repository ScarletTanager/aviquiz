#!/usr/bin/env python3
"""Bounded offline regional EBD preparation. Never publishes quiz data."""
import argparse
from collections import OrderedDict
from datetime import date, datetime, timezone
import fnmatch
import zlib
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ebd_benchmark', ROOT / 'scripts/ebd-benchmark.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)
MIB = 1024 * 1024
PRIORITIES = ['US-NC', 'US-*', 'CO', '*']
COMMON = ['LAST EDITED DATE', 'COUNTRY', 'COUNTRY CODE', 'STATE', 'STATE CODE',
          'COUNTY CODE', 'LOCALITY ID', 'LOCALITY TYPE', 'OBSERVATION DATE',
          'SAMPLING EVENT IDENTIFIER']
PROJECTION = {
    'sampling': COMMON + ['GROUP IDENTIFIER', 'PROTOCOL CODE', 'ALL SPECIES REPORTED',
                          'DURATION MINUTES', 'EFFORT DISTANCE KM', 'EFFORT AREA HA', 'NUMBER OBSERVERS'],
    'observations': COMMON + ['GLOBAL UNIQUE IDENTIFIER', 'CATEGORY', 'TAXON CONCEPT ID',
                              'SCIENTIFIC NAME', 'COMMON NAME', 'OBSERVATION COUNT', 'APPROVED'],
}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def identity(path):
    stat = path.stat()
    return {'path': str(path.resolve()), 'size_bytes': stat.st_size, 'mtime_ns': stat.st_mtime_ns}


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def priorities(value):
    rules = [v.strip().upper() for v in value.split(',')]
    if not rules or any(not re.fullmatch(r'(?:[A-Z]{2}|US-[A-Z0-9]{1,6}|US-\*|\*)', r) for r in rules):
        raise ValueError('Use country codes, US state codes, US-* or *, separated by commas.')
    return list(dict.fromkeys(rules + ['*']))


def queue(manifest, rules):
    def order(item):
        key = item['region']
        rank = next(i for i, rule in enumerate(rules) if fnmatch.fnmatchcase(key, rule))
        # The residual US partition (records without a state) follows US states.
        if key == 'US' and 'US-*' in rules:
            rank = min(rank, rules.index('US-*'))
        return rank, key == 'US', item['name'].casefold(), key
    return [{**item, 'status': 'awaiting_aggregation_and_validation' if manifest['status'] == 'partitioned' else 'blocked_incomplete_sources'}
            for item in sorted(manifest['partitions'], key=order)]


def save_manifest(folder, value):
    temporary = folder / 'manifest.next.json'
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(folder / 'manifest.json')


class Writers:
    """Eight open files, up to 256 retained compression states, bounded output."""
    def __init__(self, folder, cap, actual_cap=None):
        self.folder, self.cap, self.reserved = folder, cap, 0
        self.actual_cap, self.written = actual_cap, 0
        self.handles, self.compressors = OrderedDict(), OrderedDict()

    def emit(self, pair, content):
        if not content:
            return
        if self.actual_cap is not None and self.written + len(content) > self.actual_cap:
            raise benchmark.LimitReached('Compressed output budget reached')
        self.written += len(content)
        if pair not in self.handles:
            if len(self.handles) >= 8:
                _, old = self.handles.popitem(last=False)
                old.close()
            key, kind = pair
            self.handles[pair] = (self.folder / key / (kind + '.partial.tsv.gz')).open('ab')
        handle = self.handles.pop(pair)
        self.handles[pair] = handle
        handle.write(content)

    def write(self, key, kind, content):
        pair = (key, kind)
        new_member = pair not in self.compressors
        cost = len(content) + (len(content) // 16384 + 1) * 16 + (1024 if new_member else 0)
        if self.reserved + cost > self.cap:
            raise benchmark.LimitReached('Projected output budget reached')
        self.reserved += cost
        if new_member:
            if len(self.compressors) >= 256:
                old_pair, old = self.compressors.popitem(last=False)
                self.emit(old_pair, old.flush())
            target = self.folder / key
            target.mkdir(exist_ok=True)
            path = target / (kind + '.partial.tsv.gz')
            # A compressor can be opened long before it emits its first bytes.
            # Existing file presence marks a previous, finalized gzip member.
            if not path.exists():
                header = ('\t'.join(PROJECTION[kind]) + '\n').encode()
                if self.reserved + len(header) > self.cap:
                    raise benchmark.LimitReached('Projected header budget reached')
                self.reserved += len(header)
                content = header + content
            self.compressors[pair] = zlib.compressobj(level=1, wbits=31)
        compressor = self.compressors.pop(pair)
        self.compressors[pair] = compressor
        self.emit(pair, compressor.compress(content))

    def close(self):
        error = None
        try:
            while self.compressors:
                pair, compressor = self.compressors.popitem(last=False)
                try:
                    self.emit(pair, compressor.flush())
                except Exception as failure:
                    error = failure
                    self.compressors.clear()
                    break
        finally:
            for handle in self.handles.values():
                handle.close()
            self.handles.clear()
        if error:
            raise error


def partition(*, observations, sampling, output, release, first_year, last_year,
              max_output_mib=500, max_seconds=60, max_rows=None, rules=None):
    output = output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError('Outputs must be outside the source/deployment repository.')
    if output.exists():
        raise ValueError('Use a new output directory; partial runs are never appended or resumed.')
    if not 1 <= max_output_mib <= 500 or not 0 < max_seconds <= 86400:
        raise ValueError('Local preparation requires 1–500 MiB output and a positive deadline up to one day.')
    if not 1800 <= first_year <= last_year <= 9999 or not release.strip():
        raise ValueError('Specify a release and a valid inclusive year range.')
    if max_rows is not None and max_rows < 1:
        raise ValueError('max_rows must be positive.')
    output.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output.parent).free < (max_output_mib + 2048) * MIB:
        raise ValueError('At least the output budget plus 2 GiB free space is required.')
    inputs = {'sampling': sampling.resolve(), 'observations': observations.resolve()}
    before = {k: identity(p) for k, p in inputs.items()}
    output.mkdir(mode=0o700)
    manifest = {'schema': 'aviquiz-ebd-partitions-v1', 'status': 'incomplete',
                'release': release, 'release_pairing': 'operator-supplied; not independently attested',
                'first_year': first_year, 'last_year': last_year, 'started_at': stamp(),
                'source_identity': before, 'source_identity_is_cryptographic': False,
                'projection': PROJECTION, 'policy': 'region-projection-v1',
                'priorities': rules or PRIORITIES, 'sources': {}, 'partitions': [],
                'limits': {'max_output_mib': max_output_mib, 'max_seconds': max_seconds, 'max_rows_per_source': max_rows},
                'serving_ready': False}
    save_manifest(output, manifest)
    budget = max_output_mib * MIB
    writers, regions = Writers(output, budget - min(budget // 4, 4 * MIB)), {}
    started = time.monotonic()
    deadline = started + max_seconds
    try:
        for kind, path in inputs.items():
            counts = {'rows_read': 0, 'rows_retained': 0, 'rows_outside_years': 0, 'complete': False}
            manifest['sources'][kind] = counts
            with benchmark.source(path) as (stream, metadata, _):
                counts['container'] = metadata
                header, _ = benchmark.fields(stream)
                if not set(PROJECTION[kind]) <= set(header):
                    raise ValueError('Missing required ' + kind + ' fields')
                for row in benchmark.records(stream, header, deadline):
                    counts['rows_read'] += 1
                    if max_rows is not None and counts['rows_read'] > max_rows:
                        raise benchmark.LimitReached('Bounded prefix; not a complete regional extract')
                    day = date.fromisoformat(row['OBSERVATION DATE'])
                    if day.isoformat() != row['OBSERVATION DATE']:
                        raise ValueError('Non-canonical observation date')
                    if not first_year <= day.year <= last_year:
                        counts['rows_outside_years'] += 1
                        continue
                    country, state = row['COUNTRY CODE'], row['STATE CODE']
                    if not re.fullmatch(r'[A-Z]{2}', country):
                        raise ValueError('Invalid country code')
                    key = state if country == 'US' and state else country
                    if country == 'US' and state and not re.fullmatch(r'US-[A-Z0-9]{1,6}', state):
                        raise ValueError('Invalid US state code')
                    if not row['SAMPLING EVENT IDENTIFIER']:
                        raise ValueError('Missing sampling event identifier')
                    name = row['STATE'] if key.startswith('US-') else row['COUNTRY']
                    if len(name) > 400:
                        raise ValueError('Invalid geographic label')
                    if key not in regions:
                        if len(regions) >= 1024:
                            raise ValueError('Regional partition limit reached')
                        regions[key] = {'region': key, 'name': name or key, 'rows': {'sampling': 0, 'observations': 0}}
                    writers.write(key, kind, ('\t'.join(row[field] for field in PROJECTION[kind]) + '\n').encode())
                    regions[key]['rows'][kind] += 1
                    counts['rows_retained'] += 1
                    if counts['rows_read'] % 1000 == 0 and shutil.disk_usage(output).free < 2048 * MIB:
                        raise benchmark.LimitReached('Free disk reserve reached')
            if identity(path) != before[kind]:
                raise ValueError('Source file changed during processing')
            counts['complete'] = True  # Only after gzip EOF/CRC and context exit.
            counts['gzip_checksum_verified'] = path.suffix in ('.gz', '.tar')
        writers.close()
        for key, item in regions.items():
            item['files'] = {}
            for kind in inputs:
                partial = output / key / (kind + '.partial.tsv.gz')
                # A region can have eligible zero-detection sampling events, or
                # observation rows without matching sampling: aggregation decides.
                if partial.exists():
                    final = partial.with_name(kind + '.tsv.gz')
                    partial.rename(final)
                    item['files'][kind] = {'path': str(final.relative_to(output)),
                                           'bytes': final.stat().st_size,
                                           'sha256': checksum(final)}
        manifest['status'] = 'partitioned'
    except (Exception, KeyboardInterrupt) as error:
        writers.close()
        manifest['error'] = str(error)
    finally:
        manifest['partitions'] = list(regions.values())
        manifest['finished_at'] = stamp()
        manifest['elapsed_seconds'] = time.monotonic() - started
        manifest['process_peak_rss_bytes'] = benchmark.peak_rss()
        manifest['projected_budget_used_bytes'] = writers.reserved
        manifest['output_bytes_before_manifest'] = benchmark.directory_bytes(output)
        save_manifest(output, manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('partition', help='Stream a paired release into private regional projections')
    for field in ['observations', 'sampling', 'output']:
        prepare.add_argument('--' + field, type=Path, required=True)
    prepare.add_argument('--release', required=True)
    prepare.add_argument('--first-year', type=int, required=True)
    prepare.add_argument('--last-year', type=int, required=True)
    prepare.add_argument('--max-output-mib', type=int, default=500)
    prepare.add_argument('--max-seconds', type=float, default=60)
    prepare.add_argument('--max-rows', type=int)
    prepare.add_argument('--priorities', default=','.join(PRIORITIES))
    plan = commands.add_parser('plan', help='Reorder existing regional work without rescanning data')
    plan.add_argument('manifest', type=Path)
    plan.add_argument('--priorities', default=','.join(PRIORITIES))
    args = vars(parser.parse_args())
    command = args.pop('command')
    try:
        rules = priorities(args.pop('priorities'))
        if command == 'plan':
            manifest = json.loads(args['manifest'].read_text())
            if manifest.get('schema') != 'aviquiz-ebd-partitions-v1':
                raise ValueError('Unsupported partition manifest')
            print(json.dumps({'source_status': manifest['status'], 'priorities': rules,
                              'queue': queue(manifest, rules)}, indent=2, ensure_ascii=False))
            return
        manifest = partition(**args, rules=rules)
        print(json.dumps({'status': manifest['status'], 'manifest': str(args['output'] / 'manifest.json'),
                          'regions': len(manifest['partitions']), 'serving_ready': False,
                          'error': manifest.get('error')}, indent=2))
        if manifest['status'] != 'partitioned':
            raise SystemExit(2)
    except (ValueError, OSError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
