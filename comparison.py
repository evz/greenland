#!/usr/bin/env python3
"""
Enumerate every contiguous (border-connected) combination of US states
whose total area is within 2% of Greenland, without going over.

- Uses US Census Bureau state total area (km^2).
- Uses Holmes (1998) border list for lower-48 adjacency.
- Excludes Alaska/Hawaii automatically (not in the border list).
"""

import csv
import json
import math
import os
import re
import tempfile
from multiprocessing import Pool, cpu_count
from typing import Dict, List, Tuple

import pandas as pd
import networkx as nx
import requests

CENSUS_STATE_AREA_URL = "https://www.census.gov/geographies/reference-files/2010/geo/state-area.html"
HOLMES_BORDLIST_URL   = "https://users.econ.umn.edu/~holmes/data/BORDLIST.html"

GREENLAND_KM2 = 2_166_086  # CIA World Factbook
LOWER = math.ceil(0.98 * GREENLAND_KM2)
UPPER = GREENLAND_KM2

ABBR_TO_STATE = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut",
    "DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa",
    "KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan",
    "MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire",
    "NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
    "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee",
    "TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin",
    "WY":"Wyoming","DC":"District of Columbia"
}

def fetch_state_areas_km2() -> Dict[str, int]:
    html = requests.get(CENSUS_STATE_AREA_URL, timeout=60).text
    tables = pd.read_html(html)
    if not tables:
        raise RuntimeError("Could not find tables on Census state-area page.")

    df = tables[0]
    # Flatten multi-index columns
    df.columns = ["|".join([str(c) for c in col if str(c).lower() != "nan"]).strip("|") for col in df.columns.values]
    name_col = df.columns[0]
    area_col = "Total Area|Total Area|Sq. Km."
    if area_col not in df.columns:
        raise RuntimeError("Expected Census area column not found.")

    # 50 states only
    states_50 = set([
        "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia",
        "Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland",
        "Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
        "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
        "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington",
        "West Virginia","Wisconsin","Wyoming"
    ])

    out = {}
    for _, row in df.iterrows():
        name = str(row[name_col]).strip()
        if name in states_50 and pd.notna(row[area_col]):
            out[name] = int(round(float(row[area_col])))
    if len(out) != 50:
        raise RuntimeError(f"Expected 50 states, got {len(out)}.")
    return out

def fetch_lower48_adjacency() -> nx.Graph:
    html = requests.get(HOLMES_BORDLIST_URL, timeout=60).text
    pairs = re.findall(r"\b([A-Z]{2})-([A-Z]{2})\b", html)
    G = nx.Graph()

    # Add only the 48 contiguous states present in the border list (AK/HI excluded by construction)
    lower48 = set(ABBR_TO_STATE[a] for a, b in pairs if a in ABBR_TO_STATE) | set(ABBR_TO_STATE[b] for a, b in pairs if b in ABBR_TO_STATE)
    lower48 -= {"Alaska","Hawaii","District of Columbia"}  # keep "states" only
    G.add_nodes_from(sorted(lower48))

    for a, b in pairs:
        if a in ABBR_TO_STATE and b in ABBR_TO_STATE:
            sa, sb = ABBR_TO_STATE[a], ABBR_TO_STATE[b]
            if sa in G and sb in G:
                G.add_edge(sa, sb)

    # Sanity: lower 48 should be connected
    if not nx.is_connected(G):
        raise RuntimeError("Adjacency graph is unexpectedly not connected.")
    return G

def mask_helpers(states: List[str], G: nx.Graph, areas: Dict[str, int]):
    idx = {s:i for i,s in enumerate(states)}
    n = len(states)
    full = (1 << n) - 1
    area_arr = [areas[s] for s in states]
    adj = [0] * n
    for s in states:
        i = idx[s]
        m = 0
        for nb in G.neighbors(s):
            if nb in idx:
                m |= 1 << idx[nb]
        adj[i] = m
    return idx, area_arr, adj, full

def enumerate_connected_subsets_for_roots(args: Tuple) -> str:
    """
    Worker function: enumerate connected subsets for a range of root indices.
    Writes results to a temp file and returns the filename.
    """
    roots, states, area_arr, adj, full_mask, lower, upper = args
    n = len(states)

    # Create temp file for this worker's results
    fd, temp_path = tempfile.mkstemp(suffix=".csv", prefix="greenland_worker_")

    with os.fdopen(fd, "w", newline="") as f:
        writer = csv.writer(f)
        count = 0

        for r in roots:
            U = full_mask & ~((1 << r) - 1)
            root = 1 << r
            cand = adj[r] & U & ~root
            sum0 = area_arr[r]

            stack = [(root, cand, 0, sum0)]

            while stack:
                S, C, X, ssum = stack.pop()

                if lower <= ssum <= upper:
                    st = mask_to_states(S, states)
                    writer.writerow([len(st), ssum, round(100.0 * ssum / GREENLAND_KM2, 3), ", ".join(st)])
                    count += 1

                if ssum >= upper or C == 0:
                    continue

                cm = C
                ex = X
                children = []
                while cm:
                    vbit = cm & -cm
                    v = vbit.bit_length() - 1
                    cm ^= vbit

                    new_sum = ssum + area_arr[v]
                    if new_sum <= upper:
                        newS = S | vbit
                        newC = cm | (adj[v] & U & ~newS & ~ex)
                        children.append((newS, newC, ex, new_sum))

                    ex |= vbit

                stack.extend(reversed(children))

    return temp_path, count

