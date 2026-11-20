#!/usr/bin/env python3
"""Private offline ingestion controls; no production or network access."""
import gzip
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ingest = load('ingest', 'ebd-ingest.py')
fixtures = load('fixtures', 'test-ebd-partition.py')


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='aviquiz-ingest-test-')
        self.folder = Path(self.temporary.name)
        self.paths = fixtures.PartitionTests.sources(self, [('US', 'US-', 'United States', 'United States'), ('US', 'US-NC', 'United States', 'North Carolina')])
        self.limit_patch = patch.object(ingest.resource, 'setrlimit')
        self.limit_patch.start()

    def tearDown(self):
        self.limit_patch.stop()
        self.temporary.cleanup()

    def config(self, kind, output_bytes=1024*1024, reserve_bytes=0):
        folder = self.folder / 'run' / kind
        folder.mkdir(parents=True)
        return {'kind': kind, 'directory': str(folder), 'archive': str(self.paths[kind]),
                'output_bytes': output_bytes, 'memory_bytes': 256 * ingest.b.MIB,
                'reserve_bytes': reserve_bytes, 'seconds': 10, 'parent_pid': os.getppid(),
                'source_identity': ingest.p.identity(self.paths[kind])}

    def test_complete_workers_and_atomic_manifest(self):
        results = {kind: ingest.consume(self.config(kind)) for kind in self.paths}
        self.assertTrue(all(value['status'] == 'complete' for value in results.values()))
        manifest = {'status': 'running', 'priorities': ingest.p.PRIORITIES, 'serving_ready': False}
        output = self.folder / 'run'
        ingest.finalize(output, manifest, results)
        final = json.loads((output / 'manifest.json').read_text())
        self.assertEqual(final['status'], 'partitioned')
        self.assertFalse(final['serving_ready'])
        self.assertEqual(len(final['partitions']), 2)
        self.assertEqual(final['queue'][0]['region'], 'US-NC')
        for item in final['partitions']:
            for value in item['files'].values():
                path = output / value['path']
                self.assertEqual(ingest.p.checksum(path), value['sha256'])
                with gzip.open(path, 'rt') as stream:
                    self.assertNotIn('DO-NOT-RETAIN', stream.read())

    def test_hard_compressed_budget_and_free_reserve(self):
        result = ingest.consume(self.config('sampling', output_bytes=100))
        self.assertEqual(result['status'], 'incomplete')
        self.assertFalse(result['source_complete'])
        self.assertLessEqual(result['compressed_output_bytes'], 100)
        result = ingest.consume(self.config('observations', reserve_bytes=10**18))
        self.assertEqual(result['status'], 'incomplete')
        self.assertFalse(result['source_complete'])
        self.assertEqual(result['rows_read'], 0)

    def test_partial_sources_cannot_finalize(self):
        output = self.folder / 'partial'
        output.mkdir()
        manifest = {'status': 'running', 'priorities': ingest.p.PRIORITIES}
        with self.assertRaises(ValueError):
            ingest.finalize(output, manifest, {'sampling': {'status':'complete','source_complete':True},
                                               'observations': {'status':'incomplete','source_complete':False}})
        with self.assertRaises(ValueError):
            ingest.finalize(output, manifest, {})
        self.assertFalse((output / 'manifest.json').exists())

    def test_supervisor_stops_at_disk_reserve(self):
        actual = shutil.disk_usage(self.folder)
        calls = 0
        def disk(path):
            nonlocal calls
            calls += 1
            free = 100 * ingest.GIB if calls == 1 else 55 * ingest.GIB
            return type(actual)(actual.total, actual.total-free, free)
        with patch.object(ingest.shutil, 'disk_usage', side_effect=disk):
            manifest = ingest.run(**self.paths, output=self.folder / 'low-disk', release='test', output_gib=1, max_hours=0.01)
        self.assertEqual(manifest['status'], 'incomplete')
        self.assertEqual(manifest['stop_reason'], 'free_disk_reserve')
        self.assertFalse(manifest['serving_ready'])

    def test_supervisor_end_to_end_when_local_reserve_available(self):
        if shutil.disk_usage(self.folder).free < 61 * ingest.GIB:
            self.skipTest('Requires the real 60 GiB safety reserve; never weaken it for CI')
        manifest = ingest.run(**self.paths, output=self.folder / 'supervised', release='test', output_gib=1, max_hours=0.01)
        self.assertEqual(manifest['status'], 'partitioned')
        self.assertFalse(manifest['serving_ready'])
        self.assertGreaterEqual(manifest['minimum_monitored_free_bytes'], 60 * ingest.GIB)
        self.assertTrue(all(value <= 256 * ingest.b.MIB for value in manifest['peak_monitored_worker_rss_bytes'].values()))


if __name__ == '__main__':
    unittest.main()
