#!/usr/bin/env python3
"""Supervised local paired-release partitioning; no production publication."""
import argparse
from datetime import date
import importlib.util
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('partitioner', ROOT / 'scripts/ebd-partition.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
b = p.benchmark
GIB = 1024 ** 3


def atomic(path, value):
    temporary = path.with_suffix('.next.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False) + '\n')
    temporary.replace(path)


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def consume(config):
    os.nice(10)
    limit = config['output_bytes']
    resource.setrlimit(resource.RLIMIT_FSIZE, (max(limit, 4 * b.MIB), max(limit, 4 * b.MIB)))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (config['memory_bytes'] * 2, config['memory_bytes'] * 2))
    folder, kind = Path(config['directory']), config['kind']
    regions = folder / 'regions'
    regions.mkdir()
    # Compressed bytes are hard-bounded per process. The parent's monitored
    # filesystem reserve is an independent guard, including unrelated writers.
    writers = p.Writers(regions, 16 * 1024 * GIB, actual_cap=limit)
    result = {'kind': kind, 'status': 'incomplete', 'rows_read': 0, 'partitions': {},
              'source_complete': False, 'gzip_checksum_verified': False, 'serving_ready': False}
    started = last = time.monotonic()
    def stopping(signum, frame):
        raise InterruptedError('Stopped by supervisor')
    signal.signal(signal.SIGTERM, stopping)
    try:
        if shutil.disk_usage(folder).free < config['reserve_bytes']:
            raise b.LimitReached('Free disk reserve reached')
        with b.source(config['archive']) as (stream, metadata, compressed):
            result['container'] = metadata
            header, _ = b.fields(stream)
            if not set(p.PROJECTION[kind]) <= set(header):
                raise ValueError('Required projection fields are missing')
            for row in b.records(stream, header, started + config['seconds']):
                key = p.region_key(row['COUNTRY CODE'], row['STATE CODE'])
                day = row['OBSERVATION DATE']
                if date.fromisoformat(day).isoformat() != day or not row['SAMPLING EVENT IDENTIFIER']:
                    raise ValueError('Invalid date or missing sampling event identifier')
                name = (row['STATE'] if key.startswith('US-') else row['COUNTRY']) or key
                if len(name) > 400:
                    raise ValueError('Invalid geographic label')
                if key not in result['partitions']:
                    if len(result['partitions']) >= 1024:
                        raise ValueError('Regional partition limit reached')
                    result['partitions'][key] = {'name': name, 'rows': 0}
                writers.write(key, kind, ('\t'.join(row[field] for field in p.PROJECTION[kind]) + '\n').encode())
                result['rows_read'] += 1
                result['partitions'][key]['rows'] += 1
                if result['rows_read'] % 2000 == 0:
                    if os.getppid() != config['parent_pid']:
                        raise InterruptedError('Supervisor exited')
                    if shutil.disk_usage(folder).free < config['reserve_bytes']:
                        raise b.LimitReached('Free disk reserve reached')
                    if time.monotonic() - last >= 10:
                        atomic(folder / 'progress.json', {'kind': kind, 'status': 'reading',
                            'rows_read': result['rows_read'], 'regions': len(result['partitions']),
                            'elapsed_seconds': time.monotonic() - started,
                            'compressed_bytes_read': compressed.tell() if compressed else None,
                            'compressed_member_bytes': metadata.get('compressed_member_bytes'),
                            'compressed_output_bytes': writers.written, 'peak_rss_bytes': b.peak_rss()})
                        last = time.monotonic()
            writers.close()
            result['compressed_bytes_read'] = compressed.tell() if compressed else None
        if p.identity(Path(config['archive'])) != config['source_identity']:
            raise ValueError('Source changed during processing')
        result.update(status='complete', source_complete=True,
                      gzip_checksum_verified=Path(config['archive']).suffix in ('.tar', '.gz'))
    except (Exception, KeyboardInterrupt) as error:
        result['reason'] = type(error).__name__
        result['message'] = str(error)[:400]
    finally:
        try:
            writers.close()
        except Exception:
            result.update(status='incomplete', source_complete=False, message='Output finalization failed')
        result.update(elapsed_seconds=time.monotonic() - started, compressed_output_bytes=writers.written,
                      peak_rss_bytes=b.peak_rss(), finished_at=p.stamp())
        atomic(folder / 'progress.json', {k: v for k, v in result.items() if k != 'partitions'})
    return result


def finalize(output, manifest, results):
    """No ready manifest until both full sources and all output hashes succeed."""
    if set(results) != {'sampling', 'observations'} or not all(value.get('status') == 'complete' and value.get('source_complete') for value in results.values()):
        raise ValueError('Both complete sources are required')
    items = {}
    for kind, result in results.items():
        for key, region in result['partitions'].items():
            item = items.setdefault(key, {'region': key, 'name': region['name'],
                                         'rows': {'sampling': 0, 'observations': 0}, 'files': {}})
            item['rows'][kind] = region['rows']
            partial = output / kind / 'regions' / key / (kind + '.partial.tsv.gz')
            if not partial.is_file():
                raise ValueError('Expected projection file is missing')
            final = partial.with_name(kind + '.tsv.gz')
            partial.rename(final)
            item['files'][kind] = {'path': str(final.relative_to(output)), 'bytes': final.stat().st_size,
                                   'sha256': p.checksum(final)}
    manifest.update(status='partitioned', partitions=list(items.values()), finished_at=p.stamp(), serving_ready=False)
    manifest['queue'] = p.queue(manifest, manifest['priorities'])
    p.save_manifest(output, manifest)


def run(*, observations, sampling, output, release, output_gib=350, reserve_free_gib=60,
        memory_mib=256, max_hours=24):
    output = output.resolve()
    if ROOT == output or ROOT in output.parents or output.exists():
        raise ValueError('Use a new private output directory outside the repository')
    if not 1 <= output_gib <= 350 or reserve_free_gib < 60 or not 128 <= memory_mib <= 512 or not 0 < max_hours <= 24:
        raise ValueError('Limits: at most 350 GiB output, at least 60 GiB free reserve, 128–512 MiB RAM per process, at most 24 hours')
    sources = {'sampling': sampling.resolve(), 'observations': observations.resolve()}
    if len(set(sources.values())) != 2 or not release.strip():
        raise ValueError('Two distinct source files and a release identifier are required')
    identities = {kind: p.identity(path) for kind, path in sources.items()}
    output.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output.parent).free < (output_gib + reserve_free_gib) * GIB:
        raise ValueError('Insufficient free disk for both the output cap and reserve')
    output.mkdir(mode=0o700)
    budget = output_gib * GIB - 4 * b.MIB
    # 1/14 for sampling, 13/14 for observations. Caps sum to less than the
    # total authorized budget, even if the supervisor is delayed.
    sampling_budget = budget // 14
    per_source = {'sampling': sampling_budget, 'observations': budget - sampling_budget}
    manifest = {'schema': 'aviquiz-ebd-partitions-v1', 'status': 'running', 'started_at': p.stamp(),
                'release': release, 'release_pairing': 'operator-supplied; not independently attested',
                'year_selection': 'all valid source observation dates; no lookback filter',
                'projection': p.PROJECTION, 'policy': 'region-projection-v1',
                'source_identity': identities, 'source_identity_is_cryptographic': False,
                'priorities': p.PRIORITIES, 'partitions': [], 'serving_ready': False,
                'supervisor_pid': os.getpid(), 'runner_sha256': p.checksum(Path(__file__)),
                'partitioner_sha256': p.checksum(ROOT / 'scripts/ebd-partition.py'),
                'git_commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(), 'limits': {'output_bytes': output_gib * GIB,
                'reserve_free_bytes': reserve_free_gib * GIB, 'worker_rss_bytes': memory_mib * b.MIB,
                'max_hours': max_hours, 'processes': 2, 'worker_nice_increment': 10}}
    p.save_manifest(output, manifest)
    children, handles, results = {}, [], {}
    started, reason = time.monotonic(), None
    peak_rss, minimum_free = {}, shutil.disk_usage(output).free
    try:
        for kind, path in sources.items():
            folder = output / kind
            folder.mkdir()
            result_file, errors = (folder / 'result.json').open('wb'), (folder / 'stderr.txt').open('wb')
            handles.extend([result_file, errors])
            config = {'kind': kind, 'directory': str(folder), 'archive': str(path),
                      'output_bytes': per_source[kind], 'memory_bytes': memory_mib * b.MIB,
                      'reserve_bytes': reserve_free_gib * GIB, 'seconds': max_hours * 3600,
                      'parent_pid': os.getpid(), 'source_identity': identities[kind]}
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--worker'],
                      stdin=subprocess.PIPE, stdout=result_file, stderr=errors,
                      env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
            children[kind] = child
            child.stdin.write((json.dumps(config) + '\n').encode())
            child.stdin.close()
        while True:
            free = shutil.disk_usage(output).free
            minimum_free = min(minimum_free, free)
            progress, alive = {}, False
            for kind, child in children.items():
                progress[kind] = read_json(output / kind / 'progress.json')
                if child.poll() is None:
                    alive = True
                    rss = b.rss_for(child.pid)
                    peak_rss[kind] = max(peak_rss.get(kind, 0), rss)
                    if rss > memory_mib * b.MIB:
                        reason = 'worker_rss_limit:' + kind
                elif child.returncode != 0:
                    reason = 'worker_exit:' + kind
                else:
                    result = read_json(output / kind / 'result.json')
                    if result:
                        results[kind] = result
                    if not result or result.get('status') != 'complete':
                        reason = 'incomplete_source:' + kind
                    else:
                        results[kind] = result
            if free < reserve_free_gib * GIB:
                reason = 'free_disk_reserve'
            if time.monotonic() - started > max_hours * 3600 + 5:
                reason = 'supervisor_deadline'
            atomic(output / 'status.json', {'status': 'running' if alive and not reason else 'stopping' if reason else 'validating',
                'updated_at': p.stamp(), 'free_bytes': free, 'peak_worker_rss_bytes': peak_rss,
                'elapsed_seconds': time.monotonic() - started, 'sources': progress, 'stop_reason': reason})
            if reason or not alive:
                break
            time.sleep(1)
    except (Exception, KeyboardInterrupt) as error:
        reason = type(error).__name__
    finally:
        for child in children.values():
            if child.poll() is None:
                child.terminate()
        for child in children.values():
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        for handle in handles:
            handle.close()
    manifest.update(elapsed_seconds=time.monotonic() - started, minimum_monitored_free_bytes=minimum_free,
                    peak_monitored_worker_rss_bytes=peak_rss,
                    sources={kind: {k: v for k, v in result.items() if k != 'partitions'} for kind, result in results.items()})
    if not reason:
        try:
            finalize(output, manifest, results)
        except (Exception, KeyboardInterrupt) as error:
            reason = type(error).__name__
    if reason:
        manifest.update(status='incomplete', stop_reason=reason, finished_at=p.stamp())
        p.save_manifest(output, manifest)
    atomic(output / 'status.json', {'status': manifest['status'], 'updated_at': p.stamp(),
                                   'stop_reason': reason, 'serving_ready': False})
    return manifest


def main():
    if '--worker' in sys.argv:
        result = consume(json.loads(sys.stdin.readline()))
        print(json.dumps(result))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ['observations', 'sampling', 'output']:
        parser.add_argument('--' + field, type=Path, required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('--output-gib', type=int, default=350)
    parser.add_argument('--reserve-free-gib', type=int, default=60)
    parser.add_argument('--memory-mib', type=int, default=256)
    parser.add_argument('--max-hours', type=float, default=24)
    try:
        manifest = run(**vars(parser.parse_args()))
        print(json.dumps({'status': manifest['status'], 'partitions': len(manifest['partitions']),
                          'serving_ready': False, 'stop_reason': manifest.get('stop_reason')}))
        if manifest['status'] != 'partitioned':
            raise SystemExit(2)
    except (ValueError, OSError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