def mask_to_states(mask: int, states: List[str]) -> List[str]:
    out = []
    i = 0
    while mask:
        lsb = mask & -mask
        j = lsb.bit_length() - 1
        out.append(states[j])
        mask ^= lsb
        i += 1
    return out

def main():
    print(f"Greenland area: {GREENLAND_KM2:,} km²")
    print(f"Target band: [{LOWER:,}, {UPPER:,}] km² (within 2%, not over)")

    areas50 = fetch_state_areas_km2()
    G = fetch_lower48_adjacency()

    # Restrict to lower 48 (contiguous) states only
    lower48_states = sorted(G.nodes())
    areas48 = {s: areas50[s] for s in lower48_states}

    idx, area_arr, adj, full = mask_helpers(lower48_states, G, areas48)
    n = len(lower48_states)

    # Determine number of workers
    num_workers = min(cpu_count(), n)
    print(f"Using {num_workers} parallel workers")

    # Distribute roots across workers (each root's search tree is independent)
    root_chunks = [[] for _ in range(num_workers)]
    for r in range(n):
        root_chunks[r % num_workers].append(r)

    # Prepare arguments for each worker
    worker_args = [
        (roots, lower48_states, area_arr, adj, full, LOWER, UPPER)
        for roots in root_chunks
    ]

    # Run workers in parallel
    output_file = "greenland_like_contiguous_state_combos_under.csv"
    temp_files = []
    total_count = 0

    with Pool(num_workers) as pool:
        results = pool.map(enumerate_connected_subsets_for_roots, worker_args)

    for temp_path, count in results:
        temp_files.append(temp_path)
        total_count += count

    # Merge temp files into final output
    sample_rows = []
    with open(output_file, "w", newline="") as out_f:
        writer = csv.writer(out_f)
        writer.writerow(["states_count", "total_km2", "percent_of_greenland", "states"])

        for temp_path in temp_files:
            with open(temp_path, "r", newline="") as in_f:
                reader = csv.reader(in_f)
                for row in reader:
                    writer.writerow(row)
                    if len(sample_rows) < 10:
                        sample_rows.append(row)
            os.unlink(temp_path)  # Clean up temp file

    print(f"Found {total_count} combinations.")
    print(f"Wrote: {output_file}")
    print("\nFirst 10 results:")
    print(f"{'states_count':>12} {'total_km2':>12} {'percent_of_greenland':>20} states")
    for row in sample_rows:
        print(f"{row[0]:>12} {row[1]:>12} {row[2]:>20} {row[3]}")

    # Also export as JSON for the web app
    export_json(output_file)


def export_json(csv_file: str, json_file: str = None, max_combinations: int = 10000):
    """
    Export CSV results to JSON format for the web app.
    Uses a heap to efficiently find the max_combinations closest to Greenland area.
    """
    import heapq

    if json_file is None:
        json_file = "data/combinations.json"

    # Ensure data directory exists
    os.makedirs(os.path.dirname(json_file), exist_ok=True)

    print(f"Reading {csv_file}...")

    # Use a max-heap (negated min-heap) to keep track of top N closest
    # Heap items: (negated_distance, row_count, combo_dict) - row_count as tiebreaker
    heap = []
    row_count = 0

    with open(csv_file, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 1_000_000 == 0:
                print(f"  Processed {row_count:,} rows...")

            percent = float(row["percent_of_greenland"])
            distance = abs(100.0 - percent)

            combo = {
                "states": [s.strip() for s in row["states"].split(",")],
                "total_km2": int(row["total_km2"]),
                "percent": percent
            }

            if len(heap) < max_combinations:
                heapq.heappush(heap, (-distance, row_count, combo))
            elif -distance > heap[0][0]:
                heapq.heapreplace(heap, (-distance, row_count, combo))

    print(f"  Total rows: {row_count:,}")

    # Extract combinations and sort by closeness
    combinations = [item[2] for item in heap]
    combinations.sort(key=lambda x: abs(100.0 - x["percent"]))

    output = {
        "greenland_km2": GREENLAND_KM2,
        "combinations": combinations
    }

    with open(json_file, "w") as f:
        json.dump(output, f)

    print(f"Wrote JSON: {json_file} ({len(combinations)} combinations)")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--export-json":
        csv_file = sys.argv[2] if len(sys.argv) > 2 else "greenland_like_contiguous_state_combos_under.csv"
        export_json(csv_file)
    else:
        main()
