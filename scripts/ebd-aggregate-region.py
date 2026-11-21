#!/usr/bin/env python3
"""Build private daily regional EBD facts with bounded disk-backed reconciliation."""
import argparse
from collections import Counter
import csv
from datetime import date
from functools import lru_cache
import gc
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import shutil
import sqlite3
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('partitioner', ROOT / 'scripts/ebd-partition.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
b = p.benchmark
GIB = 1024 ** 3


def load(path):
    return json.loads(Path(path).read_text())


def safe_path(root, relative):
    path = (root / relative).resolve()
    if root not in path.parents:
        raise ValueError('Projection path must be inside its input manifest directory')
    return path


def taxonomy(profile):
    taxa = profile['taxa']
    species = {}
    canonical = {}
    for key, (category, scientific, common) in {**taxa, **profile.get('external_species_parents', {})}.items():
        if category == 'species':
            if scientific in species and species[scientific] != key:
                raise ValueError('Ambiguous source-native species identity')
            species[scientific] = key
            canonical[key] = (scientific, common)
    mapping, excluded = {}, {}
    for key, (category, scientific, common) in taxa.items():
        if category in ('species', 'issf', 'intergrade', 'form'):
            if scientific not in species:
                raise ValueError('Identifiable taxon requires a source-native parent: ' + scientific)
            mapping[key] = species[scientific]
        else:
            excluded[key] = category
    return mapping, canonical, excluded


def eligible(row):
    return row['ALL SPECIES REPORTED'] == '1' and row['PROTOCOL CODE'] in ('P21', 'P22')


def aggregate(config):
    started = time.monotonic()
    deadline = started + config['seconds']
    out, source_root = Path(config['directory']), Path(config['manifest']).resolve().parent
    region = config['region']
    os.nice(10)
    resource.setrlimit(resource.RLIMIT_FSIZE, (config['max_file_bytes'], config['max_file_bytes']))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (config['memory_bytes'] * 2, config['memory_bytes'] * 2))
    temporary = out / 'tmp'
    temporary.mkdir()
    os.environ['SQLITE_TMPDIR'] = str(temporary)
    manifest = load(config['manifest'])
    if manifest.get('schema') != 'aviquiz-ebd-partitions-v1' or manifest.get('status') != 'partitioned':
        raise ValueError('A complete paired partition manifest is required')
    entry = next(item for item in manifest['partitions'] if item['region'] == region)
    profile = load(config['taxonomy_profile'])
    if profile.get('observation_source_sha256') != entry['files']['observations']['sha256'] or profile.get('rows') != entry['rows']['observations']:
        raise ValueError('Taxonomy profile does not match the observation projection')
    mapping, canonical, excluded = taxonomy(profile)
    for provenance in [profile.get('parent_provenance')]:
        if provenance:
            parent_entry = next(x for x in manifest['partitions'] if x['region'] == provenance['region'])
            if parent_entry['files']['observations']['sha256'] != provenance['source_sha256']:
                raise ValueError('Species parent provenance does not match the release')
    metrics, outcomes = Counter(), Counter()
    last_progress = 0
    def progress(phase, force=False):
        nonlocal last_progress
        now = time.monotonic()
        if now >= deadline:
            raise b.LimitReached('Aggregation deadline reached')
        if shutil.disk_usage(out).free < config['reserve_free_bytes']:
            raise b.LimitReached('Free disk reserve reached')
        if force or now - last_progress >= 10:
            p.save_manifest(out, {'schema':'aviquiz-ebd-aggregation-progress-v1','status':'running',
                'phase':phase,'region':region,'metrics':dict(metrics),'elapsed_seconds':now-started,
                'serving_ready':False,'updated_at':p.stamp()})
            last_progress = now
    def sql_progress():
        return int(time.monotonic() >= deadline or shutil.disk_usage(out).free < config['reserve_free_bytes'])
    stage_path, candidate = out / 'reconciliation.private.sqlite', out / 'daily.partial.sqlite'
    db = b.connection(stage_path, config['max_file_bytes'], config['memory_bytes'])
    db.execute('PRAGMA temp_store=FILE')
    db.execute('PRAGMA cache_size=-65536')
    db.set_progress_handler(sql_progress, 100000)
    db.executescript('''
    CREATE TABLE events (id INTEGER PRIMARY KEY, event TEXT UNIQUE NOT NULL,
      outing TEXT NOT NULL, day TEXT NOT NULL, county TEXT NOT NULL, locality TEXT NOT NULL,
      loc_type TEXT NOT NULL, eligible INTEGER NOT NULL, outing_id INTEGER,
      has_observation INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE audit (kind TEXT NOT NULL, reference TEXT NOT NULL, reason TEXT NOT NULL);
    ''')
    def verified_file(item, kind):
        value = item['files'].get(kind)
        if not value:
            raise ValueError('A sampling projection is missing')
        path = safe_path(source_root, value['path'])
        if path.stat().st_size != value['bytes'] or p.checksum(path) != value['sha256']:
            raise ValueError('Projection checksum or size mismatch')
        return path
    try:
        progress('sampling', True)
        with b.source(verified_file(entry, 'sampling')) as (stream, _, _):
            header, _ = b.fields(stream)
            for row in b.records(stream, header, deadline):
                if p.region_key(row['COUNTRY CODE'], row['STATE CODE']) != region:
                    raise ValueError('Sampling row is outside its regional partition')
                if date.fromisoformat(row['OBSERVATION DATE']).year < 1800:
                    raise ValueError('Observation date precedes the daily schema range')
                event, group = row['SAMPLING EVENT IDENTIFIER'], row['GROUP IDENTIFIER']
                if not event or not row['LOCALITY ID']:
                    raise ValueError('Missing event or locality identifier')
                db.execute('INSERT INTO events(event,outing,day,county,locality,loc_type,eligible) VALUES (?,?,?,?,?,?,?)',
                    (event,'g:'+group if group else 'e:'+event,row['OBSERVATION DATE'],row['COUNTY CODE'],
                     row['LOCALITY ID'],row['LOCALITY TYPE'],int(eligible(row))))
                metrics['sampling_rows'] += 1
                metrics['eligible_submissions'] += int(eligible(row))
                if metrics['sampling_rows'] % 10000 == 0:
                    db.commit(); progress('sampling')
        db.commit()
        if metrics['sampling_rows'] != entry['rows']['sampling']:
            raise ValueError('Sampling row count does not match manifest')
        progress('deduplicate_outings', True)
        db.executescript('''
        CREATE INDEX events_outing ON events(outing);
        CREATE TABLE outings (id INTEGER PRIMARY KEY, outing TEXT UNIQUE NOT NULL,
          day TEXT NOT NULL, county TEXT NOT NULL, locality TEXT NOT NULL, loc_type TEXT NOT NULL,
          valid INTEGER NOT NULL DEFAULT 1);
        INSERT INTO outings(outing,day,county,locality,loc_type)
          SELECT outing,min(day),min(county),min(locality),min(loc_type) FROM events WHERE eligible=1
          GROUP BY outing HAVING min(day)=max(day) AND min(locality)=max(locality)
            AND min(county)=max(county) AND min(loc_type)=max(loc_type);
        INSERT INTO audit SELECT 'outing',outing,'conflicting_local_metadata' FROM events WHERE eligible=1
          GROUP BY outing HAVING min(day)<>max(day) OR min(locality)<>max(locality)
            OR min(county)<>max(county) OR min(loc_type)<>max(loc_type);
        ''')
        db.commit()
        metrics['local_conflicting_outings'] = db.execute("SELECT COUNT(*) FROM audit").fetchone()[0]
        # Check every other sampling partition for relevant NC IDs, without
        # loading the world into memory or staging private unrelated records.
        groups = {r[0][2:].encode() for r in db.execute("SELECT outing FROM outings WHERE outing LIKE 'g:%'")}
        event_ids = {r[0].encode() for r in db.execute('SELECT event FROM events')}
        progress('cross_region_shared_groups', True)
        signature = db.cursor()
        for other in manifest['partitions']:
            if other['region'] == region:
                continue
            path = verified_file(other, 'sampling')
            with b.source(path) as (stream, _, _):
                header, _ = b.fields(stream)
                index = {name:i for i,name in enumerate(header)}
                while True:
                    line = stream.readline(b.LINE_LIMIT+1)
                    if not line:
                        break
                    if len(line)>b.LINE_LIMIT:
                        raise b.LimitReached('Input line exceeds buffer limit')
                    values = line.rstrip(b'\r\n').split(b'\t')
                    if len(values)!=len(header):
                        raise ValueError('Sampling projection width mismatch')
                    metrics['external_sampling_rows_checked'] += 1
                    if values[index['SAMPLING EVENT IDENTIFIER']] in event_ids:
                        metrics['cross_region_duplicate_event_ids'] += 1
                    group = values[index['GROUP IDENTIFIER']]
                    if group in groups and values[index['ALL SPECIES REPORTED']]==b'1' and values[index['PROTOCOL CODE']] in (b'P21',b'P22'):
                        metrics['external_shared_copies'] += 1
                        outing='g:'+group.decode()
                        current=signature.execute('SELECT day,county,locality,loc_type FROM outings WHERE outing=?',(outing,)).fetchone()
                        foreign=tuple(values[index[n]].decode() for n in ['OBSERVATION DATE','COUNTY CODE','LOCALITY ID','LOCALITY TYPE'])
                        if current is None or tuple(current)!=foreign or values[index['STATE CODE']].decode()!=region:
                            db.execute('UPDATE outings SET valid=0 WHERE outing=?',(outing,))
                            db.execute("INSERT INTO audit VALUES ('outing',?,'cross_region_shared_group_conflict')",(outing,))
                    if metrics['external_sampling_rows_checked'] % 200000==0:
                        db.commit(); progress('cross_region_shared_groups')
            db.commit()
        if metrics['cross_region_duplicate_event_ids']:
            raise ValueError('Event identifiers occur in multiple regional sampling partitions')
        del groups,event_ids
        gc.collect()
        metrics['cross_region_conflicting_outings'] = db.execute('SELECT COUNT(*) FROM outings WHERE valid=0').fetchone()[0]
        db.execute('UPDATE events SET outing_id=(SELECT id FROM outings WHERE outings.outing=events.outing AND valid=1) WHERE eligible=1')
        db.execute('CREATE TABLE detections (outing_id INTEGER NOT NULL,taxon TEXT NOT NULL,has_species INTEGER NOT NULL,PRIMARY KEY(outing_id,taxon)) WITHOUT ROWID')
        db.commit()
        metrics['eligible_independent_outings'] = db.execute('SELECT COUNT(*) FROM outings WHERE valid=1').fetchone()[0]
        @lru_cache(maxsize=131072)
        def event_lookup(event):
            value=db.execute('SELECT id,day,county,locality,loc_type,eligible,outing_id,has_observation FROM events WHERE event=?',(event,)).fetchone()
            if value is not None and not value[7]:
                db.execute('UPDATE events SET has_observation=1 WHERE id=?',(value[0],))
            return tuple(value) if value else None
        progress('observations', True)
        for_path=verified_file(entry,'observations')
        with b.source(for_path) as (stream,_,_):
            header,_=b.fields(stream)
            for row in b.records(stream,header,deadline):
                metrics['observation_rows']+=1
                event=event_lookup(row['SAMPLING EVENT IDENTIFIER'])
                reason=None
                if not event:
                    reason='missing_sampling_event'
                elif (event[1],event[2],event[3],event[4]) != (row['OBSERVATION DATE'],row['COUNTY CODE'],row['LOCALITY ID'],row['LOCALITY TYPE']) or p.region_key(row['COUNTRY CODE'],row['STATE CODE'])!=region:
                    reason='conflicting_shared_outing:metadata_mismatch' if event[5] and event[6] is None else 'date_or_geography_mismatch'
                elif not event[5]:
                    reason='ineligible_submission'
                elif event[6] is None:
                    reason='conflicting_shared_outing'
                elif row['APPROVED']!='1':
                    reason='not_approved'
                elif row['TAXON CONCEPT ID'] in excluded:
                    reason='excluded_taxon:'+excluded[row['TAXON CONCEPT ID']]
                else:
                    key=row['TAXON CONCEPT ID']
                    if key not in mapping:
                        raise ValueError('Observed taxon is absent from the verified profile')
                    count=row['OBSERVATION COUNT']
                    if count=='0':
                        reason='zero_count'
                    elif count!='X' and (not count.isdecimal() or int(count)<=0):
                        raise ValueError('Invalid positive detection count')
                    else:
                        db.execute('INSERT INTO detections VALUES (?,?,?) ON CONFLICT(outing_id,taxon) DO UPDATE SET has_species=MAX(has_species,excluded.has_species)',
                            (event[6],mapping[key],int(row['CATEGORY']=='species')))
                        reason='accepted_species' if row['CATEGORY']=='species' else 'accepted_rollup:'+row['CATEGORY']
                outcomes[reason]+=1
                if reason in ('missing_sampling_event','date_or_geography_mismatch','conflicting_shared_outing:metadata_mismatch'):
                    if outcomes[reason]<=100:
                        db.execute('INSERT INTO audit VALUES (?,?,?)',('observation',row['SAMPLING EVENT IDENTIFIER'],reason))
                if metrics['observation_rows']%50000==0:
                    db.commit(); progress('observations')
        db.commit();event_lookup.cache_clear();gc.collect()
        if metrics['observation_rows']!=entry['rows']['observations']:
            raise ValueError('Observation count does not match manifest')
        if outcomes['missing_sampling_event'] or outcomes['date_or_geography_mismatch']:
            (out/'reconciliation-failures.json').write_text(json.dumps(dict(outcomes),indent=2))
            raise ValueError('Observation/sampling reconciliation failed; private audit retained')
        metrics['eligible_submissions_without_observation_rows']=db.execute('SELECT COUNT(*) FROM events WHERE eligible=1 AND has_observation=0').fetchone()[0]
        metrics['outings_without_approved_species_detections']=db.execute('SELECT COUNT(*) FROM outings o WHERE valid=1 AND NOT EXISTS (SELECT 1 FROM detections d WHERE d.outing_id=o.id)').fetchone()[0]
        metrics['independent_outing_species_pairs']=db.execute('SELECT COUNT(*) FROM detections').fetchone()[0]
        progress('place_membership', True)
        db.execute('CREATE TABLE membership (outing_id INTEGER NOT NULL,place_id TEXT NOT NULL,PRIMARY KEY(outing_id,place_id)) WITHOUT ROWID')
        county_pattern=re.compile(re.escape(region)+r'-[0-9]{3}')
        buffer=[]
        for outing in db.execute('SELECT id,county,locality,loc_type FROM outings WHERE valid=1'):
            buffer.append((outing[0],region))
            if county_pattern.fullmatch(outing[1]) and not outing[1].endswith('-000'):
                buffer.append((outing[0],outing[1]))
            else:
                metrics['outings_without_county']+=1
            if outing[3]=='H':
                if not re.fullmatch(r'L\d+',outing[2]):
                    raise ValueError('Invalid public hotspot identifier')
                buffer.append((outing[0],outing[2]))
            if len(buffer)>=10000:
                db.executemany('INSERT INTO membership VALUES (?,?)',buffer);buffer=[];progress('place_membership')
        db.executemany('INSERT INTO membership VALUES (?,?)',buffer)
        db.commit()
        aggregate_db=b.connection(candidate,config['max_file_bytes'],config['memory_bytes'])
        aggregate_db.executescript((ROOT/'schema/ebd-seasonal.sql').read_text())
        version='source-native:'+manifest['release']
        policy='regional-daily-v1'
        aggregate_db.execute('INSERT INTO ebd_release VALUES (?,?,?,?)',(manifest['release'],
            'eBird Basic Dataset '+manifest['release']+', Cornell Lab of Ornithology',version,policy))
        aggregate_db.executemany('INSERT INTO ebd_taxon VALUES (?,?,?,?)',((version,key,*value) for key,value in canonical.items()))
        aggregate_db.commit();aggregate_db.close();db.close()
        db=b.connection(candidate,config['max_file_bytes'],config['memory_bytes'])
        db.execute('PRAGMA temp_store=FILE');db.execute('PRAGMA cache_size=-65536')
        db.set_progress_handler(sql_progress,100000)
        db.execute('ATTACH DATABASE ? AS stage',(str(stage_path),))
        progress('daily_effort', True)
        db.execute("INSERT INTO ebd_place SELECT DISTINCT place_id,CASE WHEN substr(place_id,1,1)='L' THEN 'hotspot' ELSE 'region' END,place_id,'v1' FROM stage.membership")
        db.execute('INSERT INTO ebd_partition SELECT DISTINCT m.place_id,CAST(substr(o.day,1,4) AS INTEGER),? FROM stage.membership m JOIN stage.outings o ON o.id=m.outing_id',(manifest['release'],))
        db.execute('INSERT INTO ebd_effort_day SELECT m.place_id,CAST(substr(o.day,1,4) AS INTEGER),o.day,COUNT(*) FROM stage.membership m JOIN stage.outings o ON o.id=m.outing_id GROUP BY m.place_id,o.day')
        db.commit()
        progress('daily_detections', True)
        db.execute('INSERT INTO ebd_detection_day SELECT m.place_id,CAST(substr(o.day,1,4) AS INTEGER),o.day,?,d.taxon,COUNT(*) FROM stage.detections d JOIN stage.outings o ON o.id=d.outing_id JOIN stage.membership m ON m.outing_id=o.id GROUP BY m.place_id,o.day,d.taxon',(version,))
        db.commit()
        progress('integrity_checks', True)
        if db.execute('SELECT 1 FROM ebd_invalid_detection LIMIT 1').fetchone() or db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Daily facts fail denominator or foreign-key checks')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise ValueError('Aggregate database integrity failure')
        metrics['places']=db.execute('SELECT COUNT(*) FROM ebd_place').fetchone()[0]
        metrics['effort_day_rows']=db.execute('SELECT COUNT(*) FROM ebd_effort_day').fetchone()[0]
        metrics['detection_day_rows']=db.execute('SELECT COUNT(*) FROM ebd_detection_day').fetchone()[0]
        cases={}
        for place,start_md,end_md,label in [(region,'09-01','09-30','state-september'),
            (region+'-037','09-20','10-10','chatham-autumn'),(region+'-037','09-27','09-30','chatham-chase'),
            ('L651593','09-20','10-10','jordan-dam-autumn')]:
            if region!='US-NC' and label!='state-september':
                continue
            parameters={'place_id':place,'first_year':2017,'last_year':2025,'start_md':start_md,'end_md':end_md,
                        'taxonomy_version':version,'processing_version':policy}
            progress('seasonal_validation', True)
            rows=[dict(row) for row in db.execute((ROOT/'schema/ebd-seasonal-query.sql').read_text(),parameters)]
            raw={r['taxon_key']:i for i,r in enumerate(sorted(rows,key=lambda r:(-r['checklist_rate'],r['taxon_key'])),1)}
            daily={r['taxon_key']:i for i,r in enumerate(sorted(rows,key=lambda r:(-r['day_balanced_rate'],r['taxon_key'])),1)}
            for i,row in enumerate(rows,1):
                row.update(prototype_rank=i,raw_rank=raw[row['taxon_key']],day_balanced_rank=daily[row['taxon_key']])
            if rows:
                with (out/(label+'.csv')).open('w') as stream:
                    writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
            focal=next((r for r in rows if r['scientific_name']=='Setophaga kirtlandii'),None)
            cases[label]={'place':place,'years':[2017,2025],'window':[start_md,end_md],'species':len(rows),
                'sampled_checklists':rows[0]['sampled_checklists'] if rows else 0,
                'evidence':dict(Counter(row['evidence'] for row in rows)),'focus':focal,'top_10':rows[:10]}
        db.close()
        target=out/'daily.sqlite'
        candidate.rename(target)
        report={'schema':'aviquiz-ebd-regional-aggregate-v1','status':'aggregated','analysis_ready':True,'serving_ready':False,
            'region':region,'release':manifest['release'],'taxonomy_version':version,'processing_version':policy,
            'input_manifest':str(config['manifest']),'taxonomy_profile_sha256':p.checksum(Path(config['taxonomy_profile'])),
            'metrics':dict(metrics),'observation_outcomes':dict(outcomes),'cases':cases,
            'daily_database_bytes':target.stat().st_size,'daily_database_sha256':p.checksum(target),
            'elapsed_seconds':time.monotonic()-started,'peak_rss_bytes':b.peak_rss(),
            'private_reconciliation_retained':True,'completed_years_for_reference':[2017,2025],
            'scope_note':'Daily facts retain all source years; partial 2026 is excluded from the reference cases.'}
        (out/'analysis-report.json').write_text(json.dumps(report,indent=2)+'\n')
        p.save_manifest(out,{'status':'aggregated','analysis_ready':True,'serving_ready':False,'report':'analysis-report.json'})
        return report
    finally:
        try:
            db.close()
        except Exception:
            pass


