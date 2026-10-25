import csv, json, re
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
s = openpyxl.load_workbook(ROOT/'checklist_dec2026.xlsx').active
taxa = list(csv.DictReader(open('/private/tmp/ebird-taxonomy.csv')))
species_taxa = [r for r in taxa if r['CATEGORY']=='species']
norm = lambda v: re.sub('[^a-z]', '', v.lower())
by_name = {norm(r['COMMON_NAME']):r for r in species_taxa}
by_sci = {r['SCIENTIFIC_NAME']:r for r in species_taxa}
world = list(csv.DictReader(open(ROOT/'outputs/ebird_life_lists/worldwide_life_list.csv',encoding='utf-8-sig')))
colombia = list(csv.DictReader(open(ROOT/'outputs/ebird_life_lists/colombia_life_list.csv',encoding='utf-8-sig')))
def seen(records):
    keys = set()
    for r in records:
        keys.add(r['Scientific Name'])
        t=by_name.get(norm(r['Common Name']))
        if t: keys.add(t['SCIENTIFIC_NAME'])
    return keys
world_seen, co_seen = seen(world),seen(colombia)
sites=[]
for col in range(3,16):
    code=s.cell(20,col).value
    legend=next((s.cell(r,1).value for r in range(2,16) if s.cell(r,1).value.startswith(code+' -')),code)
    sites.append({'code':code,'name':legend.split(' -',1)[-1].strip(),'column':col})
birds=[]; corrections=[]; unresolved=[]; family=''
for row in s.iter_rows(min_row=21,max_row=941):
    text=row[0].value
    if not text: continue
    if len(text.split())==1 or re.fullmatch(r'[A-Za-z]+idae \(\d+\)',text): family=text; continue
    # Find the genus/species boundary; the malformed grosbeak row omits its genus.
    match=re.search(r'\s([A-Z][a-z]+)\s([a-z]+)$',text)
    if text=='Rose-breasted Grosbeak ludovicianus':
        common='Rose-breasted Grosbeak'; original_sci='ludovicianus'
    elif match:
        common=text[:match.start()].strip(); original_sci=text[match.start():].strip()
    else:
        unresolved.append(text); continue
    t=by_sci.get(original_sci) or by_name.get(norm(common))
    if not t: unresolved.append(text)
    sci=t['SCIENTIFIC_NAME'] if t else original_sci
    if sci!=original_sci: corrections.append({'checklist':text,'scientificName':sci})
    birds.append({'id':t['SPECIES_CODE'] if t else norm(common),'name':common,'acceptedName':t['COMMON_NAME'] if t else common,'scientificName':sci,'originalScientificName':original_sci,'family':family,'sites':[x['code'] for x in sites if str(row[x['column']-1].value).strip().upper()=='X'],'worldLifer':sci not in world_seen,'colombiaLifer':sci not in co_seen,'row':row[0].row,'photos':[]})
summary={'species':len(birds),'worldLifers':sum(b['worldLifer'] for b in birds),'colombiaLifers':sum(b['colombiaLifer'] for b in birds),'sites':len(sites),'corrections':corrections,'unresolved':unresolved}
data={'birds':birds,'sites':sites,'summary':summary,'snapshot':'2026-10-07'}
(OUT/'dist/data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
with (ROOT/'outputs/ebird_life_lists/trip_lifer_comparison.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.writer(f); writer.writerow(['Common Name','Scientific Name','Potential Worldwide Lifer','Potential Colombia Lifer','Sites','Checklist Row'])
    writer.writerows([b['name'],b['scientificName'],b['worldLifer'],b['colombiaLifer'],'; '.join(b['sites']),b['row']] for b in birds)
print(json.dumps(summary,indent=2))
