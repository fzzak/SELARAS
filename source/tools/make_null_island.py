"""Generate a clearly synthetic test location that fills all six locked slots (for testing the format)."""
import json, os, sys, math, random
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); R = random.Random(7)
KX, KY = 111.32, 110.57                     # km per degree at the equator
def km(lon, lat): return lon * KX, lat * KY
def floor_elev(lon, lat):                   # metres, negative below sea level
    x, y = km(lon, lat); r = math.hypot(x, y)
    z = -3100 + 3095 * math.exp(-(r / 13.5) ** 2.2)                  # seamount with a reef flat
    z += 900 * math.exp(-((x * 0.8 + y * 0.6 - 4) / 5.5) ** 2) * math.exp(-((x * 0.6 - y * 0.8) / 30) ** 2) * (r > 9)   # ridge to the NE
    z += 35 * math.sin(x / 2.3) * math.cos(y / 3.1) + 18 * math.sin((x + y) / 1.1)
    if r < 1.6: z = 14 * (1 - r / 1.6) + 1                           # small island
    elif r < 5.5: z = max(z, -6 - 2.5 * (r - 1.6))                   # reef flat
    return z
# ---- bathymetry.asc -------------------------------------------------------------------------
cell, lo0, la0, n = 0.005, -0.3, -0.3, 121
with open(f'{OUT}/bathymetry.asc', 'w') as f:
    f.write(f'ncols {n}\nnrows {n}\nxllcorner {lo0 - cell / 2:.6f}\nyllcorner {la0 - cell / 2:.6f}\ncellsize {cell}\nNODATA_value -32767\n')
    for j in range(n - 1, -1, -1):
        f.write(' '.join(str(int(round(floor_elev(lo0 + i * cell, la0 + j * cell)))) for i in range(n)) + '\n')
# ---- stations ---------------------------------------------------------------------------------
st = []
def add(sid, typ, lon, lat, hours, label): st.append(dict(id=sid, type=typ, lon=round(lon, 5), lat=round(lat, 5), t=hours, label=label))
west_east = [-0.26, -0.19, -0.13, -0.085, 0.085, 0.13, 0.19, 0.26]
for k, lo in enumerate(west_east): add(f'CTD{k + 1:02d}', 'CTD', lo, 0.012, 6 + 5 * k, 'West to east transect')
for k, la in enumerate([-0.24, -0.15, -0.09, 0.09, 0.15, 0.24]): add(f'CTD{k + 9:02d}', 'CTD', -0.012, la, 52 + 5 * k, 'South to north transect')
add('ROV01', 'ROV', 0.062, 0.03, 90, 'ROV dive on the east slope'); add('ROV02', 'ROV', -0.05, -0.045, 98, 'ROV dive on the south-west slope')
bio_sites = [('ED01', 0.03, 0.02, 5, 'reef flat'), ('ED02', -0.028, 0.025, 6, 'reef flat'), ('ED03', 0.005, -0.04, 12, 'reef crest'),
             ('ED04', 0.075, 0.035, 60, 'east slope'), ('ED05', -0.07, -0.04, 80, 'south-west slope'), ('ED06', 0.01, 0.09, 120, 'north slope'),
             ('ED07', 0.2, 0.05, 10, 'open water'), ('ED08', -0.21, -0.1, 10, 'open water'), ('ED09', 0.05, -0.23, 150, 'open water, deep')]
for k, (sid, lo, la, dep, where) in enumerate(bio_sites): add(sid, 'eDNA', lo, la, 104 + 3 * k, f'eDNA water sample, {where}, {dep} m')
def iso(h): return f'2026-01-{10 + int(h // 24):02d}T{int(h % 24):02d}:{int(h * 60 % 60):02d}Z'
st.sort(key=lambda s: s['t'])
with open(f'{OUT}/stations.csv', 'w') as f:
    f.write('station_id,type,time_utc,lat,lon,label\n')
    for s in st: f.write(f"{s['id']},{s['type']},{iso(s['t'])},{s['lat']},{s['lon']},\"{s['label']}\"\n")
