// Global state
let map;
let statesLayer;
let statesGeoJSON;
let combinationsData;
let selectedComboIndex = null;
let selectedStates = []; // Multi-select filter
let allStateNames = []; // For typeahead
let highlightedIndex = -1;

// State layer styles
const defaultStyle = {
    fillColor: '#1a4670',
    weight: 1,
    opacity: 1,
    color: '#0f3460',
    fillOpacity: 0.6
};

const hoverStyle = {
    fillColor: '#4cc9f0',
    weight: 2,
    color: '#4cc9f0',
    fillOpacity: 0.3
};

const selectedStyle = {
    fillColor: '#e94560',
    weight: 2,
    opacity: 1,
    color: '#ff6b6b',
    fillOpacity: 0.7
};

// Initialize the application
async function init() {
    // Set initial mobile view state
    if (window.innerWidth <= 768) {
        document.getElementById('map-container').classList.add('hidden');
    }

    initMap();
    await Promise.all([
        loadStatesGeoJSON(),
        loadCombinations()
    ]);
    renderStates();
    renderCombinations();
    setupEventListeners();
}

// Initialize Leaflet map
function initMap() {
    map = L.map('map', {
        center: [39.8, -98.5],
        zoom: 4,
        minZoom: 3,
        maxZoom: 8
    });

    // Dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);
}

// Load US states GeoJSON
async function loadStatesGeoJSON() {
    const response = await fetch('data/us-states.json');
    statesGeoJSON = await response.json();
}

// Load combinations data
async function loadCombinations() {
    const response = await fetch('data/combinations.json');
    combinationsData = await response.json();

    // Update stats
    document.getElementById('greenland-area').textContent =
        combinationsData.greenland_km2.toLocaleString() + ' km\u00B2';
    document.getElementById('combo-count').textContent =
        combinationsData.combinations.length.toLocaleString();
}

// Render state boundaries on map
function renderStates() {
    // Filter to lower 48 (exclude AK, HI, PR, DC for cleaner display)
    const lower48 = statesGeoJSON.features.filter(f => {
        const name = f.properties.name;
        return name !== 'Alaska' && name !== 'Hawaii' &&
               name !== 'Puerto Rico' && name !== 'District of Columbia';
    });

    // Populate state names for typeahead
    allStateNames = lower48.map(f => f.properties.name).sort();

    statesLayer = L.geoJSON({ type: 'FeatureCollection', features: lower48 }, {
        style: defaultStyle,
        onEachFeature: (feature, layer) => {
            layer.on({
                mouseover: handleStateHover,
                mouseout: handleStateOut,
                click: handleStateClick
            });
        }
    }).addTo(map);

    // Fit map to lower 48
    map.fitBounds(statesLayer.getBounds());
}

// Handle state hover
function handleStateHover(e) {
    const layer = e.target;
    const stateName = layer.feature.properties.name;

    // Don't change style if this state is in the selected combination
    if (selectedComboIndex !== null) {
        const combo = combinationsData.combinations[selectedComboIndex];
        if (combo.states.includes(stateName)) {
            return;
        }
    }

    layer.setStyle(hoverStyle);
    layer.bringToFront();
}

// Handle state mouseout
function handleStateOut(e) {
    const layer = e.target;
    const stateName = layer.feature.properties.name;

    // Don't reset if this state is in the selected combination
    if (selectedComboIndex !== null) {
        const combo = combinationsData.combinations[selectedComboIndex];
        if (combo.states.includes(stateName)) {
            return;
        }
    }

    layer.setStyle(defaultStyle);
}

// Handle state click - add state to filter
function handleStateClick(e) {
    const stateName = e.target.feature.properties.name;
    addStateFilter(stateName);
}

