#!/usr/bin/env python3
"""Exercise photo assembly, immutable facts, validation and local activation."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('packages',HERE/'seasonal-package.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class PackageTests(unittest.TestCase):
    def test_assembly_activation_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';source.mkdir()
            raw=json.dumps({'e':[['09-01','3']],'b':{'0':[['09-01','3']]}}).encode();data=gzip.compress(raw,mtime=0);(source/'facts.bin').write_bytes(data)
            digest=hashlib.sha256(data).hexdigest()
            p.save(source/'manifest.json',dict(schema='aviquiz-place-facts-v1',year_encoding='hex-bitset-lsb-first',scope='CO',release='test',years=[2020,2021],chunks=[dict(key='facts.bin',bytes=len(data),sha256=digest)],places={'CO':dict(chunk=0,offset=0,length=len(data),sha256=digest,rawBytes=len(raw))}))
            bird=dict(id='testbird',name='Test',scientificName='Avis test',family='Testidae',photos=[],taxonOrder=1)
            p.save(source/'species.json',{'birds':[bird]});p.save(source/'places.json',{'nodes':[dict(id='CO',name='Colombia',parent='world',kind='country')]})
            p.seal(source,dict(geography='CO',release='test',years=[2020,2021],species_count=1,place_count=1))
            self.assertEqual(p.validate(source)['detection_days'],2)
            db=root/'photos.sqlite';c=sqlite3.connect(db);c.executescript('create table species(id,bird,photos); create table photo_assets(species_id,photo_json);')
            photo=dict(id='123',source='https://macaulaylibrary.org/asset/123',url='https://cdn.download.ams.birds.cornell.edu/api/v2/asset/123/1200',photographer='Fixture',credit='Fixture credit',observationDate='2021-09-01')
            c.execute('insert into species values(?,?,?)',('testbird',json.dumps(bird),'[]'));c.execute('insert into photo_assets values(?,?)',('testbird',json.dumps(photo)));c.commit();c.close()
            result=p.assemble(source,root/'assembled',db);self.assertEqual(result['with_photos'],1)
            self.assertEqual((source/'facts.bin').read_bytes(),(root/'assembled/facts.bin').read_bytes())
            self.assertEqual(p.load(root/'assembled/species.json')['birds'][0]['photos'][0]['credit'],'Fixture credit')
            activated=subprocess.run([sys.executable,str(HERE/'process-ebd.py'),'activate',str(root/'assembled'),'--target',str(root/'active')],capture_output=True,text=True)
            self.assertEqual(activated.returncode,0,activated.stderr)
            pointer=p.load(root/'active/CO/active.json');self.assertEqual(p.validate(pointer['path'])['revision'],result['revision'])
            (root/'assembled/facts.bin').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):p.validate(root/'assembled')
if __name__=='__main__':unittest.main()
