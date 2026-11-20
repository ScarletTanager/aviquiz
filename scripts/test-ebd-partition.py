#!/usr/bin/env python3
"""Offline regional routing, priority and incomplete-source safety checks."""
import gzip
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('partitioner', ROOT / 'scripts/ebd-partition.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PartitionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='aviquiz-ebd-partition-test-')
        self.folder = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def sources(self, geographies=None, repeats=1):
        geographies = geographies or [('EC', '', 'Ecuador', ''), ('US', 'US-VA', 'United States', 'Virginia'),
            ('CO', 'CO-CAL', 'Colombia', 'Caldas'), ('US', 'US-NC', 'United States', 'North Carolina'),
            ('CA', 'CA-ON', 'Canada', 'Ontario'), ('BR', 'BR-RJ', 'Brazil', 'Rio de Janeiro'),
            ('US', 'US-CA', 'United States', 'California')]
        paths = {}
        for kind in module.PROJECTION:
            path = self.folder / (kind + '.txt')
            header = module.PROJECTION[kind] + ['OBSERVER ID', 'CHECKLIST COMMENTS', 'LATITUDE']
            with path.open('w') as stream:
                stream.write('\t'.join(header) + '\n')
                order = geographies if kind == 'sampling' else list(reversed(geographies))
                for repeat in range(repeats):
                    for country, state, country_name, state_name in order:
                        row = dict.fromkeys(header, '')
                        row.update({'LAST EDITED DATE': '2026-10-01 01:00:00', 'COUNTRY CODE': country,
                            'COUNTRY': country_name, 'STATE CODE': state, 'STATE': state_name,
                            'OBSERVATION DATE': '2025-03-01', 'LOCALITY ID': 'L123', 'LOCALITY TYPE': 'H',
                            'SAMPLING EVENT IDENTIFIER': 'S-' + (state or country) + '-' + str(repeat),
                            'ALL SPECIES REPORTED': '1', 'PROTOCOL CODE': 'P21', 'CATEGORY': 'species',
                            'TAXON CONCEPT ID': 'taxon-1', 'COMMON NAME': 'Test bird', 'SCIENTIFIC NAME': 'Avis test',
                            'APPROVED': '1', 'OBSERVER ID': 'DO-NOT-RETAIN',
                            'CHECKLIST COMMENTS': 'DO-NOT-RETAIN', 'LATITUDE': 'DO-NOT-RETAIN'})
                        stream.write('\t'.join(row[field] for field in header) + '\n')
            paths[kind] = path
        return paths

    def run_partition(self, paths, name='out', **kwargs):
        return module.partition(**paths, output=self.folder / name, release='test-release',
                                first_year=2025, last_year=2025, **kwargs)

    def test_routing_priority_projection_and_reordering(self):
        manifest = self.run_partition(self.sources(), max_output_mib=1)
        self.assertEqual(manifest['status'], 'partitioned')
        self.assertFalse(manifest['serving_ready'])
        self.assertTrue(all(s['complete'] for s in manifest['sources'].values()))
        self.assertEqual([r['region'] for r in module.queue(manifest, module.PRIORITIES)],
                         ['US-NC', 'US-CA', 'US-VA', 'CO', 'BR', 'CA', 'EC'])
        self.assertEqual(module.queue(manifest, module.priorities('CO,US-NC,*'))[0]['region'], 'CO')
        for item in manifest['partitions']:
            for kind, file in item['files'].items():
                path = self.folder / 'out' / file['path']
                self.assertEqual(module.checksum(path), file['sha256'])
                with gzip.open(path, 'rt') as stream:
                    body = stream.read()
                self.assertNotIn('DO-NOT-RETAIN', body)
                self.assertNotIn('LATITUDE', body)
                self.assertEqual(body.splitlines()[0].split('\t'), module.PROJECTION[kind])
                self.assertEqual(item['rows'][kind], 1)

    def test_prefix_cannot_become_complete(self):
        paths = self.sources()
        manifest = self.run_partition(paths, max_rows=2)
        self.assertEqual(manifest['status'], 'incomplete')
        self.assertFalse(any(p.name in ('sampling.tsv.gz', 'observations.tsv.gz') for p in (self.folder / 'out').rglob('*')))
        self.assertTrue(all(r['status'] == 'blocked_incomplete_sources' for r in module.queue(manifest, module.PRIORITIES)))
        with self.assertRaises(ValueError):
            self.run_partition(paths)
        self.assertEqual(self.run_partition(paths, name='restart')['status'], 'partitioned')

    def test_gzip_in_tar_and_truncated_input(self):
        paths = self.sources()
        observation = paths['observations'].read_bytes()
        archive = self.folder / 'observations.tar'
        payload = gzip.compress(observation)
        with tarfile.open(archive, 'w') as tar:
            member = tarfile.TarInfo('ebd.txt.gz')
            member.size = len(payload)
            tar.addfile(member, io.BytesIO(payload))
        paths['observations'] = archive
        self.assertEqual(self.run_partition(paths)['status'], 'partitioned')
        broken = self.folder / 'broken.gz'
        broken.write_bytes(payload[:-8])
        paths['observations'] = broken
        manifest = self.run_partition(paths, name='truncated')
        self.assertEqual(manifest['status'], 'incomplete')
        self.assertFalse(manifest['sources']['observations']['complete'])

    def test_output_and_deadline_guards(self):
        paths = self.sources(repeats=1500)
        self.assertEqual(self.run_partition(paths, max_output_mib=1)['status'], 'incomplete')
        self.assertEqual(self.run_partition(paths, name='deadline', max_seconds=0.000001)['status'], 'incomplete')
        with self.assertRaises(ValueError):
            module.partition(**paths, output=ROOT / 'never-write-test-output', release='test', first_year=2025, last_year=2025)
        with self.assertRaises(ValueError):
            module.priorities('../escape')

    def test_writer_eviction_and_residual_us(self):
        geographies = [('US', 'US-NC', 'United States', 'North Carolina'),
            ('US', 'US-VA', 'United States', 'Virginia'), ('US', '', 'United States', ''),
            ('CO', 'CO-CAL', 'Colombia', 'Caldas'), ('EC', 'EC-P', 'Ecuador', 'Pichincha'),
            ('CA', '', 'Canada', ''), ('BR', '', 'Brazil', ''), ('DE', '', 'Germany', ''),
            ('FR', '', 'France', ''), ('JP', '', 'Japan', '')]
        manifest = self.run_partition(self.sources(geographies, repeats=2))
        self.assertEqual(manifest['status'], 'partitioned')
        self.assertEqual([r['region'] for r in module.queue(manifest, module.PRIORITIES)][:4],
                         ['US-NC', 'US-VA', 'US', 'CO'])
        for item in manifest['partitions']:
            for file in item['files'].values():
                with gzip.open(self.folder / 'out' / file['path'], 'rt') as stream:
                    lines = stream.readlines()
                self.assertEqual(len(lines), 3)  # one header across concatenated gzip members

    def test_sample_projection_still_matches_aggregate_baseline(self):
        sample = ROOT.parents[1] / 'outputs/ebd_sample'
        paths = {'observations': sample / 'ebd_US-AL-125_202503_202503_smp_relMar-2025.txt',
                 'sampling': sample / 'ebd_US-AL-125_202503_202503_smp_relMar-2025_sampling.txt'}
        if not all(p.exists() for p in paths.values()):
            self.skipTest('Local Cornell paired sample is not available')
        manifest = self.run_partition(paths)
        self.assertEqual(manifest['status'], 'partitioned')
        item = manifest['partitions'][0]
        self.assertEqual(item['region'], 'US-AL')
        self.assertEqual(item['rows'], {'sampling': 317, 'observations': 4863})
        def aggregate(inputs, name):
            folder = self.folder / name
            folder.mkdir()
            return module.benchmark.sample({'directory': str(folder), 'sampling': str(inputs['sampling']),
                'observations': str(inputs['observations']), 'place': 'US-AL-125',
                'first_year': 2025, 'last_year': 2025, 'release': 'test', 'seconds': 30,
                'max_file_bytes': 16 * module.MIB, 'memory_bytes': 256 * module.MIB})
        projected = {kind: self.folder / 'out' / file['path'] for kind, file in item['files'].items()}
        original, retained = aggregate(paths, 'original'), aggregate(projected, 'projected')
        self.assertEqual(original['rankings'], retained['rankings'])
        self.assertEqual(retained['counts']['species'], 119)


if __name__ == '__main__':
    unittest.main()
