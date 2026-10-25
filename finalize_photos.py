import csv, json, re, shutil
from pathlib import Path
root=Path(__file__).resolve().parent
data=json.loads((root/'dist/data.json').read_text())
photos=json.loads((root/'photo-metadata.json').read_text())
norm=lambda v:re.sub('[^a-z]','',v.lower())
issues=[]
for bird in data['birds']:
    bird['photos']=[]
    for photo in photos.get(bird['id'],[]):
        # Gallery titles must identify the requested species, including its subspecific forms.
        alt=photo.get('alt') or ''
        credit=photo.get('credit') or ''
        actual=alt.rsplit(' - ',1)[0] if alt else credit.split('©')[0].strip()
        if not any(norm(actual).startswith(norm(n)) for n in [bird['name'],bird['acceptedName']]):
            issues.append((bird['name'],alt));continue
        photo['photographer']=alt.rsplit(' - ',1)[-1] if alt else credit.split('©')[-1].strip()
        if not re.fullmatch(r'\d+',photo['id']):continue
        # The catalog can show a processing placeholder while still exposing the asset ID.
        # Use the same Cornell image endpoint observed in gallery image URLs.
        photo['url']=f"https://cdn.download.ams.birds.cornell.edu/api/v2/asset/{photo['id']}/1200"
        bird['photos'].append(photo)
(root/'dist/data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
shutil.copy(root.parents[1]/'outputs/ebird_life_lists/trip_lifer_comparison.csv',root/'dist/trip_lifer_comparison.csv')
report={'species':len(data['birds']),'photoCovered':sum(bool(b['photos']) for b in data['birds']),'photos':sum(len(b['photos']) for b in data['birds']),'missing':[b['name'] for b in data['birds'] if not b['photos']],'identityIssues':issues}
(root/'photo-validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps({**report,'identityIssues':issues[:10]},indent=2))
