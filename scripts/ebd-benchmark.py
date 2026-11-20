#!/usr/bin/env python3
"""Bounded offline EBD correctness/throughput benchmark; never imports production data."""
import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
import gzip
import io
import json
import os
from pathlib import Path
import platform
import resource
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
MIB = 1024 * 1024
LINE_LIMIT = MIB
RESERVE = 4 * MIB


class LimitReached(RuntimeError):
    pass


def directory_bytes(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())


def peak_rss():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value if sys.platform == 'darwin' else value * 1024


@contextmanager
def source(path):
    """Stream the one data gzip inside tar, without extracting it to disk."""
    path = Path(path)
    if path.suffix == '.tar':
        with tarfile.open(path, 'r:') as archive:
            members = [m for m in archive.getmembers() if m.isfile() and m.name.endswith('.txt.gz')]
            if len(members) != 1:
                raise ValueError('Expected exactly one .txt.gz member')
            member = members[0]
            with archive.extractfile(member) as compressed, gzip.GzipFile(fileobj=compressed) as stream:
                yield stream, {'member': member.name, 'compressed_member_bytes': member.size}, compressed
    elif path.suffix == '.gz':
        with path.open('rb') as compressed, gzip.GzipFile(fileobj=compressed) as stream:
            yield stream, {'compressed_member_bytes': path.stat().st_size}, compressed
    else:
        with path.open('rb') as stream:
            yield stream, {'input_bytes': path.stat().st_size}, None


def fields(stream):
    line = stream.readline(LINE_LIMIT + 1)
    if len(line) > LINE_LIMIT:
        raise LimitReached('Header exceeds line buffer limit')
    names = line.decode('utf-8-sig').rstrip('\r\n').split('\t')
    if len(names) != len(set(names)):
        raise ValueError('Duplicate input header')
    return names, len(line)


def records(stream, header, deadline):
    index = {name: i for i, name in enumerate(header)}
    while True:
        if time.monotonic() >= deadline:
            raise LimitReached('Processing runtime limit')
        line = stream.readline(LINE_LIMIT + 1)
        if not line:
            break
        if len(line) > LINE_LIMIT:
            raise LimitReached('Input exceeds bounded line buffer')
        row = line.decode('utf-8').rstrip('\r\n').split('\t')
        if len(row) != len(header):
            raise ValueError('Input field count mismatch')
        yield {name: row[i] for name, i in index.items()}


def connection(path, max_bytes, memory_bytes):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA page_size=4096')
    db.execute(f'PRAGMA max_page_count={max(1, max_bytes // 4096)}')
    db.execute('PRAGMA journal_mode=DELETE')
    db.execute('PRAGMA temp_store=MEMORY')
    db.execute('PRAGMA cache_size=-4096')
    db.execute(f'PRAGMA hard_heap_limit={memory_bytes // 2}')
    return db