with open(f'{OUT}/track.csv', 'w') as f:
    f.write('time_utc,lat,lon\n'); f.write(f'{iso(0)},-0.29,-0.29\n')
    for s in st: f.write(f"{iso(s['t'])},{s['lat']},{s['lon']}\n")
    f.write(f'{iso(140)},0.29,0.29\n')
# ---- profiles ---------------------------------------------------------------------------------
def tc_depth(lon, lat):
    x, y = km(lon, lat); return 120 - 55 * math.exp(-(math.hypot(x, y) / 17) ** 2)
levels = list(range(1, 200, 5)) + list(range(200, 1000, 25)) + list(range(1000, 3001, 100))
rows = 0
with open(f'{OUT}/profiles.csv', 'w') as f:
    f.write('station_id,depth_m,temperature_c,salinity_psu,oxygen_umol_kg,chlorophyll_mg_m3,turbidity_ntu,flag\n')
    for s in st:
        if s['type'] not in ('CTD', 'ROV'): continue
        bottom = -floor_elev(s['lon'], s['lat']); D = tc_depth(s['lon'], s['lat'])
        x, y = km(s['lon'], s['lat']); near = math.exp(-(math.hypot(x, y) / 17) ** 2)
        for z in levels:
            if z > bottom - 8: break
            T = 3.2 + 26.2 / (1 + math.exp((z - D) / 24)) - 0.0006 * z + R.gauss(0, 0.03)
            S = 34.28 + 0.72 * math.exp(-((z - (D + 12)) / 48) ** 2) + 0.00009 * z + R.gauss(0, 0.004)
            O = 203 - 125 / (1 + math.exp(-(z - (D + 70)) / 55)) + 0.022 * max(z - 700, 0) + R.gauss(0, 0.8)
            C = 0.07 + (0.45 + 0.65 * near) * math.exp(-((z - (D - 22)) / 19) ** 2) + abs(R.gauss(0, 0.008))
            Tu = 0.12 + 0.55 * math.exp(-(bottom - z) / 45) + abs(R.gauss(0, 0.012))
            chem = f'{O:.1f},{C:.3f},{Tu:.3f}' if s['type'] == 'CTD' else ',,'      # the ROV sensor has no chemistry channels
            f.write(f"{s['id']},{z},{T:.3f},{S:.3f},{chem},modelled\n"); rows += 1
# ---- currents ---------------------------------------------------------------------------------
cur = 0
with open(f'{OUT}/currents.csv', 'w') as f:
    f.write('time_utc,lat,lon,depth_m,u_m_s,v_m_s\n')
    for depth, U in ((10, 0.30), (100, 0.17), (300, 0.07)):
        for j in range(11):
            for i in range(11):
                lon, lat = -0.27 + i * 0.054, -0.27 + j * 0.054
                if -floor_elev(lon, lat) < depth + 15: continue
                x, y = km(lon, lat); a = 9.0 + depth / 60; r2 = max(x * x + y * y, a * a)
                th = math.radians(18)                                  # background flow toward ENE
                xr, yr = x * math.cos(th) + y * math.sin(th), -x * math.sin(th) + y * math.cos(th)
                ur = U * (1 - a * a * (xr * xr - yr * yr) / (r2 * r2)); vr = -U * 2 * a * a * xr * yr / (r2 * r2)
                u, v = ur * math.cos(th) - vr * math.sin(th), ur * math.sin(th) + vr * math.cos(th)
                f.write(f'{iso(48)},{lat:.4f},{lon:.4f},{depth},{u + R.gauss(0, 0.008):.3f},{v + R.gauss(0, 0.008):.3f}\n'); cur += 1
