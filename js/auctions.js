// Function to load CSV file using PapaParse
function loadCSV(url, dateKey = "auction_date") {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: results => {
                if (dateKey) {
                    // Convert "SALE DATE" property to JavaScript Date objects
                    results.data = results.data.map(obj => {
                        // Use destructuring to get other properties if needed
                        const { [dateKey]: saleDate, ...rest } = obj;

                        // Convert string to Date, set to midnight (otherwise date filter doesn't work)
                        const saleDateObj = new Date(saleDate);
                        saleDateObj.setHours(24, 0, 0, 0)

                        // Add other properties back if needed
                        return { [dateKey]: saleDateObj, ...rest };
                    });
                }
                resolve(results.data);
            },
            error: error => {
                reject(error.message);
            }
        });
    });
}
let combinedData = []


function updateURLWithFilters(filters) {
    const params = new URLSearchParams();

    Object.keys(filters).forEach(column => {
        params.set(column, JSON.stringify(filters[column]));
    });

    // Update the URL in the address bar
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
}

function applyFiltersFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.size == 0) {
        const currentDate = new Date();
        const futureDate = new Date();
        futureDate.setDate(currentDate.getDate() + 7);
        gridApi.setColumnFilterModel('auction_date', {
            dateFrom: currentDate.toISOString(),
            dateTo: futureDate.toISOString(),
            filterType: "auction_date",
            type: "inRange"
        })
        gridApi.onFilterChanged()
        return
    }
    const filters = {};

    params.forEach((value, key) => {
        filters[key] = JSON.parse(value);
    });

    gridApi.setFilterModel(filters);
}



// grid columns
const columnDefs = [
    {
        headerName: "Sold?",
        field: "isSold",
        cellDataType: 'boolean',
        filter: 'agSetColumnFilter',
        suppressSizeToFit: true,
        minWidth: 40,
    },
    {
        field: "borough",
        filter: 'agSetColumnFilter',
    },
    {
        headerName: "Address",
        field: "address",
        cellRenderer: 'agGroupCellRenderer'
    },
    {
        headerName: "Case #",
        field: "case_number",
    },
    {
        headerName: "Auction Date",
        field: "auction_date",
        suppressSizeToFit: true,
        minWidth: 120,
        filter: 'agDateColumnFilter',
        sort: "asc",
        sortIndex: 0,
    },
    {
        headerName: "Block", field: "block",
        filter: 'agNumberColumnFilter',
    },
    {
        headerName: "Lot", field: "lot",
        filter: 'agNumberColumnFilter',
    },
    // {
    //     headerName: "Judgement Amt", field: "judgement",
    //     valueFormatter: (params) => params.value ? formattedCurrency.format(params.value) : null,
    // },
    {
        headerName: "Upset Price", field: "upset_price",
        valueFormatter: (params) => params.value ? formattedCurrency.format(params.value) : null
    },
    {
        headerName: "Sale Price", field: "winning_bid",
        valueFormatter: (params) => params.value ? formattedCurrency.format(params.value) : null
    }

]

const formattedCurrency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});


const formattedPercent = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
})


const defaultColDef = {
    flex: 1,
    minWidth: 100,
    filter: 'agTextColumnFilter',
    menuTabs: ['filterMenuTab'],
    autoHeaderHeight: true,
    wrapHeaderText: true,
    sortable: true,
    resizable: true
}

function zoomToBlock(event) {
    if (!event.node.isSelected()) {
        return
    }
    const key = `${event.node.data.block}-${event.node.data.borough}`;
    map.fitBounds(markers[key][0].getBounds(), { maxZoom: 14 })
}