def worker():
    config=json.loads(sys.stdin.readline())
    try:
        result=aggregate(config)
    except Exception as error:
        result={'status':'incomplete','reason':type(error).__name__,'message':str(error)[:500],
                'analysis_ready':False,'serving_ready':False}
        p.save_manifest(Path(config['directory']),result)
    print(json.dumps(result))


def main():
    if '--worker' in sys.argv:
        worker();return
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--taxonomy-profile',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--region',default='US-NC')
    parser.add_argument('--disk-gib',type=int,default=40)
    parser.add_argument('--memory-mib',type=int,default=768)
    parser.add_argument('--hours',type=float,default=12)
    args=parser.parse_args()
    output=args.output.resolve();source_root=args.manifest.resolve().parent
    if output==ROOT or ROOT in output.parents or output==source_root or source_root in output.parents or output.exists():
        parser.error('Use a new output directory outside the source repository and input partitions')
    if not 1<=args.disk_gib<=40 or not 256<=args.memory_mib<=1024 or not 0<args.hours<=24:
        parser.error('Limits: 1–40 GiB disk, 256–1024 MiB worker RSS, up to 24 hours')
    output.parent.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(output.parent).free<(args.disk_gib+60)*GIB:
        parser.error('The output allowance plus 60 GiB free reserve is required')
    output.mkdir(mode=0o700)
    config={'mode':'sample','directory':str(output),'manifest':str(args.manifest.resolve()),
            'taxonomy_profile':str(args.taxonomy_profile.resolve()),'region':args.region,
            'seconds':args.hours*3600,'memory_bytes':args.memory_mib*b.MIB,
            'reserve_free_bytes':60*GIB,'monitor_interval_seconds':1,'monitor_filesystem_growth':True}
    result=b.supervise(config,output,args.disk_gib*GIB,worker_program=Path(__file__).resolve())
    if result.get('status')!='aggregated':
        (output/'daily.sqlite').unlink(missing_ok=True)
        p.save_manifest(output,{'status':'incomplete','analysis_ready':False,'serving_ready':False,
                                'reason':result.get('reason')})
    (output/'supervisor-report.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({key:result.get(key) for key in ['status','reason','message','metrics','elapsed_seconds',
          'monitored_peak_workspace_bytes','monitored_peak_rss_bytes','minimum_monitored_free_bytes']}))
    if result.get('status')!='aggregated':
        raise SystemExit(2)


if __name__=='__main__':
    main()
