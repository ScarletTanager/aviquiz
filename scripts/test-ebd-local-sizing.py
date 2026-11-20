#!/usr/bin/env python3
"""Offline checks for the supervised parallel sizing runner."""
import gzip
import importlib.util
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sizing = load('sizing', HERE / 'ebd-local-sizing.py')
fixtures = load('fixtures', HERE / 'test-ebd-partition.py')


class SizingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='aviquiz-sizing-test-')
        self.folder = Path(self.temporary.name)
        self.paths = fixtures.PartitionTests.sources(self)

    def tearDown(self):
        self.temporary.cleanup()

    def config(self, kind, **changes):
        directory = self.folder / kind
        directory.mkdir()
        return {'kind': kind, 'directory': str(directory), 'archive': str(self.paths[kind]),
                'seconds': 1, 'projection_budget_bytes': 4 * sizing.bench.MIB, **changes}

    def test_full_small_source_is_still_not_serving_data(self):
        config = self.config('sampling')
        result = sizing.profile(config)
        self.assertEqual(result['status'], 'complete')
        self.assertTrue(result['source_complete'])
        self.assertFalse(result['serving_ready'])
        self.assertEqual(result['rows_projected'], 7)
        self.assertGreater(result['compressed_projection_bytes'], 0)
        for path in Path(config['directory']).rglob('*.gz'):
            self.assertIn('.partial.', path.name)
            with gzip.open(path, 'rt') as stream:
                self.assertNotIn('DO-NOT-RETAIN', stream.read())

    def test_projection_budget_stays_a_prefix(self):
        result = sizing.profile(self.config('observations', projection_budget_bytes=1))
        self.assertEqual(result['status'], 'bounded_prefix')
        self.assertFalse(result['source_complete'])
        self.assertFalse(result['gzip_checksum_verified'])

    def test_parallel_process_supervision(self):
        report = sizing.run(**self.paths, output=self.folder / 'parallel', seconds=2, disk_mib=32)
        self.assertEqual(report['status'], 'measured')
        self.assertEqual(report['parallel_processes'], 2)
        self.assertEqual(len(report['results']), 2)
        self.assertTrue(all(result['rows_projected'] == 7 for result in report['results']))
        self.assertTrue(all(result['monitored_peak_rss_bytes'] <= 256 * sizing.bench.MIB for result in report['results']))
        self.assertFalse(report['serving_ready'])
        self.assertLess(sizing.bench.directory_bytes(self.folder / 'parallel'), 32 * sizing.bench.MIB)
        with self.assertRaises(ValueError):
            sizing.run(**self.paths, output=self.folder / 'parallel')

    def test_sequential_mode_and_worker_error_fail_closed(self):
        self.paths['observations'].write_text('BAD HEADER\ninvalid\n')
        report = sizing.run(**self.paths, output=self.folder / 'failure', seconds=2, disk_mib=32, parallel=1)
        self.assertEqual(report['status'], 'incomplete')
        self.assertEqual(report['results'][1]['status'], 'incomplete')
        self.assertFalse(report['serving_ready'])


if __name__ == '__main__':
    unittest.main()
