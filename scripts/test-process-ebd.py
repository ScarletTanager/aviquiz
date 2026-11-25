#!/usr/bin/env python3
"""Small end-to-end fixture for geography extracts and collector handoff."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import unittest

HERE=Path(__file__).resolve().parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file); result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
tests=module('aggregate_tests','test-ebd-aggregate-region.py')
geo=module('geo','ebd-geography-data.py')

class GeographyTests(tests.AggregateTests):
    def test_shared_queue_keeps_collected_coverage(self):
        catalog=self.root/'catalog.json';db=self.root/'photos.sqlite'
        photos=[dict(id=str(q*10+i),observationDate=f'2025-{(q-1)*3+1:02}-01') for q in range(1,5) for i in range(2)]
        bird=dict(id='sharedbird',name='Shared bird',scientificName='Avis test',taxonOrder=1,photos=photos)
        catalog.write_text(json.dumps({'birds':[bird]}));c=geo.seasonal.worker.connect(db);geo.seasonal.init(c);geo.seasonal.seed(c,catalog)
        catalog.write_text(json.dumps({'birds':[{**bird,'photos':[]}]}));geo.seasonal.seed(c,catalog)
        self.assertEqual(c.execute('select count(*) from photo_assets').fetchone()[0],8)
        self.assertEqual(c.execute("select count(*) from photo_quarter_jobs where state='complete'").fetchone()[0],4)
        self.assertEqual(len(json.loads(c.execute('select photos from species').fetchone()[0])),8)
        self.assertEqual(geo.seasonal.plan(c,10),[]);c.close()

    def test_geography_to_collector(self):
        inputs=self.inputs()
        extract=self.root/'extract';extract.mkdir()
        base=dict(scope='US-NC',manifest=inputs['manifest'],directory=str(extract),_deadline=time.monotonic()+60,reserve_free_bytes=0)
        result=geo.extract(base)
        aggregate=self.root/'aggregate';aggregate.mkdir()
        config=dict(inputs,directory=str(aggregate),manifest=result['manifest'],taxonomy_profile=result['profile'])
        geo.aggregate.aggregate(config)
        taxonomy=self.root/'current.json';taxonomy.write_text(json.dumps([
            dict(sciName='Avis test',comName='Test bird',speciesCode='testbird',category='species',familySciName='Testidae',taxonOrder=1),
            dict(sciName='Setophaga kirtlandii',comName="Kirtland's Warbler",speciesCode='kirwar',category='species',familySciName='Parulidae',taxonOrder=2)]))
        export=self.root/'export';export.mkdir()
        photo_db=self.root/'shared-photos.sqlite'
        result=geo.export(dict(base,directory=str(export),daily_database=str(aggregate/'daily.sqlite'),extract_manifest=result['manifest'],taxonomy=str(taxonomy),first_year=2017,last_year=2025,photo_sources=[],shared_photo_db=str(photo_db)))
        self.assertEqual(result['species'],2)
        c=sqlite3.connect(result['shared_photo_queue'])
        self.assertEqual(c.execute('select count(*) from photo_quarter_jobs').fetchone()[0],8)
        self.assertGreater(result['places'],1)
        package=json.loads((Path(result['package'])/'package.json').read_text())
        self.assertEqual(package['schema'],'aviquiz-seasonal-package-v1')
        self.assertTrue((Path(result['package'])/'species.json').is_file())

    def test_cli_run_and_status(self):
        inputs=self.inputs()
        taxonomy=self.root/'taxonomy-current.json';taxonomy.write_text(json.dumps([
            dict(sciName='Avis test',comName='Test bird',speciesCode='testbird',category='species',familySciName='Testidae',taxonOrder=1),
            dict(sciName='Setophaga kirtlandii',comName="Kirtland's Warbler",speciesCode='kirwar',category='species',familySciName='Parulidae',taxonOrder=2)]))
        root=self.root/'jobs'; command=[sys.executable,str(HERE/'process-ebd.py'),'--root',str(root)]
        run=subprocess.run(command+['run','US-NC','--manifest',inputs['manifest'],'--taxonomy',str(taxonomy),'--photo-db',str(self.root/'shared-photos.sqlite'),'--disk-gib','1'],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr+' '+(root/'US-NC'/'state.json').read_text())
        status=subprocess.run(command+['status','US-NC'],capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(status.stdout)['status'],'completed')

    def test_concurrent_geographies_and_stop(self):
        inputs=self.inputs()
        taxonomy=self.root/'current.json';taxonomy.write_text('[]')
        root=self.root/'jobs'; command=[sys.executable,str(HERE/'process-ebd.py'),'--root',str(root)]
        options=['--manifest',inputs['manifest'],'--taxonomy',str(taxonomy),'--photo-db',str(self.root/'photos.sqlite'),'--disk-gib','1']
        try:
            for scope in ('US-NC','US-VA'):
                result=subprocess.run(command+['start',scope]+options,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
            duplicate=subprocess.run(command+['start','US-NC']+options,capture_output=True,text=True)
            self.assertNotEqual(duplicate.returncode,0)
            status=subprocess.run(command+['status','US-NC'],capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(status.stdout)['status'],'running')
        finally:
            for scope in ('US-NC','US-VA'):
                subprocess.run(command+['stop',scope],capture_output=True,text=True)
            for _ in range(50):
                if all(not (root/scope/'state.json').exists() or json.loads((root/scope/'state.json').read_text()).get('status')!='running' for scope in ('US-NC','US-VA')):break
                time.sleep(.1)

if __name__=='__main__': unittest.main()
