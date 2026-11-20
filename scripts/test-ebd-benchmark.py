#!/usr/bin/env python3
"""Local bounded benchmark regressions. No network or production access."""
import csv
import gzip
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('benchmark', HERE / 'ebd-benchmark.py')
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)
base = bench.WORKSPACE / 'outputs/ebd_sample'
observations = base / 'ebd_US-AL-125_202503_202503_smp_relMar-2025.txt'
sampling = base / 'ebd_US-AL-125_202503_202503_smp_relMar-2025_sampling.txt'
with tempfile.TemporaryDirectory(prefix='aviquiz-ebd-tests-') as temp:
    root = Path(temp)
    def run(name, *args, expected=0):
        command = [sys.executable, '-B', str(HERE / 'ebd-benchmark.py'), '--output', str(root / name), '--skip-scans', *args]
        result = subprocess.run(command, capture_output=True, text=True)
        assert result.returncode == expected, (result.stdout, result.stderr)
        report = json.loads((root / name / 'report.json').read_text())
        assert bench.directory_bytes(root / name) < report['limits']['disk_bytes']
        return report
    report = run('correct')
    sample = report['results'][0]
    assert sample['status'] == 'complete'
    assert sample['counts']['eligible_outings'] == 202
    assert sample['counts']['species'] == 119
    assert not (root / 'correct/sample/staging.partial.sqlite').exists()
    db = sqlite3.connect(root / 'correct/sample/aggregate.sqlite')
    assert db.execute("SELECT name FROM sqlite_master WHERE name IN ('events','detections')").fetchall() == []
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    db.close()
    # Independent original in-memory implementation: compare every taxon and every base output field.
    ref = subprocess.run([sys.executable, '-B', str(HERE / 'ebd-seasonal-pilot.py'),
        '--observations', str(observations), '--sampling', str(sampling), '--place', 'US-AL-125',
        '--first-year', '2025', '--last-year', '2025', '--start', '01-01', '--end', '12-31',
        '--release', 'relMar-2025', '--rankings', str(root / 'reference.csv')], capture_output=True, text=True, check=True)
    reference = json.loads(ref.stdout)
    assert sample['counts']['eligible_submissions'] == reference['scope_counts']['eligible_submissions']
    assert sample['counts']['eligible_outings'] == reference['scope_counts']['eligible_outings']
    with (root / 'reference.csv').open() as stream:
        old = list(csv.DictReader(stream))
    assert len(old) == len(sample['rankings'])
    for actual, expected in zip(sample['rankings'], old):
        for key, value in actual.items():
            if isinstance(value, (int, float)):
                assert abs(value - float(expected[key])) < 1e-12, (key, value, expected[key])
            else:
                assert value == expected[key], (key, value, expected[key])
    # A tiny supervisor budget forces a stopped run; no serving DB may remain.
    stopped = run('timeout', '--sample-seconds', '0.001', expected=2)
    assert stopped['status'] == 'incomplete'
    assert not (root / 'timeout/sample/aggregate.sqlite').exists()
    # Reusing stopped outputs is forbidden; a clean restart is independently correct.
    retry = subprocess.run([sys.executable, '-B', str(HERE / 'ebd-benchmark.py'), '--output', str(root / 'timeout'), '--skip-scans'], capture_output=True, text=True)
    assert retry.returncode != 0 and 'already exists' in retry.stderr
    assert run('restart')['results'][0]['counts'] == sample['counts']
    # Force SQLite's disk allocation limit without generating a large input.
    folder = root / 'disk-limit'; folder.mkdir()
    config = {'mode':'sample','directory':str(folder),'max_file_bytes':4096,'memory_bytes':256*bench.MIB,
              'seconds':60,'observations':str(observations),'sampling':str(sampling),
              'place':'US-AL-125','first_year':2025,'last_year':2025,'release':'relMar-2025'}
    failed = subprocess.run([sys.executable, '-B', str(HERE / 'ebd-benchmark.py'), '--worker'], input=json.dumps(config)+'\n', capture_output=True, text=True, check=True)
    assert json.loads(failed.stdout)['status'] == 'incomplete'
    assert not (folder / 'aggregate.sqlite').exists()
    # A wrong pair fails closed, rather than creating a usable species list.
    with observations.open() as stream:
        header = stream.readline().rstrip('\n').split('\t')
        row = stream.readline().rstrip('\n').split('\t')
    row[header.index('SAMPLING EVENT IDENTIFIER')] = 'S-not-in-sampling'
    mismatch = root / 'mismatch.txt'
    mismatch.write_text('\t'.join(header)+'\n'+'\t'.join(row)+'\n')
    bad = run('wrong-pair', '--observations', str(mismatch), expected=2)
    assert bad['results'][0]['status'] == 'incomplete'
    assert not (root / 'wrong-pair/sample/aggregate.sqlite').exists()
    # A deliberately tiny resident-memory budget stops the child without promotion.
    memory_root = root / 'memory'; memory_root.mkdir()
    memory_stage = memory_root / 'sample'; memory_stage.mkdir()
    limited = bench.supervise({**config,'directory':str(memory_stage),'memory_bytes':1}, memory_root, 8*bench.MIB)
    assert limited['status'] == 'incomplete'
    assert not (memory_stage / 'aggregate.sqlite').exists()
    # Streaming reads the gzip inside tar, and a truncated gzip must not be called complete.
    archive = root / 'tiny.tar'
    payload = b'OBSERVATION DATE\tCOUNTY CODE\n'+b'2025-03-01\tUS-AL-125\n'*100
    zipped = gzip.compress(payload)
    with tarfile.open(archive, 'w') as tar:
        info = tarfile.TarInfo('ebd.txt.gz'); info.size = len(zipped)
        tar.addfile(info, io.BytesIO(zipped))
    scanned = bench.scan({'archive':str(archive),'seconds':1})
    assert scanned['rows_read'] == 100 and scanned['gzip_checksum_verified']
    truncated = root / 'bad.gz'; truncated.write_bytes(zipped[:-8])
    try:
        bench.scan({'archive':str(truncated),'seconds':1})
        raise AssertionError('Truncated gzip accepted')
    except EOFError:
        pass
print('Passed all 119 taxa against original pilot; pairing failure, disk/memory/time stops, no partial promotion, new-directory restart, aggregate-only retention, gzip-in-tar streaming and truncated gzip rejection. No network or production access.')
