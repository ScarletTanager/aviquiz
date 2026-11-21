#!/usr/bin/env python3
"""Independent synthetic controls for regional daily facts and reconciliation."""
import gzip
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('aggregate',HERE/'ebd-aggregate-region.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)


class AggregateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='aviquiz-region-test-')
        self.root=Path(self.temp.name);self.source=self.root/'inputs';self.source.mkdir()
        self.limits=patch.object(a.resource,'setrlimit');self.limits.start()
        self.nice=patch.object(a.os,'nice');self.nice.start()

    def tearDown(self):
        self.limits.stop();self.nice.stop();self.temp.cleanup()

    def inputs(self, mismatch=False):
        sampling=[]
        def event(code,group,day,loc='L651593',kind='H',county='US-NC-037',protocol='P21',state='US-NC'):
            row=dict.fromkeys(a.p.PROJECTION['sampling'],'')
            row.update({'COUNTRY CODE':'US','STATE CODE':state,'COUNTY CODE':county,
                'OBSERVATION DATE':day,'LOCALITY ID':loc,'LOCALITY TYPE':kind,'GROUP IDENTIFIER':group,
                'SAMPLING EVENT IDENTIFIER':code,'ALL SPECIES REPORTED':'1','PROTOCOL CODE':protocol})
            sampling.append(row);return row
        s1=event('S1','G1','2017-09-27');s2=event('S2','G1','2017-09-27')
        s3=event('S3','','2018-09-27');s4=event('S4','','2018-09-27',protocol='P20')
        s5=event('S5','Gbad','2018-09-27');s6=event('S6','Gbad','2018-09-28')
        s7=event('S7','Gcross','2018-09-28')
        s9=event('S9','','2017-09-27',loc='Lprivate',kind='P')
        event('S10','','2018-09-28') # valid effort, no observations
        event('S11','','2018-09-29',county='US-NC-') # state/hotspot only
        external=event('S8','Gcross','2018-09-28',county='US-VA-001',state='US-VA')
        observations=[]
        def detection(source,key,category='species',sci='Avis test',common='Test bird',count='1'):
            row=dict.fromkeys(a.p.PROJECTION['observations'],'')
            for field in a.p.COMMON:row[field]=source.get(field,'')
            row.update({'TAXON CONCEPT ID':key,'CATEGORY':category,'SCIENTIFIC NAME':sci,
                'COMMON NAME':common,'APPROVED':'1','OBSERVATION COUNT':count})
            observations.append(row)
        detection(s1,'T1');detection(s1,'T2','issf');detection(s2,'T1')
        detection(s3,'T1',count='X');detection(s4,'T1');detection(s5,'T1');detection(s7,'T1')
        detection(s9,'T1');detection(s1,'T3',sci='Setophaga kirtlandii',common="Kirtland's Warbler")
        detection(s3,'T4','slash',sci='Avis test/other',common='Uncertain bird')
        if mismatch: observations[0]['SAMPLING EVENT IDENTIFIER']='MISSING'
        manifest={'schema':'aviquiz-ebd-partitions-v1','status':'partitioned','release':'test','partitions':[]}
        nc_sampling=[r for r in sampling if r['STATE CODE']=='US-NC']
        for region,rows in [('US-NC',nc_sampling),('US-VA',[external])]:
            item={'region':region,'rows':{'sampling':len(rows),'observations':len(observations) if region=='US-NC' else 0},'files':{}}
            folder=self.source/region;folder.mkdir()
            for kind,values in [('sampling',rows),('observations',observations if region=='US-NC' else [])]:
                file=folder/(kind+'.tsv.gz')
                with gzip.open(file,'wt') as stream:
                    stream.write('\t'.join(a.p.PROJECTION[kind])+'\n')
                    for row in values:stream.write('\t'.join(row[field] for field in a.p.PROJECTION[kind])+'\n')
                item['files'][kind]={'path':str(file.relative_to(self.source)),'bytes':file.stat().st_size,'sha256':a.p.checksum(file)}
            manifest['partitions'].append(item)
        source_manifest=self.source/'manifest.json';source_manifest.write_text(json.dumps(manifest))
        profile={'rows':len(observations),'observation_source_sha256':manifest['partitions'][0]['files']['observations']['sha256'],
            'taxa':{'T1':['species','Avis test','Test bird'],'T2':['issf','Avis test','Test bird'],
            'T3':['species','Setophaga kirtlandii',"Kirtland's Warbler"],'T4':['slash','Avis test/other','Uncertain bird']}}
        profile_path=self.root/'taxonomy.json';profile_path.write_text(json.dumps(profile))
        out=self.root/'output';out.mkdir()
        return {'directory':str(out),'manifest':str(source_manifest),'taxonomy_profile':str(profile_path),
                'region':'US-NC','seconds':60,'max_file_bytes':64*a.b.MIB,'memory_bytes':512*a.b.MIB,'reserve_free_bytes':0}

    def test_exact_daily_effort_detections_rollup_and_public_scopes(self):
        config=self.inputs();report=a.aggregate(config)
        self.assertEqual(report['status'],'aggregated');self.assertFalse(report['serving_ready'])
        self.assertEqual(report['metrics']['local_conflicting_outings'],1)
        self.assertEqual(report['metrics']['cross_region_conflicting_outings'],1)
        self.assertEqual(report['metrics']['eligible_independent_outings'],5)
        self.assertEqual(report['metrics']['outings_without_county'],1)
        db=sqlite3.connect(Path(config['directory'])/'daily.sqlite')
        self.assertEqual(db.execute("SELECT SUM(checklist_count) FROM ebd_effort_day WHERE place_id='US-NC'").fetchone()[0],5)
        self.assertEqual(db.execute("SELECT SUM(checklist_count) FROM ebd_effort_day WHERE place_id='US-NC-037'").fetchone()[0],4)
        self.assertEqual(db.execute("SELECT SUM(checklist_count) FROM ebd_effort_day WHERE place_id='L651593'").fetchone()[0],4)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM ebd_place WHERE place_id='Lprivate'").fetchone()[0],0)
        self.assertEqual(db.execute("SELECT checklist_count FROM ebd_detection_day WHERE place_id='US-NC-037' AND observation_date='2017-09-27' AND taxon_key='T1'").fetchone()[0],2)
        self.assertEqual(db.execute("SELECT SUM(checklist_count) FROM ebd_detection_day WHERE place_id='US-NC' AND taxon_key='T1'").fetchone()[0],3)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM ebd_invalid_detection').fetchone()[0],0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('events','outings','detections')").fetchone()[0],0)
        focus=report['cases']['chatham-autumn']['focus']
        self.assertEqual(focus['reporting_checklists'],1);self.assertEqual(focus['sampled_checklists'],4)
        self.assertEqual(focus['reporting_seasons'],1);self.assertEqual(focus['sampled_seasons'],2)
        self.assertAlmostEqual(focus['checklist_rate'],1/4)
        self.assertAlmostEqual(focus['day_balanced_rate'],(1/2)/3)
        db.close()

    def test_join_mismatch_cannot_promote_database(self):
        config=self.inputs(mismatch=True)
        with self.assertRaisesRegex(ValueError,'reconciliation failed'):a.aggregate(config)
        self.assertFalse((Path(config['directory'])/'daily.sqlite').exists())
        self.assertTrue((Path(config['directory'])/'reconciliation-failures.json').exists())

    def test_taxonomy_requires_verified_species_parent(self):
        with self.assertRaisesRegex(ValueError,'source-native parent'):
            a.taxonomy({'taxa':{'T':['issf','Unknown species','Unknown']}})
        with self.assertRaisesRegex(ValueError,'Ambiguous'):
            a.taxonomy({'taxa':{'A':['species','Avis test','Test'],'B':['species','Avis test','Test']}})


if __name__=='__main__':unittest.main()