// Initialize AG Grid
const gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    masterDetail: true,
    detailRowAutoHeight: true,
    rowSelection: 'single',
    onRowSelected: zoomToBlock,

    detailCellRendererParams: {
        detailGridOptions: {
            columnDefs: [
                {
                    headerName: "Address", field: "ADDRESS",
                    minWidth: 200,
                },
                {
                    headerName: "Neighborhood", field: "NEIGHBORHOOD",
                    filter: 'agSetColumnFilter'
                },
                {
                    headerName: "Category", field: "BUILDING CLASS CATEGORY",
                },
                {
                    headerName: "Apt #", field: "APARTMENT NUMBER",
                },
                {
                    headerName: "Total Units", field: "TOTAL UNITS",
                    filter: 'agNumberColumnFilter',
                },
                {
                    field: 'SALE DATE',
                    headerName: 'Sale Date',
                    filter: 'agDateColumnFilter',
                    sort: "asc",
                    sortIndex: 0,
                    sortable: true
                },
                {
                    headerName: 'Sale Price',
                    field: "SALE PRICE",
                    valueFormatter: (params) => formattedCurrency.format(params.value),
                },

            ],
            defaultColDef: {
                flex: 1,
                sortable: true,
                filter: 'agNumberColumnFilter',
            },
        },
        getDetailRowData: (params) => {
            // find all transactions for this address
            let repeats = getTransactions(params.data);


            // add % price change
            repeats = repeats.map((transaction, index, arr) => {
                // For the first row, priceChange is null
                if (index === 0) {
                    return { ...transaction, priceChange: null };
                }

                // For subsequent rows, priceChange is the difference in price over the immediately preceding sale
                const priceChange = transaction["SALE PRICE"] - arr[index - 1]["SALE PRICE"];
                const priceChangePct = transaction["SALE PRICE"] / arr[index - 1]["SALE PRICE"] - 1;
                return { ...transaction, priceChange, priceChangePct };
            });

            params.successCallback(repeats);
        },
    },
    // Listen for AG Grid filter changes
    onFilterChanged: function () {
        const allFilters = gridApi.getFilterModel()
        updateURLWithFilters(allFilters);

        // Get all displayed rows
        let visibleRows = [];
        gridApi.forEachNodeAfterFilterAndSort((node) => {
            if (node.data.block && node.data.borough) {
                visibleRows.push(node.data);
            }
        });

        // Show or hide markers based on visible rows
        for (let key in markers) {
            markers[key].forEach(l => l.removeFrom(map)); // Remove all markers from map initially
        }
        visibleRows.forEach(function (row) {
            const key = `${row.block}-${row.borough}`;
            if (markers[key]) {
                markers[key].forEach(l => l.addTo(map)); // Add only visible row markers to map
            }
        });
    }
};

// Create AG Grid
const gridDiv = document.querySelector('#myGrid');
const gridApi = agGrid.createGrid(gridDiv, gridOptions)
// Load and apply filters from URL when the grid initializes
applyFiltersFromURL(gridApi);

const csvPromises = [
    loadCSV('foreclosures/auction_sales.csv', 'SALE DATE'),
    loadCSV('foreclosures/cases.csv', dateKey = 'auction_date'),
    loadCSV('foreclosures/lots.csv', dateKey = null),
    loadCSV('foreclosures/bids.csv', dateKey = 'auction_date')
]

// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises).then(([sales, auctions, lots, bids]) => {
    combinedData = sales
    // get the address from transaction records
    for (const lot of lots) {
        const auctionMatches = auctions.filter(({ case_number }) => case_number == lot.case_number)
        if (!auctionMatches.length) {
            console.log("Couldn't find a match for lot", lot.case_number)
            continue
        }
        
        const auction = auctionMatches[0]
        lot.auction_date = auction.auction_date
        lot.case_name = auction.case_name

        const result = bids.find(({case_number, auction_date}) => (case_number == lot.case_number) && (auction_date.getTime() == lot.auction_date.getTime()))
        if(result) {
            lot.judgement = result.judgement
            lot.upset_price = result.upset_price
            lot.winning_bid = result.winning_bid
        }

        const transactions = getTransactions(lot)

        if (transactions.length > 0) {
            if (!lot.address) {
                lot.address = transactions[transactions.length - 1]["ADDRESS"]
            }
            lot.isSold = new Date() > lot.auction_date ? transactions.some(t => {
                const millisecondsInADay = 24 * 60 * 60 * 1000;
                const dayDifference = (t["SALE DATE"] - lot.auction_date) / millisecondsInADay
                return dayDifference >= 0 && dayDifference <= 90 && t["SALE PRICE"] > 10000
            }) : false
        } else {
            lot.isSold = false
        }

    }


    // load the full table
    gridApi.setGridOption('rowData', lots)
    gridApi.sizeColumnsToFit()
})
    .catch(error => {
        console.error('Error loading CSV files:', error);
    });


