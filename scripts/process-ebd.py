#!/usr/bin/env python3
"""Run bounded, independent offline EBD geography jobs."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import traceback

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('geo_data', HERE / 'ebd-geography-data.py')
data = importlib.util.module_from_spec(spec); spec.loader.exec_module(data)
ROOT = HERE.parents[2] / 'outputs' / 'ebd_jobs'
DEFAULT_MANIFEST = ROOT.parent / 'ebd_ingestion' / 'relSep2026-20261120-r2' / 'manifest.json'
DEFAULT_TAXONOMY = ROOT.parent / 'ebd_reference' / 'taxonomy-2026.json'
DEFAULT_PHOTO_DB = ROOT.parent / 'photo_metadata' / 'queue.sqlite'
GIB = 1024 ** 3

def write(path, obj):
    data.atomic(path, obj)

def state(job):
    try: return json.loads((job / 'state.json').read_text())
    except (FileNotFoundError, json.JSONDecodeError): return {}

def locked(job):
    job.mkdir(parents=True, exist_ok=True)
    handle = (job / 'job.lock').open('a+')
    try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: handle.close(); return None
    return handle

def worker(job):
    lock = locked(job)
    if lock is None: raise ValueError('This geography already has a running job')
    info = state(job); config = info['config']; started = time.time()
    info.update(status='running', pid=os.getpid(), started_at=started); write(job/'state.json', info)
    try:
        for stage in ('extract', 'aggregate', 'export'):
            if stage in info.get('completed', {}): continue
            folder = job / (stage + '-' + str(time.time_ns())); folder.mkdir()
            info.update(phase=stage, stage_directory=str(folder)); write(job/'state.json', info)
            settings = dict(config, directory=str(folder))
            if stage == 'aggregate':
                settings.update(region=config['scope'], manifest=info['completed']['extract']['manifest'], taxonomy_profile=info['completed']['extract']['profile'], max_file_bytes=config['disk_bytes'], seconds=max(1, config['seconds']-(time.time()-started)))
            if stage == 'export':
                settings.update(daily_database=info['completed']['aggregate']['database'], extract_manifest=info['completed']['extract']['manifest'])
            stage_config = folder/'stage.json'; write(stage_config, settings)
            child = subprocess.Popen([sys.executable, __file__, '_stage', stage, str(stage_config)], start_new_session=True)
            def stop(signum, frame):
                os.killpg(child.pid, signal.SIGTERM)
                child.wait()
                raise KeyboardInterrupt()
            signal.signal(signal.SIGTERM, stop)
            try:
                while child.poll() is None:
                    rss = data.b.rss_for(child.pid)
                    if shutil.disk_usage(job).free < config['reserve_free_bytes'] or data.b.directory_bytes(job) > config['disk_bytes'] or time.time()-started > config['seconds'] or (rss is not None and rss > config['memory_bytes']):
                        raise RuntimeError('Disk reserve, job size, memory, or runtime limit reached')
                    time.sleep(2)
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM); child.wait()
            if child.returncode: raise RuntimeError(stage+' failed; inspect '+str(folder/'error.log'))
            result = json.loads((folder/'result.json').read_text())
            info.setdefault('completed', {})[stage] = result; write(job/'state.json', info)
        info.update(status='completed', phase='done', finished_at=time.time())
    except BaseException as error:
        info.update(status='stopped' if isinstance(error, KeyboardInterrupt) else 'failed', error=str(error), finished_at=time.time())
    finally:
        info.pop('pid', None); write(job/'state.json', info); lock.close()
    return info['status'] == 'completed'

def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--root', type=Path, default=ROOT)
    sub=parser.add_subparsers(dest='command', required=True)
    for cmd in ('validate','activate'):
        q=sub.add_parser(cmd); q.add_argument('package',type=Path); q.add_argument('--target',type=Path,default=ROOT.parent/'ebd_active')
    for cmd in ('start','run'):
        q=sub.add_parser(cmd); q.add_argument('scope'); q.add_argument('--parent'); q.add_argument('--manifest',type=Path,default=DEFAULT_MANIFEST); q.add_argument('--taxonomy',type=Path,default=DEFAULT_TAXONOMY); q.add_argument('--photo-db',type=Path,default=DEFAULT_PHOTO_DB); q.add_argument('--resume',action='store_true'); q.add_argument('--disk-gib',type=int,default=20); q.add_argument('--hours',type=int,default=24); q.add_argument('--first-year',type=int,default=2017); q.add_argument('--last-year',type=int,default=2025)
    for cmd in ('status','stop'):
        q=sub.add_parser(cmd); q.add_argument('scope',nargs='?' if cmd=='status' else None)
    q=sub.add_parser('_worker');q.add_argument('job',type=Path)
    q=sub.add_parser('_stage');q.add_argument('stage');q.add_argument('config',type=Path)
    args=parser.parse_args()
    if args.command == '_stage':
        cfg=json.loads(args.config.read_text());cfg['_deadline']=time.monotonic()+cfg['seconds']
        try:
            if args.stage=='aggregate': data.aggregate.aggregate(cfg); result={'database':str(Path(cfg['directory'])/'daily.sqlite')}
            else: result=getattr(data,args.stage)(cfg)
            write(Path(cfg['directory'])/'result.json',result)
        except Exception:
            (Path(cfg['directory'])/'error.log').write_text(traceback.format_exc()); return 1
        return 0
    if args.command in ('validate','activate'):
        package=args.package.resolve(); manifest=json.loads((package/'package.json').read_text())
        if manifest.get('schema')!='aviquiz-seasonal-package-v1': raise ValueError('Unsupported package schema')
        if not isinstance(manifest.get('geography'),str) or not __import__('re').fullmatch(r'[A-Z]{2}(?:-[A-Z0-9]{1,12}){0,2}',manifest['geography']): raise ValueError('Invalid package geography')
        if not isinstance(manifest.get('files'),dict) or not manifest['files']: raise ValueError('Package file list is missing')
        for name,expected in manifest['files'].items():
            path=(package/name).resolve()
            if package not in path.parents or not path.is_file() or data.p.checksum(path)!=expected['sha256'] or path.stat().st_size!=expected['bytes']: raise ValueError('Package file checksum or size mismatch: '+name)
        if args.command=='activate':
            root=args.target.expanduser().resolve();root.mkdir(parents=True,exist_ok=True);dest=root/manifest['geography'];dest.mkdir(parents=True,exist_ok=True)
            import tempfile
            stage=Path(tempfile.mkdtemp(prefix='.activate-',dir=dest))
            try:
                for name in manifest['files']: shutil.copyfile(package/name,stage/name)
                (stage/'manifest.json').write_bytes((package/'manifest.json').read_bytes())
                pointer=dest/'active.json';temp=pointer.with_suffix('.next');write(temp,{'revision':manifest['revision'],'path':str(stage)});temp.replace(pointer)
            except BaseException: shutil.rmtree(stage,ignore_errors=True);raise
            print(pointer)
        else: print(json.dumps({'valid':True,'geography':manifest['geography'],'species':manifest['species_count'],'places':manifest['place_count'] }))
        return 0
    if args.command=='_worker': return 0 if worker(args.job) else 1
    root=args.root.expanduser().resolve(); root.mkdir(parents=True,exist_ok=True)
    if root == HERE.parent or HERE.parent in root.parents:
        raise ValueError('Job output must be outside the source repository')
    if args.command=='status':
        if args.scope: data.validate_scope(args.scope,'US' if args.scope.startswith('L') else None)
        jobs=[root/args.scope] if args.scope else sorted(x for x in root.iterdir() if x.is_dir())
        for job in jobs:
            info=state(job)
            if not info: continue
            if info.get('status')=='running':
                handle=locked(job)
                if handle: info['status']='interrupted';handle.close()
            folder=info.get('stage_directory')
            if folder:
                for filename in ('progress.json','manifest.json'):
                    try: info['progress']=json.loads((Path(folder)/filename).read_text());break
                    except (FileNotFoundError,json.JSONDecodeError): pass
            print(json.dumps(info,indent=2))
        return 0
    data.validate_scope(args.scope,getattr(args,'parent',None) or ('US' if args.scope.startswith('L') else None))
    job=root/args.scope
    if args.command=='stop':
        info=state(job); handle=locked(job)
        if handle: handle.close(); raise ValueError('No job is running')
        os.kill(info['pid'],signal.SIGTERM); print('Stop requested'); return 0
    data.validate_scope(args.scope,args.parent)
    root_lock=(root/'scheduler.lock').open('a+');fcntl.flock(root_lock,fcntl.LOCK_EX)
    handle=locked(job)
    if not handle: raise ValueError('This geography already has a running job')
    active=0; reserved=0
    for other in root.iterdir():
        if other.is_dir() and other!=job:
            probe=locked(other)
            if probe: probe.close()
            else:
                active+=1
                reserved+=max(0,state(other).get('config',{}).get('disk_bytes',20*GIB)-data.b.directory_bytes(other))
    if active>=2: raise ValueError('At most two geography jobs may run at once')
    if not 1<=args.disk_gib<=150 or not 1<=args.hours<=72 or not 1800<=args.first_year<=args.last_year or args.last_year-args.first_year>=30: raise ValueError('Invalid limits or year range')
    if shutil.disk_usage(root).free < 60*GIB+reserved+args.disk_gib*GIB: raise ValueError('Insufficient free disk for reserved jobs and 60 GiB safety margin')
    old=state(job)
    if args.resume:
        if not old or old.get('status')=='completed': raise ValueError('No interrupted job to resume')
        info=old;info.pop('error',None)
        completed=info.get('completed',{})
        if 'extract' in completed:
            manifest=data.load(completed['extract']['manifest'])
            for item in manifest['partitions']:
                for kind in ('sampling','observations'):
                    entry=item['files'][kind]; path=Path(completed['extract']['manifest']).parent/entry['path']
                    if not path.is_file() or data.p.checksum(path)!=entry['sha256']: raise ValueError('Completed extract changed; start a new job in another root')
        if 'aggregate' in completed:
            db=Path(completed['aggregate']['database']); report=data.load(db.parent/'analysis-report.json')
            if not db.is_file() or data.p.checksum(db)!=report['daily_database_sha256']: raise ValueError('Completed aggregation changed; start a new job in another root')
    else:
        if old: raise ValueError('Job exists; choose --resume or a different --root')
        if not args.manifest or not args.taxonomy: raise ValueError('--manifest and --taxonomy are required')
        if not args.manifest.is_file() or not args.taxonomy.is_file(): raise ValueError('Manifest and taxonomy must be existing files')
        config=dict(scope=args.scope,parent=args.parent,manifest=str(args.manifest.resolve()),taxonomy=str(args.taxonomy.resolve()),shared_photo_db=str(args.photo_db.resolve()),first_year=args.first_year,last_year=args.last_year,photo_sources=[],seconds=args.hours*3600,disk_bytes=args.disk_gib*GIB,memory_bytes=768*1024**2,reserve_free_bytes=60*GIB)
        info=dict(config=config,status='starting',completed={})
    write(job/'state.json',info)
    # The worker acquires the lock; keep scheduler serialized until it does so.
    handle.close()
    log=(job/'worker.log').open('a'); child=subprocess.Popen([sys.executable,__file__,'_worker',str(job)],stdout=log,stderr=log,start_new_session=True)
    for _ in range(100):
        if state(job).get('status')=='running' or child.poll() is not None: break
        time.sleep(.05)
    root_lock.close()
    if child.poll() is not None: raise ValueError('Job failed to start; inspect '+str(job/'worker.log'))
    if args.command=='run':
        try: return child.wait()
        except KeyboardInterrupt:
            child.terminate(); child.wait(); return 130
    print('Started',args.scope,'; status: '+str(job/'state.json')); return 0

if __name__=='__main__':
    try: sys.exit(main())
    except (ValueError, OSError) as exc: print('Error:',exc,file=sys.stderr);sys.exit(1)