def sample(config):
    started = time.monotonic()
    deadline = started + config['seconds']
    out = Path(config['directory'])
    stage_path = out / 'staging.partial.sqlite'
    candidate = out / 'aggregate.partial.sqlite'
    db = connection(stage_path, config['max_file_bytes'], config['memory_bytes'])
    db.executescript('''
    CREATE TABLE events (event TEXT PRIMARY KEY, outing TEXT NOT NULL, day TEXT NOT NULL,
      locality TEXT NOT NULL, eligible INTEGER NOT NULL);
    CREATE INDEX events_outing ON events(outing);
    CREATE TABLE detections (event TEXT NOT NULL, taxon TEXT NOT NULL,
      scientific TEXT NOT NULL, common TEXT NOT NULL, PRIMARY KEY(event,taxon));
    ''')
    timings, counts = {}, {}
    with source(config['sampling']) as (stream, _, _):
        header, _ = fields(stream)
        needed = {'SAMPLING EVENT IDENTIFIER', 'GROUP IDENTIFIER', 'OBSERVATION DATE',
                  'LOCALITY ID', 'COUNTY CODE', 'PROTOCOL CODE', 'ALL SPECIES REPORTED'}
        if not needed <= set(header):
            raise ValueError('Missing sampling fields')
        rows_read = 0
        for row in records(stream, header, deadline):
            rows_read += 1
            day = row['OBSERVATION DATE']
            if row['COUNTY CODE'] != config['place'] or not config['first_year'] <= int(day[:4]) <= config['last_year']:
                continue
            date.fromisoformat(day)
            event, group = row['SAMPLING EVENT IDENTIFIER'], row['GROUP IDENTIFIER']
            if not event:
                raise ValueError('Missing sampling event ID')
            eligible = row['ALL SPECIES REPORTED'] == '1' and row['PROTOCOL CODE'] in ('P21', 'P22')
            db.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                       (event, 'g:' + group if group else 'e:' + event, day, row['LOCALITY ID'], int(eligible)))
        counts['sampling_source_rows'] = rows_read
    db.commit()
    timings['sampling_seconds'] = time.monotonic() - started
    db.execute('''CREATE TABLE valid_outings AS SELECT outing,min(day) day FROM events
      WHERE eligible=1 GROUP BY outing HAVING min(day)=max(day) AND min(locality)=max(locality)''')
    db.execute('CREATE UNIQUE INDEX valid_outing_id ON valid_outings(outing)')
    counts['sampling_scoped_rows'] = db.execute('SELECT COUNT(*) FROM events').fetchone()[0]
    counts['eligible_submissions'] = db.execute('SELECT COUNT(*) FROM events WHERE eligible=1').fetchone()[0]
    counts['eligible_outings'] = db.execute('SELECT COUNT(*) FROM valid_outings').fetchone()[0]
    counts['conflicting_outings_excluded'] = db.execute('SELECT COUNT(DISTINCT outing) FROM events WHERE eligible=1').fetchone()[0] - counts['eligible_outings']
    checkpoint = time.monotonic()
    missing, disagreements, rows_read = 0, 0, 0
    with source(config['observations']) as (stream, _, _):
        header, _ = fields(stream)
        needed = {'SAMPLING EVENT IDENTIFIER', 'OBSERVATION DATE', 'LOCALITY ID', 'COUNTY CODE',
                  'APPROVED', 'CATEGORY', 'TAXON CONCEPT ID', 'SCIENTIFIC NAME', 'COMMON NAME'}
        if not needed <= set(header):
            raise ValueError('Missing observation fields')
        for row in records(stream, header, deadline):
            rows_read += 1
            day = row['OBSERVATION DATE']
            if row['COUNTY CODE'] != config['place'] or not config['first_year'] <= int(day[:4]) <= config['last_year']:
                continue
            match = db.execute('SELECT * FROM events WHERE event=?', (row['SAMPLING EVENT IDENTIFIER'],)).fetchone()
            if match is None:
                missing += 1
                continue
            if match['day'] != day or match['locality'] != row['LOCALITY ID']:
                disagreements += 1
                continue
            if match['eligible'] and row['APPROVED'] == '1' and row['CATEGORY'] == 'species':
                if not row['TAXON CONCEPT ID']:
                    raise ValueError('Missing species taxon ID')
                db.execute('INSERT OR IGNORE INTO detections VALUES (?,?,?,?)',
                           (row['SAMPLING EVENT IDENTIFIER'], row['TAXON CONCEPT ID'], row['SCIENTIFIC NAME'], row['COMMON NAME']))
    db.commit()
    counts.update(observation_source_rows=rows_read, missing_sampling_events=missing, date_locality_disagreements=disagreements)
    if missing or disagreements:
        raise ValueError('Observation/sampling pairing failed')
    if not counts['eligible_outings'] or not rows_read:
        raise ValueError('No paired eligible data')
    timings['observations_seconds'] = time.monotonic() - checkpoint
    if db.execute('SELECT 1 FROM detections GROUP BY taxon HAVING COUNT(DISTINCT scientific)>1 OR COUNT(DISTINCT common)>1 LIMIT 1').fetchone():
        raise ValueError('Inconsistent species names for one taxon')
    counts['deduplicated_event_species'] = db.execute('SELECT COUNT(*) FROM detections').fetchone()[0]
    stage_bytes = directory_bytes(out)
    checkpoint = time.monotonic()
    serving = connection(candidate, config['max_file_bytes'], config['memory_bytes'])
    serving.executescript((ROOT / 'schema/ebd-seasonal.sql').read_text())
    serving.execute('INSERT INTO ebd_release VALUES (?,?,?,?)',
                    (config['release'], 'Local benchmark; source eBird Basic Dataset, Cornell Lab of Ornithology', 'release-native', 'pilot-v1'))
    serving.execute('INSERT INTO ebd_place VALUES (?,?,?,?)', (config['place'], 'region', config['place'], 'v1'))
    serving.executemany('INSERT INTO ebd_partition VALUES (?,?,?)',
                        ((config['place'], year, config['release']) for year in range(config['first_year'], config['last_year'] + 1)))
    serving.executemany('INSERT INTO ebd_taxon VALUES (?,?,?,?)',
                        (('release-native', *tuple(r)) for r in db.execute('SELECT taxon,min(scientific),min(common) FROM detections GROUP BY taxon')))
    serving.executemany('INSERT INTO ebd_effort_day VALUES (?,?,?,?)',
                        ((config['place'], int(r[0][:4]), *tuple(r)) for r in db.execute('SELECT day,COUNT(*) FROM valid_outings GROUP BY day')))
    serving.executemany('INSERT INTO ebd_detection_day VALUES (?,?,?,?,?,?)',
                        ((config['place'], int(r[0][:4]), r[0], 'release-native', r[1], r[2]) for r in db.execute('''
                        SELECT day,taxon,COUNT(*) FROM (
                          SELECT e.outing,e.day,d.taxon FROM detections d JOIN events e ON e.event=d.event
                          JOIN valid_outings v ON v.outing=e.outing GROUP BY e.outing,e.day,d.taxon
                        ) GROUP BY day,taxon''')))
    if serving.execute('SELECT 1 FROM ebd_invalid_detection LIMIT 1').fetchone():
        raise ValueError('Species detections exceed eligible effort')
    if serving.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('Aggregate foreign key failure')
    serving.commit()
    timings['aggregation_seconds'] = time.monotonic() - checkpoint
    params = dict(place_id=config['place'], first_year=config['first_year'], last_year=config['last_year'],
                  start_md='01-01', end_md='12-31', taxonomy_version='release-native', processing_version='pilot-v1')
    query = (ROOT / 'schema/ebd-seasonal-query.sql').read_text()
    serving.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
    latencies = []
    for _ in range(30):
        checkpoint = time.monotonic()
        ranked = [dict(r) for r in serving.execute(query, params)]
        latencies.append(1000 * (time.monotonic() - checkpoint))
    counts['effort_days'] = serving.execute('SELECT COUNT(*) FROM ebd_effort_day').fetchone()[0]
    counts['species'] = len(ranked)
    counts['detection_day_rows'] = serving.execute('SELECT COUNT(*) FROM ebd_detection_day').fetchone()[0]
    serving.close()
    db.close()
    # No event-level IDs or source text are retained after a successful sample run.
    stage_path.unlink()
    candidate.rename(out / 'aggregate.sqlite')
    return {'status': 'complete', 'engine': 'stdlib SQLite disk-backed baseline, not DuckDB/Parquet',
            'scope': {k: config[k] for k in ('place', 'first_year', 'last_year', 'release')},
            'counts': counts, 'timings': timings, 'elapsed_seconds': time.monotonic() - started,
            'peak_rss_bytes': peak_rss(), 'staging_bytes_before_aggregation': stage_bytes,
            'serving_database_bytes': (out / 'aggregate.sqlite').stat().st_size,
            'query_ms': {'first': latencies[0], 'median_warm': sorted(latencies[1:])[14], 'max': max(latencies)},
            'rankings': ranked, 'source_inputs_complete': True}