# ---- biology ----------------------------------------------------------------------------------
POOL = [('Acropora', 'Corals'), ('Pocillopora', 'Corals'), ('Porites', 'Corals'), ('Montipora', 'Corals'), ('Stylophora', 'Corals'), ('Favites', 'Corals'),
        ('Chaetodon', 'Fishes'), ('Acanthurus', 'Fishes'), ('Chromis', 'Fishes'), ('Thalassoma', 'Fishes'), ('Scarus', 'Fishes'), ('Caesio', 'Fishes'),
        ('Epinephelus', 'Fishes'), ('Myctophum', 'Fishes'), ('Cyclothone', 'Fishes'), ('Thunnus', 'Fishes'),
        ('Tridacna', 'Molluscs'), ('Conus', 'Molluscs'), ('Octopus', 'Molluscs'), ('Sthenoteuthis', 'Molluscs'),
        ('Stenopus', 'Crustaceans'), ('Alpheus', 'Crustaceans'), ('Calanus', 'Crustaceans'), ('Euphausia', 'Crustaceans'), ('Oncaea', 'Crustaceans'),
        ('Linckia', 'Echinoderms'), ('Diadema', 'Echinoderms'), ('Holothuria', 'Echinoderms'),
        ('Xestospongia', 'Sponges'), ('Stylissa', 'Sponges'), ('Halimeda', 'Algae'), ('Sargassum', 'Algae'), ('Symbiodinium', 'Algae'), ('Prochlorococcus', 'Bacteria'), ('Synechococcus', 'Bacteria')]
PELAGIC = {'Myctophum', 'Cyclothone', 'Thunnus', 'Sthenoteuthis', 'Calanus', 'Euphausia', 'Oncaea', 'Prochlorococcus', 'Synechococcus'}
bio = 0
with open(f'{OUT}/biology.csv', 'w') as f:
    f.write('sample_id,station_id,lat,lon,depth_m,time_utc,method,scientific_name,taxon_group,value,value_type\n')
    for sid, lo, la, dep, where in bio_sites:
        s = next(q for q in st if q['id'] == sid); x, y = km(lo, la); near = math.exp(-(math.hypot(x, y) / 11) ** 2)
        for name, group in POOL:
            p = (0.25 + 0.6 * (1 - near)) if name in PELAGIC else (0.08 + 0.85 * near) * (0.75 if dep > 50 else 1)
            if R.random() > p: continue
            reads = int(math.exp(R.gauss(5.2 + (1.2 if name in PELAGIC and near < 0.3 else 0), 1.3))) + 3
            f.write(f"{sid},{sid},{la},{lo},{dep},{iso(s['t'])},eDNA,{name},{group},{reads},reads\n"); bio += 1
meta = {
  "selaras_format": 1, "id": "null_island_test", "name": "Null Island · synthetic test set",
  "region": "Invented seamount at 0°N 0°E", "period": {"start": "2026-01-10", "end": "2026-01-15"},
  "description": "An invented seamount with generated numbers in every slot, so you can see what a complete location looks like and test the file format.",
  "slots": {k: {"status": "synthetic", "source": "Generated by a script"} for k in ("seafloor", "physics", "chemistry", "currents", "biology", "stations")},
  "stories": [
    {"title": "All six slots filled", "text": "This invented location has a file for every locked slot: seafloor, physics, chemistry, currents, biology, and stations with track. None of it is measured. Use it to see how a complete dataset behaves before your own files are ready.",
     "show": ["seafloor", "physics", "chemistry", "currents", "biology", "stations"], "variable": "temperature_c", "select": ["CTD04"], "depth_window": 1000, "camera": {"az": -35, "el": 30, "zoom": 1}},
    {"title": "A dome over the seamount", "text": "In this generated example the 20 °C surface rises about 50 m over the seamount, the chlorophyll maximum follows it up, and eDNA richness is highest on the reef. This is the kind of cross-slot pattern SELARAS is meant to show in real data.",
     "show": ["seafloor", "physics", "chemistry", "biology", "stations"], "variable": "temperature_c", "surface": {"variable": "temperature_c", "value": 20}, "select": ["CTD04", "CTD01", "ED01"], "depth_window": 300, "camera": {"az": -48, "el": 18, "zoom": 1.25}}
  ]
}
json.dump(meta, open(f'{OUT}/dataset.json', 'w'), indent=2, ensure_ascii=False)
print('null island: stations', len(st), '| profile rows', rows, '| currents', cur, '| biology rows', bio)
