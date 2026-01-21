# Fair Trade Options for Greenland

An interactive map showing 21,523 combinations of contiguous US states that exactly match Greenland's area.

**Live site:** [greenland.ericvanzanten.com](https://greenland.ericvanzanten.com)

## The Premise

Helpful suggestions for EU negotiators seeking equivalent land swaps.

## The Data

- **Greenland's area:** 2,166,086 km²
- **Combinations found:** 21,523 exact matches (within 10 km²)
- **State counts:** Range from 9 to 24 states per combination

All combinations use contiguous (border-connected) states from the lower 48.

## How It Works

`comparison.py` enumerates all connected subgraphs of US states whose total area falls within 2% of Greenland. The script found 76 million combinations total, of which 21,523 are exact matches.

Data sources:
- State areas: [US Census Bureau](https://www.census.gov/geographies/reference-files/2010/geo/state-area.html)
- State adjacency: [Holmes (1998) border list](https://users.econ.umn.edu/~holmes/data/BORDLIST.html)
- Greenland area: CIA World Factbook

## Running Locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Regenerating the Data

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pandas networkx requests

# Generate all combinations (warning: produces ~16GB CSV)
python3 comparison.py

# Extract exact matches
grep ",100\.0," greenland_like_contiguous_state_combos_under.csv > data/all_exact.csv
```