function getTransactions(data) {
    let repeats = combinedData.filter(({ BOROUGH, BLOCK, LOT }) => BOROUGH == data.borough && BLOCK == data.block && LOT == data.lot);
    repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"]);
    return repeats;
}

// Style URL format in XYZ PNG format; see our documentation for more options
const toner = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
});


const map = L.map('map', {
    center: [40.7143, -74.0060],
    zoom: 13,
    layers: [toner]
})
const layerControl = L.control.layers({ "Streets": toner }).addTo(map);


// Function to calculate the centroid of a GeoJSON geometry
function getCentroid(geometry) {
    let latlng = [];

    switch (geometry.type) {
        case 'Polygon':
            latlng = L.polygon(geometry.coordinates).getBounds().getCenter();
            break;
        case 'MultiPolygon':
            latlng = L.polygon(geometry.coordinates[0]).getBounds().getCenter();
            break;
        case 'Point':
            latlng = L.latLng(geometry.coordinates[1], geometry.coordinates[0]);
            break;
        default:
            console.error('Unsupported geometry type:', geometry.type);
            break;
    }
    return latlng;
}

const borough_dict = {
    "1": "Manhattan",
    "2": "Bronx",
    "3": "Brooklyn",
    "4": "Queens",
    "5": "Staten Island",
}

let markers = {};

// Load the GeoJSON file
fetch('foreclosures/auctions.geojson')
    .then(response => response.json())
    .then(geojsonFeature => {
        lots = L.geoJSON(geojsonFeature, {
            onEachFeature: function (feature, layer) {
                let block = feature.properties.BLOCK;
                let borough = borough_dict[feature.properties.BORO];

                // Store the marker in the markers object
                const key = `${block}-${borough}`;
                if (!markers[key]) {
                    markers[key] = []
                }
                markers[key].push(layer);

                layer.on('click', function () {

                    // Highlight the row in AG Grid
                    gridApi.forEachNodeAfterFilterAndSort(function (node) {
                        if (node.data.block === block && node.data.borough === borough) {
                            node.setSelected(true, true); // Select the row

                            // Ensure the selected row is visible by scrolling to it
                            gridApi.ensureIndexVisible(node.rowIndex, 'middle');
                        }
                    });
                });


            }


        }).addTo(map)
        layerControl.addOverlay(lots, "Auction Locations")
        gridApi.onFilterChanged()
    })
    .catch(error => console.error('Error loading GeoJSON:', error));

// splitter functionality
const splitter = document.getElementById('splitter')

let isResizing = false
const mapDiv = document.getElementById('map')

splitter.addEventListener('mousedown', startResize())
document.addEventListener('mousemove', resize())
document.addEventListener('mouseup', stopResize())

splitter.addEventListener('touchstart', startResize())
document.addEventListener('touchmove', resize())
document.addEventListener('touchend', stopResize())

function stopResize() {
    return () => {
        isResizing = false;
    };
}

function resize() {
    return (e) => {
        if (!isResizing) return;
        const lastY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const newMapHeight = lastY;
        const newGridHeight = window.innerHeight - lastY - splitter.offsetHeight;

        mapDiv.style.height = newMapHeight + 'px';
        gridDiv.style.height = newGridHeight + 'px';
        map.invalidateSize();
        gridApi.sizeColumnsToFit();

    };
}

function startResize() {
    return (e) => {
        isResizing = true;
    };
}