def scan(config):
    started = time.monotonic()
    deadline = started + config['seconds']
    rows_read, uncompressed_bytes = 0, 0
    complete = False
    with source(config['archive']) as (stream, metadata, compressed):
        header, size = fields(stream)
        uncompressed_bytes += size
        date_index = header.index('OBSERVATION DATE')
        min_day = max_day = None
        while time.monotonic() < deadline:
            line = stream.readline(LINE_LIMIT + 1)
            if not line:
                complete = True
                break
            if len(line) > LINE_LIMIT:
                raise LimitReached('Input exceeds bounded line buffer')
            values = line.rstrip(b'\r\n').split(b'\t')
            if len(values) != len(header):
                raise ValueError('Archive field count mismatch')
            day = values[date_index].decode('ascii')
            min_day = min(min_day or day, day)
            max_day = max(max_day or day, day)
            uncompressed_bytes += len(line)
            rows_read += 1
        compressed_bytes = compressed.tell() if compressed else None
    elapsed = time.monotonic() - started
    return {'status': 'complete' if complete else 'bounded_prefix', 'archive_complete': complete,
            'gzip_checksum_verified': complete, 'source': Path(config['archive']).name, **metadata,
            'elapsed_seconds': elapsed, 'rows_read': rows_read,
            'uncompressed_bytes_processed': uncompressed_bytes, 'compressed_bytes_read_including_readahead': compressed_bytes,
            'rows_per_second': rows_read / elapsed, 'uncompressed_mib_per_second': uncompressed_bytes / MIB / elapsed,
            'compressed_mib_per_second': compressed_bytes / MIB / elapsed if compressed_bytes else None,
            'prefix_date_range': [min_day, max_day], 'peak_rss_bytes': peak_rss(),
            'warning': 'Sequential prefix only; not a representative geographic sample, paired extract, or full-archive integrity check. No scan rows retained.'}