// Render combinations list
function renderCombinations() {
    const container = document.getElementById('combinations');
    container.innerHTML = '';

    const filtered = combinationsData.combinations.filter((combo) => {
        if (selectedStates.length === 0) return true;
        // Combination must include ALL selected states
        return selectedStates.every(state => combo.states.includes(state));
    });

    // Render filtered items (with reasonable limit)
    const toRender = filtered.slice(0, Math.min(filtered.length, 500));

    toRender.forEach((combo) => {
        const originalIdx = combinationsData.combinations.indexOf(combo);
        const item = createComboItem(combo, originalIdx);
        container.appendChild(item);
    });

    // Update header with count
    const filterText = selectedStates.length > 0
        ? ` containing ${selectedStates.join(', ')}`
        : '';
    document.querySelector('.list-header span').textContent =
        `${filtered.length.toLocaleString()} combinations${filterText}`;
}

// Create a combination item element
function createComboItem(combo, idx) {
    const item = document.createElement('div');
    item.className = 'combo-item' + (idx === selectedComboIndex ? ' selected' : '');
    item.dataset.index = idx;

    item.innerHTML = `
        <div class="combo-header">
            <span class="combo-count">${combo.states.length} states</span>
        </div>
        <div class="combo-area">${combo.total_km2.toLocaleString()} km\u00B2</div>
        <div class="combo-states">${combo.states.join(', ')}</div>
    `;

    item.addEventListener('click', () => selectCombination(idx));

    return item;
}

// Select a combination and highlight on map
function selectCombination(idx) {
    // Deselect previous
    if (selectedComboIndex !== null) {
        resetMapStyles();
        const prevItem = document.querySelector(`.combo-item[data-index="${selectedComboIndex}"]`);
        if (prevItem) prevItem.classList.remove('selected');
    }

    selectedComboIndex = idx;
    const combo = combinationsData.combinations[idx];

    // Highlight states on map
    statesLayer.eachLayer(layer => {
        const stateName = layer.feature.properties.name;
        if (combo.states.includes(stateName)) {
            layer.setStyle(selectedStyle);
            layer.bringToFront();
        }
    });

    // Update selected combo UI
    const currentItem = document.querySelector(`.combo-item[data-index="${idx}"]`);
    if (currentItem) currentItem.classList.add('selected');

    // Show selected info panel
    const infoPanel = document.getElementById('selected-info');
    infoPanel.classList.remove('hidden');
    document.getElementById('selected-states').textContent = combo.states.join(', ');
    document.getElementById('selected-area').textContent =
        `${combo.total_km2.toLocaleString()} km\u00B2`;

    // Fit map to selected states
    const selectedLayers = [];
    statesLayer.eachLayer(layer => {
        if (combo.states.includes(layer.feature.properties.name)) {
            selectedLayers.push(layer);
        }
    });
    if (selectedLayers.length > 0) {
        const group = L.featureGroup(selectedLayers);

        // On mobile, switch to map view when selecting a combination
        if (window.innerWidth <= 768) {
            const mapTab = document.querySelector('#mobile-tabs .tab[data-view="map"]');
            if (mapTab) {
                mapTab.click();
            }
        }

        setTimeout(() => {
            map.invalidateSize();
            map.fitBounds(group.getBounds(), { padding: [50, 50] });
        }, 100);
    }
}

// Reset map styles to default
function resetMapStyles() {
    statesLayer.eachLayer(layer => {
        layer.setStyle(defaultStyle);
    });
}

// Clear selection
function clearSelection() {
    if (selectedComboIndex !== null) {
        const prevItem = document.querySelector(`.combo-item[data-index="${selectedComboIndex}"]`);
        if (prevItem) prevItem.classList.remove('selected');
    }
    selectedComboIndex = null;
    resetMapStyles();
    highlightFilteredStates(); // Re-apply filter highlights if any

    document.getElementById('selected-info').classList.add('hidden');

    // Reset map view
    map.fitBounds(statesLayer.getBounds());
}

// Add state to filter
function addStateFilter(stateName) {
    if (!selectedStates.includes(stateName)) {
        selectedStates.push(stateName);
        renderFilterTags();
        renderCombinations();
        highlightFilteredStates();
    }
    document.getElementById('state-search').value = '';
    hideDropdown();
}

