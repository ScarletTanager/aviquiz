#!/usr/bin/env python3
"""Bounded projection sizing, using two independent archive-reader processes."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import resource
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('partitioner', ROOT / 'scripts/ebd-partition.py')
partitioner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(partitioner)
bench = partitioner.benchmark


def profile(config):
    started = time.monotonic()
    deadline = started + config['seconds']
    kind, folder = config['kind'], Path(config['directory'])
    writers = partitioner.Writers(folder, config['projection_budget_bytes'])
    counts, rows, projected = {}, 0, 0
    complete, reason, low, high = False, None, None, None
    with bench.source(config['archive']) as (stream, metadata, compressed):
        header, _ = bench.fields(stream)
        if not set(partitioner.PROJECTION[kind]) <= set(header):
            raise ValueError('Required projection fields are missing')
        try:
            for row in bench.records(stream, header, deadline):
                key = partitioner.region_key(row['COUNTRY CODE'], row['STATE CODE'])
                if key not in counts and len(counts) >= 1024:
                    raise ValueError('Regional partition limit reached')
                content = ('\t'.join(row[field] for field in partitioner.PROJECTION[kind]) + '\n').encode()
                writers.write(key, kind, content)
                counts[key] = counts.get(key, 0) + 1
                rows += 1
                projected += len(content)
                day = row['OBSERVATION DATE']
                low, high = min(low or day, day), max(high or day, day)
            complete = True
        except bench.LimitReached as error:
            reason = str(error)
        finally:
            writers.close()
        source_bytes = stream.tell()
        compressed_bytes = compressed.tell() if compressed else None
    elapsed = time.monotonic() - started
    output_bytes = sum(p.stat().st_size for p in folder.rglob('*.gz'))
    return {'status': 'complete' if complete else 'bounded_prefix', 'source_complete': complete,
            'gzip_checksum_verified': complete and Path(config['archive']).suffix in ('.tar', '.gz'),
            'stop_reason': reason, 'kind': kind, 'source': Path(config['archive']).name,
            'container': metadata, 'rows_projected': rows, 'prefix_date_range': [low, high],
            'regions_in_prefix': len(counts), 'elapsed_seconds': elapsed,
            'source_uncompressed_bytes_read': source_bytes,
            'compressed_bytes_read_including_readahead': compressed_bytes,
            'projected_tsv_bytes': projected, 'compressed_projection_bytes': output_bytes,
            'projected_rows_per_second': rows / elapsed,
            'compressed_input_mib_per_second': compressed_bytes / bench.MIB / elapsed if compressed_bytes else None,
            'peak_rss_bytes': bench.peak_rss(), 'serving_ready': False,
            'warning': 'Sequential prefix only: not geographically representative, not a paired extract, not a worldwide capacity estimate. Projections stay partial and must not be used as complete regional data.'}


def worker():
    config = json.loads(sys.stdin.readline())
    resource.setrlimit(resource.RLIMIT_FSIZE, (config['max_file_bytes'], config['max_file_bytes']))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (config['memory_bytes'] * 2, config['memory_bytes'] * 2))
    try:
        result = profile(config)
    except Exception as error:
        result = {'status': 'incomplete', 'reason': type(error).__name__, 'message': str(error)[:400], 'serving_ready': False}
    print(json.dumps(result))


def run(*, observations, sampling, output, seconds=10, disk_mib=128, memory_mib=256, parallel=2):
    output = output.resolve()
    if ROOT == output or ROOT in output.parents or output.exists():
        raise ValueError('Use a new output directory outside the repository')
    if not 1 <= seconds <= 60 or not 32 <= disk_mib <= 500 or not 64 <= memory_mib <= 1024 or parallel not in (1, 2):
        raise ValueError('Sizing limits: 1–60 seconds, 32–500 MiB disk, 64–1024 MiB per worker, 1 or 2 processes')
    paths = {'sampling': sampling.resolve(), 'observations': observations.resolve()}
    inputs = {kind: partitioner.identity(path) for kind, path in paths.items()}
    output.parent.mkdir(parents=True, exist_ok=True)
    budget = disk_mib * bench.MIB
    if shutil.disk_usage(output.parent).free < budget + 2048 * bench.MIB:
        raise ValueError('Output budget plus 2 GiB free disk required')
    output.mkdir(mode=0o700)
    jobs = []
    for kind, path in paths.items():
        directory = output / kind
        directory.mkdir()
        jobs.append({'mode': 'scan', 'kind': kind, 'archive': str(path), 'directory': str(directory),
                     'seconds': seconds, 'memory_bytes': memory_mib * bench.MIB,
                     'projection_budget_bytes': (budget - bench.RESERVE) // 4})
    report = {'schema': 'aviquiz-ebd-sizing-v1', 'status': 'incomplete', 'started_at': partitioner.stamp(),
              'source_identity': inputs, 'parallel_processes': parallel,
              'limits': {'disk_bytes': budget, 'worker_rss_bytes': memory_mib * bench.MIB, 'seconds_per_source': seconds},
              'serving_ready': False}
    partitioner.save_manifest(output, report)
    started = time.monotonic()
    def execute(config):
        return bench.supervise(config, output, budget, worker_program=Path(__file__).resolve())
    # Threads supervise independent OS processes; parsing/compression do not share
    # the Python interpreter or a mutable output partition.
    with ThreadPoolExecutor(max_workers=parallel) as executor:
        results = list(executor.map(execute, jobs))
    if any(partitioner.identity(path) != inputs[kind] for kind, path in paths.items()):
        raise ValueError('Source file changed during profiling')
    report.update(results=results, finished_at=partitioner.stamp(), wall_seconds=time.monotonic() - started,
                  status='measured' if all(r['status'] in ('complete', 'bounded_prefix') for r in results) else 'incomplete')
    report['retained_output_bytes_before_report'] = bench.directory_bytes(output)
    if report['retained_output_bytes_before_report'] >= budget:
        report['status'] = 'incomplete'
    partitioner.save_manifest(output, report)
    return report


def main():
    if '--worker' in sys.argv:
        worker()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ['observations', 'sampling', 'output']:
        parser.add_argument('--' + field, type=Path, required=True)
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--disk-mib', type=int, default=128)
    parser.add_argument('--memory-mib', type=int, default=256)
    parser.add_argument('--parallel', type=int, choices=[1, 2], default=2)
    try:
        report = run(**vars(parser.parse_args()))
        print(json.dumps(report, indent=2))
        if report['status'] != 'measured':
            raise SystemExit(2)
    except (ValueError, OSError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