def worker():
    config = json.loads(sys.stdin.readline())
    resource.setrlimit(resource.RLIMIT_FSIZE, (config['max_file_bytes'], config['max_file_bytes']))
    if sys.platform.startswith('linux'):
        limit = config['memory_bytes'] * 2
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    started = time.monotonic()
    try:
        result = sample(config) if config['mode'] == 'sample' else scan(config)
    except Exception as error:
        result = {'status': 'incomplete', 'reason': type(error).__name__,
                  'message': str(error)[:400], 'elapsed_seconds': time.monotonic() - started,
                  'peak_rss_bytes': peak_rss(), 'source_inputs_complete': False}
    encoded = json.dumps(result, allow_nan=False)
    if len(encoded.encode()) > 512 * 1024:
        import hashlib
        result['rankings_sha256'] = hashlib.sha256(json.dumps(result.pop('rankings', []), sort_keys=True).encode()).hexdigest()
        result['rankings_omitted_from_report'] = True
        encoded = json.dumps(result, allow_nan=False)
    print(encoded)


def rss_for(pid):
    if sys.platform.startswith('linux'):
        try:
            for line in Path(f'/proc/{pid}/status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    return int(line.split()[1]) * 1024
        except FileNotFoundError:
            return 0
    else:
        result = subprocess.run(['ps', '-o', 'rss=', '-p', str(pid)], capture_output=True, text=True)
        if result.returncode:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return 0
            raise RuntimeError('RSS monitor unavailable')
        return int(result.stdout.strip() or '0') * 1024
    return 0


def supervise(config, root, budget, worker_program=None):
    config['max_file_bytes'] = max(4096, (budget - directory_bytes(root) - RESERVE) // 4 // 4096 * 4096)
    result_path = Path(config['directory']) / 'worker-result.json'
    error_path = Path(config['directory']) / 'worker-stderr.txt'
    started = time.monotonic()
    peak_disk = directory_bytes(root)
    peak_memory = 0
    stop_reason = None
    with result_path.open('wb') as output, error_path.open('wb') as errors:
        child = subprocess.Popen([sys.executable, str(worker_program or __file__), '--worker'], stdin=subprocess.PIPE,
                                 stdout=output, stderr=errors, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        child.stdin.write((json.dumps(config) + '\n').encode())
        child.stdin.close()
        try:
            while child.poll() is None:
                peak_disk = max(peak_disk, directory_bytes(root))
                peak_memory = max(peak_memory, rss_for(child.pid))
                if peak_disk > budget - RESERVE:
                    stop_reason = 'workspace_disk_limit'
                elif peak_memory > config['memory_bytes']:
                    stop_reason = 'monitored_rss_limit'
                elif time.monotonic() - started > config['seconds'] + (2 if config['mode'] == 'scan' else 0):
                    stop_reason = 'supervisor_runtime_limit'
                if stop_reason:
                    child.terminate()
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill(); child.wait()
                    break
                time.sleep(.05)
        except KeyboardInterrupt:
            child.kill(); child.wait()
            stop_reason = 'interrupted'
        except Exception as error:
            child.kill(); child.wait()
            stop_reason = 'resource_monitor_unavailable:' + type(error).__name__
    peak_disk = max(peak_disk, directory_bytes(root))
    try:
        result = json.loads(result_path.read_text())
    except (ValueError, OSError):
        result = {'status': 'incomplete', 'reason': stop_reason or 'worker_exit', 'exit_code': child.returncode}
    if stop_reason:
        result = {'status': 'incomplete', 'reason': stop_reason, 'elapsed_seconds': time.monotonic() - started}
    if result['status'] == 'incomplete':
        (Path(config['directory']) / 'aggregate.sqlite').unlink(missing_ok=True)
    result.update(monitored_peak_workspace_bytes=peak_disk, monitored_peak_rss_bytes=peak_memory,
                  per_database_file_limit_bytes=config['max_file_bytes'])
    return result


def main():
    if sys.argv[1:] == ['--worker']:
        worker(); return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='NEW directory outside the source checkout')
    parser.add_argument('--disk-mib', type=int, default=500)
    parser.add_argument('--memory-mib', type=int, default=256)
    parser.add_argument('--sample-seconds', type=float, default=60)
    parser.add_argument('--scan-seconds', type=float, default=10)
    parser.add_argument('--skip-scans', action='store_true')
    parser.add_argument('--observations', type=Path, default=WORKSPACE / 'outputs/ebd_sample/ebd_US-AL-125_202503_202503_smp_relMar-2025.txt')
    parser.add_argument('--sampling', type=Path, default=WORKSPACE / 'outputs/ebd_sample/ebd_US-AL-125_202503_202503_smp_relMar-2025_sampling.txt')
    parser.add_argument('--observation-archive', type=Path, default=WORKSPACE / 'ebd_relSep-2026.tar')
    parser.add_argument('--sampling-archive', type=Path, default=WORKSPACE / 'ebd_sampling_relSep-2026.tar')
    parser.add_argument('--place', default='US-AL-125')
    parser.add_argument('--first-year', type=int, default=2025)
    parser.add_argument('--last-year', type=int, default=2025)
    parser.add_argument('--release', default='relMar-2025')
    args = parser.parse_args()
    if not 8 <= args.disk_mib <= 500 or args.memory_mib < 32 or args.sample_seconds <= 0 or not 0 < args.scan_seconds <= 30:
        parser.error('Require disk 8..500 MiB, memory >=32 MiB, positive sample runtime and scan runtime <=30 seconds')
    output = args.output.resolve()
    if not 1800 <= args.first_year <= args.last_year <= 9999:
        parser.error('Require ordered observation years between 1800 and 9999')
    if output.exists():
        parser.error('Output directory already exists; restart in a NEW directory')
    if output == ROOT or ROOT in output.parents:
        parser.error('Benchmark outputs must be outside the source/deployment checkout')
    for path in [args.observations, args.sampling] + ([] if args.skip_scans else [args.observation_archive, args.sampling_archive]):
        if not path.is_file():
            parser.error(f'Input does not exist: {path}')
    budget = args.disk_mib * MIB
    output.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output.parent).free < budget + 2 * 1024 ** 3:
        parser.error('Insufficient disk headroom (require budget plus 2 GiB)')
    output.mkdir()  # Never overwrite or append a previous benchmark, including an interrupted one.
    metadata = {'version': 1, 'started_at': datetime.now(timezone.utc).isoformat(),
                'host': {'platform': platform.platform(), 'cpu_count': os.cpu_count(), 'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version},
                'limits': {'disk_bytes': budget, 'rss_bytes': args.memory_mib * MIB,
                           'sample_seconds': args.sample_seconds, 'scan_seconds_each': args.scan_seconds,
                           'rss_enforcement': 'supervisor sampled ~50ms; transient overshoot possible; SQLite heap also capped',
                           'disk_enforcement': 'two SQLite databases plus DELETE journals, each capped at one quarter of remaining budget; 4 MiB report reserve; no file-based SQL temp spill'},
                'production_changed': False, 'resume_policy': 'Restart from original inputs in a NEW directory; no mid-gzip resume or append.'}
    (output / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    results = []
    config = {'mode': 'sample', 'directory': str(output / 'sample'), 'memory_bytes': args.memory_mib * MIB,
              'seconds': args.sample_seconds, 'observations': str(args.observations.resolve()),
              'sampling': str(args.sampling.resolve()), 'place': args.place, 'first_year': args.first_year,
              'last_year': args.last_year, 'release': args.release}
    Path(config['directory']).mkdir()
    results.append({'stage': 'sample', **supervise(config, output, budget)})
    if not args.skip_scans and results[0]['status'] == 'complete':
        for label, archive in [('observation_prefix', args.observation_archive), ('sampling_prefix', args.sampling_archive)]:
            folder = output / label
            folder.mkdir()
            results.append({'stage': label, **supervise({'mode': 'scan', 'directory': str(folder),
                         'memory_bytes': args.memory_mib * MIB, 'seconds': args.scan_seconds,
                         'archive': str(archive.resolve())}, output, budget)})
    metadata['results'] = results
    metadata['finished_at'] = datetime.now(timezone.utc).isoformat()
    metadata['status'] = 'complete' if all(r['status'] in ('complete', 'bounded_prefix') for r in results) else 'incomplete'
    metadata['retained_output_bytes_before_final_report'] = directory_bytes(output)
    report = output / 'report.json'
    report.write_text(json.dumps(metadata, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'report': str(report), 'status': metadata['status'], 'retained_bytes': directory_bytes(output)}))
    if metadata['status'] != 'complete':
        sys.exit(2)


if __name__ == '__main__':
    main()