// Remove state from filter
function removeStateFilter(stateName) {
    selectedStates = selectedStates.filter(s => s !== stateName);
    renderFilterTags();
    renderCombinations();
    highlightFilteredStates();
}

// Render filter tags
function renderFilterTags() {
    const container = document.getElementById('selected-filters');
    container.innerHTML = '';
    selectedStates.forEach(state => {
        const tag = document.createElement('span');
        tag.className = 'filter-tag';
        tag.innerHTML = `${state}<button data-state="${state}">&times;</button>`;
        tag.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            removeStateFilter(state);
        });
        container.appendChild(tag);
    });
}

// Highlight filtered states on map
function highlightFilteredStates() {
    statesLayer.eachLayer(layer => {
        const stateName = layer.feature.properties.name;
        if (selectedStates.includes(stateName)) {
            layer.setStyle({
                fillColor: '#4cc9f0',
                weight: 2,
                color: '#4cc9f0',
                fillOpacity: 0.4
            });
        } else if (selectedComboIndex === null) {
            layer.setStyle(defaultStyle);
        }
    });
}

// Show dropdown with matching states
function showDropdown(query) {
    const dropdown = document.getElementById('search-dropdown');
    const matches = allStateNames.filter(name =>
        name.toLowerCase().includes(query.toLowerCase()) &&
        !selectedStates.includes(name)
    );

    if (matches.length === 0 || query === '') {
        hideDropdown();
        return;
    }

    dropdown.innerHTML = '';
    matches.slice(0, 8).forEach((name, idx) => {
        const item = document.createElement('div');
        item.className = 'dropdown-item' + (idx === highlightedIndex ? ' highlighted' : '');
        item.textContent = name;
        item.addEventListener('click', () => addStateFilter(name));
        item.addEventListener('mouseenter', () => {
            highlightedIndex = idx;
            updateDropdownHighlight();
        });
        dropdown.appendChild(item);
    });

    dropdown.classList.remove('hidden');
}

function hideDropdown() {
    document.getElementById('search-dropdown').classList.add('hidden');
    highlightedIndex = -1;
}

function updateDropdownHighlight() {
    const items = document.querySelectorAll('.dropdown-item');
    items.forEach((item, idx) => {
        item.classList.toggle('highlighted', idx === highlightedIndex);
    });
}

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('state-search');
    const dropdown = document.getElementById('search-dropdown');

    // Typeahead search
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        highlightedIndex = -1;
        showDropdown(query);
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = document.querySelectorAll('.dropdown-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateDropdownHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateDropdownHighlight();
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            const stateName = items[highlightedIndex].textContent;
            addStateFilter(stateName);
        } else if (e.key === 'Escape') {
            hideDropdown();
        }
    });

    // Hide dropdown on blur (with delay for click)
    searchInput.addEventListener('blur', () => {
        setTimeout(hideDropdown, 150);
    });

    // Show dropdown on focus if there's text
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) {
            showDropdown(searchInput.value.trim());
        }
    });

    // Clear all filters
    document.getElementById('clear-search').addEventListener('click', () => {
        searchInput.value = '';
        selectedStates = [];
        renderFilterTags();
        renderCombinations();
        highlightFilteredStates();
    });

    // Clear selection
    document.getElementById('clear-selection').addEventListener('click', clearSelection);

    // Mobile tabs
    document.querySelectorAll('#mobile-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;
            document.querySelectorAll('#mobile-tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const sidebar = document.getElementById('sidebar');
            const mapContainer = document.getElementById('map-container');

            if (view === 'list') {
                sidebar.classList.remove('hidden');
                mapContainer.classList.add('hidden');
            } else {
                sidebar.classList.add('hidden');
                mapContainer.classList.remove('hidden');
                map.invalidateSize();
            }
        });
    });
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
